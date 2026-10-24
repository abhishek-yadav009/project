const { DoseRecord } = require('../models');
const { HttpError, ok } = require('../utils/http');
const v = require('../utils/validate');
const config = require('../config');
const { assertPatientAccess } = require('../services/access');
const doses = require('../services/doses');
const { checkMissedDoses } = require('../services/alerts');
const { localDate } = require('../utils/time');
const { trustedOperators } = require('../utils/mongo');

exports.schedule = async (req, res) => {
  const patientId = req.user.role === 'patient' ? String(req.user._id) : v.objectId(req.query.patientId, 'patientId');
  await assertPatientAccess(req.user, patientId, 'viewDoses');
  await doses.syncPatient(patientId);
  await checkMissedDoses(patientId);

  const tz = await doses.patientTz(patientId);
  const now = new Date();
  const today = localDate(now, tz);
  const since = new Date(now.getTime() - config.doseHistoryDays * 86400000);
  const ahead = new Date(now.getTime() + 7 * 86400000);
  const list = await DoseRecord.find({ patient: patientId, scheduledAt: trustedOperators({ $gte: since, $lte: ahead }) })
    .sort({ scheduledAt: 1 })
    .populate('prescription', 'medicineName strength dosageInstructions route status')
    .populate('recordedBy', 'name')
    .lean();

  const overdueCutoff = now.getTime() - config.overdueAfterMinutes * 60000;
  const rows = list.map((d) => ({
    ...d,
    overdue: d.status === 'upcoming' && d.scheduledAt.getTime() < overdueCutoff,
    due: d.status === 'upcoming' && d.scheduledAt.getTime() <= now.getTime(),
  }));

  ok(res, {
    timezone: tz,
    today,
    now,
    rules: { overdueAfterMinutes: config.overdueAfterMinutes, missedAfterMinutes: config.missedAfterMinutes },
    todaySchedule: rows.filter((d) => d.localDate === today && d.status !== 'cancelled'),
    upcoming: rows.filter((d) => d.status === 'upcoming' && d.scheduledAt > now).slice(0, 100),
    overdue: rows.filter((d) => d.overdue),
    history: rows.filter((d) => ['taken', 'missed', 'skipped'].includes(d.status)).reverse().slice(0, 100),
    adherence: await doses.adherence(patientId),
  });
};

exports.setStatus = async (req, res) => {
  const id = v.objectId(req.params.id, 'dose id');
  const dose = await DoseRecord.findOne({ _id: id, patient: req.user._id }).populate('prescription', 'medicineName');
  if (!dose) throw new HttpError(404, 'Dose not found');
  const status = v.oneOf(req.body?.status, 'Status', ['taken', 'missed', 'skipped']);
  const note = v.str(req.body?.note, 'Note', { max: 300 });
  const updated = await doses.recordStatus(dose, status, req.user, note);
  if (status === 'missed') await checkMissedDoses(req.user._id);
  ok(res, updated);
};

exports.adherence = async (req, res) => {
  const patientId = req.user.role === 'patient' ? String(req.user._id) : v.objectId(req.query.patientId, 'patientId');
  await assertPatientAccess(req.user, patientId, 'viewDoses');
  const days = req.query.days ? Math.min(Math.max(parseInt(req.query.days, 10) || 14, 1), 90) : config.doseHistoryDays;
  ok(res, await doses.adherence(patientId, { days }));
};
