
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

						self.server = {
							attachToStream: function(uri) {
								var deferred = Q.defer();
								try {
									$.ajax({
										type: 'GET',
										url: uri,
										timeout: 10 * 1000,
										context: self.tag,
										success: function(response) {
											var data = null;
											try {
												data = JSON.parse(response);
											} catch(err) {
												return deferred.reject("Error parsing data response from uri '" + uri + "':", err.stack);
											}
											var Stream = function(data) {
												this.data = data;
											}
											Stream.prototype = new EVENTS();
											var stream = new Stream(data);

											// TODO: Look for `update next` timestamp and do new lookup. Notify widget of update via event on stream.

											deferred.resolve(stream);

											setTimeout(function() {
												stream.emit("changed", data);
											}, 1);
											return;
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
							},
							getResource: function(uri) {
								if (/^\.\//.test(uri)) {
									uri = self.config.widgetBaseUri + "/" + uri;
								}
								var deferred = Q.defer();
								try {
									$.ajax({
										type: 'GET',
										url: uri,
										timeout: 10 * 1000,
										context: self.tag,
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

					var widget = new Widget();

					return Q.timeout(client.call(widget), 10 * 1000).then(function() {
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

