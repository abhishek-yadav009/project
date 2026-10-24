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
  smtpUrl: env.SMTP_URL || '',
  smtpFrom: env.SMTP_FROM || '',
  twilioAccountSid: env.TWILIO_ACCOUNT_SID || '',
  twilioAuthToken: env.TWILIO_AUTH_TOKEN || '',
  twilioFromNumber: env.TWILIO_FROM_NUMBER || '',
  emailConfigPresent: Boolean(env.SMTP_URL && env.SMTP_FROM),
  smsConfigPresent: Boolean(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_FROM_NUMBER),
};
