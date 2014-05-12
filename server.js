
const ASSERT = require("assert");
const PATH = require("path");
const FS = require("fs-extra");
const EXPRESS = require("express");
const GLOB = require("glob");
const Q = require("q");
const SEND = require("send");
const PIO = require("pio");
const WAITFOR = require("waitfor");
const VM = require("vm");


var PORT = process.env.PORT || 8080;

exports.main = function(callback) {
	try {

		var routes = null;

		function mapRoutes() {
			var _routes = {};
			return PIO.forPackage(__dirname).then(function(pio) {
				if (!pio._config["config.plugin"]) return;
				var all = [];
				for (var serviceId in pio._config["config.plugin"]) {
					if (!_routes[serviceId]) {
						_routes[serviceId] = {};
					}
					all.push(pio.locate(serviceId).then(function(serviceLocator) {
						var config = pio._config["config.plugin"][serviceId];
						var all = [];
						if (
							serviceLocator.aspects ||
							serviceLocator.aspects.source ||
							serviceLocator.aspects.source.basePath
						) {
							Object.keys(config.widgets).forEach(function(group) {
								var selector = config.widgets[group];
								if (!Array.isArray(selector)) {
									selector = [ selector ];
								}
								selector.forEach(function(selector) {
									all.push(Q.denodeify(function(callback) {
										return GLOB(selector, {
											cwd: serviceLocator.aspects.source.basePath
										}, function (err, paths) {
											if (err) return callback(err);
											if (paths.length === 0) return callback(null);


											if (!_routes[serviceId][group]) {
												_routes[serviceId][group] = {};
											}
											paths.forEach(function(path) {
												path = PATH.join(serviceLocator.aspects.install.basePath, path);

												var filename = PATH.basename(path);
												var m = filename.match(/^([a-zA-Z0-9-_\.]+?)(\.json\.service\.js)?$/);

												if (!_routes[serviceId][group][m[1]]) {
													_routes[serviceId][group][m[1]] = {};
												}
												if (m[2]) {
													_routes[serviceId][group][m[1]].service = path;
												} else {
													_routes[serviceId][group][m[1]].widget = path;
												}
											});
											return callback(null);
										});
									})());
								});
							});
						}
						return Q.all(all);
					}));
				}
				return Q.all(all);
			}).then(function() {
				return _routes;
			});
		}

	    var app = EXPRESS();

	    app.configure(function() {
	        app.use(EXPRESS.logger());
	        app.use(EXPRESS.cookieParser());
	        app.use(EXPRESS.bodyParser());
	        app.use(EXPRESS.methodOverride());
	        app.use(app.router);
	    });

	    app.get("/favicon.ico", function (req, res, next) {
	    	return res.end();
	    });


	    function ensureRoutes(res, next) {
	    	if (routes) {
	    		return next();
	    	}
	    	res.writeHead(503);
	    	return res.end("Initializing ...");
	    }

	    function locateRoute(serviceId, group, name, callback) {
	    	if (!routes[serviceId]) {
	    		return callback(new Error("No routes for serviceId '" + serviceId + "'!"));
	    	}
	    	if (!routes[serviceId][group]) {
	    		return callback(new Error("No routes for serviceId '" + serviceId + " and group '" + group + "'!"));
	    	}
	    	name = name.replace(/\..+$/, "").split("/")[0];
	    	if (!routes[serviceId][group][name]) {
	    		return callback(new Error("No route for serviceId '" + serviceId + " and group '" + group + "' and name '" + name + "'!"));
	    	}
	    	return callback(null, routes[serviceId][group][name]);
	    }

	    app.get(/^\/widget\/([^\/]+)\/([^\/]+)\/(.+)$/, function (req, res, next) {
	    	return ensureRoutes(res, function(err) {
	    		if (err) return next(err);
	    		return locateRoute(req.params[0], req.params[1], req.params[2], function(err, route) {
	    			if (err) return next(err);
	    			if (!route.widget) {
	    				res.writeHead(404);
	    				return res.end();
	    			}
	    			var filepath = "/" + req.params[2];
	    			var filepathParts = filepath.split("/");
	    			if (filepathParts.length > 2) {
	    				filepathParts.splice(1, 1);
	    			}
	    			filepath = filepathParts.join("/");
					return SEND(req, filepath).root(route.widget).on('error', next).pipe(res);
	    		});
	    	});
	    });

	    app.get(/^\/service\/([^\/]+)\/([^\/]+)\/(.+)$/, function (req, res, next) {
	    	return ensureRoutes(res, function(err) {
	    		if (err) return next(err);
	    		return locateRoute(req.params[0], req.params[1], req.params[2], function(err, route) {
	    			if (err) return next(err);
	    			if (!route.service) {
	    				res.writeHead(404);
	    				return res.end();
	    			}
	    			var path = route.service;
	    			return FS.exists(path, function(exists) {
	    				if (!exists) {
	    					console.error("Error: No service found at: " + path);
	    				}

						console.log("Call service:", path);

						var API = {
							GLOB: GLOB
						};

						function eval(path) {
							try {
						    	// NOTE: If there are sytnax errors in code this will print
						    	//		 error to stdout (if fourth argument set to `true`).
						    	//		 There is no way to capture errors from here.
						    	// @see https://github.com/joyent/node/issues/1307#issuecomment-1551157
						    	// TODO: Find a better solution to handle errors here.
						    	// TODO: Capture errors by watching this processe's stdout file log from
						    	//		 another process.
						    	var globals = {
						        	// TODO: Wrap to `console` object provided by `sandboxOptions` and inject module info.
						        	console: console,
						        	// NodeJS globals.
						        	// @see http://nodejs.org/docs/latest/api/globals.html
						        	global: global,
						        	process: process,
						        	Buffer: Buffer,
						        	setTimeout: setTimeout,
						        	clearTimeout: clearTimeout,
						        	setInterval: setInterval,
						        	clearInterval: clearInterval,
						        	setImmediate: setImmediate,
						        	require: require,
						        	exports: {},
						        	__dirname: PATH.dirname(path)
						    	};
						        VM.runInNewContext(FS.readFileSync(path), globals, path, true);

								if (typeof globals.exports.app !== "function") {
									return next(new Error("Service '" + path + "' does not export `app` function!"));
								}

								return globals.exports.app(req, res, next);

							} catch(err) {
								return next(err);
							}
						}

						return eval(path);

	    			});
				});
	    	});
	    });


	    app.get(/^\//, function (req, res, next) {
			return SEND(req, req._parsedUrl.pathname)
				.root(PATH.join(__dirname, "www"))
				.on('error', next)
				.pipe(res);
	    });

		var server = app.listen(PORT);

		console.log("Listening at: http://localhost:" + PORT);

		function doMapRoutes() {
			return mapRoutes().then(function(_routes) {
				if (JSON.stringify(routes) !== JSON.stringify(_routes)) {
					console.log("Mapped routes:", JSON.stringify(_routes, null, 4));
				}
				routes = _routes;
			}).fail(function(err) {
				console.error("Error mapping routes!", err.stack);
			});
		}

		// TODO: Only rescan on reload!
		setInterval(doMapRoutes, 15 * 1000);
		doMapRoutes();

	    return callback(null, {
	        server: server
	    });
	} catch(err) {
		return callback(err);
	}
}

if (require.main === module) {
	return exports.main(function(err) {
		if (err) {
			console.error(err.stack);
			process.exit(1);
		}
		// Keep server running.
	});
}
