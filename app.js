var express = require('express');
var path = require('path');
var config = require('./config');
var session = require('express-session');
var MySQLStore = require('express-mysql-session')(session);
var passport = require('passport');
var FacebookStrategy = require('passport-facebook').Strategy;
var cookieParser = require('cookie-parser');
var bodyParser = require('body-parser');
var async = require('async');
var url = require('url');

var pjson = require('./package.json'); //for version number

var app = express();

app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs')
app.use('/static', express.static('public'));
app.use(bodyParser.json()); // support json encoded bodies

//

var mysql = require('mysql');
//pooling
//https://codeforgeek.com/2015/01/nodejs-mysql-tutorial/
var pool = mysql.createPool({
	connectionLimit: config.db.connectionLimit,
	host: config.db.host,
	user: config.db.username,
	password: config.db.password,
	database: config.db.database,
	debug: false,
});

//generic query func
function doQuery(query, callback){

	pool.getConnection( function(err, connection){
		if(err){
			//connection failed
			callback(err);
			return;
		}
		//console.log('connected as id ' + connection.threadId);

		connection.query(query, function(err, row){
			connection.release();

			if(!err){//success
				var str = JSON.stringify(row);
			    row = JSON.parse(str);
			    var data = row;

				callback(data);
				return;
			} else {
				callback(err);
				return;
			}

		});

		connection.on('error', function(err){
			callback(err); //failed
		});

	});

}

//


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
	var hostname = req.headers.host;
	var page = req.query.p;
	var req_url = 'http://' + hostname + '/auth/facebook/callback';
	var redirect_url = '/register';
	if(page != undefined){
		req_url += "?p=" + page;
		switch(page){
			case 'profile':
				redirect_url = '/profile';
				break;
			case 'dashboard':
				redirect_url = '/upcoming';
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
	var hostname = req.headers.host;
	var page = req.query.p;
	var req_url = 'http://' + hostname + '/auth/facebook/callback';
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
app.get('/search*', ensureAuthenticated, function(req, res){ 
//needs to be rewritten, this is just a base

	checkConfirmed(req.user.db_id, function(returnVal){
		if(returnVal >= 1){

			async.parallel({
				users: function(callback){
					doQuery(`SELECT * FROM users`, function(data){
						callback(null, data);
					});
				},
				classes: function(callback){
					doQuery(`SELECT * FROM classes WHERE instructor_id = ${req.user.db_id}`, function(data){
						callback(null, data);
					});
				},
				exercise_types: function(callback){
					doQuery('SELECT * FROM exercise_types', function(data){
						callback(null, data);
					});
				},
				class_times: function(callback){
					doQuery('SELECT * FROM class_times', function(data){
						callback(null, data);
					})
				}
			}, function(err, result){
				var activeClasses = [];

				//var inactiveClasses = [];
				for(var i = 0; i < result.classes.length; i++){
					if(result.classes[i].isActive > 0){
						activeClasses.push(result.classes[i]);
					} else {
						//inactiveClasses.push(result.classes[i]);
					}
				}

				var new_activeClasses = [];
				for(var j = 0; j < result.class_times.length; j++){
					var class_id = result.class_times[j].class_id;

					for(var k = 0; k < activeClasses.length; k++){
					 	
					 	if(activeClasses[k].id == class_id){
					 		new_activeClasses.push(activeClasses[k]);
					 		activeClasses[k].date = result.class_times[j].date;
					 		activeClasses[k].isRepeating = result.class_times[j].isRepeating;
					 		break;
					 	}
					}
				}

				res.render("account", {
				'app_version': pjson.version, 
				'page': 'search.ejs', 
				'footer': 'dashboard-search',
				'isInstructor': req.user.isInstructor,
				'activeClasses': new_activeClasses,
				'exercise_types': result.exercise_types,
				'users': result.users
				});

			});

		}
		else {
			//user is not confirmed
			res.redirect('/register');
		}
	});

});

app.get('/dashboard*', ensureAuthenticated, function(req, res){

	checkConfirmed(req.user.db_id, function(returnVal){
		if(returnVal >= 1){
			//user is confirmed
			res.render("account", {
				'app_version': pjson.version, 
				'page': 'dashboard.ejs', 
				'footer': 'dashboard-search',
				'isInstructor': req.user.isInstructor,
				'username': req.user.displayName
			});
		}
		else {
			//user is not confirmed
			res.redirect('/register');
		}
	});

});


app.get('/upcoming*', ensureAuthenticated, function(req, res){

	checkConfirmed(req.user.db_id, function(returnVal){
		if(returnVal >= 1){
			//user is confirmed, get classes
			var connection = mysql.createConnection({
				host: config.db.host,
				user: config.db.username,
				password: config.db.password,
				database: config.db.database
			});

			var query = `SELECT * FROM classes WHERE instructor_id = '${req.user.db_id}'`;

			connection.connect();

			connection.query(query, function(err, rows){
				connection.end();
				hasClasses = false;
				if(!err){
					//console.log(rows);
					if(rows.length > 0) hasClasses = true;
				}
				else {
					//console.log(err);
				}

				res.render("account", {
				'app_version': pjson.version, 
				'page': 'upcoming.ejs', 
				'footer': 'upcoming',
				'isInstructor': req.user.isInstructor,
				'hasClasses': hasClasses
				});
			})

		}
		else {
			//user is not confirmed
			res.redirect('/register');
		}
	});

});

app.get('/addclass*', ensureAuthenticated, function(req, res){
	checkConfirmed(req.user.db_id, function(returnVal){
		if(returnVal >= 1){
			//user is confirmed
			//now grab their current classes if any
			async.parallel({
				classes: function(callback){
					doQuery(`SELECT * FROM classes WHERE instructor_id = ${req.user.db_id}`, function(data){
						callback(null, data);
					});
				},
				exercise_types: function(callback){
					doQuery('SELECT * FROM exercise_types', function(data){
						callback(null, data);
					});
				},
				class_times: function(callback){
					doQuery(`SELECT * FROM class_times WHERE instructor_id = ${req.user.db_id}`, function(data){
						callback(null, data);
					});
				}
			}, function(err, result){
				var activeClasses = [];
				var inactiveClasses = [];
				for(var i = 0; i < result.classes.length; i++){
					if(result.classes[i].isActive > 0){
						activeClasses.push(result.classes[i]);
					} else {
						inactiveClasses.push(result.classes[i]);
					}
				}

				var new_activeClasses = [];
				for(var j = 0; j < result.class_times.length; j++){
					var class_id = result.class_times[j].class_id;

					for(var k = 0; k < activeClasses.length; k++){
					 	
					 	if(activeClasses[k].id == class_id){
					 		new_activeClasses.push(activeClasses[k]);
					 		activeClasses[k].date = result.class_times[j].date;
					 		activeClasses[k].isRepeating = result.class_times[j].isRepeating;
					 		break;
					 	}
					}
				}

				res.render("account", {
				'app_version': pjson.version, 
				'page': 'addclass.ejs', 
				'footer': 'addclass',
				'isInstructor': req.user.isInstructor,
				'activeClasses': new_activeClasses,
				'inactiveClasses': inactiveClasses,
				'exercise_types': result.exercise_types
				});

			});
		}
		else {
			//user is not confirmed
			res.redirect('/register');
		}
	});
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
					//res.render("account/profile", {'app_version': pjson.version, 'user': row[0], 'class_preferences': class_preferences});
					res.render("account", {
						'app_version': pjson.version, 
						'page': 'profile.ejs', 
						'footer': 'profile',
						'isInstructor': req.user.isInstructor,
						'user': row[0],
						'class_preferences': class_preferences,
					});
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
*	Schedule class
*/

app.get('/scheduleclass*', ensureAuthenticated, function(req, res){

	checkConfirmed(req.user.db_id, function(returnVal){
		if(returnVal >= 1){
			//user is confirmed
			//get all classes associated with user

			var connection = mysql.createConnection({
			host: config.db.host,
			user: config.db.username,
			password: config.db.password,
			database: config.db.database
			});

			var query = `SELECT id, title, length_class FROM classes WHERE instructor_id = '${req.user.db_id}'`;

			connection.connect();
			connection.query(query, function(err, rows){
				connection.end();
				var classes;
				if(!err){
					classes = rows;
					console.log(classes);
				}
				else {
					classes = err;
				}

				res.render("account", {
				'app_version': pjson.version, 
				'page': 'schedule_class.ejs', 
				'footer': 'upcoming',
				'isInstructor': req.user.isInstructor,
				'classes': classes
				});

			});

		}
		else {
			//user is not confirmed
			res.redirect('/register');
		}
	});

});


/*
*	Create class
*/
app.get('/createclass*', ensureAuthenticated, function(req, res){

	checkConfirmed(req.user.db_id, function(returnVal){
		if(returnVal >= 1){
			//user is confirmed, check if is instructor
			if(req.user.isInstructor >= 1){
				getClassPreferences(req.user.db_id, function(class_preferences){
					res.render("account", {
						'app_version': pjson.version, 
						'page': 'createclass.ejs', 
						'footer': 'addclass',
						'isInstructor': req.user.isInstructor,
						'class_preferences': class_preferences,
					});
				});
			}
			else {
				res.redirect('/upcoming');
			}
		}
		else {
			//user is not confirmed
			res.redirect('/register');
		}
	});

});

app.post('/post/previewclass', ensureAuthenticated, function(req, res){
	var data = req.body;
	//sql injection check here
	res.render("class", {'app_version': pjson.version, 'class_data': data});
});


/*
*	schedule class
*/
/*app.get('/scheduleclass*', ensureAuthenticated, function(req, res){

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

});*/

app.get('/history', ensureAuthenticated, function(req, res){
	res.render("account", {
						'app_version': pjson.version, 
						'page': 'history.ejs',
						'isInstructor': req.user.isInstructor,
						'footer': 'addclass',
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
			res.redirect('/upcoming');
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


			connection.query('SELECT * FROM exercise_types', function(err, row, fields){
				var exercise_rows = row;

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
							res.render("register", {'app_version': pjson.version, 'user': req.user, 'exercise_types': exercise_rows});
						}
					}
				}
				else {
					console.log("Error querying database");
				}

				connection.end();
				});

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
	var description = data.description;
	var selected_exercises = data.selected_exercises;

	//sql injection vulnerablity-fix this
	/*var new_user = `UPDATE users SET (reg_date, display_name, email, birthdate, location, confirmed) ` +
		`VALUES( NOW(), '${display_name}', '${email}', '${birthdate}', '${location}', 1 ) WHERE facebook_id = '${req.user.id}'`*/

	var new_user = `UPDATE users SET reg_date=NOW(), display_name = '${display_name}', email='${email}', birthdate='${birthdate}', location='${location}', isInstructor='${isInstructor}', description='${description}', confirmed=1 WHERE facebook_id = '${req.user.id}'`;

	//create user in database and fill in fields
	connection.query( new_user, function(err, row, fields){
		if(!err){
	        //now add regclass prefs
	        for(var i = 0; i < selected_exercises.length; i++){
				var query = `INSERT INTO user_class_preferences (user_id, exercise_type_id) VALUES('${req.user.db_id}', '${selected_exercises[i]}')`;

				connection.query(query, function(err, row, fields){
					
					if(err) {
						console.log(err);
						//res.send('err');
					}
					else {
						//res.send("success");
					}
					///res.send('success');
				});
			}
			res.send("success");
			connection.end();
		}
		else {
			//res.send('error updating user');
		}

		if(err != null) console.log(err);

		//connection.end();
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
		description = req.body['description'];
	} catch(err){
		console.log(error);
	}

	//update user profile
	var connection = mysql.createConnection({
	host: config.db.host,
	user: config.db.username,
	password: config.db.password,
	database: config.db.database,
	});
	connection.connect();

	var updateProfileQuery = `UPDATE users SET display_name='${displayName}', email='${email}', birthdate='${birthdate}', isInstructor='${isInstructor}', description='${description}' WHERE id='${req.user.db_id}'`;

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

	var class_type = parseInt(class_data.type);
	var class_length = parseInt(class_data.length);
	var class_price = parseFloat(class_data.price);
	var class_students = parseInt(class_data.students);

	var test_time = '00:00:00';

	var connection = mysql.createConnection({
		host: config.db.host,
		user: config.db.username,
		password: config.db.password,
		database: config.db.database,
	});
	connection.connect();
	var query = `INSERT INTO classes 
		(instructor_id, type_class, length_class, start_time, price, max_students, title, description, location) 
		VALUES('${req.user.db_id}', '${class_type}', '${class_length}', '${test_time}', '${class_price}', '${class_students}', '${class_data.title}', '${class_data.description}', '${class_data.location}') `;

	connection.query(query, function(err, rows){
		connection.end();
		if(!err){
			res.send('success');
		}
		else {
			res.send(err);
		}
	})
});

/*
* update a class
*/
app.post('/post/updateclass', ensureAuthenticated, function(req, res){
	var class_data = req.body;
	console.log(class_data);
	res.send('update class');
});

//get a single class
app.post('/post/getclass*', ensureAuthenticated, function(req,res){
	if(req.query.id) {
		//get info from database.
		async.parallel({
			class: function(callback){
				doQuery(`SELECT * FROM classes WHERE id = ${req.query.id}`, function(data){
					callback(null, data);
				});
			},
			class_times: function(callback){
				doQuery(`SELECT * FROM class_times WHERE class_id = ${req.query.id}`, function(data){
					callback(null, data);
				});
			}
		}, function(err, result){

			res.json({
				class: result.class[0],
				class_times: result.class_times
			});

		});
	}
	else {
		//todo: need to throw error
		res.send('getclass s');
	}
});

app.post('/post/saveschedule', ensureAuthenticated, function(req, res){
	//console.log(req.body);

	//check input
	var class_id = req.body.id;

	for(var i = 0; i < req.body.new_classes.length; i++){
		var timedate = req.body.new_classes[i].time;
		var isRepeating = req.body.new_classes[i].isRepeating;
		if(isRepeating == true) { 
			isRepeating = 1
		} else {
			isRepeating = 0;
		}
		doQuery(`INSERT INTO class_times (class_id, date, isRepeating, instructor_id) VALUES('${class_id}', '${timedate}', '${isRepeating}', '${req.user.db_id}')`, function(){
			//set class to be active now
			doQuery(`UPDATE classes SET isActive=1 WHERE id = '${class_id}'`, function(){
				//console.log('insert success');
			});
		});
	}

	res.send('success');
});

//

//api routes

//GET LOCATIONS
app.get('/api/locations*', function(req, res){
	res.json('api/locations/');
});

//GET CLASSES
app.get('/api/classes*', function(req, res){

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

	//parse path
	//params:start and end time, type_class, maxprice

	var query;
	parseClass(req, query);

	//get number of classes wanted
	getNumClasses(req, query) //adds LIMIT if asked

	//connect to database
	var connection = mysql.createConnection({
	host: config.db.host,
	user: config.db.username,
	password: config.db.password,
	database: config.db.database
	});

	connection.connect();

	var classes = {};

	//look up class objects – where I am little confused
	connection.query(query, function(err, row, fields){
		connection.end();
		if(!err){
			//success
			res.send('success');

			for(var i = 0; i < row.length; i++){
				try{
					//makes a single class with id and name
					var one_class = {
						id: row[i]['id'],
						name: row[i]['name'],
						start_time: row[i]['start_time'],
						length_class: row[i]['length_class'],
						price: row[i]['price'],
						description: row[i]['description'],
						type_class: row[i]['type_class'],
						instructor_name: row[i]['instructor_name'] 
					}
					classes[i] = one_class;
				} catch(err){
					console.log(err);
				}
			}

		}
		else {
			console.log(err);
			res.send(err);
		}
	});

	res.json(classes);

});

function parseClass(req, query){
	query = 'SELECT * FROM classes';
	var atLeastOneExpression = false;
	if(req.body['start_time'] !== '') {
		dealWithWhereOrAnd(query,atLeastOneExpression);
		query = query + 'start_time >= '$req.body['start_time']'';
	}
	if(req.body['end_time'] !== '') {
		dealWithWhereOrAnd(query,atLeastOneExpression);
		query = query + 'end_time <= '$req.body['end_time']'';
	}
	if(req.body['type_class'] !== '') {
		dealWithWhereOrAnd(query,atLeastOneExpression);
		query = query + 'type_class ='$req.body['type_class']'';
	}
	if(req.body['price'] !== '') {
		dealWithWhereOrAnd(query,atLeastOneExpression);
		query = query + 'price <='$req.body['price']'';
	}
};

function dealWithWhereOrAnd(query, atLeastOneExpression) {
	if(!atLeastOneExpression) {
		query = query + ' WHERE ';
		atLeastOneExpression = true;
	} else {
		query = query + ' AND ';
	}
}

function getNumClasses(req, query) {
	if(req.body['numClasses'] !== '') {
		query = query + ' LIMIT '$req.body['numClasses']'';
	}
}

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