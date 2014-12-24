
const ASSERT = require("assert");
const PATH = require("path");
const FS = require("fs-extra");
const GLOB = require("glob");
const Q = require("q");
const SEND = require("send");
const PIO = require("pio");
const WAITFOR = require("waitfor");
const VM = require("vm");

require("io.pinf.server.www").for(module, __dirname, function(app, _config, HELPERS) {

	var routes = null;

	function mapRoutes() {
		var _routes = {};
		return PIO.forPackage(__dirname).then(function(pio) {
			if (!pio._config["config.plugin"]) return;
			var all = [];
			Object.keys(pio._config["config.plugin"]).forEach(function(serviceId) {
				if (!_routes[serviceId]) {
					_routes[serviceId] = {};
				}
				console.log("Locate widgets for service '" + serviceId + "'");
				all.push(pio.locate(serviceId).then(function(serviceLocator) {
					if (!serviceLocator) {
						return;
					}
					var config = pio._config["config.plugin"][serviceId];
					var all = [];
					if (
						serviceLocator.aspects ||
						serviceLocator.aspects.source ||
						serviceLocator.aspects.source.basePath
					) {
						if (typeof config.widgets === "string") {
							config.widgets = {
								"__DEFAULT__": config.widgets
							};
						}
						Object.keys(config.widgets).forEach(function(group) {
							var selector = config.widgets[group];
							if (!Array.isArray(selector)) {
								selector = [ selector ];
							}
							selector.forEach(function(selector) {
								all.push(Q.denodeify(function(callback) {
									console.log("Locate widgets using '" + selector + "' in '" + serviceLocator.aspects.source.basePath + "'!");
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
			});
			return Q.all(all);
		}).then(function() {
			return _routes;
		});
	}


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
    	if (name) {
	    	name = name.replace(/\..+$/, "").split("/")[0];
	    }
    	if (!routes[serviceId][group]) {
    		if (routes[serviceId]["__DEFAULT__"] && routes[serviceId]["__DEFAULT__"][name]) {
    			group = "__DEFAULT__";
    		} else {
	    		return callback(new Error("No routes for serviceId '" + serviceId + " and group '" + group + "'!"));
	    	}
    	}
    	if (!routes[serviceId][group][name]) {
    		return callback(new Error("No route for serviceId '" + serviceId + " and group '" + group + "' and name '" + name + "'!"));
    	}
    	return callback(null, routes[serviceId][group][name]);
    }

    app.get(/^\/widget\/([^\/]+)(?:\/([^\/]+))?\/(.+)$/, function (req, res, next) {
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

    function loadWidget (path, callback) {
    	if (!loadWidget._widgets) {
    		loadWidget._widgets = {};
    	}
    	// TODO: Optionally disable widget cache (e.g. during dev mode)
    	if (loadWidget._widgets[path]) {
			console.log("Re-using widget:", path);
    		return callback(null, loadWidget._widgets[path]);
    	}
		console.log("Loading widget:", path);
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

			loadWidget._widgets[path] = globals.exports;

			return callback(null, globals.exports);
		} catch(err) {
			return callback(err);
		}
    }

    function processServiceRequest (req, res, next) {
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

					return loadWidget(path, function (err, exports) {
						if (err) return next(err);

						// TODO: Use local (service-specific) config for this helper function instead of config from this firewidgets service which is used by `HELPERS.sendEmail`.
						//var helpers = HELPERS.makeGlobalHelpers(pio);
						//for (var name in helpers) {
						//	res[name] = helpers[name];
						//}
						res.sendEmail = HELPERS.sendEmail;

						return exports.app(req, res, next);
					});
    			});
			});
    	});
    };
    app.get(/^\/service\/([^\/]+)(?:\/([^\/]+))?\/(.+)$/, processServiceRequest);
    app.post(/^\/service\/([^\/]+)(?:\/([^\/]+))?\/(.+)$/, processServiceRequest);


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

});
