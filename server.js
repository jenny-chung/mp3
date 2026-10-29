// Get the packages we need
var express = require('express'),
    mongoose = require('mongoose');

// Read .env file
require('dotenv').config();

// Turns errors into { message, data } responses
var errorHandler = require('./routes/helpers').errorHandler;

// Create our Express application
var app = express();

// Use environment defined port or 3000
var port = process.env.PORT || 3000;

// Connect to a MongoDB --> Uncomment this once you have a connection string!!
mongoose.connect(process.env.MONGODB_URI).catch(function (err) { console.error('MongoDB connection error:', err.message); });

// Allow CORS so that backend and frontend could be put on different servers
var allowCrossDomain = function (req, res, next) {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "X-Requested-With, X-HTTP-Method-Override, Content-Type, Accept");
    res.header("Access-Control-Allow-Methods", "POST, GET, PUT, DELETE, OPTIONS");
    next();
};
app.use(allowCrossDomain);

// Parse URL-encoded and JSON request bodies
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Use routes as a module (see index.js)
require('./routes')(app);

// Unknown routes -> 404; every error (bad JSON, validation, unexpected) is answered by errorHandler
app.use(function (req, res) {
    res.status(404).json({ message: 'Route not found', data: null });
});
app.use(errorHandler);

// Start the server
app.listen(port);
console.log('Server running on port ' + port);
