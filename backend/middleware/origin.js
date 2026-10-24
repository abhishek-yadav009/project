const config = require('../config');
const { HttpError } = require('../utils/http');

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const configuredOrigins = new Set(config.corsOrigins.map((origin) => new URL(origin).origin));

function enforceTrustedOrigin(req, _res, next) {
  if (!MUTATING_METHODS.has(req.method)) return next();
  const origin = req.get('origin');
  if (!origin) return next();

  let requestOrigin;
  let suppliedOrigin;
  try {
    requestOrigin = new URL(`${req.protocol}://${req.get('host')}`).origin;
    suppliedOrigin = new URL(origin).origin;
  } catch {
    throw new HttpError(403, 'Request origin is invalid');
  }

  if (suppliedOrigin !== origin || (suppliedOrigin !== requestOrigin && !configuredOrigins.has(suppliedOrigin))) {
    throw new HttpError(403, 'Request origin is not allowed');
  }
  next();
}

module.exports = { enforceTrustedOrigin };
