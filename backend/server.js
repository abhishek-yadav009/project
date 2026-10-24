const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const session = require('express-session');
const { MongoStore } = require('connect-mongo');
const mongoose = require('mongoose');
const config = require('./config');
const { connectDB } = require('./config/db');
const routes = require('./routes');
const { notFound, errorHandler, apiLimiter } = require('./middleware/errors');
const { enforceTrustedOrigin } = require('./middleware/origin');
const { startMonitor } = require('./services/alerts');

function buildApp() {
  const app = express();
  app.set('trust proxy', config.trustProxy);
  app.disable('x-powered-by');

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'"],
          imgSrc: ["'self'", 'data:'],
          connectSrc: ["'self'"],
          frameSrc: ["'self'", 'https://www.openstreetmap.org'],
          frameAncestors: ["'self'", 'https://*.vusercontent.net', 'https://v0.app', 'https://*.v0.app'],
        },
      },
      frameguard: false,
      crossOriginEmbedderPolicy: false,
    }),
  );
  if (config.corsOrigins.length) app.use('/api', cors({ origin: config.corsOrigins, credentials: true }));
  app.use(express.json({ limit: '100kb' }));

  app.use(
    session({
      name: 'hc.sid',
      secret: config.sessionSecret,
      resave: false,
      saveUninitialized: false,
      rolling: true,
      store: MongoStore.create({ client: mongoose.connection.getClient(), dbName: config.mongoDbName, collectionName: 'sessions', ttl: 8 * 3600 }),
      cookie: {
        httpOnly: true,
        secure: config.isProd,
        sameSite: config.isProd ? 'none' : 'lax',
        maxAge: 8 * 3600 * 1000,
      },
    }),
  );

  app.use('/api', enforceTrustedOrigin, apiLimiter, routes);
  app.use('/api', notFound);
  app.use(express.static(path.join(__dirname, '..', 'frontend'), { extensions: ['html'], maxAge: config.isProd ? '1h' : 0 }));
  app.use(notFound);
  app.use(errorHandler);
  return app;
}

async function main() {
  await connectDB();
  const app = buildApp();
  app.listen(config.port, () => console.log(`[server] Listening on http://localhost:${config.port}`));
  startMonitor();
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[server] Failed to start:', err.message);
    process.exit(1);
  });
}

module.exports = { buildApp };
