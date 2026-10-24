const mongoose = require('mongoose');
const { CareAuthorization, DoctorProfile } = require('../models');
const { HttpError } = require('../utils/http');
const { inValues } = require('../utils/mongo');

async function isVerifiedDoctor(userId) {
  const dp = await DoctorProfile.findOne({ user: userId }).select('verificationStatus').lean();
  return dp?.verificationStatus === 'verified';
}

/**
 * Central authorization check for every patient-scoped read/write.
 * permission: viewMedications | viewDoses | receiveAlerts | viewMedicalInfo (caregiver-scoped flags).
 * Doctors with an active grant get full clinical access; admins get none.
 */
async function assertPatientAccess(user, patientId, permission) {
  if (typeof patientId !== 'string' && !(patientId instanceof mongoose.Types.ObjectId)) {
    throw new HttpError(400, 'patientId is required');
  }
  const pid = String(patientId);
  if (!mongoose.isValidObjectId(pid)) throw new HttpError(400, 'Invalid patientId');

  if (user.role === 'patient') {
    if (String(user._id) === pid) return { level: 'self', grant: null };
    throw new HttpError(403, 'Patients can only access their own records');
  }

  if (user.role === 'doctor') {
    if (!(await isVerifiedDoctor(user._id))) throw new HttpError(403, 'Your doctor account has not been verified yet');
    const grant = await CareAuthorization.findOne({ grantee: user._id, patient: pid, status: 'active' });
    if (!grant) throw new HttpError(403, 'You do not have active authorization for this patient');
    return { level: 'doctor', grant };
  }

  if (user.role === 'caregiver') {
    const grant = await CareAuthorization.findOne({ grantee: user._id, patient: pid, status: 'active' });
    if (!grant) throw new HttpError(403, 'You do not have active authorization for this patient');
    if (permission && !grant.permissions?.[permission]) {
      throw new HttpError(403, `The patient has not granted the "${permission}" permission`);
    }
    return { level: 'caregiver', grant };
  }

  throw new HttpError(403, 'Your role cannot access patient records');
}

const canSeeMedicalInfo = (access) =>
  access.level === 'self' || access.level === 'doctor' || Boolean(access.grant?.permissions?.viewMedicalInfo);

async function alertRecipients(patientId) {
  const grants = await CareAuthorization.find({ patient: patientId, status: 'active' }).lean();
  const doctorIds = grants.filter((g) => g.granteeRole === 'doctor').map((g) => g.grantee);
  const verified = await DoctorProfile.find({ user: inValues(doctorIds), verificationStatus: 'verified' }).select('user').lean();
  const caregivers = grants.filter((g) => g.granteeRole === 'caregiver' && g.permissions?.receiveAlerts).map((g) => g.grantee);
  return { doctors: verified.map((d) => d.user), caregivers };
}

module.exports = { assertPatientAccess, canSeeMedicalInfo, isVerifiedDoctor, alertRecipients };
