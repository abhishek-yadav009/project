const { Alert, DoseRecord, Prescription, User, CareAuthorization } = require('../models');
const config = require('../config');
const { notify } = require('./audit');
const { alertRecipients } = require('./access');
const doses = require('./doses');
const { inValues, trustedOperators } = require('../utils/mongo');

/** Create one alert per prescription when missed doses in the window reach the threshold. */
async function checkMissedDoses(patientId) {
  const since = new Date(Date.now() - config.missedDoseWindowDays * 86400000);
  const active = await Prescription.find({ patient: patientId, status: 'active' }).select('medicineName').lean();
  const created = [];

  for (const rx of active) {
    const missed = await DoseRecord.find({ prescription: rx._id, status: 'missed', scheduledAt: trustedOperators({ $gte: since }) }).sort({ scheduledAt: -1 }).select('_id').lean();
    if (missed.length < config.missedDoseThreshold) continue;
    if (await Alert.exists({ patient: patientId, prescription: rx._id, type: 'repeated_missed_doses', status: 'open' })) continue;

    let alert;
    try {
      alert = await Alert.create({
        patient: patientId,
        prescription: rx._id,
        type: 'repeated_missed_doses',
        missedCount: missed.length,
        threshold: config.missedDoseThreshold,
        windowDays: config.missedDoseWindowDays,
        doses: missed.map((d) => d._id),
      });
    } catch (err) {
      if (err.code === 11000) continue;
      throw err;
    }
    created.push(alert);

    const patient = await User.findById(patientId).select('name').lean();
    const { doctors, caregivers } = await alertRecipients(patientId);
    const base = `${missed.length} missed doses in the last ${config.missedDoseWindowDays} days`;
    await notify([patientId], { type: 'missed_dose_alert', title: 'Repeated missed doses', message: `${base} for ${rx.medicineName}.`, patient: patientId, alert: alert._id });
    await notify(doctors, { type: 'missed_dose_alert', title: `Missed-dose alert: ${patient?.name}`, message: `${patient?.name}: ${base} for ${rx.medicineName}.`, patient: patientId, alert: alert._id });

    const cgGrants = await CareAuthorization.find({ patient: patientId, grantee: inValues(caregivers), status: 'active' }).lean();
    const withMeds = cgGrants.filter((g) => g.permissions?.viewMedications).map((g) => g.grantee);
    const withoutMeds = cgGrants.filter((g) => !g.permissions?.viewMedications).map((g) => g.grantee);
    await notify(withMeds, { type: 'missed_dose_alert', title: `Missed-dose alert: ${patient?.name}`, message: `${patient?.name}: ${base} for ${rx.medicineName}.`, patient: patientId, alert: alert._id });
    await notify(withoutMeds, { type: 'missed_dose_alert', title: `Missed-dose alert: ${patient?.name}`, message: `${patient?.name}: ${base} for one of their medicines.`, patient: patientId, alert: alert._id });
  }
  return created;
}

async function processPatient(patientId) {
  await doses.syncPatient(patientId);
  return checkMissedDoses(patientId);
}

let timer = null;
let running = false;

async function runCycle() {
  if (running) return;
  running = true;
  try {
    const patientIds = await Prescription.distinct('patient', { status: 'active' });
    for (const pid of patientIds) {
      try {
        await processPatient(pid);
      } catch (err) {
        console.error(`[monitor] Patient ${pid} failed: ${err.message}`);
      }
    }
  } catch (err) {
    console.error('[monitor] Cycle failed:', err.message);
  } finally {
    running = false;
  }
}

function startMonitor(intervalMs = 60000) {
  if (timer) return;
  setTimeout(runCycle, 3000);
  timer = setInterval(runCycle, intervalMs);
  timer.unref();
  console.log(`[monitor] Adherence monitor running every ${intervalMs / 1000}s (threshold ${config.missedDoseThreshold} missed / ${config.missedDoseWindowDays} days)`);
}

module.exports = { checkMissedDoses, processPatient, startMonitor, runCycle };
