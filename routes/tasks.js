const express = require('express');
const Task = require('../models/task');
const User = require('../models/user');
const { isId, send, fail, inTransaction, assertObject, requireName, findById, findOne, findMany } = require('./helpers');

const router = express.Router();

// ISO strings, YYYY-MM-DD, or epoch milliseconds (number or digit-only string)
function parseDeadline(value) {
    if (typeof value !== 'string' && typeof value !== 'number') {
        throw fail(400, 'A valid deadline is required');
    }
    const deadline = new Date(/^\d+$/.test(value) ? Number(value) : value);
    if (isNaN(deadline.getTime())) {
        throw fail(400, 'A valid deadline is required');
    }
    return deadline;
}

// Create (task = null) or replace (task = existing) a task and keep users' pendingTasks in sync.
// Checks run in order: bad format 400, user not found 404, name mismatch 400. Then the writes.
async function saveTask(session, task, body) {
    assertObject(body);
    const { description, completed, assignedUser, assignedUserName } = body;
    const name = requireName(body.name);
    const deadline = parseDeadline(body.deadline);

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
        const user = await User.findById(uid).select('name').lean().session(session);
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
        name,
        description: description === undefined ? '' : description,
        deadline,
        completed: completed === true,
        assignedUser: uid,
        assignedUserName: uname
    });
    await task.save({ session });

    // Two-way reference: the old user loses the task, the new user gets it if it is pending
    if (previous && previous !== uid) {
        await User.updateOne({ _id: previous }, { $pull: { pendingTasks: task.id } }, { session });
    }
    if (uid) {
        const update = task.completed ? { $pull: { pendingTasks: task.id } } : { $addToSet: { pendingTasks: task.id } };
        await User.updateOne({ _id: uid }, update, { session });
    }
    return task;
}

router.route('/')
    .get(async (req, res) => send(res, 200, 'OK', await findMany(Task, req, 100)))
    .post(async (req, res) => {
        const task = await inTransaction((session) => saveTask(session, null, req.body));
        send(res, 201, 'Task created', task);
    });

router.route('/:id')
    .get(async (req, res) => send(res, 200, 'OK', await findOne(Task, req, 'Task')))
    .put(async (req, res) => {
        const task = await inTransaction(async (session) => {
            const existing = await findById(Task, req.params.id, 'Task', { session });
            return saveTask(session, existing, req.body);
        });
        send(res, 200, 'Task updated', task);
    })
    .delete(async (req, res) => {
        await inTransaction(async (session) => {
            const task = await findById(Task, req.params.id, 'Task', { session });
            if (task.assignedUser) {
                await User.updateOne({ _id: task.assignedUser }, { $pull: { pendingTasks: task.id } }, { session });
            }
            await task.deleteOne({ session });
        });
        res.status(204).end();
    });

module.exports = router;
