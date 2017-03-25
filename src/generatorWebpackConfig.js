var paths = require('./util/path.js');
var Utils = require('./util/utils.js');
var webpackUtils = require('./util/webpack-utils.js');
var os = require('os');
var path = require('path'),
  fs = require('fs'),
  logger = require('./logger'),
  webpack = require('webpack'),
  glob = require('glob'),
  ExtractTextPlugin = require('extract-text-webpack-plugin');
var OptimizeCSSPlugin = require('optimize-css-assets-webpack-plugin')
getbabelConfig = require('./babel');
var HtmlWebpackPlugin = require('html-webpack-plugin');

/**
 * only given props will be used
 *     entry
 *     output
 *     module: loaders: will be merged with project plugins
 *     resolve
 *     resolveLoader
 *     plugins: will be merged with project plugins
 *     externals
 *     postcss
 */

const initDefaultWebpackConf = function(conf, isDebug, fullConf) {

  var babelOptions = getbabelConfig(fullConf, isDebug);

  var webpackconf = {
    entry: {},
    output: {
      path: `${process.cwd()}/${conf.root}/`,
      filename: '[name].[hash:7].js',
      publicPath: `${conf.publicPath}`
    },
    module: {
      rules: [{
        test: /\.(ico|jpg|png|gif|svg|eot|otf|webp|ttf|woff|woff2)(\?.*)?$/,
        loader: "url-loader",
        query: {
          limit: 10000,
          name: "[path][name].[hash:7].[ext]"
        }
      }, {
        test: /\.vue$/,
        loader: 'vue-loader',
        options: {
          loaders: webpackUtils.cssLoaders({
            sourceMap: isDebug,
            extract: !isDebug,
            from: 'vue'
          })
        }
      },{
        test: /\.html?$/,
        loader: 'html-loader'
      }, {
        test: /\.tpl?$/,
        loader: 'ejs-loader'
      }, {
        test: /\.json$/,
        loader: 'json-loader',
      }, {
        test: /\.(jsx|js)?$/,
        exclude: /(node_modules|bower_components)/,
        use: [{
          loader: 'babel-loader',
          options: babelOptions
        }]
      }]
    },
    resolve: {
      extensions: ['.js', '.vue', '.json'],
      alias: {
        'vue$': 'vue/dist/vue.esm.js',
        '@': path.join(process.cwd(), 'src'),
      },
      modules: [
        // project node modules
        path.join(process.cwd(), 'node_modules'),
        // hey node modules
        path.join(__dirname, "..", 'node_modules'),
        // all global node modules
        path.join(paths.join(path.sep), 'node_modules')
      ],
    },
    resolveLoader: {
      modules: [
        // project node modules
        path.join(process.cwd(), 'node_modules'),
        // hey node modules
        path.join(__dirname, "..", 'node_modules'),
        // all global node modules
        path.join(paths.join(path.sep), 'node_modules')
      ]
    },
    devtool: (isDebug ? '#eval' : false),
    plugins: [
      new webpack.LoaderOptionsPlugin({
        options: {
          minimize: !isDebug,
          debug: isDebug,
          context: process.cwd(),
          babel: babelOptions,
          postcss: [
              require('autoprefixer')
          ]
        }
      }),
      new webpack.DefinePlugin({
        WEBPACK_DEBUG: isDebug,
        'process.env': {
          NODE_ENV: (isDebug ? '"development"' : '"production"')
        }
      }),
    ],
    externals: fullConf.webpack.externals
  };

  let stylels = webpackUtils.styleLoaders({
    sourceMap: isDebug,
    extract: !isDebug
  });

  for (var i = 0; i < stylels.length; i++) {
    webpackconf.module.rules.push(stylels[i]);
  }

  if (isDebug) {
  } else {
    webpackconf.plugins.push(
      new webpack.optimize.UglifyJsPlugin({
        compress: {
          warnings: false
        },
        sourceMap: false
      }),
      new OptimizeCSSPlugin({
        cssProcessorOptions: {
          safe: true
        }
      }),
      new ExtractTextPlugin({
        filename: 'css/[name].[contenthash].css',
        allChunks: true
      }),
      new webpack.optimize.OccurrenceOrderPlugin()
    );
  }
  return webpackconf;
};

function initCommonOutputPlugins(genWebpack, webpackconf, isDebug) {
  let comObj = {}
    // check relationship between chunk and common
  if (webpackconf.commonTrunk) {
    for (let key in webpackconf.commonTrunk) {
      comObj[key] = [];
    }
  }

  // add output
  if (webpackconf.output) {
    for (let key in webpackconf.output) {
      let files = glob.sync(key);
      let resObj = webpackconf.output[key];
      files.forEach((file) => {
        let entry = file.replace('.html', '');
        if (resObj && resObj.jsname) {
          entry = resObj.jsname;
        }
        genWebpack.entry[entry] = './' + entry;

        let name = './' + file;
        let depends = [];
        if (resObj && resObj.commons) {
          resObj.commons.map((common) => {
            depends.push(common);
            comObj[common].push(entry);
          });
          Array.prototype.push.apply(depends, resObj.commons);
        } else {
          if (webpackconf.commonTrunk) {
            for (let key in webpackconf.commonTrunk) {
              depends.push(key);
              comObj[key].push(entry);
            }
          }
        }
        depends.push(file.replace('.html', ''));
        var plugin_obj = {
          template: name,
          filename: file,
          chunks: depends
        };

        if(!isDebug){
          Utils.extend(plugin_obj,{
            inject: true,
            minify: {
              removeComments: true,
              collapseWhitespace: true,
              removeAttributeQuotes: true
            },
            chunksSortMode: 'dependency'
          })
        }

        genWebpack.plugins.push(new HtmlWebpackPlugin(plugin_obj));
      })
    }
  }

  // add common trunk
  if (webpackconf.commonTrunk) {
    for (let key in webpackconf.commonTrunk) {
      genWebpack.entry[key] = webpackconf.commonTrunk[key];
      genWebpack.plugins.push(new webpack.optimize.CommonsChunkPlugin({
        name: key,
        chunks: comObj[key]
      }))
    }
  }

  if (webpackconf.global) {
    var globals = {};
    for (var key in webpackconf.global) {
      if (webpackconf.global[key].startsWith('./') || webpackconf.global[key].startsWith('../')) {
        globals[key] = path.resolve(webpackconf.global[key]);
      }
    }

    logger.debug('ProvidePlugin config from package.json:');
    logger.debug(globals);

    genWebpack.plugins.push(new webpack.ProvidePlugin(globals));
  }

  return genWebpack;
}

function parseEntry(config, entry, isDebug) {
  if (entry) {
    if (Utils.isString(entry)) {
      entry = [entry];
      if (isDebug) {
        entry.unshift(`webpack-dev-server/client?http://localhost:${config.port}`, 'webpack/hot/dev-server');
      }
    } else if (Utils.isArray(entry)) {
      if (isDebug) {
        entry.unshift(`webpack-dev-server/client?http://localhost:${config.port}`, 'webpack/hot/dev-server');
      }
    } else if (Utils.isObject(entry)) {
      for (var key in entry) {
        entry[key] = parseEntry(config, entry[key], isDebug);
      }
    }
    return entry;
  } else {
    logger.error('No entry is found!');
  }
}

module.exports = function(conf, isDebug) {
  var webpackConfig = conf.webpack || {};
  var genWebpack = initDefaultWebpackConf(webpackConfig, isDebug, conf);
  genWebpack = initCommonOutputPlugins(genWebpack, webpackConfig, conf ,isDebug);
  genWebpack.entry = parseEntry(conf, genWebpack.entry, isDebug);

  if (isDebug) {
    genWebpack.plugins.push(new webpack.HotModuleReplacementPlugin());
    var IPv4 = "localhost";
    if (os) {
      for (var i = 0; i < os.networkInterfaces().en0.length; i++) {
        if (os.networkInterfaces().en0[i].family == 'IPv4') {
          IPv4 = os.networkInterfaces().en0[i].address;
        }
      }
    }
    genWebpack.output.publicPath = `http://${IPv4}:${conf.port}/`;
  }
  logger.info('server start with webpack config: ');
  // logger.info(genWebpack);
  // logger.info(genWebpack.module.rules);
  return genWebpack;
}