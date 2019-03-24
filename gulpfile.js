const { src, dest, parallel } = require('gulp');
const pug = require('gulp-pug');
const styl = require('gulp-stylus');
const watch = require('gulp-watch');

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

exports.watch = parallel(html_stream, css_stream, js_stream);
exports.default = parallel(html, js, css);