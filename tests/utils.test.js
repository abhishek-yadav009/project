const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
if (!process.env.SESSION_SECRET) process.env.SESSION_SECRET = 'unit-test-only-session-secret';
const validate = require('../backend/utils/validate');
const time = require('../backend/utils/time');
const { CareAuthorization, DoseRecord } = require('../backend/models');
const { inValues, trustedOperators } = require('../backend/utils/mongo');
const { enforceTrustedOrigin } = require('../backend/middleware/origin');

test('date validation accepts real ISO calendar dates only', () => {
  assert.equal(validate.dateStr('2024-02-29', 'Date'), '2024-02-29');
  assert.throws(() => validate.dateStr('2025-02-29', 'Date'), /valid date/);
  assert.throws(() => validate.dateStr('10\/31\/2025', 'Date'), /valid date/);
});

test('scheduled times are normalized, deduplicated, and bounded', () => {
  assert.deepEqual(validate.timesArray('20:00, 08:30, 08:30'), ['08:30', '20:00']);
  assert.throws(() => validate.timesArray(['25:00']), /valid HH:MM/);
  assert.throws(() => validate.timesArray([]), /between 1 and 8/);
});

test('dose calendar helpers respect the patient timezone', () => {
  assert.equal(time.localDate(new Date('2026-01-01T02:00:00Z'), 'America/Los_Angeles'), '2025-12-31');
  assert.equal(time.zonedToUtc('2026-01-01', '08:00', 'UTC').toISOString(), '2026-01-01T08:00:00.000Z');
  assert.equal(time.zonedToUtc('2026-01-01', '08:00', 'Asia/Kolkata').toISOString(), '2026-01-01T02:30:00.000Z');
});

test('user-entered strings and lists enforce limits and normalize values', () => {
  assert.equal(validate.email(' Person@Example.COM '), 'person@example.com');
  assert.deepEqual(validate.stringList('Ibuprofen, acetaminophen, ibuprofen'), ['ibuprofen', 'acetaminophen']);
  assert.throws(() => validate.str('too long', 'Name', { max: 3 }), /at most 3/);
});

test('Mongoose filter sanitization preserves explicitly trusted database operators', () => {
  mongoose.set('sanitizeFilter', true);
  const statusQuery = CareAuthorization.find({ status: inValues(['active', 'pending']) });
  statusQuery._castConditions();
  assert.deepEqual(statusQuery.getFilter().status.$in, ['active', 'pending']);

  const range = { $gte: new Date(), $lte: new Date(Date.now() + 1000) };
  const trustedQuery = DoseRecord.find({ scheduledAt: trustedOperators(range) });
  trustedQuery._castConditions();
  assert.equal(trustedQuery.getFilter().scheduledAt.$gte, range.$gte);
  assert.equal(trustedQuery.getFilter().scheduledAt.$lte, range.$lte);

  const unsafeRange = { $gte: new Date() };
  const unsafeQuery = DoseRecord.find({ scheduledAt: unsafeRange });
  unsafeQuery._castConditions();
  assert.deepEqual(unsafeQuery.getFilter().scheduledAt.$eq.$gte, unsafeRange.$gte);
});

test('state-changing requests reject untrusted browser origins', () => {
  const request = (origin, requestOrigin = 'http://localhost:3000') => ({
    method: 'POST',
    protocol: requestOrigin.split('://')[0],
    get: (name) => name === 'origin' ? origin : requestOrigin.split('://')[1],
  });
  let nextCalls = 0;
  enforceTrustedOrigin(request('http://localhost:3000'), {}, () => { nextCalls += 1; });
  assert.equal(nextCalls, 1);
  assert.throws(() => enforceTrustedOrigin(request('https://attacker.example'), {}, () => {}), /not allowed/);
  assert.throws(() => enforceTrustedOrigin(request('null'), {}, () => {}), /invalid/);
});
