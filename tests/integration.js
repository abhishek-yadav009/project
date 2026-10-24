const assert = require('node:assert/strict');
const mongoose = require('mongoose');

process.env.NODE_ENV = 'test';
process.env.MONGODB_DB = `caretrack_integration_${Date.now()}_${process.pid}`;
process.env.SESSION_SECRET = 'integration-test-session-secret-not-for-production';
process.env.SMTP_URL = '';
process.env.SMTP_FROM = '';
process.env.TWILIO_ACCOUNT_SID = '';
process.env.TWILIO_AUTH_TOKEN = '';
process.env.TWILIO_FROM_NUMBER = '';

const config = require('../backend/config');
const { connectDB } = require('../backend/config/db');
const { buildApp } = require('../backend/server');
const { DoctorProfile, CareAuthorization, DoseRecord, User } = require('../backend/models');
const { notify } = require('../backend/services/audit');
const delivery = require('../backend/services/delivery');

async function request(baseUrl, path, { method = 'GET', body, cookie } = {}) {
  const response = await fetch(`${baseUrl}/api${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await response.json();
  return { response, json, cookie: response.headers.get('set-cookie')?.split(';')[0] || cookie };
}

async function register(baseUrl, body) {
  const result = await request(baseUrl, '/auth/register', { method: 'POST', body });
  assert.equal(result.response.status, 201, result.json.error?.message);
  return { user: result.json.data.user, cookie: result.cookie };
}

async function run() {
  if (!config.mongoUri) throw new Error('MONGODB_URI is required for integration tests');
  let server;
  try {
    await connectDB();
    const app = buildApp();
    server = app.listen(0);
    await new Promise((resolve, reject) => {
      server.once('listening', resolve);
      server.once('error', reject);
    });
    const baseUrl = `http://127.0.0.1:${server.address().port}`;

    const health = await request(baseUrl, '/health');
    assert.equal(health.response.status, 200);
    assert.equal(health.json.data.database, 'connected');

    const unauthenticated = await request(baseUrl, '/patients/me');
    assert.equal(unauthenticated.response.status, 401);

    const patient = await register(baseUrl, {
      name: 'Integration Patient',
      email: `patient-${Date.now()}@example.test`,
      password: 'TestPassword123',
      role: 'patient',
    });
    const profile = await request(baseUrl, '/patients/me', { cookie: patient.cookie });
    assert.equal(profile.response.status, 200);
    assert.equal(profile.json.data.user._id, patient.user._id);

    const update = await request(baseUrl, '/patients/me', {
      method: 'PUT',
      cookie: patient.cookie,
      body: { name: 'Updated Patient', timezone: 'UTC', phone: '' },
    });
    assert.equal(update.response.status, 200);
    assert.equal(update.json.data.user.name, 'Updated Patient');

    const allergy = await request(baseUrl, '/patients/me/allergies', {
      method: 'POST',
      cookie: patient.cookie,
      body: { substance: 'penicillin', severity: 'moderate', reaction: 'rash' },
    });
    assert.equal(allergy.response.status, 201);

    const audit = await request(baseUrl, '/patients/me/audit-log?page=1&limit=10', { cookie: patient.cookie });
    assert.equal(audit.response.status, 200);
    assert.ok(audit.json.data.items.some((entry) => entry.action === 'allergy.add'));

    const prescriptionPage = await request(baseUrl, '/prescriptions?page=1&limit=5', { cookie: patient.cookie });
    assert.equal(prescriptionPage.response.status, 200);
    assert.deepEqual(prescriptionPage.json.data.pagination, { page: 1, limit: 5, total: 0, pages: 0 });

    await request(baseUrl, '/auth/notification-preferences', {
      method: 'PUT',
      cookie: patient.cookie,
      body: { email: true, sms: true, notificationPhone: '+14155550123' },
    }).then((result) => assert.equal(result.response.status, 200));
    await notify([patient.user._id], {
      type: 'integration_test',
      title: 'Integration test notice',
      message: 'Delivery status verification.',
      patient: patient.user._id,
    });
    const notices = await request(baseUrl, '/notifications?page=1&limit=5', { cookie: patient.cookie });
    assert.equal(notices.response.status, 200);
    assert.equal(notices.json.data.items[0].channels.email, 'not_configured');
    assert.equal(notices.json.data.items[0].channels.sms, 'not_configured');
    assert.equal(notices.json.data.pagination.limit, 5);

    const previousEmailConfiguration = config.emailConfigPresent;
    let resetCode = '';
    config.emailConfigPresent = true;
    delivery.sendPasswordReset = async (email, code) => {
      assert.equal(email, patient.user.email);
      resetCode = code;
    };
    const resetRequested = await request(baseUrl, '/auth/forgot-password', {
      method: 'POST',
      body: { email: patient.user.email },
    });
    assert.equal(resetRequested.response.status, 200);
    assert.equal(resetRequested.json.data.devToken, undefined);
    assert.match(resetCode, /^\d{6}$/);
    const wrongCode = String(Number(resetCode) === 999999 ? 999998 : Number(resetCode) + 1);
    const rejectedReset = await request(baseUrl, '/auth/reset-password', {
      method: 'POST',
      body: { email: patient.user.email, token: wrongCode, password: 'NewPassword123' },
    });
    assert.equal(rejectedReset.response.status, 400);
    const completedReset = await request(baseUrl, '/auth/reset-password', {
      method: 'POST',
      body: { email: patient.user.email, token: resetCode, password: 'NewPassword123' },
    });
    assert.equal(completedReset.response.status, 200);
    const storedUser = await User.findById(patient.user._id).select('+resetTokenHash +passwordHash').lean();
    assert.equal(storedUser.resetTokenHash, undefined);
    assert.notEqual(storedUser.passwordHash, 'NewPassword123');
    const loginAfterReset = await request(baseUrl, '/auth/login', {
      method: 'POST',
      body: { email: patient.user.email, password: 'NewPassword123' },
    });
    assert.equal(loginAfterReset.response.status, 200);
    config.emailConfigPresent = previousEmailConfiguration;

    const otherPatient = await register(baseUrl, {
      name: 'Other Patient',
      email: `other-${Date.now()}@example.test`,
      password: 'TestPassword123',
      role: 'patient',
    });
    const isolatedAudit = await request(baseUrl, '/patients/me/audit-log', { cookie: otherPatient.cookie });
    assert.equal(isolatedAudit.response.status, 200);
    assert.equal(isolatedAudit.json.data.length, 0);

    const doctor = await register(baseUrl, {
      name: 'Integration Doctor',
      email: `doctor-${Date.now()}@example.test`,
      password: 'TestPassword123',
      role: 'doctor',
      licenseNumber: 'TEST-LICENSE',
    });
    await DoctorProfile.updateOne({ user: doctor.user._id }, { verificationStatus: 'verified' });
    await CareAuthorization.create({
      patient: patient.user._id,
      grantee: doctor.user._id,
      granteeRole: 'doctor',
      requestedBy: patient.user._id,
      status: 'active',
      approvedAt: new Date(),
    });
    const startDate = new Date().toISOString().slice(0, 10);
    const invalidPrescription = await request(baseUrl, '/prescriptions', {
      method: 'POST',
      cookie: doctor.cookie,
      body: {
        patientId: patient.user._id,
        medicineName: 'Invalid Test Medicine',
        strength: '10 mg',
        dosageInstructions: 'Test',
        route: 'oral',
        frequency: 'Once daily',
        scheduleTimes: ['25:61'],
        startDate,
      },
    });
    assert.equal(invalidPrescription.response.status, 400);

    const createPrescription = await request(baseUrl, '/prescriptions', {
      method: 'POST',
      cookie: doctor.cookie,
      body: {
        patientId: patient.user._id,
        medicineName: 'Integration Test Medicine',
        activeIngredients: ['example ingredient'],
        strength: '10 mg',
        dosageInstructions: 'Take as directed in this synthetic integration test.',
        route: 'oral',
        frequency: 'Once daily',
        scheduleTimes: ['23:59'],
        startDate,
        endDate: '',
        additionalInstructions: '',
        reason: 'Integration test',
      },
    });
    assert.equal(createPrescription.response.status, 201, createPrescription.json.error?.message);
    assert.equal(createPrescription.json.data.prescription.patient, patient.user._id);
    assert.equal(createPrescription.json.data.prescription.medicineName, 'Integration Test Medicine');
    assert.ok(createPrescription.json.data.safetyCheck);
    const patientPrescriptions = await request(baseUrl, '/prescriptions', { cookie: patient.cookie });
    assert.equal(patientPrescriptions.response.status, 200);
    assert.ok(patientPrescriptions.json.data.some((rx) => rx._id === createPrescription.json.data.prescription._id));

    const prescriptionId = createPrescription.json.data.prescription._id;
    const now = Date.now();
    const doseRecords = await DoseRecord.create([
      ...[30, 40].map((minutes) => {
        const scheduledAt = new Date(now + minutes * 60000);
        return {
          patient: patient.user._id,
          prescription: prescriptionId,
          scheduledAt,
          localDate: scheduledAt.toISOString().slice(0, 10),
          localTime: scheduledAt.toISOString().slice(11, 16),
        };
      }),
      (() => {
        const scheduledAt = new Date(now + 120 * 60000);
        return {
          patient: patient.user._id,
          prescription: prescriptionId,
          scheduledAt,
          localDate: scheduledAt.toISOString().slice(0, 10),
          localTime: scheduledAt.toISOString().slice(11, 16),
        };
      })(),
      (() => {
        const scheduledAt = new Date(now - (config.missedAfterMinutes + 10) * 60000);
        return {
          patient: patient.user._id,
          prescription: prescriptionId,
          scheduledAt,
          localDate: scheduledAt.toISOString().slice(0, 10),
          localTime: scheduledAt.toISOString().slice(11, 16),
        };
      })(),
    ]);
    for (const [index, status] of ['taken', 'skipped'].entries()) {
      const result = await request(baseUrl, `/doses/${doseRecords[index]._id}/status`, {
        method: 'POST',
        cookie: patient.cookie,
        body: { status },
      });
      assert.equal(result.response.status, 200, result.json.error?.message);
      assert.equal(result.json.data.status, status);
    }
    const futureTaken = await request(baseUrl, `/doses/${doseRecords[2]._id}/status`, {
      method: 'POST',
      cookie: patient.cookie,
      body: { status: 'taken' },
    });
    assert.equal(futureTaken.response.status, 200, futureTaken.json.error?.message);
    assert.equal(futureTaken.json.data.status, 'taken');
    const schedule = await request(baseUrl, '/doses', { cookie: patient.cookie });
    assert.equal(schedule.response.status, 200, schedule.json.error?.message);
    const missedDose = schedule.json.data.history.find((dose) => dose._id === String(doseRecords[3]._id));
    assert.equal(missedDose?.status, 'missed');
    assert.equal(missedDose?.autoMarked, true);
    const correctedMissedDose = await request(baseUrl, `/doses/${doseRecords[3]._id}/status`, {
      method: 'POST',
      cookie: patient.cookie,
      body: { status: 'taken' },
    });
    assert.equal(correctedMissedDose.response.status, 200, correctedMissedDose.json.error?.message);
    assert.equal(correctedMissedDose.json.data.status, 'taken');
    const refreshedSchedule = await request(baseUrl, '/doses', { cookie: patient.cookie });
    assert.equal(refreshedSchedule.response.status, 200, refreshedSchedule.json.error?.message);
    assert.equal(refreshedSchedule.json.data.adherence.taken, 3, JSON.stringify(refreshedSchedule.json.data.adherence));
    assert.equal(refreshedSchedule.json.data.adherence.skipped, 1, JSON.stringify(refreshedSchedule.json.data.adherence));
    assert.equal(refreshedSchedule.json.data.adherence.eligible, 4, JSON.stringify(refreshedSchedule.json.data.adherence));
    assert.equal(refreshedSchedule.json.data.adherence.adherencePercent, 75, JSON.stringify(refreshedSchedule.json.data.adherence));
    const persistedDoseStatuses = await Promise.all(doseRecords.map((dose) => DoseRecord.findById(dose._id).lean()));
    assert.deepEqual(persistedDoseStatuses.map((dose) => dose.status).sort(), ['skipped', 'taken', 'taken', 'taken']);
    assert.equal(persistedDoseStatuses[0].history.length, 1);
    assert.equal(persistedDoseStatuses[1].history.length, 1);
    assert.equal(persistedDoseStatuses[2].status, 'taken');
    assert.equal(persistedDoseStatuses[2].history.length, 1);
    assert.equal(persistedDoseStatuses[3].history.length, 2);
    assert.deepEqual(
      persistedDoseStatuses[3].history.map((entry) => entry.to),
      ['missed', 'taken'],
    );

    const authorizedRecord = await request(baseUrl, `/patients/${patient.user._id}/record`, { cookie: doctor.cookie });
    assert.equal(authorizedRecord.response.status, 200);
    assert.equal(authorizedRecord.json.data.allergies[0].substance, 'penicillin');
    const deniedRecord = await request(baseUrl, `/patients/${otherPatient.user._id}/record`, { cookie: doctor.cookie });
    assert.equal(deniedRecord.response.status, 403);

    console.log('Integration checks passed: health, authentication, profile, reset-token security, audit isolation, pagination, notification preferences, prescription creation, and patient-authorized access.');
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.dropDatabase();
      await mongoose.disconnect();
    }
  }
}

run().catch((error) => {
  console.error('Integration checks failed:', error.message);
  process.exitCode = 1;
});
