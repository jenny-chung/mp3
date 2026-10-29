const User = require('../models/user');

const OID = /^[0-9a-fA-F]{24}$/;
const isId = (v) => typeof v === 'string' && OID.test(v);

// Runs fn(session) as one atomic transaction. fn may be retried on a conflict, so do all
// reads inside it and pass the session to every query.
const inTransaction = (fn) => User.db.transaction(fn, {
    readConcern: { level: 'snapshot' },
    writeConcern: { w: 'majority' }
});

// Operators that run server-side JavaScript; never accepted inside "where"
const FORBIDDEN_OPERATORS = ['$where', '$expr', '$function', '$accumulator'];

const send = (res, status, message, data) => res.status(status).json({ message, data });

class HttpError extends Error {
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}
const fail = (status, message) => new HttpError(status, message);

// Turns every error into a { message, data } response; clients never see Mongoose/MongoDB text
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
    if (err instanceof HttpError) {
        return send(res, err.status, err.message, null);
    }
    if (err.type === 'entity.parse.failed') {
        return send(res, 400, 'Request body is not valid JSON', null);
    }
    if (err.code === 11000) { // only users.email has a unique index
        return send(res, 400, 'A user with that email already exists', null);
    }
    if (err.name === 'CastError' || err.name === 'ValidationError') {
        return send(res, 400, 'Invalid value in request', null);
    }
    console.error(err);
    send(res, 500, 'Internal server error', null);
}

function assertObject(body) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        throw fail(400, 'Request body must be a JSON object');
    }
}

// Returns the trimmed name
function requireName(name) {
    if (typeof name !== 'string' || !name.trim()) {
        throw fail(400, 'A name is required');
    }
    return name.trim();
}

function hasForbiddenOperator(value) {
    if (value === null || typeof value !== 'object') {
        return false;
    }
    return Object.keys(value).some((key) => FORBIDDEN_OPERATORS.includes(key) || hasForbiddenOperator(value[key]));
}

function parseObject(raw, name) {
    if (raw === undefined) {
        return undefined;
    }
    let parsed;
    try {
        parsed = JSON.parse(raw);
    } catch (e) {
        throw fail(400, `"${name}" must be valid JSON`);
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw fail(400, `"${name}" must be a JSON object`);
    }
    return parsed;
}

function parseNonNegativeInt(raw, name) {
    if (raw === undefined) {
        return undefined;
    }
    if (!/^\d+$/.test(raw)) {
        throw fail(400, `"${name}" must be a non-negative integer`);
    }
    return parseInt(raw, 10);
}

function parseSelect(raw) {
    const select = parseObject(raw, 'select');
    if (!select) {
        return undefined;
    }
    const vals = Object.keys(select).filter((k) => k !== '_id').map((k) => select[k]);
    if (Object.values(select).some((v) => ![0, 1, true, false].includes(v))) {
        throw fail(400, '"select" values must be 0 or 1');
    }
    if (vals.some((v) => v) && vals.some((v) => !v)) {
        throw fail(400, '"select" cannot mix include and exclude');
    }
    return select;
}

// Load one document by id (404 if malformed or unknown); pass { session } inside a transaction
async function findById(Model, id, name, { select, session } = {}) {
    const doc = isId(id) ? await Model.findById(id).select(select || {}).session(session || null) : null;
    if (!doc) {
        throw fail(404, `${name} not found`);
    }
    return doc;
}

// GET /:id -> only select applies
function findOne(Model, req, name) {
    return findById(Model, req.params.id, name, { select: parseSelect(req.query.select) });
}

// GET collection -> where, sort, select, skip, limit, count (all done by Mongoose)
async function findMany(Model, req, defaultLimit) {
    const where = parseObject(req.query.where, 'where') || {};
    if (hasForbiddenOperator(where)) {
        throw fail(400, 'Unsupported operator in "where"');
    }
    const sort = parseObject(req.query.sort, 'sort');
    if (sort && Object.values(sort).some((v) => v !== 1 && v !== -1)) {
        throw fail(400, '"sort" values must be 1 or -1');
    }
    const select = parseSelect(req.query.select);
    const skip = parseNonNegativeInt(req.query.skip, 'skip');
    const limit = parseNonNegativeInt(req.query.limit, 'limit') ?? defaultLimit;
    const count = req.query.count;
    if (count !== undefined && count !== 'true' && count !== 'false') {
        throw fail(400, '"count" must be true or false');
    }

    try {
        if (count === 'true') {
            return await Model.countDocuments(where);
        }
        let q = Model.find(where);
        if (sort) {
            q = q.sort(sort);
        }
        if (select) {
            q = q.select(select);
        }
        if (skip) {
            q = q.skip(skip);
        }
        if (limit) {
            q = q.limit(limit);
        }
        return await q;
    } catch (e) {
        // A query the database rejects (e.g. an unknown operator in "where") is the client's fault
        if (e.name === 'MongoServerError' || (e.name === 'Error' && /^Can't use /.test(e.message))) {
            throw fail(400, 'The query parameters are not valid');
        }
        throw e;
    }
}

module.exports = { isId, send, fail, inTransaction, errorHandler, assertObject, requireName, findById, findOne, findMany };
