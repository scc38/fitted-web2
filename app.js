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

//

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

/*	helper func for checking if a user is confirmed
	may be a bad way to do this-
	i wanted to save it in passport session instead
	but it doesn't seem to want to allow me to update
	a session after it's already been created.
*/
function checkConfirmed(db_id, callback){
	var connection = mysql.createConnection({
			host: config.db.host,
			user: config.db.username,
			password: config.db.password,
			database: config.db.database
			});
	connection.connect();
	connection.query(`SELECT confirmed FROM users WHERE id='${db_id}'`, function(err, row, fields){
		connection.end();
		if(!err){
			var val;
			try{
				val = row[0]['confirmed'];
			}
			catch(err){
				val = 0;
			}
			callback(val);
		}
		else {
			callback(0);
		}
	});
}


//helper func for creating a new blank user in passport use
function insertNewUser(facebook_id, callback){
	var connection = mysql.createConnection({
			host: config.db.host,
			user: config.db.username,
			password: config.db.password,
			database: config.db.database
			});
			connection.connect();

	var insert_user_query = `INSERT INTO users (facebook_id) VALUES ('${facebook_id}');`;
	var get_id_query = 'SELECT * FROM users WHERE facebook_id = ' + facebook_id;
	connection.query(insert_user_query, function(err, row, fields){
		if(!err){
			//return row[0];
		}
		//else return err;
	});

	connection.query(get_id_query, function(err, row, fields){
		connection.end();
		if(!err){
			if(row.length <= 0){
				callback(null);
			}
			else{
				callback(row[0]['id']);
			}
		}
		else {
			callback(null);
		}
	});

	//return id;
}

passport.use(new FacebookStrategy({
	clientID: config.facebook.api_id,
	clientSecret: config.facebook.api_secret,
	callbackURL: config.facebook.callback_url,
	enableProof: true
	},
	function(accessToken, refreshToken, profile, done){
		//async
		process.nextTick(function() {
			//user has authenticated with facebook, now connect to db
			//if fb_id user DNE create new user.
			//Else select from user.

			var connection = mysql.createConnection({
			host: config.db.host,
			user: config.db.username,
			password: config.db.password,
			database: config.db.database
			});
			connection.connect();

			var isRegistered = false;
			connection.query('SELECT * FROM users WHERE facebook_id=' + profile.id, function(err, row, fields){
				var user_obj = {};
				user_obj['id'] = profile.id;
				user_obj['displayName'] = profile.displayName;
				
				connection.end();
				if(!err){
					if(row.length <= 0){
						//user does not yet exist, create new base user
						insertNewUser(profile.id, function(db_id){
							user_obj['db_id'] = db_id;
							user_obj['isInstructor'] = 0;
							user_obj['confirmed'] = false;
							return done(null, user_obj);
						});
					}
					else {
						//we have user by fb id, proceed
						user_obj['db_id'] = row[0]['id'];
						user_obj['isInstructor'] = row[0]['isInstructor'];
						user_obj["confirmed"] = row[0]['confirmed']
						return done(null, user_obj);
					}
				}
				else {
					//error
					return done(err);
				}
			});

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

app.get('/account*', ensureAuthenticated, function(req, res){
	//console.log("account");
	//console.log(req.user);
	checkConfirmed(req.user.db_id, function(returnVal){
		if(returnVal >= 1){
			//user is confirmed
			res.render("account", {'app_version': pjson.version, 'isInstructor': req.user.isInstructor});
		}
		else {
			//user is not confirmed
			res.redirect('/register');
		}
	});
});

app.get('/register', ensureAuthenticated, function(req, res){
	/*	The user is already authenticated. Now we check to see if their facebook_id already
		exists in the database and that it is confirmed.
		If it does, then redirect to account page.
	*/

	//console.log("register");
	//console.log(req.user);

	checkConfirmed(req.user.db_id, function(returnVal){
		if(returnVal >= 1){
			//user is confirmed
			res.redirect('/account');
		}
		else {
			//user is not confirmed, update user and confirm them
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
						//res.render("register", {'app_version': pjson.version, 'user': req.user});
					}
					else {
						if(row[0]['confirmed']){
							//user has been confirmed by the registration process. redirect to account page
							//res.redirect('/account');
							req.logout();
							res.redirect('/auth/facebook');
						}
						else {
							//user is not confirmed. allow them to finish registering first.
							res.render("register", {'app_version': pjson.version, 'user': req.user});
						}
					}
				}
				else {
					console.log("Error querying database");
				}

				connection.end();
			});
		}
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
	var isInstructor = data.isInstructor;
	//sql injection vulnerablity-fix this
	/*var new_user = `UPDATE users SET (reg_date, display_name, email, birthdate, location, confirmed) ` +
		`VALUES( NOW(), '${display_name}', '${email}', '${birthdate}', '${location}', 1 ) WHERE facebook_id = '${req.user.id}'`*/

	var new_user = `UPDATE users SET reg_date=NOW(), display_name = '${display_name}', email='${email}', birthdate='${birthdate}', location='${location}', isInstructor='${isInstructor}', confirmed=1 WHERE facebook_id = '${req.user.id}'`;

	//create user in database and fill in fields
	connection.query( new_user, function(err, row, fields){
		if(!err){
			//console.log("query successful");
			/*req.user.db_id = "test";
			req.login(req.user, function(error) {
            	if (!error) {
                // successfully serialized user to session
                console.log('serialize sucess');
	            }
	        });	
	        res.send('user update success');
	        res.end();*/
	        res.send('user update success');
		}
		else {
			res.send('error updating user');
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

app.post('/regclassprefscomplete', ensureAuthenticated, function(req, res){
	var data = req.body;

	var connection = mysql.createConnection({
	host: config.db.host,
	user: config.db.username,
	password: config.db.password,
	database: config.db.database
	});
	connection.connect();

	for(var i = 0; i < data.length; i++){
		var query = `INSERT INTO user_class_preferences (user_id, exercise_type_id) VALUES('${req.user.db_id}', '${data[i]}')`;

		connection.query(query, function(err, row, fields){
			
			if(err) console.log(err);
			else {
				//res.send("success");
			}
		});
	}

	res.send("success");
	connection.end();

	//finally, mark user as confirmed in UPDATE query?
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
				/*user_obj = row[0];
				var reg_date = String(user_obj['reg_date']);
				var d = new Date(Date.parse(reg_date));
				
				var monthNames = ["January", "February", "March", "April", "May", "June",
					"July", "August", "September", "October", "November", "December"
				];

				var month = monthNames[d.getMonth()];
				var day = d.getDay();
				var year = d.getFullYear();

				var new_reg_date = String(month) + " " + String(day) + ", " + String(year);
			
				user_obj['reg_date'] = new_reg_date;*/

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

app.get('/getinstructor', ensureAuthenticated, function(req, res){
	res.render("account/instructor", {'app_version': pjson.version});
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
	//parse path
	//params:day,month,year

	//basic class object
	/*var class_obj = {
		id: '',
		instructor_id: '',
		instructor_name: '',
		start_time: '',
		end_time: '',
		type_class: '',
		name_class: '',
		location_zip: '',
		venue: '',
		min_students: '',
		max_students: '',
		date_created: '',
		price: '',
		class_description: '',
	};*/

	/*var class_obj = {
		id: '1',
		instructor_id: '',
		instructor_name: 'Lionel Messi',
		start_time: '2016-10-05 H',
		end_time: '12:00PM',
		type_class: '',
		name_class: '',
		location_zip: '',
		venue: '',
		min_students: '',
		max_students: '',
		date_created: '',
		price: '',
		class_description: '',
	};

	var class_obj = {
		id: '2',
		instructor_id: '',
		instructor_name: 'Lionel Messi',
		start_time: '',
		end_time: '',
		type_class: '',
		name_class: '',
		location_zip: '',
		venue: '',
		min_students: '',
		max_students: '',
		date_created: '',
		price: '',
		class_description: '',
	};*/


	//connect to database
	//look up class objects

	//iterate through class objects and look up instructor name

	var classes = {};

	res.json(class_obj);
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