const rateLimit = require('express-rate-limit');
const { HttpError } = require('../utils/http');

function notFound(req, _res, next) {
  next(new HttpError(404, `Route not found: ${req.method} ${req.originalUrl}`));
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, _req, res, _next) {
  let status = err.status || err.statusCode || 500;
  let message = err.message || 'Internal server error';
  let details = err.details;

  if (err.name === 'ValidationError') {
    status = 400;
    details = Object.values(err.errors).map((e) => e.message);
    message = details[0] || 'Validation failed';
  } else if (err.name === 'CastError') {
    status = 400;
    message = `Invalid ${err.path}`;
  } else if (err.code === 11000) {
    status = 409;
    message = 'A record with these details already exists';
  } else if (err.type === 'entity.parse.failed') {
    status = 400;
    message = 'Invalid JSON body';
  } else if (err.name === 'MongoServerSelectionError' || err.name === 'MongooseServerSelectionError') {
    status = 503;
    message = 'Database unavailable';
  }

  if (status >= 500) {
    console.error('[error]', err);
    if (status === 500) message = 'Internal server error';
  }
  res.status(status).json({ success: false, error: { message, ...(details ? { details } : {}) } });
}

const limiter = (windowMinutes, limit, message) =>
  rateLimit({
    windowMs: windowMinutes * 60000,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (_req, res) => res.status(429).json({ success: false, error: { message } }),
  });

module.exports = {
  notFound,
  errorHandler,
  authLimiter: limiter(15, 20, 'Too many authentication attempts; try again in 15 minutes'),
  externalLimiter: limiter(1, 30, 'Too many lookups; please wait a minute'),
  apiLimiter: limiter(1, 300, 'Too many requests; please slow down'),
};
