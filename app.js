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
			if(config.db.use_database === 'true'){
				//database code- check whether user exists or not using profile.id
			}
			return done(null, profile);
		});
	}
))

app.use(cookieParser());
app.use(bodyParser.urlencoded({ extended: false }));
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
	console.log("Not authenticated");
	res.redirect('/');
});

app.get('/account', ensureAuthenticated, function(req, res){
	//console.log(req);
	res.send("authenticated");
})

app.get('/register', ensureAuthenticated, function(req, res){
	//res.send("isAuth, register");
	//console.log(req.user);
	res.render("register", {'app_version': pjson.version, 'user': req.user});
});

app.get('/regcomplete', ensureAuthenticated, function(req, res){
	res.redirect('/');
});

app.get('/', function(req,res){
	res.render("main", {'app_version': pjson.version});
});

function ensureAuthenticated(req,res,next){
	if(req.isAuthenticated()) {return next();}
	res.redirect('/login');
}

module.exports = app;