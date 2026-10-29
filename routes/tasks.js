const express = require('express');
const Task = require('../models/task');
const { isId, send, fail, wrap, findOne, findMany } = require('./helpers');

const router = express.Router();

// Validate the body, then create (task = null) or replace (task = existing doc) a task.
// Assignment is not handled yet: assignedUser/assignedUserName always get their defaults.
async function saveTask(task, body) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        throw fail(400, 'Request body must be a JSON object');
    }
    const { name, description, completed } = body;
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

    task = task || new Task();
    task.set({
        name: name.trim(),
        description: description === undefined ? '' : description,
        deadline,
        completed: completed === true,
        assignedUser: '',
        assignedUserName: 'unassigned'
    });
    await task.save();
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
        await task.deleteOne();
        res.status(204).end();
    }));

module.exports = router;
