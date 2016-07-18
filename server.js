var express = require('express');
var http = require('http');
//var https = require('https');
var app = require('./app');
var config = require('./config');

var port = config.port;
app.set('port', port);

//gonna want to make a https server at some point
var server = http.createServer(app);
server.listen(port);