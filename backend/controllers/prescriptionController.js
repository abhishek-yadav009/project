const { Prescription, AuditLog, User, DrugSafetyCheck } = require('../models');
const { HttpError, ok } = require('../utils/http');
const v = require('../utils/validate');
const { audit, diff, notify } = require('../services/audit');
const { assertPatientAccess } = require('../services/access');
const rxnorm = require('../services/rxnorm');
const doses = require('../services/doses');
const { runSafetyCheck } = require('../services/safety');
const { inValues } = require('../utils/mongo');

const EDITABLE = ['medicineName', 'activeIngredients', 'strength', 'dosageInstructions', 'route', 'frequency', 'scheduleTimes', 'startDate', 'endDate', 'additionalInstructions'];
const SCHEDULE_FIELDS = ['scheduleTimes', 'startDate', 'endDate'];

function parseFields(b, { partial = false } = {}) {
  const out = {};
  const req = !partial;
  const has = (k) => !partial || b[k] !== undefined;
  if (has('medicineName')) out.medicineName = v.str(b.medicineName, 'Medicine name', { required: true, max: 200 });
  if (b.activeIngredients !== undefined) out.activeIngredients = v.stringList(b.activeIngredients, 'Active ingredients');
  if (has('strength')) out.strength = v.str(b.strength, 'Strength', { required: true, max: 100 });
  if (has('dosageInstructions')) out.dosageInstructions = v.str(b.dosageInstructions, 'Dosage instructions', { required: true, max: 500 });
  if (has('route')) out.route = v.oneOf(b.route, 'Route', Prescription.ROUTES);
  if (has('frequency')) out.frequency = v.str(b.frequency, 'Frequency', { required: true, max: 100 });
  if (has('scheduleTimes')) out.scheduleTimes = v.timesArray(b.scheduleTimes);
  if (has('startDate')) out.startDate = v.dateStr(b.startDate, 'Start date', { required: req || b.startDate !== undefined });
  if (b.endDate !== undefined || req) out.endDate = v.dateStr(b.endDate, 'End date');
  if (b.durationDays !== undefined && b.durationDays !== '' && !out.endDate) {
    const n = Number(b.durationDays);
    if (!Number.isInteger(n) || n < 1 || n > 3650) throw new HttpError(400, 'Duration must be 1-3650 days');
    out.durationDays = n;
  }
  if (b.additionalInstructions !== undefined) out.additionalInstructions = v.str(b.additionalInstructions, 'Additional instructions', { max: 1000 });
  return out;
}

function applyDuration(fields, startDate) {
  if (fields.durationDays) {
    const d = new Date(`${startDate}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + fields.durationDays - 1);
    fields.endDate = d.toISOString().slice(0, 10);
  }
  delete fields.durationDays;
}

function validateDates({ startDate, endDate }) {
  if (endDate && endDate < startDate) throw new HttpError(400, 'End date must be on or after the start date');
  const max = new Date();
  max.setUTCFullYear(max.getUTCFullYear() + 1);
  if (startDate > max.toISOString().slice(0, 10)) throw new HttpError(400, 'Start date cannot be more than one year in the future');
}

async function resolveIngredients(fields) {
  const lookup = await rxnorm.resolveMedicine(fields.medicineName);
  if (lookup.lookupStatus === 'found' && lookup.ingredients?.length) {
    return { activeIngredients: lookup.ingredients.map((i) => i.name), ingredientSource: 'rxnorm', rxcui: lookup.rxcui, medication: lookup._id || null };
  }
  if (fields.activeIngredients?.length) return { activeIngredients: fields.activeIngredients, ingredientSource: 'prescriber-entered', rxcui: null, medication: lookup._id || null };
  return { activeIngredients: [], ingredientSource: 'unknown', rxcui: null, medication: lookup._id || null };
}

async function withPrescriber(list) {
  const ids = [...new Set(list.map((p) => String(p.prescriber)))];
  const users = await User.find({ _id: inValues(ids) }).select('name').lean();
  const map = new Map(users.map((u) => [String(u._id), u.name]));
  return list.map((p) => ({ ...p, prescriberName: map.get(String(p.prescriber)) || 'Unknown' }));
}

exports.list = async (req, res) => {
  const patientId = req.user.role === 'patient' ? String(req.user._id) : v.objectId(req.query.patientId, 'patientId');
  await assertPatientAccess(req.user, patientId, 'viewMedications');
  await doses.syncPatient(patientId);
  const filter = { patient: patientId };
  if (req.query.status) filter.status = v.oneOf(req.query.status, 'status', ['active', 'discontinued', 'completed']);
  const list = await Prescription.find(filter).sort({ status: 1, createdAt: -1 }).populate('lastSafetyCheck', 'interactionStatus findings createdAt').lean();
  ok(res, await withPrescriber(list));
};

async function loadForDoctor(req) {
  const id = v.objectId(req.params.id, 'prescription id');
  const rx = await Prescription.findById(id);
  if (!rx) throw new HttpError(404, 'Prescription not found');
  await assertPatientAccess(req.user, rx.patient);
  return rx;
}

exports.get = async (req, res) => {
  const id = v.objectId(req.params.id, 'prescription id');
  const rx = await Prescription.findById(id).populate('lastSafetyCheck').lean();
  if (!rx) throw new HttpError(404, 'Prescription not found');
  await assertPatientAccess(req.user, rx.patient, 'viewMedications');
  ok(res, (await withPrescriber([rx]))[0]);
};

exports.create = async (req, res) => {
  const b = req.body || {};
  const patientId = v.objectId(b.patientId, 'patientId');
  await assertPatientAccess(req.user, patientId);
  const fields = parseFields(b);
  applyDuration(fields, fields.startDate);
  validateDates(fields);

  const ingredients = await resolveIngredients(fields);
  const check = await runSafetyCheck({ patientId, requestedBy: req.user._id, proposed: { medicineName: fields.medicineName, activeIngredients: fields.activeIngredients } });
  const rx = await Prescription.create({ ...fields, ...ingredients, patient: patientId, prescriber: req.user._id, status: 'active', scheduleEffectiveFrom: new Date(), lastSafetyCheck: check._id });
  check.prescription = rx._id;
  await check.save();

  await audit({ actor: req.user._id, action: 'prescription.create', entityType: 'Prescription', entityId: rx._id, patient: patientId, changes: EDITABLE.map((f) => ({ field: f, from: null, to: rx[f] ?? null })), meta: { safetyCheck: check._id } });
  await doses.syncPatient(patientId);
  await notify([patientId], { type: 'prescription_new', title: 'New prescription', message: `${req.user.name} prescribed ${rx.medicineName} ${rx.strength}.`, patient: patientId });
  ok(res, { prescription: rx, safetyCheck: check }, 201);
};

exports.update = async (req, res) => {
  const rx = await loadForDoctor(req);
  if (rx.status !== 'active') throw new HttpError(409, `Cannot update a ${rx.status} prescription`);
  const fields = parseFields(req.body || {}, { partial: true });
  if (!Object.keys(fields).length) throw new HttpError(400, 'No changes supplied');
  applyDuration(fields, fields.startDate || rx.startDate);
  const before = rx.toObject();
  const merged = { ...before, ...fields };
  validateDates(merged);

  let check = null;
  if (fields.medicineName !== undefined || fields.activeIngredients !== undefined) {
    const enteredIngredients = fields.activeIngredients ?? (rx.ingredientSource === 'prescriber-entered' ? rx.activeIngredients : []);
    Object.assign(fields, await resolveIngredients({ medicineName: merged.medicineName, activeIngredients: enteredIngredients }));
    check = await runSafetyCheck({ patientId: rx.patient, requestedBy: req.user._id, proposed: { medicineName: merged.medicineName, activeIngredients: enteredIngredients }, excludePrescriptionId: rx._id, prescriptionId: rx._id });
    fields.lastSafetyCheck = check._id;
  }

  Object.assign(rx, fields);
  const changes = diff(before, rx.toObject(), EDITABLE);
  if (!changes.length) throw new HttpError(400, 'No changes detected');
  const scheduleChanged = changes.some((c) => SCHEDULE_FIELDS.includes(c.field));
  if (scheduleChanged) rx.scheduleEffectiveFrom = new Date();
  await rx.save();

  if (scheduleChanged) {
    await doses.clearFutureUpcoming(rx._id);
    await doses.syncPatient(rx.patient);
  }
  await audit({ actor: req.user._id, action: 'prescription.update', entityType: 'Prescription', entityId: rx._id, patient: rx.patient, changes, meta: { reason: v.str(req.body?.reason, 'Reason', { max: 300 }) } });
  await notify([rx.patient], { type: 'prescription_updated', title: 'Prescription updated', message: `${req.user.name} updated ${rx.medicineName}: ${changes.map((c) => c.field).join(', ')}.`, patient: rx.patient });
  ok(res, { prescription: rx, changes, safetyCheck: check });
};

exports.discontinue = async (req, res) => {
  const rx = await loadForDoctor(req);
  if (rx.status !== 'active') throw new HttpError(409, `Prescription is already ${rx.status}`);
  const reason = v.str(req.body?.reason, 'Reason', { required: true, max: 300 });
  rx.status = 'discontinued';
  rx.discontinuedAt = new Date();
  rx.discontinuedBy = req.user._id;
  rx.discontinueReason = reason;
  await rx.save();
  const cancelled = await doses.cancelFutureUpcoming(rx._id, req.user._id);
  await audit({ actor: req.user._id, action: 'prescription.discontinue', entityType: 'Prescription', entityId: rx._id, patient: rx.patient, changes: [{ field: 'status', from: 'active', to: 'discontinued' }], meta: { reason, cancelledDoses: cancelled.modifiedCount } });
  await notify([rx.patient], { type: 'prescription_discontinued', title: 'Prescription discontinued', message: `${req.user.name} discontinued ${rx.medicineName}. Reason: ${reason}`, patient: rx.patient });
  ok(res, { prescription: rx, cancelledFutureDoses: cancelled.modifiedCount });
};

exports.recheck = async (req, res) => {
  const rx = await loadForDoctor(req);
  const check = await runSafetyCheck({
    patientId: rx.patient,
    requestedBy: req.user._id,
    proposed: { medicineName: rx.medicineName, activeIngredients: rx.ingredientSource === 'prescriber-entered' ? rx.activeIngredients : [] },
    excludePrescriptionId: rx._id,
    prescriptionId: rx._id,
  });
  rx.lastSafetyCheck = check._id;
  await rx.save();
  await audit({ actor: req.user._id, action: 'safety.recheck', entityType: 'Prescription', entityId: rx._id, patient: rx.patient, meta: { safetyCheck: check._id } });
  ok(res, check);
};

exports.history = async (req, res) => {
  const patientId = req.user.role === 'patient' ? String(req.user._id) : v.objectId(req.query.patientId, 'patientId');
  await assertPatientAccess(req.user, patientId, 'viewMedications');
  const filter = { patient: patientId, entityType: 'Prescription' };
  if (req.query.prescriptionId) filter.entityId = v.objectId(req.query.prescriptionId, 'prescriptionId');
  const logs = await AuditLog.find(filter).sort({ createdAt: -1 }).limit(200).populate('actor', 'name role').lean();
  const rxIds = [...new Set(logs.map((l) => String(l.entityId)))];
  const rxs = await Prescription.find({ _id: inValues(rxIds) }).select('medicineName').lean();
  const names = new Map(rxs.map((r) => [String(r._id), r.medicineName]));
  ok(res, logs.map((l) => ({ ...l, medicineName: names.get(String(l.entityId)) || '' })));
};

exports.safetyChecks = async (req, res) => {
  const patientId = req.user.role === 'patient' ? String(req.user._id) : v.objectId(req.query.patientId, 'patientId');
  const access = await assertPatientAccess(req.user, patientId, 'viewMedications');
  if (access.level === 'caregiver') throw new HttpError(403, 'Safety check results are available to the patient and their doctors');
  const checks = await DrugSafetyCheck.find({ patient: patientId }).sort({ createdAt: -1 }).limit(50).populate('requestedBy', 'name').lean();
  ok(res, checks);
};

exports.runCheck = async (req, res) => {
  const b = req.body || {};
  const patientId = v.objectId(b.patientId, 'patientId');
  await assertPatientAccess(req.user, patientId);
  const medicineName = v.str(b.medicineName, 'Medicine name', { required: true, max: 200 });
  const activeIngredients = v.stringList(b.activeIngredients, 'Active ingredients');
  const check = await runSafetyCheck({ patientId, requestedBy: req.user._id, proposed: { medicineName, activeIngredients } });
  await audit({ actor: req.user._id, action: 'safety.check', entityType: 'DrugSafetyCheck', entityId: check._id, patient: patientId });
  ok(res, check, 201);
};

exports.searchMedicines = async (req, res) => {
  const q = v.str(req.query.q, 'Search term', { required: true, min: 2, max: 100 });
  try {
    ok(res, { source: rxnorm.SOURCE, results: await rxnorm.searchMedicines(q), stockNote: 'Pharmacy stock availability is not shown: no verified live inventory source is connected.' });
  } catch (err) {
    throw new HttpError(503, `Medicine search unavailable (RxNorm): ${err.message}`);
  }
};
