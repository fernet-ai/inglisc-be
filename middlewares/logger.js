// Never log request bodies, response bodies, URLs, or authorization headers.
module.exports = (req, res, next) => next();
