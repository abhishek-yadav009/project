const { Router } = require('express');
const { requireAuth, requireRole } = require('../middleware/auth');
const { authLimiter, externalLimiter } = require('../middleware/errors');
const { isDbReady } = require('../config/db');
const { ok } = require('../utils/http');
const auth = require('../controllers/authController');
const patient = require('../controllers/patientController');
const care = require('../controllers/careController');
const rx = require('../controllers/prescriptionController');
const dose = require('../controllers/doseController');
const alert = require('../controllers/alertController');
const misc = require('../controllers/miscController');

const r = Router();
const doctor = requireRole('doctor');
const patientOnly = requireRole('patient');
const granteeOnly = requireRole('doctor', 'caregiver');

r.get('/health', (_req, res) => ok(res, { status: 'ok', database: isDbReady() ? 'connected' : 'disconnected' }));

r.post('/auth/register', authLimiter, auth.register);
r.post('/auth/login', authLimiter, auth.login);
r.post('/auth/logout', auth.logout);
r.get('/auth/me', requireAuth, auth.me);
r.post('/auth/forgot-password', authLimiter, auth.forgotPassword);
r.post('/auth/reset-password', authLimiter, auth.resetPassword);

r.use(requireAuth);

r.put('/auth/notification-preferences', auth.updateNotificationPreferences);
r.get('/patients/me', patientOnly, patient.getMine);
r.put('/patients/me', patientOnly, patient.updateMine);
r.get('/patients/me/audit-log', patientOnly, rx.history);
r.post('/patients/me/allergies', patientOnly, patient.addAllergy);
r.delete('/patients/me/allergies/:id', patientOnly, patient.removeAllergy);
r.post('/patients/me/history', patientOnly, patient.addHistory);
r.delete('/patients/me/history/:id', patientOnly, patient.removeHistory);
r.get('/patients/:patientId/record', granteeOnly, patient.getRecord);

r.get('/care', care.list);
r.get('/care/patients', granteeOnly, care.myPatients);
r.post('/care/invite', patientOnly, care.invite);
r.post('/care/request', granteeOnly, care.request);
r.post('/care/:id/approve', patientOnly, care.approve);
r.post('/care/:id/decline', patientOnly, care.decline);
r.post('/care/:id/revoke', care.revoke);
r.put('/care/:id/permissions', patientOnly, care.updatePermissions);

r.get('/medicines/search', externalLimiter, rx.searchMedicines);

r.get('/prescriptions', rx.list);
r.get('/prescriptions/history', rx.history);
r.get('/prescriptions/:id', rx.get);
r.post('/prescriptions', doctor, externalLimiter, rx.create);
r.put('/prescriptions/:id', doctor, rx.update);
r.post('/prescriptions/:id/discontinue', doctor, rx.discontinue);
r.post('/prescriptions/:id/recheck', doctor, externalLimiter, rx.recheck);

r.get('/safety/checks', rx.safetyChecks);
r.post('/safety/check', doctor, externalLimiter, rx.runCheck);

r.get('/doses', dose.schedule);
r.get('/doses/adherence', dose.adherence);
r.post('/doses/:id/status', patientOnly, dose.setStatus);

r.get('/alerts', alert.list);
r.post('/alerts/:id/resolve', doctor, alert.resolve);

r.get('/notifications', alert.notifications);
r.post('/notifications/read-all', alert.markAllRead);
r.post('/notifications/:id/read', alert.markRead);

r.get('/facilities', externalLimiter, misc.facilities);

r.get('/admin/doctors', requireRole('admin'), misc.listDoctors);
r.post('/admin/doctors/:userId/verify', requireRole('admin'), misc.verifyDoctor);

module.exports = r;
