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

//sequelize connection
/*var Sequelize = require('sequelize')
  , sequelize = new Sequelize(config.db.database, config.db.username, config.db.password, {
      dialect: "mysql",
      port:    3306,
    });

sequelize
  .authenticate()
  .then(function(err) {
    console.log('Connection has been established successfully.');
  }, function (err) { 
    console.log('Unable to connect to the database:', err);
  });
*/



var app = express();

app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs')
app.use('/static', express.static('public'));
app.use(bodyParser.json()); // support json encoded bodies


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
	callbackURL: config.facebook.callback_url,
	enableProof: true
	},
	function(accessToken, refreshToken, profile, done){
		//async
		process.nextTick(function() {
			if(config.db.use_database === 'true'){
				//database code- check whether user exists or not using profile.id
				//behavior: should only go to account page if user has an account in the database
				//currently goes to account page even if user does not have anncount, but is authenticated with facebook
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

app.get('/auth/facebook/callback',
	passport.authenticate('facebook', {
		successRedirect: '/register',
		failureRedirect: '/login',
		scope: ['user_friends', 'email', 'user_actions.fitness', 'user_birthday', 'user_location', 'user_events']
	}),
	function(req, res){
		res.redirect('/register');
	}
);

app.get('/auth/facebook', 
	passport.authorize('facebook', {
		scope: ['user_friends', 'email', 'user_actions.fitness', 'user_birthday', 'user_location', 'user_events']
	})
);

app.get('/logout', function(req, res){
	req.logout();
	res.redirect('/')
});

app.get('/login', function(req, res){
	res.redirect('/');
});

app.get('/account', ensureAuthenticated, function(req, res){
	res.render("account", {'app_version': pjson.version});
})
app.get('/account/*', ensureAuthenticated, function(req, res){
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


//POSTS

//on complete registration
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
	var display_name = data.display_name;
	var email = data.email;
	var birthdate = new Date(data.birthday).getMySQL();
	var location = parseInt(data.location);
	//sql injection vulnerablity-fix this
	var new_user = `INSERT INTO users (facebook_id, reg_date, display_name, email, birthdate, location) ` +
		`VALUES( '${req.user.id}', NOW(), '${display_name}', '${email}', '${birthdate}', '${location}' )`

	//create user in database and fill in fields
	connection.query( new_user, function(err, row, fields){
		if(!err){
			console.log("query successful");
			res.send('user created success')
		}
		else {
			res.send('error creating user');
		}

		if(err != null) console.log(err);

		connection.end();
	});
});

app.get('/regclassprefs', ensureAuthenticated, function(req, res){
	var connection = mysql.createConnection({
	host: config.db.host,
	user: config.db.username,
	password: config.db.password,
	database: config.db.database
	});
	connection.connect();

	var isRegistered = false;
	connection.query('SELECT * FROM exercise_types', function(err, row, fields){
		if(!err){
			if(row.length <= 0){
				//?!? nothing
				//res.render("register", {'app_version': pjson.version, 'user': req.user});
			}
			else {
				//got class types
				res.render("register_preferences", {'app_version': pjson.version, 'class_types': row});
			}
		}
		else {
			console.log("Error querying database");
		}

		connection.end();
	});

});


//account routes- make so only server can access
//about, class_history, clases, feedback, friends_calendar, profile, trainer_list
//GETS
app.get('/getprofile', ensureAuthenticated, function(req, res){
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
				res.send("error user DNE");
			}
			else {
				user_obj = row[0];
				var reg_date = String(user_obj['reg_date']);
				var d = new Date(Date.parse(reg_date));
				
				var monthNames = ["January", "February", "March", "April", "May", "June",
					"July", "August", "September", "October", "November", "December"
				];

				var month = monthNames[d.getMonth()];
				var day = d.getDay();
				var year = d.getFullYear();

				var new_reg_date = String(month) + " " + String(day) + ", " + String(year);
			
				user_obj['reg_date'] = new_reg_date;

				//user exists. redirect them to main account page.
				res.render("account/profile", {'app_version': pjson.version, 'user': row[0]});
			}
		}
		else {
			console.log("Error querying database");
		}

		connection.end();
	});
});

app.get('/getabout', ensureAuthenticated, function(req, res){
	res.render("account/about", {'app_version': pjson.version});
});

app.get('/getclasshistory', ensureAuthenticated, function(req, res){
	res.render("account/class_history", {'app_version': pjson.version});
});

app.get('/getclasses', ensureAuthenticated, function(req, res){
	res.render("account/upcoming_classes", {'app_version': pjson.version});
});

app.get('/getfriendscalendar', ensureAuthenticated, function(req, res){
	res.render("account/friends_calendar", {'app_version': pjson.version});
});

app.get('/gettrainerlist', ensureAuthenticated, function(req, res){
	res.render("account/trainer_list", {'app_version': pjson.version});
});

app.get('/getfeedback', ensureAuthenticated, function(req, res){
	res.render("account/feedback", {'app_version': pjson.version});
});


//on update profile
app.post('/updateprofile', ensureAuthenticated, function(req, res){
	res.send("update profile success");
});



//

//api routes

//GET LOCATIONS
app.get('/api/locations*', function(req, res){
	res.json('api/locations/');
});

//GET CLASSES
app.get('/api/classes*', function(req, res){
	res.json("api/classes/");
});

//GET INSTRUCTORS
app.get('/api/instructors*', function(req,res){
	res.json("api/instructors/");
});

//GET USERS
app.get('/api/users*', function(req, res){
	//optional params
	res.json("api/users");
});


app.get('/', function(req,res){
	res.render("main", {'app_version': pjson.version});
});

function ensureAuthenticated(req,res,next){
	if(req.isAuthenticated()) {return next();}
	res.redirect('/login');
}

module.exports = app;