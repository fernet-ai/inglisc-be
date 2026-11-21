const express = require('express');
const createCorsMiddleware = require('./middlewares/corsMiddleware');
const lobbyRoutes = require('./routes/lobbyRoutes');
const { createStore, ApiError } = require('./game');

function createApp(options = {}) {
  const app = express();
  const store = options.store || createStore(options);
  app.disable('x-powered-by');
  app.use(createCorsMiddleware(options.allowedOrigins));
  app.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  app.use('/lobby', (req, res, next) => {
    if ((Number(req.get('content-length')) > 0 || req.get('transfer-encoding')) && !req.is('application/json')) {
      return res.status(415).json({ error: { code: 'UNSUPPORTED_MEDIA_TYPE', message: 'Request bodies must be JSON.' } });
    }
    next();
  });
  app.use(express.json({ limit: '16kb' }));
  app.use('/lobby', lobbyRoutes(store));
  app.get('/', (req, res) => res.send('Sei su InGlisc GaMe!'));
  app.get('/mella', (req, res) => res.send('Caramella ti adoro ❤️ 🍬'));
  app.get('/health', (req, res) => res.json({ status: 'ok', uptimeSeconds: Math.floor(process.uptime()), environment: options.environment || process.env.ENVIRONMENT || 'development' }));
  app.get('/active', (req, res) => res.json({ activeUsers: store.activeCount() }));
  app.get('/lobbies', (req, res) => res.json({ lobbies: store.openLobbies() }));
  app.get('/coffee', (req, res) => res.json({ coffeeCount: store.coffeeCount() }));
  app.post('/coffee', (req, res) => res.json({ coffeeCount: store.offerCoffee() }));
  app.use((req, res) => res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found.' } }));
  app.use((err, req, res, next) => {
    if (err instanceof ApiError) return res.status(err.status).json({ error: { code: err.code, message: err.message } });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: { code: 'INVALID_JSON', message: 'Invalid JSON body.' } });
    if (err.type === 'entity.too.large') return res.status(413).json({ error: { code: 'BODY_TOO_LARGE', message: 'Request body is too large.' } });
    if (err.status >= 400 && err.status < 500) return res.status(err.status).json({ error: { code: 'BAD_REQUEST', message: 'Invalid request.' } });
    return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error.' } });
  });
  app.locals.store = store;
  return app;
}

if (require.main === module) {
  require('dotenv').config({ quiet: true });
  const app = createApp();
  const PORT = process.env.PORT || 3000;
  const ENVIRONMENT = process.env.ENVIRONMENT || 'development';
  const cleanup = setInterval(() => app.locals.store.sweep(), 60 * 1000);
  cleanup.unref();
  const server = app.listen(PORT, '0.0.0.0', () => console.log(`Server in ascolto su 0.0.0.0:${PORT} su ambiente di ${ENVIRONMENT}`));
  server.on('close', () => clearInterval(cleanup));
}

module.exports = { createApp };