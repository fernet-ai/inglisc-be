const cors = require('cors');

module.exports = function createCorsMiddleware(value = process.env.ALLOWED_ORIGINS) {
  const allowedOrigins = (value || '')
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean);

  return cors({
    origin(origin, callback) {
      const isAllowed = allowedOrigins.some(allowedOrigin => {
        if (!allowedOrigin.includes('*')) return allowedOrigin === origin;
        const pattern = allowedOrigin
          .split('*')
          .map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
          .join('[^.]+');
        return new RegExp(`^${pattern}$`).test(origin);
      });
      if (!origin || allowedOrigins.length === 0 || isAllowed) {
        return callback(null, true);
      }
      return callback(null, false);
    },
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });
};
