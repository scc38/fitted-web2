var express = require('express');
var path = require('path');
var config = require('./config');
var mysql = require('mysql');
var session = require('express-session');
var MySQLStore = require('express-mysql-session')(session);

var pjson = require('./package.json'); //for version number

var app = express();

app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs')
app.use('/static', express.static('public'));

/*//MySQLsession
var connection = mysql.createConnection(config.db);
var sessionStore = new MySQLStore({
	host: config.db.host,
	port: config.db.port,
	user: config.db.username,
	password: config.db.password,
	database: config.db.database,
	checkExpirationInterval: 900000,
	expiration: 86400000,
	createDatabaseTable: true,
	schema: {
		tableName: 'sessions',
		columnNames: {
			session_id: 'session_id',
			expires: 'expires',
			data: 'data'
		}
	}
});*/

// Routes
app.get('/login', function(req, res){
	//req.session.lastPage = '/login';
	res.render("main", {'app_version': pjson.version});
});

app.get('/start', function(req, res){
	res.render("start", {'app_version': pjson.version});
});

app.get('/', function(req,res){
	res.render("main", {'app_version': pjson.version});
});

//define routes for the main application
//var routes = require('./routes/index');
//app.use('/', routes);

module.exports = app;