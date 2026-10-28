const OID = /^[0-9a-fA-F]{24}$/;
const isId = (v) => typeof v === 'string' && OID.test(v);

const send = (res, status, message, data) => res.status(status).json({ message, data });

const fail = (status, message) => Object.assign(new Error(message), { status });

// Wrap an async handler: known errors -> their status, anything else -> generic 500
const wrap = (fn) => async (req, res) => {
    try {
        await fn(req, res);
    } catch (e) {
        if (e.status) return send(res, e.status, e.message, null);
        if (e.code === 11000) return send(res, 400, 'A user with that email already exists', null);
        if (e.name === 'CastError' || e.name === 'ValidationError') return send(res, 400, 'Invalid value in request', null);
        console.error(e);
        send(res, 500, 'Internal server error', null);
    }
};

module.exports = { isId, send, fail, wrap };
