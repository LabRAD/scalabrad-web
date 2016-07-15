'use strict';

// Include Gulp & Tools We'll Use
var gulp = require('gulp');
var gutil = require('gulp-util');
var htmlmin = require('gulp-htmlmin');
var $ = require('gulp-load-plugins')();
var sourcemaps = require('gulp-sourcemaps');
var tslint = require('gulp-tslint');
var tsc = require('gulp-typescript');
var typescript = require('typescript');
var del = require('del');
var runSequence = require('run-sequence');
var browserSync = require('browser-sync');
var merge = require('merge-stream');
var path = require('path');
var fs = require('fs');
var path = require('path');
var url = require('url');
var glob = require('glob');
var merge = require('merge2');
var exec = require('child_process').exec;
var jasmineBrowser = require('gulp-jasmine-browser');
var jasmine = require('gulp-jasmine');
var gitDescribe = require('git-describe');
var util = require('util');

var minimist = require('minimist');

var knownOptions = {
  string: 'api-host',
  default: { 
    'api-host': 'localhost:7667'
  }
};

var options = minimist(process.argv.slice(2), knownOptions);

var typescriptOptions = {
  typescript: typescript,
  target: 'ES6',
  module: 'ES6',
  declarationFiles: false,
  noExternalResolve: true,
  experimentalDecorators: true,
  emitDecoratorMetadata: true,
  noEmitOnError: true
};

var AUTOPREFIXER_BROWSERS = [
  'ie >= 10',
  'ie_mob >= 10',
  'ff >= 30',
  'chrome >= 34',
  'safari >= 7',
  'opera >= 23',
  'ios >= 7',
  'android >= 4.4',
  'bb >= 10'
];

// Get version of the client code from git
function gitVersion() {
  // use raw version from git-describe, but drop leading 'v'
  return gitDescribe.gitDescribeSync(__dirname).raw.substring(1);
}

// Get a tag that can be inserted in index.html to pass info to app
function metaTag(name, content) {
  // TODO: should properly escape strings here
  return '<meta name="' + name + '" content="' + content + '">';
}

// Lint all custom TypeScript files.
gulp.task('tslint', function () {
  return gulp.src('app/**/*.ts')
    .pipe(tslint())
    .pipe(tslint.report('prose'));
});

// Compile TypeScript and include references to library and app .d.ts files.
gulp.task('compile-ts', function () {
  var tsResult = gulp.src(['app/**/*.ts', 'typings/**/*.ts'])
    .pipe(sourcemaps.init())
    .pipe(tsc(typescriptOptions));

  return merge([
    tsResult.dts.pipe(gulp.dest('.tmp/app')),
    tsResult.js.pipe(sourcemaps.write('.')).pipe(gulp.dest('.tmp/app'))
  ]);
});

gulp.task('compile-test', function () {
  var tsResult = gulp.src(['app/**/*.ts','test/**/*.ts', 'typings/**/*.ts'])
    .pipe(sourcemaps.init())
    .pipe(tsc(typescriptOptions));

  return merge([
    tsResult.dts.pipe(gulp.dest('.tmp/')),
    tsResult.js.pipe(sourcemaps.write('.')).pipe(gulp.dest('.tmp/'))
  ]);
});

gulp.task('jasmine-browser', ['bundle-test'], function() {
  return gulp.src(['.tmp/testing/specBundle.js'])
    .pipe(jasmineBrowser.specRunner())
    .pipe(jasmineBrowser.server({port: 8888}));
});

/**
 * Build a self-executing javascript bundle using jspm.
 * Bundle configuration is found in config.js.
 */
function buildBundle(mainModule, outputFile, callback) {
  var template = 'npm run jspm bundle-sfx %s %s --skip-source-maps';
  var cmd = util.format(template, mainModule, outputFile);
  exec(cmd, function (err, stdout, stderr) {
    console.log(stdout);
    console.log(stderr);
    callback(err);
  });
}

/*
 * Create bundle of main app code.
 */
gulp.task('bundle', ['compile-ts'], function(callback) {
  buildBundle('app/scripts/app', '.tmp/scripts/bundle.js', callback);
});

/*
 * Create bundle of test code.
 */
gulp.task('bundle-test', ['compile-test', 'compile-ts'], function(callback) {
  buildBundle('spec/main', '.tmp/testing/spec-bundle.js', callback);
});


var styleTask = function (stylesPath, srcs) {
  return gulp.src(srcs.map(function(src) {
      return path.join('app', stylesPath, src);
    }))
    .pipe($.changed(stylesPath, {extension: '.css'}))
    .pipe($.autoprefixer(AUTOPREFIXER_BROWSERS))
    .pipe(gulp.dest('.tmp/' + stylesPath))
    .pipe($.if('*.css', $.cssmin()))
    .pipe(gulp.dest('dist/' + stylesPath))
    .pipe($.size({title: stylesPath}));
};

// Compile and Automatically Prefix Stylesheets
gulp.task('styles', function () {
  return styleTask('styles', ['**/*.css']);
});

gulp.task('elements', function () {
  return styleTask('elements', ['**/*.css']);
});

// Lint JavaScript
gulp.task('jshint', function () {
  return gulp.src([
      'app/scripts/**/*.js',
      'app/elements/**/*.js',
      'app/elements/**/*.html'
    ])
    .pipe(browserSync.reload({stream: true, once: true}))
    .pipe($.jshint.extract()) // Extract JS from .html files
    .pipe($.jshint())
    .pipe($.jshint.reporter('jshint-stylish'))
    .pipe($.if(!browserSync.active, $.jshint.reporter('fail')));
});

// Optimize Images
gulp.task('images', function () {
  return gulp.src('app/images/**/*')
    .pipe($.cache($.imagemin({
      progressive: true,
      interlaced: true
    })))
    .pipe(gulp.dest('dist/images'))
    .pipe($.size({title: 'images'}));
});

// Copy All Files At The Root Level (app)
gulp.task('copy', function () {
  var app = gulp.src([
    '.tmp/**/*.js',
    '.tmp/**/*.js.map',
    'app/*',
    '!app/test',
    '!app/precache.json'
  ], {
    dot: true
  }).pipe(gulp.dest('dist'));

  var bower = gulp.src(['bower_components/**/*'])
    .pipe(gulp.dest('dist/bower_components'));

  var elements = gulp.src(['app/elements/**/*.html'])
    .pipe(gulp.dest('dist/elements'));

  var swBootstrap = gulp.src(['bower_components/platinum-sw/bootstrap/*.js'])
    .pipe(gulp.dest('dist/elements/bootstrap'));

  var swToolbox = gulp.src(['bower_components/sw-toolbox/*.js'])
    .pipe(gulp.dest('dist/sw-toolbox'));

  var vulcanized = gulp.src(['app/elements/elements.html'])
    .pipe($.rename('elements.vulcanized.html'))
    .pipe(gulp.dest('dist/elements'));

  return merge(app, bower, elements, vulcanized, swBootstrap, swToolbox)
    .pipe($.size({title: 'copy'}));
});

// Copy Web Fonts To Dist
gulp.task('fonts', function () {
  return gulp.src(['app/fonts/**'])
    .pipe(gulp.dest('dist/fonts'))
    .pipe($.size({title: 'fonts'}));
});

// Scan Your HTML For Assets & Optimize Them
gulp.task('html', function () {
  var assets = $.useref.assets({searchPath: ['.tmp', 'app', 'dist']});

  return gulp.src(['app/**/*.html', '!app/{elements,test}/**/*.html'])
    // Add version info
    .pipe($.if('*.html', $.replace('<!-- DEV_MODE_CONFIG -->',
                                   metaTag("labrad-clientVersion", gitVersion()))))
    // Replace path for vulcanized assets
    .pipe($.if('*.html', $.replace('elements/elements.html', 'elements/elements.vulcanized.html')))
    .pipe(assets)
    // Concatenate And Minify JavaScript
    .pipe($.if('*.js', $.uglify({preserveComments: 'some'})))
    // Concatenate And Minify Styles
    // In case you are still using useref build blocks
    .pipe($.if('*.css', $.cssmin()))
    .pipe(assets.restore())
    .pipe($.useref())
    // Minify Any HTML
    .pipe($.if('*.html', htmlmin({
      collapseWhitespace: true
    })))
    // Output Files
    .pipe(gulp.dest('dist'))
    .pipe($.size({title: 'html'}));
});

// Inject dev mode app configuration into index.html.
gulp.task('insert-dev-config', function () {
  return gulp.src(['app/index.html'])
    .pipe($.replace('<!-- DEV_MODE_CONFIG -->', [
                      '<!-- DEV_MODE_CONFIG -->',
                      metaTag("labrad-apiHost", "ws://" + options['api-host']),
                      metaTag("labrad-clientVersion", gitVersion())
                    ].join("\n    ")))
    .pipe(gulp.dest('.tmp'));
});

// Vulcanize imports
gulp.task('vulcanize', function () {
  var DEST_DIR = 'dist/elements';

  return gulp.src('dist/elements/elements.vulcanized.html')
    .pipe($.vulcanize({
      dest: DEST_DIR,
      strip: true,
      inlineCss: true,
      inlineScripts: true
    }))
    .pipe(gulp.dest(DEST_DIR))
    .pipe($.size({title: 'vulcanize'}));
});

// Generate a list of files that should be precached when serving from 'dist'.
// The list will be consumed by the <platinum-sw-cache> element.
gulp.task('precache', function (callback) {
  var dir = 'dist';

  glob('{elements,scripts,styles}/**/*.*', {cwd: dir}, function(error, files) {
    if (error) {
      callback(error);
    } else {
      files.push('index.html', './', 'bower_components/webcomponentsjs/webcomponents.min.js');
      var filePath = path.join(dir, 'precache.json');
      fs.writeFile(filePath, JSON.stringify(files), callback);
    }
  });
});

// Clean Output Directory
gulp.task('clean', del.bind(null, ['.tmp', 'dist']));

// Watch Files For Changes & Reload
gulp.task('serve', ['bundle', 'insert-dev-config', 'styles', 'elements', 'images'], function () {
  var folder = path.resolve(__dirname, ".");
  browserSync({
    notify: false,
    open: false,
    server: {
      baseDir: ['.tmp', 'app'],
      routes: {
        '/bower_components': 'bower_components'
      },
      middleware: function(req, res, next) {
        var fileName = url.parse(req.url);
        fileName = fileName.href.split(fileName.search).join("");
        var fileExists = fs.existsSync(folder + fileName) ||
                         fs.existsSync(folder + '/.tmp' + fileName) ||
                         fs.existsSync(folder + '/app' + fileName);
        if (!fileExists && fileName.indexOf("browser-sync-client") < 0) {
          console.log("request for", req.url, "rewritten to /index.html");
          req.url = "/index.html";
        }
        return next();
      }
    }
  });

  var reload = browserSync.reload;
  gulp.watch(['app/**/*.html'], reload);
  gulp.watch(['app/styles/**/*.css'], ['styles', reload]);
  gulp.watch(['app/elements/**/*.css'], ['elements', reload]);
  gulp.watch(['app/{scripts,elements}/**/*.js'], ['jshint', reload]);
  gulp.watch(['app/{scripts,elements}/**/*.ts'], ['bundle', reload]);
  gulp.watch(['app/images/**/*'], reload);
});

gulp.task('test', ['bundle-test'], function() {
  return gulp
    .src('.tmp/testing/spec-bundle.js')
    .pipe(jasmine());
});

gulp.task('watch', function () {
  watch('**/*.js', batch(function (events, done) {
      gulp.start('build', done);
  }));
});

gulp.task('test-watch', function () {
  gulp.watch(['app/{scripts,elements}/**/*.ts'], ['test']);
});

// Build and serve the output from the dist build
gulp.task('serve:dist', ['default'], function () {
  browserSync({
    notify: false,
    open: false,
    server: 'dist'
  });
});

// Build Production Files, the Default Task
gulp.task('default', ['clean'], function (cb) {
  runSequence(
    'bundle',
    ['copy', 'styles'],
    'elements',
    ['jshint', 'images', 'fonts', 'html'],
    'vulcanize', 'precache',
    cb);
});

// Load custom tasks from the `tasks` directory
try { require('require-dir')('tasks'); } catch (err) {}
