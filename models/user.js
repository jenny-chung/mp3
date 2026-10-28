// Load required packages
var mongoose = require('mongoose');

// Define our user schema
var UserSchema = new mongoose.Schema({
    name: { type: String, required: [true, 'Name is required'], trim: true },
    email: { type: String, required: [true, 'Email is required'], trim: true, unique: true },
    pendingTasks: { type: [String], default: [] }
}, {
    // dateCreated is set by the server on creation and never changes afterwards
    timestamps: { createdAt: 'dateCreated', updatedAt: false },
    versionKey: false
});

// Export the Mongoose model
module.exports = mongoose.model('User', UserSchema);
