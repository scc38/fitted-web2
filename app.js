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

//

app.get('/auth/facebook/callback*', function(req, res, next){
	//get param page from url
	var page = req.query.p;
	var req_url = 'http://localhost:3000/auth/facebook/callback';
	var redirect_url = '/register';
	if(page != undefined){
		req_url += "?p=" + page;
		switch(page){
			case 'profile':
				redirect_url = '/profile';
				break;
		}
	}

	passport.authenticate('facebook', {
		callbackURL: req_url,
		successRedirect: redirect_url,
		failureRedirect: '/login',
		scope: ['user_friends', 'email', 'user_actions.fitness', 'user_birthday', 'user_location', 'user_events'],
	})(req, res, next)
});

app.get('/auth/facebook*', function(req, res, next){
	//get param page from url
	var page = req.query.p;
	var req_url = 'http://localhost:3000/auth/facebook/callback';
	if(page != undefined){
		req_url += "?p=" + page;
	}
	passport.authorize('facebook', {
		scope: ['user_friends', 'email', 'user_actions.fitness', 'user_birthday', 'user_location', 'user_events'],
		callbackURL: req_url,
	})(req, res, next);
});

app.get('/logout', function(req, res){
	req.logout();
	res.redirect('/');
});

app.get('/login', function(req, res){
	res.redirect('/');
});

/*
* Main app
*/

app.get('/dashboard*', ensureAuthenticated, function(req, res){

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


/*
*	user schedule
*/
app.get('/schedule', ensureAuthenticated, function(req, res){

	checkConfirmed(req.user.db_id, function(returnVal){
		if(returnVal >= 1){
			res.render("schedule", {'app_version': pjson.version, 'isInstructor': req.user.isInstructor});
		}
		else {
			//user is not confirmed
			res.redirect('/register');
		}
	});

});

/*
*	payment- implement BrainTree
*	https://developers.braintreepayments.com/start/hello-client/javascript/v3
*/
app.get('/payment*', ensureAuthenticated, function(req, res){
	res.render('payment', {'app_version': pjson.version});
});


/*
*	user profile
*	TO DO: id param in url shows profile of that user
*/
app.get('/profile*', ensureAuthenticated, function(req, res){
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
				//we've selected all the user info, now get their class preferences
				getClassPreferences(req.user.db_id, function(class_preferences){
					//user exists. redirect them to main account page.
					//console.log(class_preferences);
					res.render("account/profile", {'app_version': pjson.version, 'user': row[0], 'class_preferences': class_preferences});
				});
			}
		}
		else {
			console.log("Error querying database");
		}
		connection.end();
	});
});


/*
* Instructor only
*/

/*
*	Create class
*/
app.get('/createclass*', ensureAuthenticated, function(req, res){

	checkConfirmed(req.user.db_id, function(returnVal){
		if(returnVal >= 1){
			//user is confirmed, check if is instructor
			if(req.user.isInstructor >= 1){
				getClassPreferences(req.user.db_id, function(class_preferences){
					res.render("create_class", {'app_version': pjson.version,'class_preferences': class_preferences});
				});
			}
			else {
				res.redirect('/dashboard');
			}
		}
		else {
			//user is not confirmed
			res.redirect('/register');
		}
	});

});

/*
*	schedule class
*/
app.get('/scheduleclass*', ensureAuthenticated, function(req, res){

	checkConfirmed(req.user.db_id, function(returnVal){
		if(returnVal >= 1){
			//user is confirmed, check if is instructor
			if(req.user.isInstructor >= 1){
				res.render("schedule_class", {'app_version': pjson.version, 'isInstructor': req.user.isInstructor});
			}
			else {
				res.redirect('/dashboard');
			}
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

	checkConfirmed(req.user.db_id, function(returnVal){
		if(returnVal >= 1){
			//user is confirmed
			res.redirect('/dashboard');
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
				res.render("register_prefs_user", {'app_version': pjson.version, 'class_types': row});
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

//helper function to return class types
function getClassTypes(callback){
	var connection = mysql.createConnection({
	host: config.db.host,
	user: config.db.username,
	password: config.db.password,
	database: config.db.database
	});
	connection.connect();
	connection.query('SELECT * FROM exercise_types', function(err, row, fields){
		connection.end();
		if(!err) {
			callback(row);
		}
		else {
			callback(err);
		}
	});
}

//helper function to return data object of a single user's class preferences
function getClassPreferences(db_id, callback){
	//get types of class preferences from database
	getClassTypes(function(exercise_types){
		//get class preferences by user
		var connection = mysql.createConnection({
		host: config.db.host,
		user: config.db.username,
		password: config.db.password,
		database: config.db.database
		});
		connection.connect();
		var query = "SELECT * FROM user_class_preferences WHERE user_id=" + db_id;
		connection.query(query, function(err, row, fields){
			connection.end();
			if(!err){
				
				//build data object from this
				var class_preferences = {};

				for(var i = 0; i < row.length; i++){
					var entry = row[i];
					var exercise_entry;
					//loop through exercise_types and find matching id
					for(var j = 0; j < exercise_types.length; j++){
						if(entry['exercise_type_id'] == exercise_types[j]['id']){
							exercise_entry = j;
							break;
						}
					}
					try{
						//make a preference and add it to class_preferences data object
						var one_preference = {
							id: exercise_types[exercise_entry]['id'],
							name: exercise_types[exercise_entry]['name'],
							color: exercise_types[exercise_entry]['color'],
							isActive: exercise_types[exercise_entry]['isActive'],
						}
						class_preferences[i] = one_preference;
					} catch(err){
						console.log(err);
					}
				}
				callback(class_preferences);
			}
			else {
				callback(err);
			}
		});
	});
}

app.post('/post/saveprofile', ensureAuthenticated, function(req, res){
	var profile_data = req.body;
	var displayName,email,birthdate,isInstructor;
	try{
		//validate input, we don't want sql injections
		displayName = req.body['displayName'];
		email = req.body['email']; //gonna need to check email because email has an UNIQUE key
		birthdate = req.body['birthdate'];
		isInstructor = parseInt(req.body['isInstructor']);
	} catch(err){
		console.log(error);
	}

	//update user profile
	var connection = mysql.createConnection({
	host: config.db.host,
	user: config.db.username,
	password: config.db.password,
	database: config.db.database
	});
	connection.connect();

	var updateProfileQuery = `UPDATE users SET display_name='${displayName}', email='${email}', birthdate='${birthdate}', isInstructor='${isInstructor}' WHERE id='${req.user.db_id}'`;

	connection.query(updateProfileQuery, function(err, row, fields){
		connection.end();
		if(!err){
			//success
			res.send('success');
		}
		else {
			console.log(err);
			res.send(err);
		}
	});
});


/*
* create a class
*/
app.post('/post/createclass', ensureAuthenticated, function(req, res){
	var class_data = req.body;
	console.log(class_data);
	res.send('success');
});

/*
* update a class
*/
app.post('/post/updateclass', ensureAuthenticated, function(req, res){
	var class_data = req.body;
	console.log(class_data);
	res.send('update class');
});



app.get('/saveprofilecomplete', ensureAuthenticated, function(req, res){

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
	//console.log(req.user);
	if(req.isAuthenticated()) {return next();}
	res.redirect('/login');
}

module.exports = app;