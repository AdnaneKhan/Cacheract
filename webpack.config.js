const path = require('path');
const TerserPlugin = require('terser-webpack-plugin');
const webpack = require('webpack');

module.exports = {
  entry: './src/index.ts',
  output: {
    filename: 'bundle.js',
    path: path.resolve(__dirname, 'dist')
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude: /node_modules/,
        use: 'ts-loader'
      },
      {
        test: /assets\/.*\.(yml|py)/,
        type: 'asset/source'
      }
    ]
  },
  resolve: {
    extensions: ['.ts', '.js']
  },
  target: 'node',
  optimization: {
    minimize: true,
    minimizer: [new TerserPlugin({ terserOptions: { mangle: true, compress: { drop_console: true } } })]
  },
  plugins: [
    new webpack.DefinePlugin({
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV)
    })
  ],
  mode: process.env.NODE_ENV === 'development' ? 'development' : 'production'
};