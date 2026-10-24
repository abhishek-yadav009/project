const { AuditLog, Notification, User } = require('../models');
const config = require('../config');
const delivery = require('./delivery');
const { inValues } = require('../utils/mongo');

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
  const notifications = await Notification.insertMany(unique.map((recipient) => ({
    recipient, type, title, message, patient, alert, dose,
    channels: { inApp: 'delivered', email: 'not_attempted', sms: 'not_attempted' },
  })));
  const users = await User.find({ _id: inValues(unique) }).select('email notificationPhone notificationPreferences').lean();
  const userById = new Map(users.map((user) => [String(user._id), user]));

  await Promise.all(notifications.map(async (notice) => {
    const user = userById.get(String(notice.recipient));
    const preferences = user?.notificationPreferences || {};
    const channels = { inApp: 'delivered', email: 'opted_out', sms: 'opted_out' };

    if (preferences.email) {
      if (!config.emailConfigPresent) channels.email = 'not_configured';
      else {
        try {
          await delivery.sendEmail(user.email, `CareTrack: ${title}`, message);
          channels.email = 'delivered';
        } catch (err) {
          channels.email = 'failed';
          console.error(`[delivery] Email notification failed (${err.code || err.name || 'Error'}).`);
        }
      }
    }

    if (preferences.sms) {
      if (!config.smsConfigPresent) channels.sms = 'not_configured';
      else if (!user?.notificationPhone) channels.sms = 'missing_contact';
      else {
        try {
          await delivery.sendSms(user.notificationPhone, `${title}: ${message}`);
          channels.sms = 'delivered';
        } catch (err) {
          channels.sms = 'failed';
          console.error(`[delivery] SMS notification failed (${err.code || err.name || 'Error'}).`);
        }
      }
    }

    notice.channels = channels;
    await notice.save();
  }));
  return notifications;
}

module.exports = { audit, diff, notify };
