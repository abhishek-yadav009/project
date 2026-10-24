const { Alert, Notification, CareAuthorization } = require('../models');
const { HttpError, ok } = require('../utils/http');
const v = require('../utils/validate');
const config = require('../config');
const { assertPatientAccess } = require('../services/access');
const { audit } = require('../services/audit');
const { inValues } = require('../utils/mongo');

async function visibleAlerts(user, alert) {
  const access = await assertPatientAccess(user, alert.patient, 'receiveAlerts');
  const hideMedicine = access.level === 'caregiver' && !access.grant.permissions.viewMedications;
  return { access, hideMedicine };
}

function shape(alert, hideMedicine) {
  if (!hideMedicine) return alert;
  return { ...alert, prescription: { medicineName: 'Hidden (no medication permission)' }, doses: (alert.doses || []).map((d) => ({ ...d, prescription: undefined })) };
}

exports.list = async (req, res) => {
  let patientIds;
  if (req.user.role === 'patient') patientIds = [req.user._id];
  else if (req.query.patientId) {
    await assertPatientAccess(req.user, v.objectId(req.query.patientId, 'patientId'), 'receiveAlerts');
    patientIds = [req.query.patientId];
  } else {
    const filter = { grantee: req.user._id, status: 'active' };
    if (req.user.role === 'caregiver') filter['permissions.receiveAlerts'] = true;
    const grants = await CareAuthorization.find(filter).lean();
    const allowed = [];
    for (const g of grants) {
      try {
        await assertPatientAccess(req.user, g.patient, 'receiveAlerts');
        allowed.push(g.patient);
      } catch {
        /* unverified doctor or missing permission: skip */
      }
    }
    patientIds = allowed;
  }
  const filter = { patient: inValues(patientIds) };
  if (req.query.status) filter.status = v.oneOf(req.query.status, 'status', ['open', 'resolved']);
  const alerts = await Alert.find(filter).sort({ status: 1, createdAt: -1 }).limit(100)
    .populate('patient', 'name').populate('prescription', 'medicineName strength').populate('resolvedBy', 'name')
    .populate({ path: 'doses', select: 'scheduledAt localDate localTime status autoMarked note' })
    .lean();

  const out = [];
  for (const a of alerts) {
    const { hideMedicine } = await visibleAlerts(req.user, a);
    out.push(shape(a, hideMedicine));
  }
  const ids = alerts.filter((a) => !a.viewedBy?.some((x) => String(x.user) === String(req.user._id))).map((a) => a._id);
  if (ids.length) await Alert.updateMany({ _id: inValues(ids) }, { $push: { viewedBy: { user: req.user._id, at: new Date() } } });
  ok(res, { threshold: config.missedDoseThreshold, windowDays: config.missedDoseWindowDays, alerts: out });
};

exports.resolve = async (req, res) => {
  const id = v.objectId(req.params.id, 'alert id');
  const alert = await Alert.findById(id);
  if (!alert) throw new HttpError(404, 'Alert not found');
  await assertPatientAccess(req.user, alert.patient);
  if (alert.status === 'resolved') throw new HttpError(409, 'Alert is already resolved');
  alert.status = 'resolved';
  alert.resolvedAt = new Date();
  alert.resolvedBy = req.user._id;
  alert.resolutionNote = v.str(req.body?.note, 'Note', { max: 500 });
  await alert.save();
  await audit({ actor: req.user._id, action: 'alert.resolve', entityType: 'Alert', entityId: alert._id, patient: alert.patient, meta: { note: alert.resolutionNote } });
  ok(res, alert);
};

exports.notifications = async (req, res) => {
  const filter = { recipient: req.user._id };
  if (req.query.unread === 'true') filter.readAt = null;
  const [items, unread] = await Promise.all([
    Notification.find(filter).sort({ createdAt: -1 }).limit(50).populate('patient', 'name').lean(),
    Notification.countDocuments({ recipient: req.user._id, readAt: null }),
  ]);
  ok(res, {
    unread,
    items,
    channels: {
      inApp: 'enabled',
      email: config.emailConfigPresent ? 'configured, but delivery is not implemented' : 'not configured; delivery is not implemented',
      sms: config.smsConfigPresent ? 'configured, but delivery is not implemented' : 'not configured; delivery is not implemented',
    },
  });
};

exports.markRead = async (req, res) => {
  const id = v.objectId(req.params.id, 'notification id');
  const n = await Notification.findOneAndUpdate({ _id: id, recipient: req.user._id }, { $set: { readAt: new Date() } }, { returnDocument: 'after' });
  if (!n) throw new HttpError(404, 'Notification not found');
  ok(res, n);
};

exports.markAllRead = async (req, res) => {
  const r = await Notification.updateMany({ recipient: req.user._id, readAt: null }, { $set: { readAt: new Date() } });
  ok(res, { updated: r.modifiedCount });
};
