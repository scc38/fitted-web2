exports.port = "3000";
exports.status = {
	"debugMode": true,
	"maintenanceMode": false
}
exports.db = {
	"use_database": false,
	"host": "127.0.0.1",
	"database": "FITTED_DB",
	"port": 3306,
	"username": "root",
	"password": "root"
}
exports.facebook = {
	"api_id"	: "672245366249588",
	"api_secret": "7f1f7f29feac8da0e2edc8e963f6f359",
	"callback_url": "http://localhost:3000/auth/facebook/callback"
}