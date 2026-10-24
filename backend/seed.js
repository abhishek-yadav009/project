const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const config = require('./config');
const { connectDB } = require('./config/db');
const { User, PatientProfile, DoctorProfile, CareAuthorization } = require('./models');

const DEMO_USERS = [
  { name: 'Demo Patient', email: 'patient@example.test', role: 'patient' },
  { name: 'Demo Doctor', email: 'doctor@example.test', role: 'doctor' },
  { name: 'Demo Caregiver', email: 'caregiver@example.test', role: 'caregiver' },
];

function requirePassword(value, label) {
  if (typeof value !== 'string' || value.length < 8 || !/[A-Za-z]/.test(value) || !/\d/.test(value)) {
    throw new Error(`${label} must be at least 8 characters and include a letter and a number`);
  }
}

async function getOrCreateUser(details, passwordHash) {
  let user = await User.findOne({ email: details.email });
  if (user) {
    if (user.role !== details.role) throw new Error(`${details.email} already exists with role "${user.role}"`);
    return user;
  }
  user = await User.create({ ...details, passwordHash });
  return user;
}

async function seed() {
  const demoPassword = process.env.DEMO_PASSWORD;
  const adminEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (Boolean(adminEmail) !== Boolean(adminPassword)) {
    throw new Error('Set both ADMIN_EMAIL and ADMIN_PASSWORD, or leave both unset');
  }
  if (!demoPassword && !adminEmail) {
    throw new Error('Set DEMO_PASSWORD to create demo accounts, ADMIN_EMAIL and ADMIN_PASSWORD to create an administrator, or configure both');
  }
  if (demoPassword) requirePassword(demoPassword, 'DEMO_PASSWORD');
  if (adminPassword) requirePassword(adminPassword, 'ADMIN_PASSWORD');

  await connectDB();
  let admin = null;
  if (adminEmail) {
    admin = await getOrCreateUser({ name: 'Demo Administrator', email: adminEmail, role: 'admin' }, await bcrypt.hash(adminPassword, 12));
  }

  if (demoPassword) {
    const demoHash = await bcrypt.hash(demoPassword, 12);
    const users = {};
    for (const details of DEMO_USERS) users[details.role] = await getOrCreateUser(details, demoHash);

    await PatientProfile.updateOne(
      { user: users.patient._id },
      { $setOnInsert: { user: users.patient._id, timezone: 'UTC' } },
      { upsert: true },
    );
    const doctorProfile = await DoctorProfile.findOneAndUpdate(
      { user: users.doctor._id },
      { $set: { verificationStatus: 'verified', verifiedBy: admin?._id || null, verifiedAt: new Date() }, $setOnInsert: { user: users.doctor._id, licenseNumber: 'DEMO-NOT-A-REAL-LICENSE', specialty: 'Demo account', organization: 'Local demonstration only' } },
      { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
    );

    for (const grantee of [users.doctor, users.caregiver]) {
      const existing = await CareAuthorization.findOne({ patient: users.patient._id, grantee: grantee._id });
      if (!existing) {
        await CareAuthorization.create({
          patient: users.patient._id,
          grantee: grantee._id,
          granteeRole: grantee.role,
          requestedBy: users.patient._id,
          status: 'active',
          approvedAt: new Date(),
          permissions: {
            viewMedications: true,
            viewDoses: true,
            receiveAlerts: true,
            viewMedicalInfo: grantee.role === 'doctor',
          },
        });
      }
    }

    console.log('[seed] Demo accounts are ready (all names and records are synthetic).');
    console.log(`[seed] Patient: ${DEMO_USERS[0].email}`);
    console.log(`[seed] Doctor: ${DEMO_USERS[1].email} (${doctorProfile.verificationStatus})`);
    console.log(`[seed] Caregiver: ${DEMO_USERS[2].email}`);
    console.log(`[seed] Shared password is the value of DEMO_PASSWORD in your local .env file.`);
  }

  if (admin) console.log(`[seed] Administrator: ${admin.email}`);
}

seed()
  .catch((error) => {
    console.error('[seed] Failed:', error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (mongoose.connection.readyState) await mongoose.disconnect();
  });
