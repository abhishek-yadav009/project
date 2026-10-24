const mongoose = require('mongoose');
const { HttpError } = require('./http');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function str(value, field, { required = false, max = 500, min = 0 } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) throw new HttpError(400, `${field} is required`);
    return '';
  }
  if (typeof value !== 'string') throw new HttpError(400, `${field} must be text`);
  const v = value.trim();
  if (required && !v) throw new HttpError(400, `${field} is required`);
  if (v.length > max) throw new HttpError(400, `${field} must be at most ${max} characters`);
  if (v.length < min) throw new HttpError(400, `${field} must be at least ${min} characters`);
  return v;
}

function email(value, field = 'Email') {
  const v = str(value, field, { required: true, max: 200 }).toLowerCase();
  if (!EMAIL_RE.test(v)) throw new HttpError(400, `${field} is not a valid email address`);
  return v;
}

function isValidDateStr(v) {
  if (!DATE_RE.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

function dateStr(value, field, { required = false } = {}) {
  const v = str(value, field, { required, max: 10 });
  if (!v) return null;
  if (!isValidDateStr(v)) throw new HttpError(400, `${field} must be a valid date (YYYY-MM-DD)`);
  return v;
}

function oneOf(value, field, allowed, { required = true } = {}) {
  if ((value === undefined || value === '') && !required) return undefined;
  if (!allowed.includes(value)) throw new HttpError(400, `${field} must be one of: ${allowed.join(', ')}`);
  return value;
}

function objectId(value, field = 'id') {
  if (typeof value !== 'string' || !mongoose.isValidObjectId(value)) {
    throw new HttpError(400, `Invalid ${field}`);
  }
  return value;
}

function timesArray(value, field = 'Scheduled dose times') {
  const arr = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : null;
  if (!arr) throw new HttpError(400, `${field} are required`);
  const times = [...new Set(arr.map((t) => String(t).trim()).filter(Boolean))].sort();
  if (times.length < 1 || times.length > 8) throw new HttpError(400, `${field}: provide between 1 and 8 times`);
  for (const t of times) if (!TIME_RE.test(t)) throw new HttpError(400, `${field}: "${t}" is not a valid HH:MM time`);
  return times;
}

function stringList(value, field, { maxItems = 10, max = 100 } = {}) {
  if (value === undefined || value === null || value === '') return [];
  const arr = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : null;
  if (!arr) throw new HttpError(400, `${field} must be a list`);
  const items = [...new Set(arr.map((s) => String(s).trim().toLowerCase()).filter(Boolean))];
  if (items.length > maxItems) throw new HttpError(400, `${field}: at most ${maxItems} items`);
  for (const s of items) if (s.length > max) throw new HttpError(400, `${field}: item too long`);
  return items;
}

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

module.exports = { str, email, dateStr, isValidDateStr, oneOf, objectId, timesArray, stringList, escapeRegex, TIME_RE };
