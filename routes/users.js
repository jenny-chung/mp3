const express = require('express');
const User = require('../models/user');
const Task = require('../models/task');
const { isId, send, fail, wrap, findOne, findMany } = require('./helpers');

const router = express.Router();

const UNASSIGNED = { assignedUser: '', assignedUserName: 'unassigned' };

// Validate the body, then create (user = null) or replace (user = existing doc) a user
// and keep the tasks in sync with the new pendingTasks.
// Order: format 400 -> duplicate email 400 -> missing task 404 -> completed task 400 -> writes.
async function saveUser(user, body) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        throw fail(400, 'Request body must be a JSON object');
    }
    const { name, email } = body;
    if (typeof name !== 'string' || !name.trim()) {
        throw fail(400, 'A name is required');
    }
    if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+$/.test(email.trim())) {
        throw fail(400, 'A valid email is required');
    }

    let ids = body.pendingTasks === undefined ? [] : body.pendingTasks;
    if (!Array.isArray(ids)) {
        throw fail(400, 'pendingTasks must be a list of task ids');
    }
    if (!ids.every(isId)) {
        throw fail(400, 'pendingTasks contains an invalid task id');
    }
    ids = [...new Set(ids.map((id) => id.toLowerCase()))];

    const clash = await User.findOne({ email: email.trim(), _id: { $ne: user ? user._id : null } });
    if (clash) {
        throw fail(400, 'A user with that email already exists');
    }

    const tasks = await Task.find({ _id: { $in: ids } });
    if (tasks.length !== ids.length) {
        throw fail(404, 'One or more tasks in pendingTasks do not exist');
    }
    if (tasks.some((t) => t.completed)) {
        throw fail(400, 'Completed tasks cannot be in pendingTasks');
    }

    const oldIds = user ? user.pendingTasks.map(String) : [];
    const nameChanged = !user || user.name !== name.trim();
    user = user || new User();
    user.set({ name: name.trim(), email: email.trim(), pendingTasks: ids });
    await user.save();

    // Tasks that moved here from another user: remove them from that user's list
    for (const t of tasks) {
        if (t.assignedUser && t.assignedUser !== user.id) {
            await User.updateOne({ _id: t.assignedUser }, { $pull: { pendingTasks: t.id } });
        }
    }
    // Tasks dropped from this user become unassigned (only if they still belong to this user)
    const dropped = oldIds.filter((id) => !ids.includes(id));
    await Task.updateMany({ _id: { $in: dropped }, assignedUser: user.id }, UNASSIGNED);
    // Tasks in the new list are assigned to this user
    await Task.updateMany({ _id: { $in: ids } }, { assignedUser: user.id, assignedUserName: user.name });
    // A renamed user updates every task they own, completed ones included
    if (nameChanged) {
        await Task.updateMany({ assignedUser: user.id }, { assignedUserName: user.name });
    }
    return user;
}

async function findUser(id) {
    const user = isId(id) ? await User.findById(id) : null;
    if (!user) {
        throw fail(404, 'User not found');
    }
    return user;
}

router.route('/')
    .get(wrap(async (req, res) => send(res, 200, 'OK', await findMany(User, req))))
    .post(wrap(async (req, res) => send(res, 201, 'User created', await saveUser(null, req.body))));

router.route('/:id')
    .get(wrap(async (req, res) => send(res, 200, 'OK', await findOne(User, req, 'User'))))
    .put(wrap(async (req, res) => {
        const user = await findUser(req.params.id);
        send(res, 200, 'User updated', await saveUser(user, req.body));
    }))
    .delete(wrap(async (req, res) => {
        const user = await findUser(req.params.id);
        await Task.updateMany({ assignedUser: user.id }, UNASSIGNED);
        await user.deleteOne();
        res.status(204).end();
    }));

module.exports = router;
