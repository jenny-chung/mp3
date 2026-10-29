const express = require('express');
const Task = require('../models/task');
const User = require('../models/user');
const { isId, send, fail, wrap, findOne, findMany } = require('./helpers');

const router = express.Router();

// Validate the body, then create (task = null) or replace (task = existing doc) a task
// and keep users' pendingTasks in sync.
// Order: format 400 -> assigned user missing 404 -> assignedUserName mismatch 400 -> writes.
async function saveTask(task, body) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        throw fail(400, 'Request body must be a JSON object');
    }
    const { name, description, completed, assignedUser, assignedUserName } = body;
    if (typeof name !== 'string' || !name.trim()) {
        throw fail(400, 'A name is required');
    }

    const d = body.deadline;
    const deadline = typeof d === 'string' || typeof d === 'number' ? new Date(/^\d+$/.test(d) ? Number(d) : d) : null;
    if (!deadline || isNaN(deadline.getTime())) {
        throw fail(400, 'A valid deadline is required');
    }

    if (description !== undefined && typeof description !== 'string') {
        throw fail(400, 'description must be a string');
    }
    if (completed !== undefined && typeof completed !== 'boolean') {
        throw fail(400, 'completed must be true or false');
    }

    if (assignedUser !== undefined && typeof assignedUser !== 'string') {
        throw fail(400, 'assignedUser must be a string');
    }
    if (assignedUser && !isId(assignedUser)) {
        throw fail(400, 'assignedUser is not a valid user id');
    }
    if (assignedUserName !== undefined && typeof assignedUserName !== 'string') {
        throw fail(400, 'assignedUserName must be a string');
    }

    // Resolve the assignment: a user id must exist and its name must match assignedUserName
    const uid = (assignedUser || '').toLowerCase();
    let uname = 'unassigned';
    if (uid) {
        const user = await User.findById(uid);
        if (!user) {
            throw fail(404, 'Assigned user not found');
        }
        if (assignedUserName !== undefined && assignedUserName !== user.name) {
            throw fail(400, 'assignedUserName does not match assignedUser');
        }
        uname = user.name;
    } else if (assignedUserName !== undefined && assignedUserName !== 'unassigned') {
        throw fail(400, 'assignedUserName given without an assignedUser');
    }

    const previous = task ? task.assignedUser : '';
    task = task || new Task();
    task.set({
        name: name.trim(),
        description: description === undefined ? '' : description,
        deadline,
        completed: completed === true,
        assignedUser: uid,
        assignedUserName: uname
    });
    await task.save();

    // Two-way reference: the old user loses the task, the new user gets it if it is pending
    if (previous && previous !== uid) {
        await User.updateOne({ _id: previous }, { $pull: { pendingTasks: task.id } });
    }
    if (uid) {
        const update = task.completed ? { $pull: { pendingTasks: task.id } } : { $addToSet: { pendingTasks: task.id } };
        await User.updateOne({ _id: uid }, update);
    }
    return task;
}

async function findTask(id) {
    const task = isId(id) ? await Task.findById(id) : null;
    if (!task) {
        throw fail(404, 'Task not found');
    }
    return task;
}

router.route('/')
    .get(wrap(async (req, res) => send(res, 200, 'OK', await findMany(Task, req, 100))))
    .post(wrap(async (req, res) => send(res, 201, 'Task created', await saveTask(null, req.body))));

router.route('/:id')
    .get(wrap(async (req, res) => send(res, 200, 'OK', await findOne(Task, req, 'Task'))))
    .put(wrap(async (req, res) => {
        const task = await findTask(req.params.id);
        send(res, 200, 'Task updated', await saveTask(task, req.body));
    }))
    .delete(wrap(async (req, res) => {
        const task = await findTask(req.params.id);
        if (task.assignedUser) {
            await User.updateOne({ _id: task.assignedUser }, { $pull: { pendingTasks: task.id } });
        }
        await task.deleteOne();
        res.status(204).end();
    }));

module.exports = router;
