const { AuditLog, Notification } = require('../models');
const config = require('../config');

async function audit({ actor, action, entityType, entityId, patient = null, changes = [], meta = {} }) {
  try {
    await AuditLog.create({ actor, action, entityType, entityId, patient, changes, meta });
  } catch (err) {
    console.error('[audit] Failed to write audit log:', err.message);
  }
}

function diff(before, after, fields) {
  const changes = [];
  for (const f of fields) {
    const a = JSON.stringify(before[f] ?? null);
    const b = JSON.stringify(after[f] ?? null);
    if (a !== b) changes.push({ field: f, from: before[f] ?? null, to: after[f] ?? null });
  }
  return changes;
}

async function notify(recipients, { type, title, message, patient = null, alert = null, dose = null }) {
  const unique = [...new Set(recipients.filter(Boolean).map(String))];
  if (!unique.length) return [];
  const channels = {
    inApp: 'delivered',
    email: config.emailConfigPresent ? 'configured_delivery_not_implemented' : 'not_configured',
    sms: config.smsConfigPresent ? 'configured_delivery_not_implemented' : 'not_configured',
  };
  return Notification.insertMany(unique.map((recipient) => ({ recipient, type, title, message, patient, alert, dose, channels })));
}

module.exports = { audit, diff, notify };
