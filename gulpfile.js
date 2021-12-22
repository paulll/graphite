const { src, dest, parallel, series } = require('gulp');
const pug = require('gulp-pug');
const styl = require('gulp-stylus');
const watch = require('gulp-watch');
const ghpages = require('gh-pages');
const path = require('path');
const util = require('util');

const html = () => src('views/*.pug')
	.pipe(pug())
	.pipe(dest('site'));
const css = () => src(['style/*.styl', 'style/*.css'])
	.pipe(styl({compress: true}))
	.pipe(dest('site/style'));
const js = () => src('js/**/*')
	.pipe(dest('site/js'));

const html_stream = () => watch('views/*.pug')
	.pipe(pug())
	.pipe(dest('site'));
const css_stream = () => watch(['style/*.styl', 'style/*.css'])
	.pipe(styl({compress: true}))
	.pipe(dest('site/style'));
const js_stream = () => watch('js/**/*.js')
	.pipe(dest('site/js'));

const publish = async () => await util.promisify(ghpages.publish)(path.join(__dirname, 'site'))

exports.watch = parallel(html_stream, css_stream, js_stream);
exports.default = parallel(html, js, css);
exports.publish = series(exports.default, publish);