var mongoose = require('mongoose');

var TaskSchema = new mongoose.Schema({
    name: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    deadline: { type: Date, required: true },
    completed: { type: Boolean, default: false },
    assignedUser: { type: String, default: '' },
    assignedUserName: { type: String, default: 'unassigned' }
}, {
    timestamps: { createdAt: 'dateCreated', updatedAt: false },
    versionKey: false
});

// Speeds up the "all tasks of a user" lookups used by the reference logic
TaskSchema.index({ assignedUser: 1 });

module.exports = mongoose.model('Task', TaskSchema);
