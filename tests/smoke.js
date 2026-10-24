const baseUrl = (process.env.APP_URL || 'http://localhost:3000').replace(/\/+$/, '');
const demoPassword = process.env.DEMO_PASSWORD;

if (!demoPassword) throw new Error('Set DEMO_PASSWORD in .env before running the smoke test');

async function request(path, { cookie, method = 'GET', body } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(cookie ? { Cookie: cookie } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(method === 'GET' ? {} : { Origin: new URL(baseUrl).origin }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json();
  if (!response.ok || !payload.success) {
    throw new Error(`${method} ${path} failed (${response.status}): ${payload.error?.message || 'Unexpected response'}`);
  }
  const setCookies = response.headers.getSetCookie?.() || [response.headers.get('set-cookie')].filter(Boolean);
  return {
    data: payload.data,
    cookie: setCookies.map((value) => value.split(';')[0]).join('; '),
  };
}

async function login(email) {
  const result = await request('/api/auth/login', {
    method: 'POST',
    body: { email, password: demoPassword },
  });
  if (!result.cookie) throw new Error(`No session cookie returned for ${email}`);
  if (JSON.stringify(result.data).includes('passwordHash')) throw new Error('Authentication response exposed a password hash');
  return { cookie: result.cookie, user: result.data.user };
}

async function check(label, work) {
  await work();
  console.log(`PASS ${label}`);
}

async function main() {
  const patient = await login('patient@example.test');
  const doctor = await login('doctor@example.test');
  const caregiver = await login('caregiver@example.test');

  await check('patient profile and medication endpoints', async () => {
    await request('/api/patients/me', { cookie: patient.cookie });
    await request('/api/prescriptions', { cookie: patient.cookie });
    await request('/api/doses', { cookie: patient.cookie });
    await request('/api/doses/adherence', { cookie: patient.cookie });
    await request('/api/alerts', { cookie: patient.cookie });
    await request('/api/notifications', { cookie: patient.cookie });
  });

  await check('verified doctor authorization and patient record endpoints', async () => {
    const patients = (await request('/api/care/patients', { cookie: doctor.cookie })).data;
    if (!patients.some((item) => String(item._id) === String(patient.user._id))) {
      throw new Error('Seeded patient is not authorized to the demo doctor');
    }
    const query = `?patientId=${encodeURIComponent(patient.user._id)}`;
    await request(`/api/patients/${encodeURIComponent(patient.user._id)}/record`, { cookie: doctor.cookie });
    await request(`/api/prescriptions${query}`, { cookie: doctor.cookie });
    await request(`/api/prescriptions/history${query}`, { cookie: doctor.cookie });
    await request(`/api/doses${query}`, { cookie: doctor.cookie });
    await request(`/api/doses/adherence${query}`, { cookie: doctor.cookie });
    await request(`/api/alerts${query}`, { cookie: doctor.cookie });
    await request(`/api/safety/checks${query}`, { cookie: doctor.cookie });
  });

  await check('caregiver patient-approved access', async () => {
    const patients = (await request('/api/care/patients', { cookie: caregiver.cookie })).data;
    if (!patients.some((item) => String(item._id) === String(patient.user._id))) {
      throw new Error('Seeded patient is not authorized to the demo caregiver');
    }
    const query = `?patientId=${encodeURIComponent(patient.user._id)}`;
    await request(`/api/prescriptions${query}`, { cookie: caregiver.cookie });
    if (patients[0].permissions?.viewDoses) await request(`/api/doses${query}`, { cookie: caregiver.cookie });
  });

  console.log('Smoke checks completed. These requests do not modify patient records.');
}

main().catch((error) => {
  console.error('[smoke] Failed:', error.message);
  process.exitCode = 1;
});
