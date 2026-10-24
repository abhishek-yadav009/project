class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

const ok = (res, data, status = 200) => res.status(status).json({ success: true, data });

async function fetchJson(url, { timeout = 10000, method = 'GET', headers = {}, body } = {}) {
  const config = require('../config');
  const res = await fetch(url, {
    method,
    body,
    signal: AbortSignal.timeout(timeout),
    headers: { Accept: 'application/json', 'User-Agent': config.userAgent, ...headers },
  });
  if (res.status === 404) return { notFound: true, data: null };
  if (!res.ok) {
    const err = new Error(`Upstream service responded with HTTP ${res.status}`);
    err.upstream = true;
    throw err;
  }
  return { notFound: false, data: await res.json() };
}

module.exports = { HttpError, ok, fetchJson };
