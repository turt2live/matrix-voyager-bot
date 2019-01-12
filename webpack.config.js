const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const webpack = require("webpack");

const isProd = process.env.npm_lifecycle_event.startsWith('build');

const config = {};

if (isProd) config.devtool = 'source-map';
else config.devtool = 'eval-source-map';

config.mode = isProd ? 'production' : 'development';

config.resolve = {
    extensions: ['.js', '.ts'],
};

config.entry = {
    main: "./web/index.ts",
    vendor: "./web/vendor.ts",
};

config.output = {
    path: path.resolve(__dirname, 'build', 'web'), // output directory
    publicPath: isProd ? '/' : '/',
    filename: isProd ? 'js/[name].[hash].js' : 'js/[name].js',
    chunkFilename: isProd ? '[id].[hash].chunk.js' : '[id].chunk.js',
};

config.module = {
    rules: [
        {
            test: /\.css$/,
            loader: ["style-loader", "css-loader"]
        },
        {
            test: /\.ts$/,
            loader: ["awesome-typescript-loader", "angular2-template-loader"]
        },
        {
            test: /\.ts$/,
            enforce: "pre",
            loader: 'tslint-loader'
        },
        {
            test: /\.scss$/,
            loader: ["raw-loader", "sass-loader?sourceMap"]
        },
        {
            test: /\.html$/,
            loader: "html-loader"
        },
        {
            test: /\.(png|jpe?g|gif|svg|woff|woff2|ttf|eot|ico)(\?v=[0-9]\.[0-9]\.[0-9])?$/,
            loader: 'file-loader'
        },
    ]
};
config.optimization = {
    splitChunks: {
        cacheGroups: {
            vendor: {
                chunks: 'initial',
                name: 'vendor',
                test: 'vendor',
            },
        },
    }
};
config.plugins = [
    new HtmlWebpackPlugin({
        template: "web/index.html",
        inject: "body"
    }),
    new webpack.ContextReplacementPlugin(
        /(.+)?angular(\\|\/)core(.+)?/,
        root('./web'),
        {}
    ),
];
config.devServer = {
    historyApiFallback: true,
    disableHostCheck: true,
    quiet: true,
    stats: 'minimal',
    proxy: {
        '/api': {
            target: 'http://localhost:8185',
            secure: false
        }
    }
};

module.exports = config;

function root(args) {
    args = Array.prototype.slice.call(arguments, 0);
    return path.join.apply(path, [__dirname].concat(args));
}