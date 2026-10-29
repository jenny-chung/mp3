const express = require('express');
const User = require('../models/user');
const { isId, send, fail, wrap, findOne, findMany } = require('./helpers');

const router = express.Router();

// Validate the body, then create (user = null) or replace (user = existing doc) a user.
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

    const clash = await User.findOne({ email: email.trim(), _id: { $ne: user ? user._id : null } });
    if (clash) {
        throw fail(400, 'A user with that email already exists');
    }

    user = user || new User();
    user.set({ name: name.trim(), email: email.trim() });
    await user.save();
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
        await user.deleteOne();
        res.status(204).end();
    }));

module.exports = router;
