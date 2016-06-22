/* 
*	Routing for the main app
*/

var express = require('express');
var routes = express.Router();

routes.get('/', function(req,res){
	res.send('Hello World!');
});

module.exports = routes;