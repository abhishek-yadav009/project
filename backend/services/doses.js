const { DoseRecord, Prescription, PatientProfile } = require('../models');
const config = require('../config');
const { zonedToUtc, localDate, addDays } = require('../utils/time');
const { HttpError } = require('../utils/http');
const { notify } = require('./audit');
const { inValues, trustedOperators } = require('../utils/mongo');

const GENERATE_AHEAD_DAYS = 2;
const MARK_EARLY_MINUTES = 60;

async function patientTz(patientId) {
  const p = await PatientProfile.findOne({ user: patientId }).select('timezone').lean();
  return p?.timezone || 'UTC';
}

/** Idempotently create dose records for a prescription between two local dates. Unique index prevents duplicates. */
async function generateForPrescription(rx, tz) {
  const today = localDate(new Date(), tz);
  let from = addDays(today, -config.doseHistoryDays);
  if (rx.startDate > from) from = rx.startDate;
  let to = addDays(today, GENERATE_AHEAD_DAYS);
  if (rx.endDate && rx.endDate < to) to = rx.endDate;
  if (from > to) return 0;

  const effectiveFrom = new Date(rx.scheduleEffectiveFrom || rx.createdAt);
  const ops = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    for (const t of rx.scheduleTimes) {
      const scheduledAt = zonedToUtc(d, t, tz);
      if (scheduledAt < effectiveFrom) continue;
      ops.push({
        updateOne: {
          filter: { prescription: rx._id, scheduledAt },
          update: { $setOnInsert: { patient: rx.patient, prescription: rx._id, scheduledAt, localDate: d, localTime: t, status: 'upcoming' } },
          upsert: true,
        },
      });
    }
  }
  if (!ops.length) return 0;
  const r = await DoseRecord.bulkWrite(ops, { ordered: false });
  return r.upsertedCount || 0;
}

/** Server-side status maintenance: auto-mark long-overdue doses as missed and send one overdue reminder per dose. */
async function refreshStatuses(patientId) {
  const now = Date.now();
  const missedCutoff = new Date(now - config.missedAfterMinutes * 60000);
  const toMiss = await DoseRecord.find({ patient: patientId, status: 'upcoming', scheduledAt: trustedOperators({ $lt: missedCutoff }) }).select('_id').lean();
  if (toMiss.length) {
    await DoseRecord.updateMany(
      { _id: inValues(toMiss.map((d) => d._id)), status: 'upcoming' },
      {
        $set: { status: 'missed', autoMarked: true, statusRecordedAt: new Date() },
        $push: { history: { from: 'upcoming', to: 'missed', at: new Date(), by: null, note: `Auto-marked: not recorded within ${config.missedAfterMinutes} minutes` } },
      },
    );
  }

  const overdueCutoff = new Date(now - config.overdueAfterMinutes * 60000);
  const overdue = await DoseRecord.find({ patient: patientId, status: 'upcoming', overdueNotified: false, scheduledAt: trustedOperators({ $lt: overdueCutoff }) })
    .populate('prescription', 'medicineName')
    .lean();
  for (const d of overdue) {
    const claimed = await DoseRecord.updateOne({ _id: d._id, overdueNotified: false }, { $set: { overdueNotified: true } });
    if (!claimed.modifiedCount) continue;
    await notify([patientId], {
      type: 'dose_overdue',
      title: 'Dose overdue',
      message: `Your ${d.localTime} dose of ${d.prescription?.medicineName || 'a medicine'} (${d.localDate}) has not been recorded.`,
      patient: patientId,
      dose: d._id,
    });
  }
  return { autoMissed: toMiss.length, overdueNotified: overdue.length };
}

async function syncPatient(patientId) {
  const tz = await patientTz(patientId);
  const active = await Prescription.find({ patient: patientId, status: 'active' }).lean();
  for (const rx of active) await generateForPrescription(rx, tz);
  const today = localDate(new Date(), tz);
  await Prescription.updateMany({ patient: patientId, status: 'active', endDate: trustedOperators({ $ne: null, $lt: today }) }, { $set: { status: 'completed' } });
  await refreshStatuses(patientId);
}

/** Remove future, unrecorded doses (no clinical outcome yet) when a schedule changes. */
async function clearFutureUpcoming(prescriptionId) {
  return DoseRecord.deleteMany({ prescription: prescriptionId, status: 'upcoming', scheduledAt: trustedOperators({ $gt: new Date() }) });
}

async function cancelFutureUpcoming(prescriptionId, by) {
  return DoseRecord.updateMany(
    { prescription: prescriptionId, status: 'upcoming', scheduledAt: trustedOperators({ $gt: new Date() }) },
    { $set: { status: 'cancelled', statusRecordedAt: new Date() }, $push: { history: { from: 'upcoming', to: 'cancelled', at: new Date(), by, note: 'Prescription discontinued' } } },
  );
}

const TRANSITIONS = {
  upcoming: ['taken', 'missed', 'skipped'],
  missed: ['taken', 'skipped'],
};

async function recordStatus(dose, newStatus, user, note = '') {
  if (!['taken', 'missed', 'skipped'].includes(newStatus)) throw new HttpError(400, 'Status must be taken, missed, or skipped');
  if (dose.status === newStatus) throw new HttpError(409, `Dose is already marked as ${newStatus}`);
  const allowed = TRANSITIONS[dose.status] || [];
  if (!allowed.includes(newStatus)) throw new HttpError(409, `Cannot change a ${dose.status} dose to ${newStatus}`);
  if (dose.status === 'missed' && !dose.autoMarked) throw new HttpError(409, 'A dose you marked as missed cannot be changed');
  const minutesUntil = (dose.scheduledAt.getTime() - Date.now()) / 60000;
  if (minutesUntil > MARK_EARLY_MINUTES) throw new HttpError(409, `Doses can be recorded at most ${MARK_EARLY_MINUTES} minutes before the scheduled time`);
  if (newStatus === 'missed' && minutesUntil > 0) throw new HttpError(409, 'A dose cannot be marked missed before its scheduled time');

  const updated = await DoseRecord.findOneAndUpdate(
    { _id: dose._id, status: dose.status },
    {
      $set: { status: newStatus, statusRecordedAt: new Date(), recordedBy: user._id, autoMarked: false, note },
      $push: { history: { from: dose.status, to: newStatus, at: new Date(), by: user._id, note } },
    },
    { returnDocument: 'after' },
  );
  if (!updated) throw new HttpError(409, 'Dose status changed in the meantime; refresh and try again');
  return updated;
}

/**
 * Adherence = taken / (taken + missed + skipped) over doses scheduled in the past.
 * Excluded: future doses, past doses still pending (upcoming, not yet auto-missed), cancelled doses.
 */
async function adherence(patientId, { days = config.doseHistoryDays, prescriptionId = null } = {}) {
  const match = { patient: patientId, scheduledAt: { $lte: new Date(), $gte: new Date(Date.now() - days * 86400000) } };
  if (prescriptionId) match.prescription = prescriptionId;
  const rows = await DoseRecord.aggregate([{ $match: match }, { $group: { _id: '$status', n: { $sum: 1 } } }]);
  const c = Object.fromEntries(rows.map((r) => [r._id, r.n]));
  const taken = c.taken || 0;
  const missed = c.missed || 0;
  const skipped = c.skipped || 0;
  const eligible = taken + missed + skipped;
  return {
    days,
    taken,
    missed,
    skipped,
    pending: c.upcoming || 0,
    eligible,
    adherencePercent: eligible ? Math.round((taken / eligible) * 1000) / 10 : null,
    formula: 'taken / (taken + missed + skipped) for doses scheduled in the past; future, pending and cancelled doses are excluded',
  };
}

module.exports = { syncPatient, generateForPrescription, refreshStatuses, clearFutureUpcoming, cancelFutureUpcoming, recordStatus, adherence, patientTz };
