const bcrypt = require('bcryptjs');
const { User, PatientProfile, DoctorProfile } = require('../models');
const { HttpError, ok } = require('../utils/http');
const v = require('../utils/validate');
const { isValidTimeZone } = require('../utils/time');
const { audit } = require('../services/audit');

const MAX_FAILED = 5;
const LOCK_MINUTES = 15;
const DUMMY_HASH = bcrypt.hashSync('timing-safe-dummy-password', 12);

function validatePassword(pw) {
  if (typeof pw !== 'string' || pw.length < 8 || pw.length > 128) throw new HttpError(400, 'Password must be 8-128 characters');
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) throw new HttpError(400, 'Password must contain at least one letter and one number');
}

function startSession(req, user) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((err) => {
      if (err) return reject(err);
      req.session.userId = String(user._id);
      req.session.role = user.role;
      req.session.save((e) => (e ? reject(e) : resolve()));
    });
  });
}

async function publicUser(user) {
  const out = { _id: user._id, name: user.name, email: user.email, role: user.role };
  if (user.role === 'doctor') {
    const dp = await DoctorProfile.findOne({ user: user._id }).lean();
    out.doctor = dp ? { verificationStatus: dp.verificationStatus, specialty: dp.specialty, licenseNumber: dp.licenseNumber, organization: dp.organization } : null;
  }
  return out;
}

exports.register = async (req, res) => {
  const b = req.body || {};
  const name = v.str(b.name, 'Name', { required: true, max: 100, min: 2 });
  const email = v.email(b.email);
  validatePassword(b.password);
  const role = v.oneOf(b.role, 'Role', ['patient', 'doctor', 'caregiver']);

  let doctorData = null;
  if (role === 'doctor') {
    doctorData = {
      licenseNumber: v.str(b.licenseNumber, 'License number', { required: true, max: 50 }),
      specialty: v.str(b.specialty, 'Specialty', { max: 100 }),
      organization: v.str(b.organization, 'Organization', { max: 150 }),
    };
  }
  let timezone = 'UTC';
  if (role === 'patient' && b.timezone) {
    if (!isValidTimeZone(b.timezone)) throw new HttpError(400, 'Invalid timezone');
    timezone = b.timezone;
  }

  if (await User.exists({ email })) throw new HttpError(409, 'An account with this email already exists');
  const passwordHash = await bcrypt.hash(b.password, 12);
  const user = await User.create({ name, email, passwordHash, role });
  if (role === 'patient') await PatientProfile.create({ user: user._id, timezone });
  if (role === 'doctor') await DoctorProfile.create({ user: user._id, ...doctorData });
  await audit({ actor: user._id, action: 'user.register', entityType: 'User', entityId: user._id, meta: { role } });

  await startSession(req, user);
  ok(res, { user: await publicUser(user) }, 201);
};

exports.login = async (req, res) => {
  const b = req.body || {};
  const email = v.email(b.email);
  if (typeof b.password !== 'string' || !b.password) throw new HttpError(400, 'Password is required');

  const user = await User.findOne({ email }).select('+passwordHash +failedLogins +lockUntil');
  if (!user) {
    await bcrypt.compare(b.password, DUMMY_HASH);
    throw new HttpError(401, 'Invalid email or password');
  }
  if (user.lockUntil && user.lockUntil > new Date()) {
    throw new HttpError(423, `Account temporarily locked after repeated failed logins. Try again after ${user.lockUntil.toISOString()}`);
  }
  const valid = await bcrypt.compare(b.password, user.passwordHash);
  if (!valid) {
    user.failedLogins = (user.failedLogins || 0) + 1;
    if (user.failedLogins >= MAX_FAILED) {
      user.lockUntil = new Date(Date.now() + LOCK_MINUTES * 60000);
      user.failedLogins = 0;
    }
    await user.save();
    throw new HttpError(401, 'Invalid email or password');
  }
  if (user.failedLogins || user.lockUntil) {
    user.failedLogins = 0;
    user.lockUntil = undefined;
    await user.save();
  }
  await startSession(req, user);
  ok(res, { user: await publicUser(user) });
};

exports.logout = (req, res, next) => {
  req.session.destroy((err) => {
    if (err) return next(err);
    res.clearCookie('hc.sid');
    ok(res, { loggedOut: true });
  });
};

exports.me = async (req, res) => ok(res, { user: await publicUser(req.user) });

exports.publicUser = publicUser;
