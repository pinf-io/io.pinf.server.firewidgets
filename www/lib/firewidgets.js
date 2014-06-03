
define([
	"./lib/q.js",
	"./lib/eventemitter2.js",
	"./lib/doT.js",
], function(Q, EVENTS, DOT) {

	var config = {
		tagName: "x-widget"
	};

	function scan(node) {

		var all = [];

		$("[" + config.tagName + "]", node).each(function() {

			var domNode = $(this);
			var uri = config.widgetBaseUri + "/" + domNode.attr(config.tagName) + ".js";

			//console.log("... found widget:", domNode.attr(config.tagName));

			all.push(Q.denodeify(function(callback) {
				return require([
					uri
				], function(client) {
					if (!client) {
						return callback(new Error("Client implementation for widget not found at URI '" + uri + "'!"));
					}
					var data = domNode.attr(config.tagName + "-data");
					/*
					if (data) {
						if (/^__ref__:\d+$/.test(data)) {
							data = vars[parseInt(data.substring(8))];
						}
					}
					*/

					var Widget = function() {
						var self = this;

						self.config = config;

						self.widget = {
							id: domNode.attr(config.tagName)
						};

						self.tag = domNode;

						self.tagConfig = {
							replace: (domNode.attr(config.tagName + "-replace") === "true")
						}

						self.server = {
							attachToStream: function(uri) {
								function fetch() {
									var deferred = Q.defer();
									try {
										$.ajax({
											type: 'GET',
											url: uri,
											timeout: 10 * 1000,
											context: self.tag,
											crossDomain: true,
											xhrFields: {
												withCredentials: true
											},
											success: function(response, textStatus, jqXHR) {
												var data = null;
												if (typeof response === "string") {
													try {
														data = JSON.parse(response);
													} catch(err) {
														return deferred.reject("Error parsing data response from uri '" + uri + "':", err.stack);
													}
												} else {
													data = response;
												}
												var m = (jqXHR.getResponseHeader("cache-control") || "").match(/max-age=(\d+)/);
												return deferred.resolve({
													data: data,
													maxAge: (m && parseInt(m[1])) || 0
												});
											},
											error: function(xhr, type) {
												console.error("Error fetching from '" + uri + "'");
												console.error("xhr", xhr);
												console.error("type", type);
												return deferred.reject(new Error("Error fetching from '" + uri + "'"));
											}
										});
									} catch(err) {
										deferred.reject(err);
									}
									return deferred.promise;
								}
								return fetch().then(function (response) {
									var deferred = Q.defer();
									try {
										var Stream = function(mode, data) {
											this.mode = mode;
											this.data = data;
										}
										Stream.prototype = new EVENTS();
										var stream = null;
										// Init a stream that fires data events if a cache control
										// header is found (in which case we refetch after ttl expires)
										// or a stream that will have its data property set and only one data event fired
										// right after the data handler has been initialized.
										if (response.maxAge) {
											stream = new Stream("multiple", response.data);
											function fetchAgain() {
												return fetch().then(function (response) {
													if (response.maxAge) {
														setTimeout(fetchAgain, response.maxAge * 1000);
													}
													stream.emit("data", response.data);
													// All done.
													return;
												}).fail(function (err) {
													console.error("Error re-fetching stream '" + uri + "'", err);
													// Nothing more to do with error.
													return;
												});
											}
											setTimeout(fetchAgain, response.maxAge * 1000);
										} else {
											stream = new Stream("single", response.data);
										}
										deferred.resolve(stream);
									} catch(err) {
										deferred.reject(err);
									}										
									return deferred.promise;
								});
							},
							getResource: function(uri) {
								if (/^\.\//.test(uri)) {
									uri = self.config.widgetBaseUri + "/" + uri;
								}
								var deferred = Q.defer();
								try {
									// @source http://stackoverflow.com/a/4825700/330439
									function getCookie(c_name) {
									    if (document.cookie.length > 0) {
									        c_start = document.cookie.indexOf(c_name + "=");
									        if (c_start != -1) {
									            c_start = c_start + c_name.length + 1;
									            c_end = document.cookie.indexOf(";", c_start);
									            if (c_end == -1) {
									                c_end = document.cookie.length;
									            }
									            return unescape(document.cookie.substring(c_start, c_end));
									        }
									    }
									    return "";
									}									
									$.ajax({
										type: 'GET',
										url: uri,
										timeout: 10 * 1000,
										context: self.tag,
										crossDomain: true,
										xhrFields: {
											withCredentials: true
										},
										success: function(response) {
											return deferred.resolve(response);
										},
										error: function(xhr, type) {
											console.error("Error fetching from '" + uri + "'");
											console.error("xhr", xhr);
											console.error("type", type);
											return deferred.reject(new Error("Error fetching from '" + uri + "'"));
										}
									});
								} catch(err) {
									deferred.reject(err);
								}
								return deferred.promise;
							}
						};
					}
					Widget.prototype = new EVENTS();
					Widget.prototype.API = {
						Q: Q,
						EVENTS: EVENTS,
						DOT: DOT
					}
					Widget.prototype.hook = function(_resources, _streams, listeners) {
						var self = this;

						var resources = {};
						for (var id in _resources) {
							resources[id] = self.API.Q.defer();			
						}
						function loadResources() {
							return self.API.Q.all(Object.keys(resources).map(function(id) {
								return self.server.getResource(_resources[id]).then(function(html) {
									resources[id].resolve(html);
									return;
								}).fail(function(err) {
									resources[id].reject(err);
									throw err;
								});
							}));
						}

						var streams = {};
						for (var id in _streams) {
							streams[id] = self.API.Q.defer();
						}
						function attachToStreams() {
							return self.API.Q.all(Object.keys(streams).map(function(id) {
								return self.server.attachToStream(_streams[id]).then(function(stream) {
									streams[id].resolve(stream);
									return;
								}).fail(function(err) {
									streams[id].reject(err);
									throw err;
								});
							}));
						}

						function setupListeners() {
							listeners.forEach(function(listener) {
								var all = [];
								if (listener.resources) {
									listener.resources.forEach(function(resource) {
										all.push(resources[resource].promise);
									});
								}
								if (listener.streams) {
									listener.streams.forEach(function(stream) {
										all.push(streams[stream].promise);
									});
								}
								return self.API.Q.all(all).spread(function() {
									var args = Array.prototype.slice.call(arguments, 0);
									try {
										return listener.handler.apply(null, args);
									} catch(err) {
										// TODO: Attach context to error.
										console.error("Handler Error", err);
										// TODO: Make sure this error propagates!
										throw err;
									}
								}).then(function() {
									listener.streams.forEach(function(stream) {
										streams[stream].promise.then(function(stream) {
											stream.emit("data", stream.data);
											if (stream.mode === "multiple") {
												stream.data = null;
											}
										});
									});
								});
							});
							return self.API.Q.resolve();
						}

						return self.API.Q.all([
							setupListeners(),
							attachToStreams(),
							loadResources()
						]);
					}
					Widget.prototype.setHTM = function(htm, data, mode) {
						var self = this;
						return self.API.Q.denodeify(function(callback) {
							var compiled = null;
							try {
								compiled = self.API.DOT.template(htm);
							} catch(err) {
								console.error("htm", htm);
								return callback(new Error("Error compiling htm"));
							}
							if (typeof mode === "undefined") {
								mode = self.tagConfig.replace ? "replace": "content";
							}
							if (mode === "replace") {
								self.tag.replaceWith((domNode = $(compiled(data))));
							} else
							if (mode === "content") {
								self.tag.html(compiled(data));
							} else {
								return callback(new Error("Unrecognized render mode '" + mode + "'!"));
							}
							return callback(null, self.tag);
						})();
					}

					var widget = new Widget();

					return Q.timeout(client.call(widget), 10 * 1000).then(function() {
						//console.log("Scan node for widgets:", uri, domNode.html());
						return Q.timeout(scan(domNode), 10 * 1000).fail(function(err) {
							console.error("Widget rendering error:", err.stack);
							throw err;
						});						
					}).then(function() {
						return callback(null);
					}).fail(callback);
				});
			})());
		});

		return Q.all(all);
	}

	return {
		init: function(_config) {
			// TODO: deepmerge `_config` on top of `config`.
			_config.tagName = _config.tagName || config.tagName;
			config = _config;
			return scan($("html")).fail(function(err) {
				console.error("Widget rendering error:", err.stack);
				throw err;
			});
		}
	}

});
