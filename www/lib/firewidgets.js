
define([
	"./lib/q.js",
	"./lib/eventemitter2.js",
	"./lib/doT.js",
], function(Q, EVENTS, DOT) {

	const DEBUG = false;
	var API = null;

	var widgetCounter = 0;

	var config = {
		tagName: "x-widget"
	};

	function scan(node, parent, options) {

		options = options || {};

		var widgets = [];

		var all = [];

		function processNode (domNode) {

			var uri = config.widgetBaseUri + "/" + domNode.attr(config.tagName) + ".js";

			if (DEBUG) console.log("... found widget:", domNode.attr(config.tagName));

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

					var Widget = function(domNode, parent) {
						var self = this;

						self.parent = parent || null;

						self.tag = domNode;
						self.tag[0]._firewidget = this;

						self.config = config;

						self.widget = {
							id: self.tag.attr(config.tagName),
							index: (++ widgetCounter)
						};

						self.tagContent = self.tag.html();

						self.tagConfig = {
							replace: (self.tag.attr(config.tagName + "-replace") === "true")
						}

						// Public API that this widget exposes. Specifically usable by parent and child widgets.
						self.api = {};

						self.server = {
							attachToStream: function(uri) {
								function fetch (stream) {
									console.log("Fetch for widget id '", self.widget.id, "' and index '", self.widget.index);
									var deferred = Q.defer();
									try {
										var request = {
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
										};
										if (stream && stream.filter) {
											console.log("apply filter", stream.filter);
											request.type = "POST";
											request.data = JSON.stringify({
												"filter": stream.filter
											});
											request.contentType = "application/json";
										}
										$.ajax(request);
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
											this.filter = null;
										}
										Stream.prototype = new EVENTS();
										Stream.prototype.setFilter = function(filter) {
											this.filter = filter;
											if (this.resubscribe) {
												return this.resubscribe();
											}
										}
										var stream = null;
										// Init a stream that fires data events if a cache control
										// header is found (in which case we refetch after ttl expires)
										// or a stream that will have its data property set and only one data event fired
										// right after the data handler has been initialized.
										if (response.maxAge) {
											stream = new Stream("multiple", response.data);
											function scheduleFetchAgain(maxAge) {
												var fetchAgainId = setTimeout(function () {
													console.log("fetching again after maxAge", maxAge);
													self.removeListener("destroy", destroyListener);
													fetchAgainId = null;
													return fetchAgain();
												}, maxAge * 1000);
												var destroyListener = function () {
													if (!fetchAgainId) return;
													clearTimeout(fetchAgainId);
													fetchAgainId = null;
													console.log("Stopped next scheduled fetch for widget id '", self.widget.id, "' and index '", self.widget.index);
												};
												self.once("destroy", destroyListener);
											}
											function fetchAgain(oneTime) {
												if (!self.tag) {
													// Tag has been removed so we stop!
													return Q.resolve();
												}
												return fetch(stream).then(function (response) {
													if (response.maxAge && !oneTime) {
														scheduleFetchAgain(response.maxAge);
													}
													stream.emit("data", response.data);
													// All done.
													return;
												}).fail(function (err) {
													console.error("Error re-fetching stream '" + uri + "'", err);
													if (oneTime) throw err;
													// TODO: Back off gradually.
													setTimeout(fetchAgain, 15 * 1000);
													return;
												});
											}
											scheduleFetchAgain(response.maxAge);
											stream.resubscribe = function () {
												return fetchAgain(true);
											}
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
					Widget.prototype.API = API;
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
									if (!self.tag) {
										// Tag has been removed so we don't handle!
										return;
									}
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
						data = data || {};
						data = self.API.DEEPMERGE(data, window.API.config);
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
								// NOTE: Replacing nodes is not so trivial.
								//       The new tag should be assigned to `self.tag`.
								throw new Error("Node replacement not yet implemented!");
							} else
							if (mode === "content") {
								if (self.tag) {
									self.tag.html(compiled(data));
								}
							} else {
								return callback(new Error("Unrecognized render mode '" + mode + "'!"));
							}
							return callback(null, self.tag);
						})().then(function (tag) {
							if (DEBUG) console.log("Scan node for widgets ID:", self.widget.id);
							if (DEBUG) console.log("HTML:", tag.html());
							return Q.timeout(scan(tag, self), 10 * 1000).then(function(subWidgets) {
								widgets = widgets.concat(subWidgets);
							}).then(function() {
								return tag;
							}).fail(function(err) {
								console.error("Widget rendering error:", err.stack);
								throw err;
							});
						}).fail(function(err) {
							console.log("data", data);
							console.error("Error rendering widget", err.stack);
							throw err;
						});
					}
					Widget.prototype.destroy = function() {
						var self = this;

						if (self.tag === null) {
							// Already destroyed!
							return;
						}

						console.log("Destroy widget id '", self.widget.id, "' and index '", self.widget.index);
						self.tag.html("");
						self.tag = null;
						self.emit("destroy");

						console.log("Destroying child widgets", widgets);
						widgets.forEach(function (widget) {
							if (widget === self) return;
							widget.destroy();
						});
					}

					var widget = new Widget(domNode, parent || null);

					widgets.push(widget);

					return Q.timeout(client.call(widget), 30 * 1000).fail(function(err) {
						console.error("Widget rendering error:", err, err.stack);
						throw err;
					}).then(function() {
						return callback(null);
					}).fail(callback);
				});
			})());
		}

		if (options.scanSelf) {
			if (node.attr(config.tagName)) {
				processNode(node);
			}
		}

		$("[" + config.tagName + "]", node).each(function() {
			return processNode($(this));
		});

		return Q.all(all).then(function() {
			return widgets;
		});
	}

	function deepmerge (target, src) {
	    var array = Array.isArray(src);
	    var dst = array && [] || {};

	    if (array) {
	        target = target || [];
	        dst = dst.concat(target);
	        src.forEach(function(e, i) {
	            if (typeof dst[i] === 'undefined') {
	                dst[i] = e;
	            } else if (typeof e === 'object') {
	                dst[i] = deepmerge(target[i], e);
	            } else {
	                if (target.indexOf(e) === -1) {
	                    dst.push(e);
	                }
	            }
	        });
	    } else {
	        if (target && typeof target === 'object') {
	            Object.keys(target).forEach(function (key) {
	                dst[key] = target[key];
	            })
	        }
	        Object.keys(src).forEach(function (key) {
	            if (typeof src[key] !== 'object' || !src[key]) {
	                dst[key] = src[key];
	            }
	            else {
	                if (!target[key]) {
	                    dst[key] = src[key];
	                } else {
	                    dst[key] = deepmerge(target[key], src[key]);
	                }
	            }
	        });
	    }

	    return dst;
	}

	return {
		setAPI: function (api) {
			API = api;
			API.Q = API.Q || Q;
			API.EVENTS = API.EVENTS || EVENTS;
			API.DOT = API.DOT || DOT;
			API.DEEPMERGE = API.DEEPMERGE || deepmerge;
		},
		init: function(_config) {
			if (!API) throw new Error("Must call setAPI() before calling init()");
			// TODO: deepmerge `_config` on top of `config`.
			_config.tagName = _config.tagName || config.tagName;
			config = _config;
			return scan($("html"), null).fail(function(err) {
				console.error("Widget rendering error:", err.stack);
				throw err;
			});
		},
		scan: function(domNode, parent, options) {
			return scan(domNode, parent, options).fail(function(err) {
				console.error("Widget rendering error:", err.stack);
				throw err;
			});
		}
	}

});
