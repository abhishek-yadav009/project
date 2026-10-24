const { HttpError } = require('./http');

function pagination(query, { defaultLimit = 20, maxLimit = 100 } = {}) {
  const enabled = query.page !== undefined || query.limit !== undefined;
  const parse = (value, name, fallback, max) => {
    if (value === undefined) return fallback;
    if (!/^\d+$/.test(String(value))) throw new HttpError(400, `${name} must be a positive integer`);
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > max) {
      throw new HttpError(400, `${name} must be between 1 and ${max}`);
    }
    return parsed;
  };
  const page = parse(query.page, 'page', 1, 1000000);
  const limit = parse(query.limit, 'limit', defaultLimit, maxLimit);
  return { enabled, page, limit, skip: (page - 1) * limit };
}

function pageInfo(total, { page, limit }) {
  return { page, limit, total, pages: Math.ceil(total / limit) };
}

module.exports = { pagination, pageInfo };
