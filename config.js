// load the appropriate configuration file
if (process.env.NODE_ENV === 'production') {
    module.exports = require('./config.prod.js');
} else {
    module.exports = require('./config.dev.js');
}