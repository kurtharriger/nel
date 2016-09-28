/*
 * BSD 3-Clause License
 *
 * Copyright (c) 2015, Nicolas Riesco and others as credited in the AUTHORS file
 * All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are met:
 *
 * 1. Redistributions of source code must retain the above copyright notice,
 * this list of conditions and the following disclaimer.
 *
 * 2. Redistributions in binary form must reproduce the above copyright notice,
 * this list of conditions and the following disclaimer in the documentation
 * and/or other materials provided with the distribution.
 *
 * 3. Neither the name of the copyright holder nor the names of its contributors
 * may be used to endorse or promote products derived from this software without
 * specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
 * AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
 * IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
 * ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE
 * LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
 * CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
 * SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
 * INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
 * CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
 * ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
 * POSSIBILITY OF SUCH DAMAGE.
 *
 */

(function() {
    module.exports = Server;

    var DEBUG = !!process.env.DEBUG;

    var console = require("console");
    var stream = require("stream");
    var util = require("util");
    var vm = require("vm");
    var io = require("socket.io");
    var channel;

    function doLog() {
      var msg = {
          log: "SERVER: " + util.format.apply(this, arguments),
      };
      console.log(msg);
      if(channel) {
        channel.send(msg);
      }
    }

    function noop() {};
    var log = DEBUG ? doLog : noop;
    log = doLog;

    function Stdout(id, opt) {
        stream.Transform.call(this, opt);

        this._id = id;
    }

    Stdout.prototype = Object.create(stream.Transform.prototype);

    Stdout.prototype._transform = function(data, encoding, callback) {
        var response = {
            id: this._id,
            stdout: data.toString(),
        };
        log("STDOUT:", response);
        channel.send(response);
        this.push(data);
        callback();
    };

    function Stderr(id, opt) {
        stream.Transform.call(this, opt);

        this._id = id;
    }

    Stderr.prototype = Object.create(stream.Transform.prototype);

    Stderr.prototype._transform = function(data, encoding, callback) {
        var response = {
            id: this._id,
            stderr: data.toString(),
        };
        log("STDERR:", response);
        channel.send(response);
        this.push(data);
        callback();
    };

    function Context(id) {
        this.id = id;

        this.stdout = new Stdout(this.id);
        this.stderr = new Stderr(this.id);
        this.console = new console.Console(this.stdout, this.stderr);

        this._capturedStdout = null;
        this._capturedStderr = null;
        this._capturedConsole = null;

        this._async = false;
        this._done = false;

        // `$$` provides an interface for users to access the execution context
        this.$$ = Object.create(null);

        this.$$.async = Context.prototype.async.bind(this);
        this.$$.sendResult = Context.prototype.sendResult.bind(this);
        this.$$.sendError = Context.prototype.sendError.bind(this);
        this.$$.done = Context.prototype.done.bind(this);

        this.$$.mime = (function sendMime(mimeBundle) {
            this.done({
                mime: mimeBundle
            });
        }).bind(this);

        this.$$.text = (function sendText(text) {
            this.done({
                mime: {
                    "text/plain": text
                }
            });
        }).bind(this);

        this.$$.html = (function sendHtml(html) {
            this.done({
                mime: {
                    "text/html": html
                }
            });
        }).bind(this);

        this.$$.svg = (function sendSvg(svg) {
            this.done({
                mime: {
                    "image/svg+xml": svg
                }
            });
        }).bind(this);

        this.$$.png = (function sendPng(png) {
            this.done({
                mime: {
                    "image/png": png
                }
            });
        }).bind(this);

        this.$$.jpeg = (function sendJpeg(jpeg) {
            this.done({
                mime: {
                    "image/jpeg": jpeg
                }
            });
        }).bind(this);
    }

    Context.prototype.send = function send(message) {
        message.id = this.id;

        if (this._done) {
            log("RESULT: DROPPED:", message);
            return;
        }

        log("RESULT:", message);

        channel.send(message);
    };

    Context.prototype.async = function async() {
        this._async = true;
    };

    Context.prototype.sendResult = function sendResult(result) {
        this.done({
            mime: toMime(result)
        });
    };

    Context.prototype.sendError = function sendError(error) {
        this.done({
            error: formatError(error)
        });
    };

    Context.prototype.done = function done(response) {
        response = response || {};
        response.end = true;

        this.send(response);

        this._async = false;
        this._done = true;
    };

    Context.prototype.captureGlobalContext = function captureGlobalContext() {
        this._capturedStdout = process.stdout;
        this._capturedStderr = process.stderr;
        this._capturedConsole = console;

        this.stdout.pipe(this._capturedStdout);
        this.stderr.pipe(this._capturedStderr);
        this.console.Console = this._capturedConsole.Console;

        delete process.stdout;
        process.stdout = this.stdout;

        delete process.stderr;
        process.stderr = this.stderr;

        delete global.console;
        global.console = this.console;

        delete global.$$;
        global.$$ = this.$$;

        if (typeof global.$$mimer$$ !== "function") {
            global.$$mimer$$ = defaultMimer;
        }

        delete global.$$mime$$;
        Object.defineProperty(global, "$$mime$$", {
            set: this.$$.mime,
            configurable: true,
            enumerable: false,
        });

        delete global.$$html$$;
        Object.defineProperty(global, "$$html$$", {
            set: this.$$.html,
            configurable: true,
            enumerable: false,
        });

        delete global.$$svg$$;
        Object.defineProperty(global, "$$svg$$", {
            set: this.$$.svg,
            configurable: true,
            enumerable: false,
        });

        delete global.$$png$$;
        Object.defineProperty(global, "$$png$$", {
            set: this.$$.png,
            configurable: true,
            enumerable: false,
        });

        delete global.$$jpeg$$;
        Object.defineProperty(global, "$$jpeg$$", {
            set: this.$$.jpeg,
            configurable: true,
            enumerable: false,
        });

        delete global.$$async$$;
        Object.defineProperty(global, "$$async$$", {
            get: (function() {
                return this._async;
            }).bind(this),
            set: (function(value) {
                if (value) {
                    this.async();
                }
                this._async = value;
            }).bind(this),
            configurable: true,
            enumerable: false,
        });

        global.$$done$$ = this.$$.sendResult;
        global.require = require;
    };

    Context.prototype.releaseGlobalContext = function releaseGlobalContext() {
        if (process.stdout === this.stdout) {
            this.stdout.unpipe();

            delete process.stdout;
            process.stdout = this._capturedStdout;

            this._capturedStdout = null;
        }

        if (process.stderr === this.stderr) {
            this.stderr.unpipe();

            delete process.stderr;
            process.stderr = this._capturedStderr;

            this._capturedStderr = null;
        }

        if (global.console === this.console) {
            delete global.console;
            global.console = this._capturedConsole;

            this._capturedConsole = null;
        }
    };

    function Server(config) {
      log('creating server', config);
      this.config = config;
      // (id left undefined to indicate this is the initial context)
      this.initialContext = new Context();
      this.initialContext.captureGlobalContext();
    }


    Server.prototype.init = function init() {
        var self = this;
        Object.defineProperty(global, "$$defaultMimer$$", {
            value: defaultMimer,
            configurable: false,
            writable: false,
            enumerable: false,
        });


        if(this.config.port) {
          log('listening on socket port ', this.config.port);

          this.channel = new io(this.config.port);
          // Emit welcome message on connection
          this.channel.on('connection', function(socket) {
              log('client connected');
              socket.on("message", self.onMessage.bind(self));
          });
        } else {
          this.channel = process;
          this.channel.on("message", self.onMessage.bind(self));

        }
        process.on("uncaughtException", self.onUncaughtException.bind(self));
        //TODO: still need shared channel ref for now
        channel = self.channel;
    }

    Server.prototype.onUncaughtException = function onUncaughtException(error) {
        var stack = error.stack;
        var stackStr = stack ? stack.toString() : null;
        log("UNCAUGHTEXCEPTION:", error, stack);
        this.channel.send({
            stderr: stackStr,
        });
    }

    Server.prototype.onMessage = function onMessage(request) {
        log("REQUEST:", request);

        var action = request[0];
        var code = request[1];
        var id = request[2];

        var self = this;
        self.initialContext.releaseGlobalContext();
        self.context = new Context(id);
        self.context.captureGlobalContext();

        var cleanup = function cleanup() {
          self.context.releaseGlobalContext();
          self.initialContext.captureGlobalContext();
          self.initialContext._done = false;
        };

        return new Promise(function(resolve, reject) {
            if (action === "getAllPropertyNames") {
                self.onNameRequest(code).then(resolve, reject);
            } else if (action === "inspect") {
                self.onInspectRequest(code).then(resolve, reject);
            } else if (action === "run") {
                self.onRunRequest(code).then(resolve, reject);
            } else {
                self.context.sendError(new Error("NEL: Unhandled action request: " + action));
                resolve();
            }
        }).then(cleanup, cleanup);
    }

    Server.prototype.onNameRequest = function onNameRequest(code) {
        try {
          var message = {
              id: this.context.id,
              names: getAllPropertyNames(run(code)),
          };
          log("RESULT:", message);
          this.context.done(message);
        } catch (error) {
            this.context.sendError(error);
        }
        return Promise.resolve();
    }

    Server.prototype.onInspectRequest = function onInspectRequest(code) {
        try {
          var message = {
              id: this.context.id,
              inspection: inspect(run(code)),
          };
          log("RESULT:", message);
          this.context.done(message);
        } catch (error) {
            this.context.sendError(error);
        }
        return Promise.resolve();
    }

    Server.prototype.onRunRequest = function onRunRequest(code) {
        var self = this;
        var result = run(code);
        // Drop result if the run request initiated the async mode
        if (this.context._async) {
            return Promise.resolve();
        }

        // Drop result if the run request has already invoked context.done()
        if (this.context._done) {
            return Promise.resolve();
        }

        var isPromise = result.then;
        if(isPromise) {
           return result.then(
             function onFullfilled(value) {
               self.context.sendResult(value);
             },
             function onRejected(error) {
                self.context.sendError(error);
             });
        } else {
          self.context.sendResult(result);
          return Promise.resolve();
        }
    }

    function formatError(error) {
        return {
            ename: (error && error.name) ?
                error.name : typeof error,
            evalue: (error && error.message) ?
                error.message : util.inspect(error),
            traceback: (error && error.stack) ?
                error.stack.split("\n") : "",
        };
    }

    function toMime(result) {
        var mimer = (typeof global.$$mimer$$ === "function") ?
            global.$$mimer$$ :
            defaultMimer;
        return mimer(result);
    }

    function defaultMimer(result) {
        if (typeof result === "undefined") {
            return {
                "text/plain": "undefined"
            };
        }

        if (result === null) {
            return {
                "text/plain": "null"
            };
        }

        var mime;
        if (result._toMime) {
            try {
                mime = result._toMime();
            } catch (error) {}
        }
        if (typeof mime !== "object") {
            mime = {};
        }

        if (!("text/plain" in mime)) {
            try {
                mime["text/plain"] = util.inspect(result);
            } catch (error) {}
        }

        if (result._toHtml && !("text/html" in mime)) {
            try {
                mime["text/html"] = result._toHtml();
            } catch (error) {}
        }

        if (result._toSvg && !("image/svg+xml" in mime)) {
            try {
                mime["image/svg+xml"] = result._toSvg();
            } catch (error) {}
        }

        if (result._toPng && !("image/png" in mime)) {
            try {
                mime["image/png"] = result._toPng();
            } catch (error) {}
        }

        if (result._toJpeg && !("image/jpeg" in mime)) {
            try {
                mime["image/jpeg"] = result._toJpeg();
            } catch (error) {}
        }

        return mime;
    }

    function getAllPropertyNames(object) {
        var propertyList = [];

        if (object === undefined) {
            return [];
        }

        if (object === null) {
            return [];
        }

        var prototype;
        if (typeof object === "boolean") {
            prototype = Boolean.prototype;
        } else if (typeof object === "number") {
            prototype = Number.prototype;
        } else if (typeof object === "string") {
            prototype = String.prototype;
        } else {
            prototype = object;
        }

        var prototypeList = [prototype];

        function pushToPropertyList(e) {
            if (propertyList.indexOf(e) === -1) {
                propertyList.push(e);
            }
        }

        while (true) {
            var names;
            try {
                names = Object.getOwnPropertyNames(prototype).sort();
            } catch (e) {
                break;
            }
            names.forEach(pushToPropertyList);

            prototype = Object.getPrototypeOf(prototype);
            if (prototype === null) {
                break;
            }

            if (prototypeList.indexOf(prototype) === -1) {
                prototypeList.push(prototype);
            }
        }

        return propertyList;
    }

    function inspect(object) {
        if (object === undefined) {
            return {
                string: "undefined",
                type: "Undefined",
            };
        }

        if (object === null) {
            return {
                string: "null",
                type: "Null",
            };
        }

        if (typeof object === "boolean") {
            return {
                string: object ? "true" : "false",
                type: "Boolean",
                constructorList: ["Boolean", "Object"],
            };
        }

        if (typeof object === "number") {
            return {
                string: util.inspect(object),
                type: "Number",
                constructorList: ["Number", "Object"],
            };
        }

        if (typeof object === "string") {
            return {
                string: object,
                type: "String",
                constructorList: ["String", "Object"],
                length: object.length,
            };
        }

        if (typeof object === "function") {
            return {
                string: object.toString(),
                type: "Function",
                constructorList: ["Function", "Object"],
                length: object.length,
            };
        }

        var constructorList = getConstructorList(object);
        var result = {
            string: toString(object),
            type: constructorList[0] || "",
            constructorList: constructorList,
        };

        if ("length" in object) {
            result.length = object.length;
        }

        return result;

        function toString(object) {
            try {
                return util.inspect(object.valueOf());
            } catch (e) {
                return util.inspect(object);
            }
        }

        function getConstructorList(object) {
            var constructorList = [];

            var prototype = Object.getPrototypeOf(object);
            while (true) {
                try {
                    constructorList.push(prototype.constructor.name);
                } catch (e) {
                    break;
                }
                prototype = Object.getPrototypeOf(prototype);
            }

            return constructorList;
        }
    }

    function run(code) {
      return vm.runInThisContext(code);
    }
})();