const express = require('express');
const User = require('../models/user');
const Task = require('../models/task');
const { isId, send, fail, inTransaction, assertObject, requireName, findById, findOne, findMany } = require('./helpers');

const router = express.Router();

const UNASSIGNED = { assignedUser: '', assignedUserName: 'unassigned' };

// Create (user = null) or replace (user = existing) a user and keep the tasks in sync.
// Checks run in order: bad format 400, duplicate email 400, task not found 404, completed task 400.
// Then the writes.
async function saveUser(session, user, body) {
    assertObject(body);
    const name = requireName(body.name);
    if (typeof body.email !== 'string' || !/^[^\s@]+@[^\s@]+$/.test(body.email.trim())) {
        throw fail(400, 'A valid email is required');
    }
    const email = body.email.trim();

    const rawIds = body.pendingTasks === undefined ? [] : body.pendingTasks;
    if (!Array.isArray(rawIds)) {
        throw fail(400, 'pendingTasks must be a list of task ids');
    }
    if (!rawIds.every(isId)) {
        throw fail(400, 'pendingTasks contains an invalid task id');
    }
    const ids = [...new Set(rawIds.map((id) => id.toLowerCase()))];

    const clash = await User.findOne({ email, _id: { $ne: user ? user._id : null } }).session(session);
    if (clash) {
        throw fail(400, 'A user with that email already exists');
    }
    const tasks = await Task.find({ _id: { $in: ids } }).select('completed assignedUser').session(session);
    if (tasks.length !== ids.length) {
        throw fail(404, 'One or more tasks in pendingTasks do not exist');
    }
    if (tasks.some((t) => t.completed)) {
        throw fail(400, 'Completed tasks cannot be in pendingTasks');
    }

    const oldIds = user ? user.pendingTasks.map(String) : [];
    const nameChanged = !user || user.name !== name;
    user = user || new User();
    user.set({ name, email, pendingTasks: ids });
    await user.save({ session });

    // Tasks taken from another user leave that user's list
    const movedByOwner = new Map();
    for (const t of tasks) {
        if (t.assignedUser && t.assignedUser !== user.id) {
            movedByOwner.set(t.assignedUser, [...(movedByOwner.get(t.assignedUser) || []), t.id]);
        }
    }
    for (const [owner, taskIds] of movedByOwner) {
        await User.updateOne({ _id: owner }, { $pull: { pendingTasks: { $in: taskIds } } }, { session });
    }

    // Dropped tasks become unassigned; tasks in the new list are assigned to this user
    const dropped = oldIds.filter((id) => !ids.includes(id));
    await Task.updateMany({ _id: { $in: dropped }, assignedUser: user.id }, UNASSIGNED, { session });
    await Task.updateMany({ _id: { $in: ids } }, { assignedUser: user.id, assignedUserName: user.name }, { session });
    // A renamed user updates every task they own, completed ones included
    if (nameChanged) {
        await Task.updateMany({ assignedUser: user.id }, { assignedUserName: user.name }, { session });
    }
    return user;
}

router.route('/')
    .get(async (req, res) => send(res, 200, 'OK', await findMany(User, req)))
    .post(async (req, res) => {
        const user = await inTransaction((session) => saveUser(session, null, req.body));
        send(res, 201, 'User created', user);
    });

router.route('/:id')
    .get(async (req, res) => send(res, 200, 'OK', await findOne(User, req, 'User')))
    .put(async (req, res) => {
        const user = await inTransaction(async (session) => {
            const existing = await findById(User, req.params.id, 'User', { session });
            return saveUser(session, existing, req.body);
        });
        send(res, 200, 'User updated', user);
    })
    .delete(async (req, res) => {
        await inTransaction(async (session) => {
            const user = await findById(User, req.params.id, 'User', { session });
            await Task.updateMany({ assignedUser: user.id }, UNASSIGNED, { session });
            await user.deleteOne({ session });
        });
        res.status(204).end();
    });

module.exports = router;
