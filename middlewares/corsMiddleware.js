const cors = require('cors');

module.exports = function createCorsMiddleware(value = process.env.ALLOWED_ORIGINS) {
  const allowedOrigins = (value || '')
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean);

  return cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(null, false);
    },
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });
};
