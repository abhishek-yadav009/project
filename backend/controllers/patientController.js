const { PatientProfile, User } = require('../models');
const { HttpError, ok } = require('../utils/http');
const v = require('../utils/validate');
const { isValidTimeZone } = require('../utils/time');
const { audit, diff } = require('../services/audit');
const { assertPatientAccess, canSeeMedicalInfo } = require('../services/access');

async function loadOwnProfile(userId) {
  const profile = await PatientProfile.findOne({ user: userId });
  if (!profile) throw new HttpError(404, 'Patient profile not found');
  return profile;
}

const shape = (user, profile, includeMedical) => ({
  user: { _id: user._id, name: user.name, email: user.email },
  dateOfBirth: profile.dateOfBirth,
  phone: profile.phone,
  timezone: profile.timezone,
  ...(includeMedical ? { allergies: profile.allergies, medicalHistory: profile.medicalHistory } : { medicalInfoHidden: true }),
});

exports.getMine = async (req, res) => {
  const profile = await loadOwnProfile(req.user._id);
  ok(res, shape(req.user, profile, true));
};

exports.updateMine = async (req, res) => {
  const b = req.body || {};
  const profile = await loadOwnProfile(req.user._id);
  const before = profile.toObject();
  if (b.dateOfBirth !== undefined) {
    const dob = v.dateStr(b.dateOfBirth, 'Date of birth');
    if (dob && dob > new Date().toISOString().slice(0, 10)) throw new HttpError(400, 'Date of birth cannot be in the future');
    profile.dateOfBirth = dob;
  }
  if (b.phone !== undefined) profile.phone = v.str(b.phone, 'Phone', { max: 30 });
  if (b.timezone !== undefined) {
    if (!isValidTimeZone(b.timezone)) throw new HttpError(400, 'Invalid timezone');
    profile.timezone = b.timezone;
  }
  if (b.name !== undefined) {
    const name = v.str(b.name, 'Name', { required: true, min: 2, max: 100 });
    await User.updateOne({ _id: req.user._id }, { name });
    req.user.name = name;
  }
  await profile.save();
  await audit({ actor: req.user._id, action: 'profile.update', entityType: 'PatientProfile', entityId: profile._id, patient: req.user._id, changes: diff(before, profile.toObject(), ['dateOfBirth', 'phone', 'timezone']) });
  ok(res, shape(req.user, profile, true));
};

exports.addAllergy = async (req, res) => {
  const b = req.body || {};
  const substance = v.str(b.substance, 'Allergy substance', { required: true, max: 100 }).toLowerCase();
  const reaction = v.str(b.reaction, 'Reaction', { max: 200 });
  const severity = v.oneOf(b.severity || 'unknown', 'Severity', ['mild', 'moderate', 'severe', 'unknown']);
  const profile = await loadOwnProfile(req.user._id);
  if (profile.allergies.some((a) => a.substance === substance)) throw new HttpError(409, `Allergy "${substance}" is already recorded`);
  profile.allergies.push({ substance, reaction, severity });
  await profile.save();
  await audit({ actor: req.user._id, action: 'allergy.add', entityType: 'PatientProfile', entityId: profile._id, patient: req.user._id, meta: { substance, severity } });
  ok(res, profile.allergies, 201);
};

exports.removeAllergy = async (req, res) => {
  const id = v.objectId(req.params.id, 'allergy id');
  const profile = await loadOwnProfile(req.user._id);
  const item = profile.allergies.id(id);
  if (!item) throw new HttpError(404, 'Allergy not found');
  item.deleteOne();
  await profile.save();
  await audit({ actor: req.user._id, action: 'allergy.remove', entityType: 'PatientProfile', entityId: profile._id, patient: req.user._id, meta: { substance: item.substance } });
  ok(res, profile.allergies);
};

exports.addHistory = async (req, res) => {
  const b = req.body || {};
  const condition = v.str(b.condition, 'Condition', { required: true, max: 200 });
  const diagnosedOn = v.dateStr(b.diagnosedOn, 'Diagnosed on');
  const notes = v.str(b.notes, 'Notes', { max: 500 });
  const profile = await loadOwnProfile(req.user._id);
  profile.medicalHistory.push({ condition, diagnosedOn, notes });
  await profile.save();
  await audit({ actor: req.user._id, action: 'history.add', entityType: 'PatientProfile', entityId: profile._id, patient: req.user._id, meta: { condition } });
  ok(res, profile.medicalHistory, 201);
};

exports.removeHistory = async (req, res) => {
  const id = v.objectId(req.params.id, 'history id');
  const profile = await loadOwnProfile(req.user._id);
  const item = profile.medicalHistory.id(id);
  if (!item) throw new HttpError(404, 'History entry not found');
  item.deleteOne();
  await profile.save();
  await audit({ actor: req.user._id, action: 'history.remove', entityType: 'PatientProfile', entityId: profile._id, patient: req.user._id, meta: { condition: item.condition } });
  ok(res, profile.medicalHistory);
};

exports.getRecord = async (req, res) => {
  const patientId = v.objectId(req.params.patientId, 'patientId');
  const access = await assertPatientAccess(req.user, patientId);
  const [user, profile] = await Promise.all([User.findById(patientId).lean(), PatientProfile.findOne({ user: patientId }).lean()]);
  if (!user || !profile) throw new HttpError(404, 'Patient not found');
  ok(res, { ...shape(user, profile, canSeeMedicalInfo(access)), access: { level: access.level, permissions: access.grant?.permissions || null } });
};
