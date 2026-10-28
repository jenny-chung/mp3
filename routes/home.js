module.exports = function (router) {

    router.route('/').get(function (req, res) {
        res.json({ message: 'OK', data: 'APIed Piper is running' });
    });

    return router;
}
