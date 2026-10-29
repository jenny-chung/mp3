const OID = /^[0-9a-fA-F]{24}$/;
const isId = (v) => typeof v === 'string' && OID.test(v);

const send = (res, status, message, data) => res.status(status).json({ message, data });

const fail = (status, message) => Object.assign(new Error(message), { status });

// Wrap an async handler: known errors -> their status, anything else -> generic 500
const wrap = (fn) => async (req, res) => {
    try {
        await fn(req, res);
    } catch (e) {
        if (e.status) {
            return send(res, e.status, e.message, null);
        }
        if (e.code === 11000) {
            return send(res, 400, 'A user with that email already exists', null);
        }
        if (e.name === 'CastError' || e.name === 'ValidationError') {
            return send(res, 400, 'Invalid value in request', null);
        }
        console.error(e);
        send(res, 500, 'Internal server error', null);
    }
};

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

// GET /:id -> only select applies
async function findOne(Model, req, name) {
    const select = parseSelect(req.query.select);
    const doc = isId(req.params.id) ? await Model.findById(req.params.id).select(select || {}) : null;
    if (!doc) {
        throw fail(404, `${name} not found`);
    }
    return doc;
}

// GET collection -> where, sort, select, skip, limit, count (all done by Mongoose)
async function findMany(Model, req, defaultLimit) {
    const where = parseObject(req.query.where, 'where') || {};
    if (JSON.stringify(where).includes('"$where"')) {
        throw fail(400, 'Unsupported operator in "where"');
    }
    const sort = parseObject(req.query.sort, 'sort');
    if (sort && Object.values(sort).some((v) => v !== 1 && v !== -1)) {
        throw fail(400, '"sort" values must be 1 or -1');
    }
    const select = parseSelect(req.query.select);
    const skip = parseNonNegativeInt(req.query.skip, 'skip');
    let limit = parseNonNegativeInt(req.query.limit, 'limit');
    if (limit === undefined) {
        limit = defaultLimit;
    }
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
        // The query itself was rejected (e.g. unknown operator in "where"): the client's fault.
        // Mongoose throws a plain Error "Can't use $op" while casting; MongoDB answers MongoServerError.
        if (e.name === 'MongoServerError' || (e.name === 'Error' && /^Can't use /.test(e.message))) {
            throw fail(400, 'The query parameters are not valid');
        }
        throw e;
    }
}

module.exports = { isId, send, fail, wrap, findOne, findMany };
