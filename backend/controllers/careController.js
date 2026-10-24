const { CareAuthorization, User, DoctorProfile } = require('../models');
const { HttpError, ok } = require('../utils/http');
const v = require('../utils/validate');
const { audit, notify } = require('../services/audit');
const { isVerifiedDoctor } = require('../services/access');
const { inValues } = require('../utils/mongo');
const { pagination, pageInfo } = require('../utils/pagination');

const PERMISSION_KEYS = ['viewMedications', 'viewDoses', 'receiveAlerts', 'viewMedicalInfo'];

function parsePermissions(input, granteeRole) {
  if (granteeRole === 'doctor') return { viewMedications: true, viewDoses: true, receiveAlerts: true, viewMedicalInfo: true };
  const p = input || {};
  const out = {};
  for (const k of PERMISSION_KEYS) out[k] = p[k] === undefined ? k !== 'viewMedicalInfo' : p[k] === true || p[k] === 'true';
  return out;
}

async function findActiveOrPending(patient, grantee) {
  return CareAuthorization.findOne({ patient, grantee, status: inValues(['pending', 'active']) });
}

async function serialize(grants) {
  const ids = [...new Set(grants.flatMap((g) => [String(g.patient), String(g.grantee)]))];
  const users = await User.find({ _id: inValues(ids) }).select('name email role').lean();
  const map = new Map(users.map((u) => [String(u._id), u]));
  const doctorIds = grants.filter((g) => g.granteeRole === 'doctor').map((g) => g.grantee);
  const docs = await DoctorProfile.find({ user: inValues(doctorIds) }).select('user verificationStatus specialty').lean();
  const docMap = new Map(docs.map((d) => [String(d.user), d]));
  return grants.map((g) => ({
    _id: g._id,
    status: g.status,
    granteeRole: g.granteeRole,
    permissions: g.permissions,
    requestedBy: g.requestedBy,
    approvedAt: g.approvedAt,
    revokedAt: g.revokedAt,
    createdAt: g.createdAt,
    patient: map.get(String(g.patient)) || null,
    grantee: map.get(String(g.grantee)) || null,
    doctor: g.granteeRole === 'doctor' ? docMap.get(String(g.grantee)) || null : undefined,
  }));
}

exports.list = async (req, res) => {
  if (req.user.role === 'doctor' && !(await isVerifiedDoctor(req.user._id))) {
    throw new HttpError(403, 'Doctor verification is required to view patient authorizations');
  }
  const filter = req.user.role === 'patient' ? { patient: req.user._id } : { grantee: req.user._id };
  const paging = pagination(req.query);
  const grantQuery = CareAuthorization.find(filter).sort({ updatedAt: -1 });
  if (paging.enabled) grantQuery.skip(paging.skip).limit(paging.limit);
  const grants = await grantQuery.lean();
  if (!paging.enabled) return ok(res, await serialize(grants));
  const [items, total] = await Promise.all([serialize(grants), CareAuthorization.countDocuments(filter)]);
  ok(res, { items, pagination: pageInfo(total, paging) });
};

exports.invite = async (req, res) => {
  const email = v.email(req.body?.email, 'Caregiver/doctor email');
  const grantee = await User.findOne({ email }).lean();
  if (!grantee || !['doctor', 'caregiver'].includes(grantee.role)) {
    throw new HttpError(404, 'No registered doctor or caregiver account uses that email. Ask them to register first.');
  }
  if (await findActiveOrPending(req.user._id, grantee._id)) throw new HttpError(409, 'This person already has an active or pending authorization');
  const grant = await CareAuthorization.create({
    patient: req.user._id,
    grantee: grantee._id,
    granteeRole: grantee.role,
    requestedBy: req.user._id,
    status: 'active',
    approvedAt: new Date(),
    permissions: parsePermissions(req.body?.permissions, grantee.role),
  });
  await audit({ actor: req.user._id, action: 'care.grant', entityType: 'CareAuthorization', entityId: grant._id, patient: req.user._id, meta: { grantee: grantee._id, permissions: grant.permissions } });
  await notify([grantee._id], { type: 'care_granted', title: 'Access granted', message: `${req.user.name} authorized you as their ${grantee.role}.`, patient: req.user._id });
  ok(res, (await serialize([grant.toObject()]))[0], 201);
};

exports.request = async (req, res) => {
  const email = v.email(req.body?.patientEmail, 'Patient email');
  const patient = await User.findOne({ email, role: 'patient' }).lean();
  // Same response whether or not the patient exists, to avoid leaking who is registered.
  if (patient && !(await findActiveOrPending(patient._id, req.user._id))) {
    const grant = await CareAuthorization.create({
      patient: patient._id,
      grantee: req.user._id,
      granteeRole: req.user.role,
      requestedBy: req.user._id,
      status: 'pending',
      permissions: parsePermissions({}, req.user.role),
    });
    await audit({ actor: req.user._id, action: 'care.request', entityType: 'CareAuthorization', entityId: grant._id, patient: patient._id });
    await notify([patient._id], { type: 'care_request', title: 'Access request', message: `${req.user.name} (${req.user.role}) requested access to your medication records. Review it on your dashboard.`, patient: patient._id });
  }
  ok(res, { message: 'If a patient account exists for that email, they will see your request and can approve it.' }, 202);
};

async function loadOwnedGrant(req) {
  const id = v.objectId(req.params.id, 'authorization id');
  const grant = await CareAuthorization.findById(id);
  if (!grant) throw new HttpError(404, 'Authorization not found');
  const isPatient = String(grant.patient) === String(req.user._id);
  const isGrantee = String(grant.grantee) === String(req.user._id);
  if (!isPatient && !isGrantee) throw new HttpError(404, 'Authorization not found');
  return { grant, isPatient, isGrantee };
}

exports.approve = async (req, res) => {
  const { grant, isPatient } = await loadOwnedGrant(req);
  if (!isPatient) throw new HttpError(403, 'Only the patient can approve access');
  if (grant.status !== 'pending') throw new HttpError(409, `Authorization is ${grant.status}`);
  grant.status = 'active';
  grant.approvedAt = new Date();
  if (grant.granteeRole === 'caregiver' && req.body?.permissions) grant.permissions = parsePermissions(req.body.permissions, 'caregiver');
  await grant.save();
  await audit({ actor: req.user._id, action: 'care.approve', entityType: 'CareAuthorization', entityId: grant._id, patient: grant.patient, meta: { permissions: grant.permissions } });
  await notify([grant.grantee], { type: 'care_granted', title: 'Access approved', message: `${req.user.name} approved your access request.`, patient: grant.patient });
  ok(res, (await serialize([grant.toObject()]))[0]);
};

exports.decline = async (req, res) => {
  const { grant, isPatient } = await loadOwnedGrant(req);
  if (!isPatient) throw new HttpError(403, 'Only the patient can decline access');
  if (grant.status !== 'pending') throw new HttpError(409, `Authorization is ${grant.status}`);
  grant.status = 'declined';
  await grant.save();
  await audit({ actor: req.user._id, action: 'care.decline', entityType: 'CareAuthorization', entityId: grant._id, patient: grant.patient });
  ok(res, (await serialize([grant.toObject()]))[0]);
};

exports.revoke = async (req, res) => {
  const { grant, isPatient } = await loadOwnedGrant(req);
  if (!['active', 'pending'].includes(grant.status)) throw new HttpError(409, `Authorization is already ${grant.status}`);
  grant.status = 'revoked';
  grant.revokedAt = new Date();
  grant.revokedBy = req.user._id;
  await grant.save();
  await audit({ actor: req.user._id, action: 'care.revoke', entityType: 'CareAuthorization', entityId: grant._id, patient: grant.patient });
  const other = isPatient ? grant.grantee : grant.patient;
  await notify([other], { type: 'care_revoked', title: 'Access revoked', message: isPatient ? `${req.user.name} revoked your access.` : `${req.user.name} removed themselves from your care team.`, patient: grant.patient });
  ok(res, (await serialize([grant.toObject()]))[0]);
};

exports.updatePermissions = async (req, res) => {
  const { grant, isPatient } = await loadOwnedGrant(req);
  if (!isPatient) throw new HttpError(403, 'Only the patient can change permissions');
  if (grant.granteeRole !== 'caregiver') throw new HttpError(400, 'Doctor access levels are fixed; revoke access instead');
  if (grant.status !== 'active') throw new HttpError(409, 'Only active authorizations can be changed');
  const before = { ...grant.permissions.toObject?.() ?? grant.permissions };
  grant.permissions = parsePermissions(req.body?.permissions, 'caregiver');
  await grant.save();
  await audit({ actor: req.user._id, action: 'care.permissions', entityType: 'CareAuthorization', entityId: grant._id, patient: grant.patient, changes: [{ field: 'permissions', from: before, to: grant.permissions }] });
  ok(res, (await serialize([grant.toObject()]))[0]);
};

exports.myPatients = async (req, res) => {
  if (req.user.role === 'doctor' && !(await isVerifiedDoctor(req.user._id))) {
    throw new HttpError(403, 'Doctor verification is required before viewing patient records');
  }
  const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '';
  const paging = pagination(req.query);
  const grants = await CareAuthorization.find({ grantee: req.user._id, status: 'active' }).lean();
  const filter = { _id: inValues(grants.map((g) => g.patient)) };
  if (q) {
    const re = new RegExp(v.escapeRegex(q), 'i');
    filter.$or = [{ name: re }, { email: re }];
  }
  const patientQuery = User.find(filter).select('name email').sort({ name: 1 });
  if (paging.enabled) patientQuery.skip(paging.skip).limit(paging.limit);
  const patients = await patientQuery.lean();
  const byPatient = new Map(grants.map((g) => [String(g.patient), g]));
  const items = patients.map((p) => ({ ...p, authorizationId: byPatient.get(String(p._id))._id, permissions: byPatient.get(String(p._id)).permissions }));
  if (!paging.enabled) return ok(res, items);
  const total = await User.countDocuments(filter);
  ok(res, { items, pagination: pageInfo(total, paging) });
};
