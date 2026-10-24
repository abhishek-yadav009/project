const crypto = require('crypto');

const env = process.env;
const isProd = env.NODE_ENV === 'production';

let sessionSecret = env.SESSION_SECRET;
if (!sessionSecret) {
  if (isProd) throw new Error('SESSION_SECRET must be set in production');
  sessionSecret = crypto.randomBytes(32).toString('hex');
  console.warn('[config] SESSION_SECRET not set; using a random development secret (sessions reset on restart).');
}

const num = (value, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

module.exports = {
  isProd,
  port: num(env.PORT, 3000),
  mongoUri: env.MONGODB_URI,
  mongoDbName: env.MONGODB_DB || 'healthcare_mvp',
  sessionSecret,
  trustProxy: env.TRUST_PROXY ? num(env.TRUST_PROXY, 1) : 1,
  corsOrigins: (env.CORS_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean),
  overdueAfterMinutes: num(env.OVERDUE_AFTER_MINUTES, 30),
  missedAfterMinutes: num(env.MISSED_AFTER_MINUTES, 240),
  missedDoseThreshold: num(env.MISSED_DOSE_THRESHOLD, 3),
  missedDoseWindowDays: num(env.MISSED_DOSE_WINDOW_DAYS, 7),
  doseHistoryDays: num(env.DOSE_HISTORY_DAYS, 14),
  userAgent: env.HTTP_USER_AGENT || 'healthcare-mvp-hackathon/1.0 (demo app)',
  openFdaApiKey: env.OPENFDA_API_KEY || '',
  emailConfigPresent: Boolean(env.SMTP_URL),
  smsConfigPresent: Boolean(env.SMS_PROVIDER_KEY),
};
