#!/usr/bin/env node
// Load `nel` module
// var nel = require("nel");
var nel = require('.');

// Setup a new Javascript session
var session = new nel.Session({server: 'http://localhost:3001'}, function() {

  // Example of an execution request
  // Output:
  // { mime: { 'text/plain': '\'Hello, World!\'' } }
  var code = "['Hello', 'World!'].join(', ');";
  session.execute(code, {
      onSuccess: console.log,
      onError: console.error,
  });
  session.execute("throw 'error';", {
      onSuccess: console.log,
      onError: console.error,
  });
});
