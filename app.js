var express = require('express');
var path = require('path');
var config = require('./config');
var mysql = require('mysql');
var session = require('express-session');
var MySQLStore = require('express-mysql-session')(session);
var passport = require('passport');
var FacebookStrategy = require('passport-facebook').Strategy;
var cookieParser = require('cookie-parser');
var bodyParser = require('body-parser');


var pjson = require('./package.json'); //for version number

var app = express();

app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs')
app.use('/static', express.static('public'));
app.use(bodyParser.json()); // support json encoded bodies
//app.use(bodyParser.urlencoded({extended: true})); // support encoded bodies

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

//set up Passport session
passport.serializeUser(function(user, done){
	done(null, user);
});
passport.deserializeUser(function(obj, done){
	done(null, obj);
});


passport.use(new FacebookStrategy({
	clientID: config.facebook.api_id,
	clientSecret: config.facebook.api_secret,
	callbackURL: config.facebook.callback_url
	},
	function(accessToken, refreshToken, profile, done){
		process.nextTick(function() {
			console.log(profile);
			if(config.db.use_database === 'true'){
				//database code- check whether user exists or not using profile.id
			}
			return done(null, profile);
		});
	}
))

app.use(cookieParser());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(session({ secret: 'keyboard cat', key: 'sid'}));
app.use(passport.initialize());
app.use(passport.session());


// Routing
/*app.get('/login', function(req, res){
	//req.session.lastPage = '/login';
	res.render("main", {'app_version': pjson.version});
});

app.get('/start', function(req, res){
	res.render("start", {'app_version': pjson.version});
});*/

app.get('/auth/facebook', 
	passport.authenticate('facebook', {
		scope: ['user_friends', 'email', 'user_actions.fitness', 'user_birthday', 'user_location', 'user_events']
	})
);
app.get('/auth/facebook/callback',
	passport.authenticate('facebook', {
		successRedirect: '/register',
		failureRedirect: '/login',
		scope: ['user_friends', 'email', 'user_actions.fitness', 'user_birthday', 'user_location', 'user_events']
	}),
	function(req, res){
		res.redirect('/register');
});

app.get('/logout', function(req, res){
	req.logout();
	res.redirect('/')
});

app.get('/login', function(req, res){
	//console.log("Not authenticated");
	res.redirect('/');
});

app.get('/account', ensureAuthenticated, function(req, res){
	//console.log(req);
	res.render("account", {'app_version': pjson.version});
})

app.get('/register', ensureAuthenticated, function(req, res){
	/*	The user is already authenticated. Now we check to see if their facebook_id already
		exists in the database.
		If it does, then redirect to account page.
	*/

	var connection = mysql.createConnection({
	host: config.db.host,
	user: config.db.username,
	password: config.db.password,
	database: config.db.database
	});
	connection.connect();

	var isRegistered = false;
	connection.query('SELECT * FROM users WHERE facebook_id=' + req.user.id, function(err, row, fields){
		if(!err){
			if(row.length <= 0){
				//user does not yet exist, allow them to register
				//so no redirect
				res.render("register", {'app_version': pjson.version, 'user': req.user});
			}
			else {
				//user exists. redirect them to main account page.
				res.redirect('/account');
			}
		}
		else {
			console.log("Error querying database");
		}

		connection.end();
	});
});


(function() {
	Date.prototype.getMySQL = getMySQLDateTime;	
	function getMySQLDateTime() {
		var year, month, day, hours, minutes, seconds;
		year = String(this.getFullYear());
		month = String(this.getMonth() + 1);
		if (month.length == 1) {
			month = "0" + month;
		}
		day = String(this.getDate());
		if (day.length == 1) {
			day = "0" + day;
		}
		hours = String(this.getHours());
		if (hours.length == 1) {
			hours = "0" + hours;
		}
		minutes = String(this.getMinutes());
		if (minutes.length == 1) {
			minutes = "0" + minutes;
		}
		seconds = String(this.getSeconds());
		if (seconds.length == 1) {
			seconds = "0" + seconds;
		}
		// should return something like: 2011-06-16 13:36:00
		return year + "-" + month + "-" + day + ' ' + hours + ':' + minutes + ':' + seconds;
	}
})();


app.post('/regcomplete', ensureAuthenticated, function(req, res){
	/*
		This route is used when the client finishes registering, via POST req
	*/

	var connection = mysql.createConnection({
	host: config.db.host,
	user: config.db.username,
	password: config.db.password,
	database: config.db.database
	});
	connection.connect();

	var data = req.body.data;
	var facebook_id = req.user.id;
	var first_name = data.first_name;
	var last_name = data.last_name;
	var birthdate = new Date(data.birthday).getMySQL();
	//sql injection vulnerablity-fix
	var new_user = `INSERT INTO users (facebook_id, reg_date, firstname, lastname, birthdate, location, preferred_distance_miles) ` +
		`VALUES( '${req.user.id}', NOW(), '${data.first_name}', '${data.last_name}', '${birthdate}', '${data.location}', '${data.travel_range}' )`

	//create user in database and fill in fields
	connection.query( new_user, function(err, row, fields){
		if(!err){
			console.log("query successful");
			res.send('user created success')
		}
		else {
			res.send('error creating user');
		}
		connection.end();
	});
});

app.get('/', function(req,res){
	res.render("main", {'app_version': pjson.version});
});

function ensureAuthenticated(req,res,next){
	if(req.isAuthenticated()) {return next();}
	res.redirect('/login');
}

module.exports = app;