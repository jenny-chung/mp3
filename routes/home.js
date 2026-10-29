const router = require('express').Router();

router.get('/', (req, res) => {
    res.json({ message: 'OK', data: 'APIed Piper is running' });
});

module.exports = router;
