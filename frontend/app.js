const authView = document.querySelector('#auth-view');
const appView = document.querySelector('#app-view');
const content = document.querySelector('#content');
const nav = document.querySelector('#main-nav');
let currentUser = null;
let activeSection = 'overview';
let selectedPatientId = null;
let selectedScheduleDate = null;
let patientOptions = [];
let toastTimer;
let medicineSearchTimer;
let medicineSearchCache = new Map();
let browserReminderTimer;
let doctorFilter = 'pending';
const notifiedDoseIds = new Set();

const NAV_ITEMS = {
  overview: ['Overview', 'O'],
  profile: ['My profile', 'P'],
  patients: ['Patients', 'PT'],
  prescriptions: ['Prescriptions', 'Rx'],
  doses: ['Dose schedule', 'D'],
  safety: ['Safety checks', '!'],
  'medicine-search': ['Medicine guide', 'M'],
  care: ['Care team', 'C'],
  alerts: ['Alerts', 'A'],
  history: ['Change history', 'H'],
  facilities: ['Find care', 'F'],
  notifications: ['Notifications', 'N'],
  admin: ['Doctor review', '✓'],
};

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));
const dateText = (value) => value ? new Date(value).toLocaleString() : '—';
const statusTag = (value) => `<span class="status ${esc(value)}">${esc(value || 'unknown')}</span>`;
const empty = (text) => `<div class="empty">${esc(text)}</div>`;
const json = (data) => JSON.stringify(data);

function showMessage(message, type = '') {
  const box = document.querySelector(currentUser ? '#app-message' : '#auth-message');
  box.textContent = message || '';
  box.className = `message ${type}`;
  clearTimeout(toastTimer);
  if (message) toastTimer = setTimeout(() => { box.textContent = ''; box.className = 'message'; }, 6500);
}

async function api(path, options = {}) {
  const response = await fetch(`/api${path}`, {
    method: options.method || 'GET',
    credentials: 'same-origin',
    headers: { ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: options.body === undefined ? undefined : json(options.body),
  });
  let result;
  try { result = await response.json(); } catch { throw new Error(`Server returned HTTP ${response.status} without a JSON response`); }
  if (!response.ok || result.success === false) throw new Error(result.error?.message || `Request failed (HTTP ${response.status})`);
  return result.data;
}

function setAuthTab(tab) {
  document.querySelectorAll('[data-auth-tab]').forEach((button) => button.classList.toggle('active', button.dataset.authTab === tab));
  document.querySelector('#login-form').classList.toggle('hidden', tab !== 'login');
  document.querySelector('#register-form').classList.toggle('hidden', tab !== 'register');
  showMessage('');
}

function sectionsForRole(role) {
  if (role === 'patient') return [
    ['overview', 'Overview'], ['profile', 'My profile'], ['prescriptions', 'Prescriptions'],
    ['doses', 'Dose schedule'], ['safety', 'Safety checks'], ['medicine-search', 'Medicine guide'], ['care', 'Care team'],
    ['alerts', 'Alerts'], ['facilities', 'Find care'], ['notifications', 'Notifications'],
  ];
  if (role === 'doctor') return [
    ['overview', 'Overview'], ['patients', 'Patients'], ['prescriptions', 'Prescriptions'],
    ['doses', 'Dose history'], ['safety', 'Safety checks'], ['medicine-search', 'Medicine guide'], ['history', 'Change history'],
    ['care', 'Access requests'], ['alerts', 'Alerts'], ['facilities', 'Find care'], ['notifications', 'Notifications'],
  ];
  if (role === 'admin') return [
    ['admin', 'Doctor review'], ['notifications', 'Notifications'], ['facilities', 'Find care'],
  ];
  return [
    ['overview', 'Overview'], ['patients', 'Authorized patients'], ['prescriptions', 'Medications'],
    ['medicine-search', 'Medicine guide'],
    ['doses', 'Dose schedule'], ['care', 'Access'], ['alerts', 'Alerts'],
    ['facilities', 'Find care'], ['notifications', 'Notifications'],
  ];
}

async function enterApp(user) {
  currentUser = user;
  activeSection = user.role === 'admin' ? 'admin' : 'overview';
  authView.classList.add('hidden');
  appView.classList.remove('hidden');
  document.querySelector('#welcome-title').textContent = `Welcome, ${user.name}`;
  document.querySelector('#welcome-subtitle').textContent = `${user.role[0].toUpperCase()}${user.role.slice(1)} account${user.role === 'doctor' && user.doctor?.verificationStatus !== 'verified' ? ' · Verification pending' : ''}`;
  document.querySelector('#account-chip').textContent = user.name;
  document.querySelector('#toolbar-role').textContent = `${user.role[0].toUpperCase()}${user.role.slice(1)} workspace`;
  if (user.role !== 'patient' && user.role !== 'admin') {
    try {
      patientOptions = await api('/care/patients');
      if (!selectedPatientId && patientOptions.length) selectedPatientId = String(patientOptions[0]._id);
    } catch (error) {
      patientOptions = [];
      showMessage(error.message, 'error');
    }
  }
  if (user.role === 'patient') startBrowserReminderPolling();
  renderNav();
  await renderSection(activeSection);
}

function renderNav() {
  const section = sectionsForRole(currentUser.role).find(([id]) => id === activeSection);
  if (section) {
    const [, label] = section;
    document.querySelector('#section-eyebrow').textContent = currentUser.role === 'patient' ? 'YOUR CARE' : `${currentUser.role.toUpperCase()} WORKSPACE`;
    document.querySelector('#welcome-title').textContent = activeSection === 'overview' ? `Welcome, ${currentUser.name}` : label;
  }
  nav.innerHTML = sectionsForRole(currentUser.role).map(([id, label]) => {
    const icon = NAV_ITEMS[id]?.[1] || '•';
    return `<button class="nav-button ${id === activeSection ? 'active' : ''}" type="button" data-section="${id}" aria-current="${id === activeSection ? 'page' : 'false'}"><span class="nav-icon" aria-hidden="true">${icon}</span><span>${label}</span></button>`;
  }).join('');
}

function contextPicker() {
  if (currentUser.role === 'patient') return '';
  if (!patientOptions.length) return `<div class="callout">No patient has authorized this account yet. Use <strong>${currentUser.role === 'doctor' ? 'Access requests' : 'Access'}</strong> to request patient-approved access.</div>`;
  return `<label class="context-picker">Patient
    <select id="patient-picker">${patientOptions.map((p) => `<option value="${esc(p._id)}" ${String(p._id) === String(selectedPatientId) ? 'selected' : ''}>${esc(p.name)} (${esc(p.email)})</option>`).join('')}</select>
  </label>`;
}

async function getContextId() {
  return currentUser.role === 'patient' ? currentUser._id : selectedPatientId;
}

async function contextData(path) {
  const patientId = await getContextId();
  if (!patientId) return null;
  const query = currentUser.role === 'patient' ? '' : `?patientId=${encodeURIComponent(patientId)}`;
  return api(`${path}${query}`);
}

function panel(title, body, tools = '') {
  return `<section class="panel"><div class="panel-head"><h2>${title}</h2>${tools}</div>${body}</section>`;
}

function table(headers, rows) {
  if (!rows.length) return empty('No records yet.');
  return `<div class="table-wrap"><table><thead><tr>${headers.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
}

function adherenceRing(value) {
  const score = value === null || value === undefined ? null : Math.max(0, Math.min(100, Number(value)));
  const circumference = 226.2;
  const progress = score === null || !Number.isFinite(score) ? 0 : (circumference * score / 100).toFixed(2);
  return `<div class="score-ring"><svg class="score-ring-svg" viewBox="0 0 94 94" aria-hidden="true"><circle class="score-track" cx="47" cy="47" r="36"></circle><circle class="score-progress" cx="47" cy="47" r="36" stroke-dasharray="${progress} ${circumference}"></circle></svg><span>${score === null || !Number.isFinite(score) ? '—' : `${score}%`}</span></div>`;
}

function patientSelectorMarkup() {
  return currentUser.role === 'patient' ? '' : `<div class="panel">${contextPicker()}</div>`;
}

async function renderSection(section = activeSection) {
  activeSection = section;
  renderNav();
  content.innerHTML = `<div class="panel">${patientSelectorMarkup()}<p class="muted">Loading…</p></div>`;
  try {
    if (section === 'overview') content.innerHTML = await overviewView();
    else if (section === 'profile') content.innerHTML = await profileView();
    else if (section === 'patients') content.innerHTML = await patientsView();
    else if (section === 'prescriptions') content.innerHTML = await prescriptionsView();
    else if (section === 'doses') content.innerHTML = await dosesView();
    else if (section === 'safety') content.innerHTML = await safetyView();
    else if (section === 'care') content.innerHTML = await careView();
    else if (section === 'alerts') content.innerHTML = await alertsView();
    else if (section === 'history') content.innerHTML = await historyView();
    else if (section === 'facilities') content.innerHTML = facilitiesView();
    else if (section === 'notifications') content.innerHTML = await notificationsView();
    else if (section === 'medicine-search') content.innerHTML = medicineSearchView();
    else if (section === 'admin') content.innerHTML = await adminView();
    else content.innerHTML = empty('This section is not available.');
  } catch (error) {
    content.innerHTML = `${patientSelectorMarkup()}${panel('Could not load this section', `<div class="callout warning">${esc(error.message)}</div><button class="button secondary" type="button" data-action="refresh">Try again</button>`)}`;
  }
}

async function overviewView() {
  if (currentUser.role === 'admin') return adminView();
  const pId = await getContextId();
  if (!pId) return `${patientSelectorMarkup()}${panel('Getting started', `<p>Connect to a patient who has authorized this account to see permitted medication data.</p>`)}`;
  const [rxResult, doseResult, alertResult] = await Promise.allSettled([
    contextData('/prescriptions'),
    contextData('/doses'),
    api(currentUser.role === 'patient' ? '/alerts' : `/alerts?patientId=${encodeURIComponent(pId)}`),
  ]);
  const pres = rxResult.status === 'fulfilled' ? rxResult.value : [];
  const schedule = doseResult.status === 'fulfilled' ? doseResult.value : {};
  const alerts = alertResult.status === 'fulfilled' ? alertResult.value.alerts || [] : [];
  const activeCount = pres.filter((r) => r.status === 'active').length;
  const upcoming = schedule.upcoming || [];
  const missed = (schedule.history || []).filter((d) => d.status === 'missed');
  const errors = [rxResult, doseResult, alertResult].filter((r) => r.status === 'rejected').map((r) => r.reason.message);
  const nextDose = upcoming[0];
  const adherence = schedule.adherence || {};
  const adherencePercent = adherence.adherencePercent;
  const score = adherencePercent === null || adherencePercent === undefined ? null : Math.max(0, Math.min(100, adherencePercent));
  const openAlerts = alerts.filter((a) => a.status === 'open');
  const todaysDoses = (schedule.todaySchedule || []).slice(0, 5);
  const reminderButton = currentUser.role === 'patient' ? `<button class="button secondary small" type="button" data-action="enable-browser-reminders">${typeof Notification === 'undefined' ? 'Browser reminders unavailable' : Notification.permission === 'granted' ? 'Browser reminders on' : 'Enable browser reminders'}</button>` : '';
  return `${patientSelectorMarkup()}
    ${errors.length ? panel('Some data could not be loaded', `<div class="callout warning">${errors.map(esc).join('<br>')}</div>`) : ''}
    <div class="grid stats-grid">
      ${panel(`<div class="metric-label"><span class="metric-icon">Rx</span>Active medicines</div>`, `<p class="metric">${activeCount}</p><p class="metric-note">Current prescriptions on record.</p>`)}
      ${panel(`<div class="metric-label"><span class="metric-icon">◷</span>Upcoming doses</div>`, `<p class="metric">${upcoming.length}</p><p class="metric-note">${nextDose ? `Next · ${esc(nextDose.prescription?.medicineName)} at ${esc(dateText(nextDose.scheduledAt))}` : 'Nothing scheduled in the next two days.'}</p>`)}
      ${panel(`<div class="metric-label"><span class="metric-icon">✓</span>Adherence</div>`, `<p class="metric">${score === null ? '—' : `${score}%`}</p><p class="metric-note">Based on recorded doses; future doses excluded.</p>`)}
      ${panel(`<div class="metric-label"><span class="metric-icon">!</span>Open alerts</div>`, `<p class="metric">${openAlerts.length}</p><p class="metric-note">${missed.length} missed in recent history.</p>`)}
    </div>
    <div class="overview-grid">
      <div class="overview-main">
        ${panel('Today’s schedule', `${todaysDoses.length ? `<div class="dose-card-list">${todaysDoses.map((dose) => `<article class="dose-card"><div class="dose-time">${esc(dose.localTime)}</div><div><div class="dose-name">${esc(dose.prescription?.medicineName || 'Medicine')}</div><div class="dose-instructions">${esc(dose.prescription?.dosageInstructions || '')}</div></div><div>${statusTag(dose.status)}${currentUser.role === 'patient' && dose.status === 'upcoming' ? `<div class="dose-actions"><button class="button primary small" type="button" data-action="dose-status" data-id="${esc(dose._id)}" data-status="taken">Taken</button></div>` : ''}</div></article>`).join('')}</div>` : empty('No doses scheduled for today.')}${panelActions('doses', 'View full schedule')}`)}
        ${panel('Medication safety', `<div class="safety-banner"><span class="safety-mark">!</span><span>Automated checks are a limited prototype, not a comprehensive interaction checker. Review sourced findings with a qualified professional; never change medication based only on this tool.</span></div>${panelActions('safety', 'Review safety checks')}`)}
      </div>
      <div class="overview-side">
        ${panel('Adherence snapshot', `<div class="score-layout">${adherenceRing(score)}<div class="score-legend"><span><i class="legend-dot"></i>${adherence.taken || 0} taken</span><span><i class="legend-dot skipped"></i>${adherence.skipped || 0} skipped</span><span><i class="legend-dot missed"></i>${adherence.missed || 0} missed</span></div></div><p class="metric-note">${score === null ? 'Adherence appears after a scheduled dose is recorded.' : `Of ${adherence.eligible} eligible doses over ${adherence.days} days.`}</p>`)}
        ${panel('Care team alerts', openAlerts.length ? `<div class="list">${openAlerts.slice(0, 3).map((alert) => `<article class="list-item"><h3>${esc(alert.prescription?.medicineName || 'Medication alert')}</h3><p>${esc(alert.missedCount)} missed doses in ${esc(alert.windowDays)} days.</p></article>`).join('')}</div>${panelActions('alerts', 'Review alerts')}` : empty('No unresolved alerts.'))}
        ${currentUser.role === 'patient' ? panel('Browser reminders', `<p class="metric-note">Reminders can appear while this page is open and browser notifications are enabled. They do not work when the app is closed.</p>${reminderButton}`) : ''}
      </div>
    </div>
    ${currentUser.role === 'doctor' && currentUser.doctor?.verificationStatus !== 'verified' ? panel('Doctor verification', `<div class="callout warning">Your account is <strong>${esc(currentUser.doctor?.verificationStatus || 'pending')}</strong>. Patient records and prescription actions require administrator verification.</div>`) : ''}`;
}

function panelActions(section, label) {
  return `<div class="panel-actions"><button type="button" class="button soft small" data-section="${section}">${label} →</button></div>`;
}

function startBrowserReminderPolling() {
  clearInterval(browserReminderTimer);
  browserReminderTimer = null;
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  const check = async () => {
    if (!currentUser || currentUser.role !== 'patient' || document.visibilityState === 'hidden') return;
    try {
      const schedule = await api('/doses');
      const now = Date.now();
      for (const dose of schedule.todaySchedule || []) {
        const dueAt = new Date(dose.scheduledAt).getTime();
        const doseId = String(dose._id);
        if (dose.status !== 'upcoming' || dueAt > now || dueAt < now - 5 * 60_000 || notifiedDoseIds.has(doseId)) continue;
        notifiedDoseIds.add(doseId);
        const notice = new Notification(`Medication reminder · ${dose.localTime}`, {
          body: `It is time to record your scheduled dose of ${dose.prescription?.medicineName || 'your medicine'}.`,
          tag: `caretrack-dose-${doseId}`,
        });
        notice.onclick = () => { window.focus(); renderSection('doses'); notice.close(); };
      }
    } catch (error) {
      console.warn('[reminders] Browser reminder check failed:', error.message);
    }
  };
  check();
  browserReminderTimer = setInterval(check, 60_000);
}

async function profileView() {
  if (currentUser.role !== 'patient') {
    const id = await getContextId();
    if (!id) return `${patientSelectorMarkup()}${panel('Patient record', empty('Select an authorized patient first.'))}`;
    const record = await api(`/patients/${encodeURIComponent(id)}/record`);
    const allergies = record.allergies || [];
    const history = record.medicalHistory || [];
    return `${patientSelectorMarkup()}
      ${panel('Patient profile', `<p><strong>${esc(record.user.name)}</strong> · ${esc(record.user.email)}</p><p>Date of birth: ${esc(record.dateOfBirth || 'Not provided')} · Time zone: ${esc(record.timezone)}</p><p>Phone: ${esc(record.phone || 'Not provided')}</p>${record.medicalInfoHidden ? '<div class="callout">Medical information is hidden by patient permissions.</div>' : ''}`)}
      ${record.medicalInfoHidden ? '' : panel('Allergies', allergies.length ? `<ul>${allergies.map((a) => `<li>${esc(a.substance)} — ${esc(a.severity)}${a.reaction ? `; reaction: ${esc(a.reaction)}` : ''}</li>`).join('')}</ul>` : empty('No allergies recorded.'))}
      ${record.medicalInfoHidden ? '' : panel('Medical history', history.length ? `<ul>${history.map((h) => `<li>${esc(h.condition)}${h.diagnosedOn ? ` · ${esc(h.diagnosedOn)}` : ''}${h.notes ? ` — ${esc(h.notes)}` : ''}</li>`).join('')}</ul>` : empty('No medical history recorded.'))}`;
  }
  const profile = await api('/patients/me');
  return `${panel('Profile details', `<form id="profile-form" class="form-grid">
      <label>Name <input name="name" value="${esc(profile.user.name)}" required minlength="2" maxlength="100"></label>
      <label>Date of birth <input name="dateOfBirth" type="date" value="${esc(profile.dateOfBirth || '')}"></label>
      <label>Phone <input name="phone" value="${esc(profile.phone)}" maxlength="30"></label>
      <label>Time zone <input name="timezone" value="${esc(profile.timezone)}" required></label>
      <div class="wide"><button class="button primary" type="submit">Save profile</button></div>
    </form>`)}
    ${panel('Allergies', `${profile.allergies.length ? `<ul>${profile.allergies.map((a) => `<li>${esc(a.substance)} — ${esc(a.severity)}${a.reaction ? `; reaction: ${esc(a.reaction)}` : ''} <button class="button danger small" type="button" data-action="remove-allergy" data-id="${esc(a._id)}">Remove</button></li>`).join('')}</ul>` : empty('No allergies recorded.')}
      <form id="allergy-form" class="form-grid">
        <label>Substance <input name="substance" required maxlength="100"></label>
        <label>Severity <select name="severity"><option>unknown</option><option>mild</option><option>moderate</option><option>severe</option></select></label>
        <label class="wide">Reaction <input name="reaction" maxlength="200"></label>
        <div class="wide"><button class="button primary" type="submit">Add allergy</button></div>
      </form>`)}
    ${panel('Medical history', `${profile.medicalHistory.length ? `<ul>${profile.medicalHistory.map((h) => `<li>${esc(h.condition)}${h.diagnosedOn ? ` · ${esc(h.diagnosedOn)}` : ''}${h.notes ? ` — ${esc(h.notes)}` : ''} <button class="button danger small" type="button" data-action="remove-history" data-id="${esc(h._id)}">Remove</button></li>`).join('')}</ul>` : empty('No medical history recorded.')}
      <form id="history-form" class="form-grid">
        <label>Condition <input name="condition" required maxlength="200"></label>
        <label>Diagnosed on <input name="diagnosedOn" type="date"></label>
        <label class="wide">Notes <textarea name="notes" maxlength="500"></textarea></label>
        <div class="wide"><button class="button primary" type="submit">Add history entry</button></div>
      </form>`)}`;
}

async function patientsView() {
  if (currentUser.role === 'patient') return profileView();
  const patients = await api('/care/patients');
  patientOptions = patients;
  const rows = patients.map((p) => `<tr><td>${esc(p.name)}</td><td>${esc(p.email)}</td><td>${esc(p.permissions ? Object.entries(p.permissions).filter(([, enabled]) => enabled).map(([key]) => key).join(', ') : 'Authorized')}</td><td><button type="button" class="button secondary small" data-action="select-patient" data-id="${esc(p._id)}">Open patient</button></td></tr>`);
  return `${panel('Authorized patients', table(['Patient', 'Email', 'Permissions', ''], rows))}
    ${panel('Search patients', `<form id="patient-search-form" class="inline-form"><label>Name or email <input name="q" maxlength="100"></label><button class="button secondary" type="submit">Search</button></form><div id="patient-search-results"></div>`)}`;
}

async function prescriptionsView() {
  const patientId = await getContextId();
  if (!patientId) return `${patientSelectorMarkup()}${panel('Prescriptions', empty('Select a patient who has authorized you.'))}`;
  const list = await contextData('/prescriptions');
  const rows = list.map((r) => `<tr>
    <td><strong>${esc(r.medicineName)}</strong><br>${esc(r.strength)} · ${esc(r.route)}</td>
    <td>${esc(r.dosageInstructions)}<br>${esc(r.frequency)} (${esc((r.scheduleTimes || []).join(', '))})</td>
    <td>${esc(r.startDate)} – ${esc(r.endDate || 'ongoing')}</td><td>${statusTag(r.status)}</td>
    <td>${esc(r.prescriberName || '')}${r.lastSafetyCheck ? `<br><small>Safety: ${esc(r.lastSafetyCheck.interactionStatus)}</small>` : ''}</td>
    <td>${currentUser.role === 'doctor' && r.status === 'active' ? `<div class="action-stack"><button class="button secondary small" type="button" data-action="recheck" data-id="${esc(r._id)}">Recheck safety</button><button class="button danger small" type="button" data-action="discontinue" data-id="${esc(r._id)}" data-name="${esc(r.medicineName)}">Discontinue</button><details class="editor-details"><summary>Edit prescription</summary>${prescriptionEditor(r)}</details></div>` : ''}</td>
  </tr>`);
  const catalogSearch = `<div class="section-toolbar"><div><strong>RxNorm medicine catalog</strong><p class="metric-note">Search medicines by name from the U.S. National Library of Medicine. No stock information is available here.</p></div></div>
      <form id="medicine-search-form" class="inline-form"><label>Search medicine names<input name="q" minlength="2" maxlength="100" placeholder="Search the RxNorm catalog"></label><button class="button secondary" type="submit">Search catalog</button></form><div id="catalog-results"></div>`;
  const createForm = currentUser.role === 'doctor' ? `<h3>Create prescription</h3>
    <form id="prescription-form" class="form-grid">
      <label class="medicine-autocomplete">Medicine name <input name="medicineName" data-medicine-input="create" autocomplete="off" required maxlength="200"><div id="medicine-suggestions-create" class="medicine-suggestions hidden"></div></label>
      <label>Active ingredients (optional; comma-separated) <input name="activeIngredients"></label>
      <label>Strength <input name="strength" required maxlength="100" placeholder="As prescribed"></label>
      <label>Dosage instructions <input name="dosageInstructions" required maxlength="500" placeholder="As prescribed"></label>
      <label>Route <select name="route">${['oral','sublingual','topical','inhalation','intravenous','intramuscular','subcutaneous','rectal','ophthalmic','otic','nasal','transdermal','other'].map((r) => `<option value="${r}">${r}</option>`).join('')}</select></label>
      <label>Frequency <input name="frequency" required maxlength="100" placeholder="As prescribed"></label>
      <label>Scheduled times (HH:MM, comma-separated) <input name="scheduleTimes" required placeholder="08:00, 20:00"></label>
      <label>Start date <input name="startDate" type="date" required></label>
      <label>End date (optional) <input name="endDate" type="date"></label>
      <label>Duration in days (optional) <input name="durationDays" type="number" min="1" max="3650"></label>
      <label class="wide">Additional instructions <textarea name="additionalInstructions" maxlength="1000"></textarea></label>
      <label class="wide">Reason / clinical context (recorded in change history) <input name="reason" maxlength="300"></label>
      <div class="wide"><button class="button primary" type="submit">Check safety and create prescription</button></div>
    </form>
    <p class="muted">Prescription creation records the check result, including any unavailable or uncertain information. Review findings before making clinical decisions.</p>` : '';
  return `${patientSelectorMarkup()}${panel('Prescription list', `${table(['Medicine', 'Instructions', 'Dates', 'Status', 'Prescriber', 'Actions'], rows)}`)}
    ${panel('Medicine information search', catalogSearch)}
    ${currentUser.role === 'doctor' ? panel('New prescription', `${createForm}`) : ''}`;
}

function prescriptionEditor(rx) {
  const id = esc(rx._id);
  return `<form id="prescription-edit-${id}" class="form-grid edit-form">
    <label class="medicine-autocomplete">Medicine name<input name="medicineName" data-medicine-input="edit-${id}" value="${esc(rx.medicineName)}" autocomplete="off" required maxlength="200"><div id="medicine-suggestions-edit-${id}" class="medicine-suggestions hidden"></div></label>
    <label>Active ingredients<input name="activeIngredients" value="${esc((rx.activeIngredients || []).join(', '))}"></label>
    <label>Strength<input name="strength" value="${esc(rx.strength)}" required maxlength="100"></label>
    <label>Dosage instructions<input name="dosageInstructions" value="${esc(rx.dosageInstructions)}" required maxlength="500"></label>
    <label>Route<select name="route">${['oral','sublingual','topical','inhalation','intravenous','intramuscular','subcutaneous','rectal','ophthalmic','otic','nasal','transdermal','other'].map((route) => `<option value="${route}" ${rx.route === route ? 'selected' : ''}>${route}</option>`).join('')}</select></label>
    <label>Frequency<input name="frequency" value="${esc(rx.frequency)}" required maxlength="100"></label>
    <label>Scheduled times (HH:MM, comma-separated)<input name="scheduleTimes" value="${esc((rx.scheduleTimes || []).join(', '))}" required></label>
    <label>Start date<input name="startDate" type="date" value="${esc(rx.startDate)}" required></label>
    <label>End date (optional)<input name="endDate" type="date" value="${esc(rx.endDate || '')}"></label>
    <label class="wide">Additional instructions<textarea name="additionalInstructions" maxlength="1000">${esc(rx.additionalInstructions || '')}</textarea></label>
    <label class="wide">Reason for change<input name="reason" maxlength="300"></label>
    <div class="wide"><button class="button primary" type="submit">Save prescription changes</button></div>
  </form>`;
}

function shiftLocalDate(date, offset) {
  const [year, month, day] = date.split('-').map(Number);
  const value = new Date(Date.UTC(year, month - 1, day + offset));
  return value.toISOString().slice(0, 10);
}

async function dosesView() {
  const patientId = await getContextId();
  if (!patientId) return `${patientSelectorMarkup()}${panel('Dose schedule', empty('Select a patient who has authorized you.'))}`;
  const result = await contextData('/doses');
  const rowsForDay = new Map();
  for (const dose of [...(result.todaySchedule || []), ...(result.upcoming || []), ...(result.history || [])]) rowsForDay.set(String(dose._id), dose);
  const availableRows = [...rowsForDay.values()];
  const calendarDate = selectedScheduleDate || result.today;
  selectedScheduleDate = calendarDate;
  const dayStrip = Array.from({ length: 7 }, (_, i) => shiftLocalDate(result.today, i - 2)).map((date) => {
    const parsed = new Date(`${date}T12:00:00`);
    return `<button class="day-chip ${date === calendarDate ? 'active' : ''}" type="button" data-action="select-schedule-date" data-date="${date}"><span>${parsed.toLocaleDateString(undefined, { weekday: 'short' })}</span><strong>${parsed.getDate()}</strong></button>`;
  }).join('');
  const selectedDoses = availableRows.filter((dose) => dose.localDate === calendarDate).sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
  const rows = selectedDoses.map((d) => `<article class="dose-card">
      <div class="dose-time">${esc(d.localTime)}</div>
      <div><div class="dose-name">${esc(d.prescription?.medicineName || 'Medicine')} ${esc(d.prescription?.strength || '')}</div><div class="dose-instructions">${esc(d.prescription?.dosageInstructions || '')}${d.overdue ? ' · Overdue' : ''}${d.note ? ` · ${esc(d.note)}` : ''}</div></div>
      <div class="dose-card-status">${statusTag(d.status)}${currentUser.role === 'patient' && ['upcoming', 'missed'].includes(d.status) ? `<div class="dose-actions"><button class="button primary small" type="button" data-action="dose-status" data-id="${esc(d._id)}" data-status="taken">Taken</button><button class="button secondary small" type="button" data-action="dose-status" data-id="${esc(d._id)}" data-status="skipped">Skip</button></div>` : ''}</div>
    </article>`);
  const historyRows = (result.history || []).map((d) => `<tr><td>${esc(d.localDate)} ${esc(d.localTime)}</td><td>${esc(d.prescription?.medicineName || 'Medicine')}</td><td>${statusTag(d.status)}</td><td>${esc(d.note || '')}</td></tr>`);
  const adherence = result.adherence || {};
  const adherenceText = adherence.adherencePercent === null ? 'Not enough recorded outcomes to calculate.' : `${adherence.adherencePercent}% (${adherence.taken} taken / ${adherence.eligible} eligible doses)`;
  return `${patientSelectorMarkup()}
    ${panel('Adherence summary', `<div class="score-layout">${adherenceRing(adherence.adherencePercent)}<div><strong>${esc(adherenceText)}</strong><p class="metric-note">${esc(adherence.formula || '')}</p></div></div><p class="metric-note">Timezone: ${esc(result.timezone || '—')}. Unrecorded doses are marked missed after ${esc(result.rules?.missedAfterMinutes ?? '—')} minutes.</p>`)}
    ${panel('Medication schedule', `<div class="day-strip">${dayStrip}</div><div class="dose-card-list">${rows.length ? rows.join('') : empty('No doses are scheduled for this day.')}</div>`)}
    ${panel('Upcoming', (result.upcoming || []).length ? `<ul>${result.upcoming.map((d) => `<li>${esc(d.localDate)} ${esc(d.localTime)} · ${esc(d.prescription?.medicineName || 'Medicine')}</li>`).join('')}</ul>` : empty('No upcoming doses in the next two days.'))}
    ${panel('Recent recorded dose history', table(['Scheduled', 'Medicine', 'Status', 'Note'], historyRows))}`;
}

async function safetyView() {
  const id = await getContextId();
  if (!id) return `${patientSelectorMarkup()}${panel('Medication safety', empty('Select an authorized patient.'))}`;
  const result = await contextData('/safety/checks');
  const checks = Array.isArray(result) ? result : [];
  const doctorForm = currentUser.role === 'doctor' ? `<h3>Check a proposed medicine</h3><form id="safety-form" class="form-grid">
      <label>Medicine name <input name="medicineName" required maxlength="200"></label>
      <label>Active ingredients (optional; comma-separated) <input name="activeIngredients"></label>
      <div class="wide"><button class="button primary" type="submit">Run sourced check</button></div>
    </form>` : '';
  const cards = checks.map((c) => `<article class="list-item"><h3>${esc(c.proposed?.name)} · ${statusTag(c.interactionStatus)}</h3><p>Checked ${esc(dateText(c.createdAt))} · Ingredients: ${esc(c.proposed?.ingredients?.join(', ') || 'unknown')} (${esc(c.proposed?.ingredientSource)})</p>
    ${c.findings?.length ? `<ul>${c.findings.map((f) => `<li><strong>${esc(f.title)}</strong> — ${esc(f.detail)} <small>Source: ${esc(f.source)}</small>${f.sourceUrl ? ` <a href="${esc(f.sourceUrl)}" target="_blank" rel="noopener noreferrer">Source details</a>` : ''}</li>`).join('')}</ul>` : '<p>No findings were returned by this limited check; this is not confirmation that a combination is safe.</p>'}
    ${c.limitations?.length ? `<p class="muted">Limitations: ${esc(c.limitations.join(' '))}</p>` : ''}
    <p class="muted">${esc(c.disclaimer || '')}</p></article>`).join('');
  return `${patientSelectorMarkup()}
    ${panel('Safety-check status', `<div class="callout warning">Prototype only: RxNorm provides ingredient matching; FDA label text is not a comprehensive interaction database. Missing or unavailable data is reported as such. A missing finding does not mean a medicine combination is safe. Do not start, stop, or change medicines based on this tool.</div>${doctorForm}`)}
    ${panel('Saved safety-check results', cards ? `<div class="list">${cards}</div>` : empty('No saved safety checks yet.'))}`;
}

async function careView() {
  const grants = await api('/care');
  const patient = currentUser.role === 'patient';
  const rows = grants.map((g) => {
    const other = patient ? g.grantee : g.patient;
    const permissions = g.permissions || {};
    const permissionControl = patient && g.granteeRole === 'caregiver' && g.status === 'active' ? `<button type="button" class="button secondary small" data-action="toggle-permission" data-id="${esc(g._id)}" data-permission="viewMedications" data-value="${!permissions.viewMedications}">${permissions.viewMedications ? 'Hide medications' : 'Allow medications'}</button><button type="button" class="button secondary small" data-action="toggle-permission" data-id="${esc(g._id)}" data-permission="viewDoses" data-value="${!permissions.viewDoses}">${permissions.viewDoses ? 'Hide doses' : 'Allow doses'}</button>` : '';
    const action = patient && g.status === 'pending'
      ? `<button class="button primary small" type="button" data-action="grant-approve" data-id="${esc(g._id)}">Approve</button><button class="button danger small" type="button" data-action="grant-decline" data-id="${esc(g._id)}">Decline</button>`
      : ['active', 'pending'].includes(g.status) ? `<button class="button danger small" type="button" data-action="grant-revoke" data-id="${esc(g._id)}">Revoke</button>` : '';
    return `<tr><td>${esc(other?.name || 'Account')}<br><small>${esc(other?.email || '')}</small></td><td>${esc(g.granteeRole)}</td><td>${statusTag(g.status)}${g.doctor ? `<br><small>Doctor ${esc(g.doctor.verificationStatus)}</small>` : ''}</td><td>${patient ? esc(Object.entries(permissions).filter(([, v]) => v).map(([k]) => k).join(', ') || 'None') : ''}</td><td>${permissionControl}${action}</td></tr>`;
  });
  const invite = patient ? `<h3>Authorize a doctor or caregiver</h3><form id="care-invite-form" class="form-grid">
      <label class="wide">Registered account email <input name="email" type="email" required></label>
      <label><input type="checkbox" name="viewMedications" checked> View medications</label>
      <label><input type="checkbox" name="viewDoses" checked> View dose history</label>
      <label><input type="checkbox" name="receiveAlerts" checked> Receive missed-dose alerts</label>
      <label><input type="checkbox" name="viewMedicalInfo"> View allergies and history</label>
      <div class="wide"><button class="button primary" type="submit">Grant access</button></div>
    </form>` : `<h3>Request patient access</h3><form id="care-request-form" class="inline-form"><label>Patient email <input name="patientEmail" type="email" required></label><button class="button primary" type="submit">Request access</button></form><p class="muted">The patient must approve this request before any records are available.</p>`;
  return `${panel(patient ? 'Caregiver and doctor authorizations' : 'Patient access', table(['Account', 'Role', 'Status', patient ? 'Permissions' : '', 'Actions'], rows))}
    ${panel('Patient-controlled access', invite)}`;
}

async function alertsView() {
  const id = await getContextId();
  if (!id && currentUser.role !== 'patient') return `${patientSelectorMarkup()}${panel('Alerts', empty('Select a patient or request authorization.'))}`;
  const data = await api(currentUser.role === 'patient' ? '/alerts' : `/alerts?patientId=${encodeURIComponent(id)}`);
  const cards = (data.alerts || []).map((a) => `<article class="list-item"><h3>${esc(a.patient?.name || 'Patient')} · ${esc(a.prescription?.medicineName || 'Medicine')}</h3><p>${esc(a.missedCount)} missed doses in ${esc(a.windowDays)} days; threshold ${esc(a.threshold)}. Created ${esc(dateText(a.createdAt))}.</p><p>Status: ${statusTag(a.status)}</p>${a.doses?.length ? `<ul>${a.doses.map((d) => `<li>${esc(d.localDate)} ${esc(d.localTime)} — ${esc(d.status)}</li>`).join('')}</ul>` : ''}${currentUser.role === 'doctor' && a.status === 'open' ? `<button class="button secondary small" type="button" data-action="resolve-alert" data-id="${esc(a._id)}">Resolve</button>` : ''}</article>`).join('');
  return `${patientSelectorMarkup()}${panel('Missed-dose alerts', `<p class="muted">Repeated-dose threshold: ${esc(data.threshold)} within ${esc(data.windowDays)} days.</p>${cards ? `<div class="list">${cards}</div>` : empty('No alerts are visible for this account.')}`)}`;
}

async function historyView() {
  const id = await getContextId();
  if (!id) return `${patientSelectorMarkup()}${panel('Prescription history', empty('Select a patient.'))}`;
  const list = await contextData('/prescriptions/history');
  const rows = list.map((log) => `<tr><td>${esc(dateText(log.createdAt))}</td><td>${esc(log.action)}</td><td>${esc(log.medicineName)}</td><td>${esc(log.actor?.name || 'System')}</td><td>${esc((log.changes || []).map((c) => `${c.field}: ${JSON.stringify(c.from)} → ${JSON.stringify(c.to)}`).join('; ') || JSON.stringify(log.meta || {}))}</td></tr>`);
  return `${patientSelectorMarkup()}${panel('Prescription change history', table(['When', 'Action', 'Medicine', 'Changed by', 'Details'], rows))}`;
}

function facilitiesView() {
  return `${panel('Find a pharmacy or hospital', `<form id="facility-form" class="form-grid">
      <label class="wide">City, area, or address <input name="q" required minlength="2" maxlength="200" placeholder="e.g. city or postcode"></label>
      <label>Facility type <select name="type"><option value="both">Pharmacies and hospitals</option><option value="pharmacy">Pharmacies</option><option value="hospital">Hospitals</option></select></label>
      <label>Search radius <select name="radius"><option value="3000">3 km</option><option value="5000">5 km</option><option value="10000">10 km</option><option value="15000">15 km</option></select></label>
      <div class="wide facility-search-actions"><button class="button primary" type="submit">Search facilities</button><button class="button secondary" type="button" data-action="facility-geolocate">Use my location</button><small>Location is used for this search only.</small></div>
    </form><div id="facility-results"></div>`)}`;
}

function medicineSearchView() {
  return `${panel('Medicine information guide', `<div class="callout warning">Catalog results are for identification only, not prescribing advice. They do not show local pharmacy stock or prove that a medicine is appropriate for you.</div>
    <form id="medicine-search-form" class="inline-form"><label>Medicine name<input name="q" minlength="2" maxlength="100" placeholder="e.g. medicine or ingredient" required></label><button class="button primary" type="submit">Search RxNorm</button></form><div id="catalog-results" class="catalog-results"></div>`)}`;
}

async function adminView() {
  const doctors = await api(`/admin/doctors?status=${encodeURIComponent(doctorFilter)}`);
  const rows = doctors.map((doctor) => `<tr>
    <td><strong>${esc(doctor.user?.name || 'Account')}</strong><br><small>${esc(doctor.user?.email || '')}</small></td>
    <td>${esc(doctor.licenseNumber || 'Not provided')}</td>
    <td>${esc(doctor.specialty || 'Not provided')}</td>
    <td>${esc(doctor.organization || 'Not provided')}</td>
    <td>${statusTag(doctor.verificationStatus)}</td>
    <td>${doctor.verificationStatus !== 'verified' ? `<button class="button primary small" type="button" data-action="doctor-review" data-id="${esc(doctor.user?._id)}" data-status="verified">Verify</button>` : ''}${doctor.verificationStatus !== 'rejected' ? `<button class="button danger small" type="button" data-action="doctor-review" data-id="${esc(doctor.user?._id)}" data-status="rejected">Reject</button>` : ''}</td>
  </tr>`);
  return `${panel('Doctor verification queue', `<div class="section-toolbar"><p class="metric-note">Review professional registration details before granting a doctor access to patient records.</p><label>Show<select id="doctor-filter"><option value="pending" ${doctorFilter === 'pending' ? 'selected' : ''}>Pending review</option><option value="verified" ${doctorFilter === 'verified' ? 'selected' : ''}>Verified</option><option value="rejected" ${doctorFilter === 'rejected' ? 'selected' : ''}>Rejected</option></select></label></div>${table(['Doctor', 'License', 'Specialty', 'Organization', 'Status', 'Decision'], rows)}`)}
    ${panel('Review standards', `<p class="metric-note">Only verify accounts after checking the submitted license through the appropriate professional registry. This demo does not perform external license validation.</p>`)}`;
}

function renderMedicineResults(results, box, stockNote = '') {
  if (!box) return;
  box.innerHTML = `${stockNote ? `<p class="metric-note">${esc(stockNote)}</p>` : ''}
    ${results.length ? `<div class="search-results">${results.map((medicine) => `<article class="search-result"><span><strong>${esc(medicine.name)}</strong><small>${esc(medicine.tty || 'RxNorm concept')} · RxCUI ${esc(medicine.rxcui)}</small></span>${currentUser.role === 'doctor' ? `<button class="button secondary small" type="button" data-action="fill-medicine" data-name="${esc(medicine.name)}">Use name</button>` : ''}</article>`).join('')}</div>` : empty('No matching medicines found.')}`;
}

async function searchMedicineCatalog(query) {
  const normalized = query.trim();
  if (medicineSearchCache.has(normalized.toLowerCase())) return medicineSearchCache.get(normalized.toLowerCase());
  const data = await api(`/medicines/search?q=${encodeURIComponent(normalized)}`);
  medicineSearchCache.set(normalized.toLowerCase(), data);
  return data;
}

async function searchFacilities({ q, type, radius }, coordinates = null) {
  const resultsBox = document.querySelector('#facility-results');
  if (!resultsBox) return;
  resultsBox.innerHTML = '<p class="muted">Searching sourced facility data…</p>';
  const params = new URLSearchParams({ type, radius, ...(coordinates || { q }) });
  try {
    const result = await api(`/facilities?${params}`);
    const { lat, lon } = result.center;
    const latOffset = Number(radius) / 111000;
    const lonOffset = latOffset / Math.max(Math.cos(lat * Math.PI / 180), 0.2);
    const mapParams = new URLSearchParams({
      bbox: `${lon - lonOffset},${lat - latOffset},${lon + lonOffset},${lat + latOffset}`,
      layer: 'mapnik',
      marker: `${lat},${lon}`,
    });
    const facilities = result.results || [];
    resultsBox.innerHTML = `<p class="muted">${esc(result.source)} · ${esc(result.note)}</p>
      <div class="facility-layout">
        <div class="facility-list">${facilities.length ? `<div class="list">${facilities.map((facility) => `<article class="list-item"><h3>${esc(facility.name)} ${statusTag(facility.type)}</h3><p>${esc(facility.address || 'Address not listed')}${facility.distanceKm !== undefined ? ` · ${esc(facility.distanceKm)} km` : ''}</p><p>${facility.phone ? `Phone: ${esc(facility.phone)} · ` : ''}${facility.openingHours ? `Hours: ${esc(facility.openingHours)}` : ''}</p><p><a href="${esc(facility.directionsUrl)}" target="_blank" rel="noopener noreferrer">Directions</a> · <a href="${esc(facility.osmUrl)}" target="_blank" rel="noopener noreferrer">OpenStreetMap</a></p></article>`).join('')}</div>` : empty('No facilities were found in this area.')}</div>
        <iframe class="facility-map" title="OpenStreetMap location map" loading="lazy" referrerpolicy="no-referrer" src="https://www.openstreetmap.org/export/embed.html?${esc(mapParams.toString())}"></iframe>
      </div>`;
  } catch (error) {
    resultsBox.innerHTML = `<div class="callout warning">${esc(error.message)}</div>`;
    throw error;
  }
}

async function notificationsView() {
  const data = await api('/notifications');
  const rows = data.items.map((n) => `<article class="list-item"><h3>${esc(n.title)} ${n.readAt ? '<span class="muted">(read)</span>' : statusTag('unread')}</h3><p>${esc(n.message)}</p><small>${esc(dateText(n.createdAt))} · In-app: ${esc(n.channels?.inApp || 'enabled')} · email: ${esc(n.channels?.email || 'not configured')} · SMS: ${esc(n.channels?.sms || 'not configured')}</small>${!n.readAt ? `<p><button class="button secondary small" type="button" data-action="read-notification" data-id="${esc(n._id)}">Mark read</button></p>` : ''}</article>`).join('');
  return `${panel(`Notifications (${data.unread} unread)`, `<p class="muted">Email and SMS are only enabled when configured on the server.</p><button class="button secondary small" type="button" data-action="read-all">Mark all read</button>${rows ? `<div class="list">${rows}</div>` : empty('No notifications yet.')}`)}`;
}

function formObject(form) { return Object.fromEntries(new FormData(form).entries()); }
function parseTimes(value) { return value.split(',').map((s) => s.trim()).filter(Boolean); }
function setBusy(form, busy) { const button = form.querySelector('[type="submit"]'); if (button) { button.disabled = busy; if (busy) button.dataset.originalText = button.textContent; button.textContent = busy ? 'Please wait…' : button.dataset.originalText || button.textContent; } }

async function handleAuthSubmit(event) {
  const form = event.target;
  if (!['login-form', 'register-form'].includes(form.id)) return false;
  event.preventDefault();
  setBusy(form, true);
  try {
    const values = formObject(form);
    const user = await api(`/auth/${form.id === 'login-form' ? 'login' : 'register'}`, { method: 'POST', body: values });
    await enterApp(user.user);
  } catch (error) {
    showMessage(error.message, 'error');
  } finally { setBusy(form, false); }
  return true;
}

async function handleSubmit(event) {
  const form = event.target;
  if (await handleAuthSubmit(event)) return;
  event.preventDefault();
  setBusy(form, true);
  try {
    const values = formObject(form);
    if (form.id === 'profile-form') {
      await api('/patients/me', { method: 'PUT', body: values });
      showMessage('Profile saved.', 'success');
      await renderSection();
    } else if (form.id === 'allergy-form') {
      await api('/patients/me/allergies', { method: 'POST', body: values });
      showMessage('Allergy added.', 'success');
      await renderSection();
    } else if (form.id === 'history-form') {
      await api('/patients/me/history', { method: 'POST', body: values });
      showMessage('Medical history added.', 'success');
      await renderSection();
    } else if (form.id === 'care-invite-form') {
      const permissions = Object.fromEntries(['viewMedications', 'viewDoses', 'receiveAlerts', 'viewMedicalInfo'].map((key) => [key, form.elements[key].checked]));
      await api('/care/invite', { method: 'POST', body: { email: values.email, permissions } });
      showMessage('Access granted. You can revoke it at any time.', 'success');
      await renderSection();
    } else if (form.id === 'care-request-form') {
      const result = await api('/care/request', { method: 'POST', body: values });
      showMessage(result.message, 'success');
      await renderSection();
    } else if (form.id === 'prescription-form') {
      const payload = { ...values, patientId: await getContextId(), scheduleTimes: parseTimes(values.scheduleTimes), activeIngredients: values.activeIngredients ? parseTimes(values.activeIngredients) : [] };
      const result = await api('/prescriptions', { method: 'POST', body: payload });
      showMessage(`Prescription saved. Safety status: ${result.safetyCheck.interactionStatus}. Review the recorded findings.`, 'success');
      await renderSection();
    } else if (form.id.startsWith('prescription-edit-')) {
      const id = form.id.slice('prescription-edit-'.length);
      const payload = { ...values, scheduleTimes: parseTimes(values.scheduleTimes), activeIngredients: values.activeIngredients ? parseTimes(values.activeIngredients) : [], endDate: values.endDate || '' };
      const result = await api(`/prescriptions/${encodeURIComponent(id)}`, { method: 'PUT', body: payload });
      showMessage(`Prescription updated.${result.safetyCheck ? ` Safety status: ${result.safetyCheck.interactionStatus}. Review the saved findings.` : ''}`, 'success');
      await renderSection();
    } else if (form.id === 'safety-form') {
      const result = await api('/safety/check', { method: 'POST', body: { patientId: await getContextId(), medicineName: values.medicineName, activeIngredients: values.activeIngredients ? parseTimes(values.activeIngredients) : [] } });
      showMessage(`Safety check saved: ${result.interactionStatus}. Review the findings below.`, 'success');
      await renderSection();
    } else if (form.id === 'patient-search-form') {
      const found = await api(`/care/patients?q=${encodeURIComponent(values.q || '')}`);
      patientOptions = found;
      const resultContainer = document.querySelector('#patient-search-results');
      resultContainer.innerHTML = found.length ? `<ul>${found.map((p) => `<li>${esc(p.name)} — ${esc(p.email)} <button class="button secondary small" type="button" data-action="select-patient" data-id="${esc(p._id)}">Open</button></li>`).join('')}</ul>` : empty('No authorized patient matched.');
    } else if (form.id === 'medicine-search-form') {
      const box = form.parentElement.querySelector('#catalog-results');
      box.innerHTML = '<p class="muted">Searching RxNorm…</p>';
      const result = await searchMedicineCatalog(values.q);
      renderMedicineResults(result.results, box, `${result.source}. ${result.stockNote}`);
    } else if (form.id === 'facility-form') {
      await searchFacilities(values);
    }
  } catch (error) {
    showMessage(error.message, 'error');
  } finally { setBusy(form, false); }
}

async function handleAction(button) {
  const action = button.dataset.action;
  const id = button.dataset.id;
  if (action === 'refresh') return renderSection();
  if (action === 'select-patient') {
    selectedPatientId = id;
    await renderSection('overview');
    return;
  }
  if (action === 'select-schedule-date') {
    selectedScheduleDate = button.dataset.date;
    await renderSection('doses');
    return;
  }
  if (action === 'fill-medicine') {
    const input = document.querySelector('#prescription-form [name="medicineName"]');
    if (!input) {
      showMessage('Open the new prescription form to use this medicine name.', 'error');
      return;
    }
    input.value = button.dataset.name;
    input.scrollIntoView({ behavior: 'smooth', block: 'center' });
    input.focus();
    return;
  }
  if (action === 'doctor-review') {
    const status = button.dataset.status;
    if (!window.confirm(`Set this doctor account to ${status}?`)) return;
    await api(`/admin/doctors/${encodeURIComponent(id)}/verify`, { method: 'POST', body: { status } });
    showMessage(`Doctor account marked ${status}.`, 'success');
    await renderSection('admin');
    return;
  }
  if (action === 'facility-geolocate') {
    if (!navigator.geolocation) {
      showMessage('Location access is not supported in this browser. Search by city or address instead.', 'error');
      return;
    }
    const form = document.querySelector('#facility-form');
    const values = formObject(form);
    button.disabled = true;
    navigator.geolocation.getCurrentPosition(
      async ({ coords }) => {
        try {
          await searchFacilities(values, { lat: String(coords.latitude), lon: String(coords.longitude) });
          showMessage('Facilities near your current location loaded.', 'success');
        } catch (error) { showMessage(error.message, 'error'); }
        finally { button.disabled = false; }
      },
      (error) => {
        button.disabled = false;
        showMessage(error.code === error.PERMISSION_DENIED ? 'Location permission was denied. Search by city or address instead.' : 'Could not determine your location. Search by city or address instead.', 'error');
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 },
    );
    return;
  }
  if (action === 'enable-browser-reminders') {
    if (typeof Notification === 'undefined') {
      showMessage('Browser notifications are unavailable. Use the in-app dose schedule instead.', 'error');
      return;
    }
    const permission = await Notification.requestPermission();
    if (permission === 'granted') {
      startBrowserReminderPolling();
      showMessage('Browser reminders enabled while CareTrack is open.', 'success');
    } else {
      showMessage(permission === 'denied' ? 'Notifications are blocked by your browser. Update site permissions to enable reminders.' : 'Notification permission was not granted.', 'error');
    }
    await renderSection();
    return;
  }
  if (action === 'dose-status') {
    const note = window.prompt('Optional note for this dose (leave blank if none):') || '';
    await api(`/doses/${encodeURIComponent(id)}/status`, { method: 'POST', body: { status: button.dataset.status, note } });
    showMessage('Dose status saved.', 'success');
    await renderSection('doses');
    return;
  }
  if (action === 'discontinue') {
    if (!window.confirm(`Discontinue ${button.dataset.name}? This records the change and cancels future scheduled doses.`)) return;
    const reason = window.prompt('Reason for discontinuation (required):');
    if (!reason?.trim()) return;
    await api(`/prescriptions/${encodeURIComponent(id)}/discontinue`, { method: 'POST', body: { reason } });
    showMessage('Prescription discontinued; future doses were cancelled.', 'success');
    await renderSection();
    return;
  }
  if (action === 'recheck') {
    const result = await api(`/prescriptions/${encodeURIComponent(id)}/recheck`, { method: 'POST', body: {} });
    showMessage(`Safety check saved: ${result.interactionStatus}.`, 'success');
    await renderSection('safety');
    return;
  }
  if (action === 'remove-allergy' || action === 'remove-history') {
    if (!window.confirm('Remove this entry?')) return;
    const segment = action === 'remove-allergy' ? 'allergies' : 'history';
    await api(`/patients/me/${segment}/${encodeURIComponent(id)}`, { method: 'DELETE', body: {} });
    showMessage('Entry removed.', 'success');
    await renderSection('profile');
    return;
  }
  if (action === 'grant-approve') {
    await api(`/care/${encodeURIComponent(id)}/approve`, { method: 'POST', body: {} });
    showMessage('Access approved.', 'success');
    await renderSection('care');
    return;
  }
  if (action === 'grant-decline') {
    await api(`/care/${encodeURIComponent(id)}/decline`, { method: 'POST', body: {} });
    showMessage('Request declined.', 'success');
    await renderSection('care');
    return;
  }
  if (action === 'grant-revoke') {
    if (!window.confirm('Revoke this authorization now?')) return;
    await api(`/care/${encodeURIComponent(id)}/revoke`, { method: 'POST', body: {} });
    showMessage('Authorization revoked.', 'success');
    patientOptions = patientOptions.filter((p) => String(p.authorizationId) !== String(id));
    if (currentUser.role !== 'patient' && patientOptions.length && !patientOptions.some((p) => String(p._id) === String(selectedPatientId))) selectedPatientId = String(patientOptions[0]._id);
    await renderSection('care');
    return;
  }
  if (action === 'toggle-permission') {
    const grant = (await api('/care')).find((item) => String(item._id) === String(id));
    const permissions = { ...grant.permissions, [button.dataset.permission]: button.dataset.value === 'true' };
    await api(`/care/${encodeURIComponent(id)}/permissions`, { method: 'PUT', body: { permissions } });
    showMessage('Caregiver permissions updated.', 'success');
    await renderSection('care');
    return;
  }
  if (action === 'resolve-alert') {
    const note = window.prompt('Optional resolution note:') || '';
    await api(`/alerts/${encodeURIComponent(id)}/resolve`, { method: 'POST', body: { note } });
    showMessage('Alert resolved.', 'success');
    await renderSection('alerts');
    return;
  }
  if (action === 'read-notification') {
    await api(`/notifications/${encodeURIComponent(id)}/read`, { method: 'POST', body: {} });
    await renderSection('notifications');
    return;
  }
  if (action === 'read-all') {
    await api('/notifications/read-all', { method: 'POST', body: {} });
    showMessage('Notifications marked read.', 'success');
    await renderSection('notifications');
  }
}

document.querySelectorAll('[data-auth-tab]').forEach((button) => button.addEventListener('click', () => setAuthTab(button.dataset.authTab)));
document.querySelector('#register-role').addEventListener('change', (event) => document.querySelector('#doctor-fields').classList.toggle('hidden', event.target.value !== 'doctor'));
document.querySelector('#login-form').addEventListener('submit', handleSubmit);
document.querySelector('#register-form').addEventListener('submit', handleSubmit);
document.querySelector('#content').addEventListener('submit', handleSubmit);
document.querySelector('#main-nav').addEventListener('click', (event) => {
  const button = event.target.closest('[data-section]');
  if (button) renderSection(button.dataset.section);
});
document.querySelector('#content').addEventListener('click', async (event) => {
  const button = event.target.closest('[data-action]');
  const sectionButton = event.target.closest('[data-section]');
  if (sectionButton) {
    renderSection(sectionButton.dataset.section);
    return;
  }
  if (!button) return;
  button.disabled = true;
  try { await handleAction(button); } catch (error) { showMessage(error.message, 'error'); }
  finally { button.disabled = false; }
});
document.querySelector('#content').addEventListener('change', (event) => {
  if (event.target.id === 'patient-picker') {
    selectedPatientId = event.target.value;
    renderSection(activeSection);
  }
  if (event.target.id === 'doctor-filter') {
    doctorFilter = event.target.value;
    renderSection('admin');
  }
});
document.querySelector('#content').addEventListener('input', (event) => {
  const input = event.target.closest('[data-medicine-input]');
  if (!input) return;
  clearTimeout(medicineSearchTimer);
  const suggestionsId = input.dataset.medicineInput === 'create' ? 'medicine-suggestions-create' : `medicine-suggestions-${input.dataset.medicineInput}`;
  const suggestions = document.getElementById(suggestionsId);
  if (!suggestions) return;
  const query = input.value.trim();
  if (query.length < 2) {
    suggestions.classList.add('hidden');
    suggestions.innerHTML = '';
    return;
  }
  medicineSearchTimer = setTimeout(async () => {
    try {
      const result = await searchMedicineCatalog(query);
      suggestions.innerHTML = result.results.length
        ? result.results.slice(0, 8).map((medicine) => `<button type="button" data-action="choose-medicine" data-name="${esc(medicine.name)}">${esc(medicine.name)} <small>${esc(medicine.tty || 'RxNorm concept')}</small></button>`).join('')
        : '<span class="metric-note">No matching medicine names.</span>';
      suggestions.classList.remove('hidden');
    } catch (error) {
      suggestions.innerHTML = `<span class="metric-note">${esc(error.message)}</span>`;
      suggestions.classList.remove('hidden');
    }
  }, 250);
});
document.querySelector('#content').addEventListener('click', (event) => {
  const choice = event.target.closest('[data-action="choose-medicine"]');
  if (!choice) return;
  const wrapper = choice.closest('.medicine-autocomplete');
  const input = wrapper?.querySelector('[data-medicine-input]');
  if (!input) return;
  input.value = choice.dataset.name;
  choice.parentElement.classList.add('hidden');
});
document.querySelector('#logout-button').addEventListener('click', async () => {
  try { await api('/auth/logout', { method: 'POST', body: {} }); } catch (error) { showMessage(error.message, 'error'); }
  currentUser = null;
  appView.classList.add('hidden');
  authView.classList.remove('hidden');
  setAuthTab('login');
  clearInterval(browserReminderTimer);
  browserReminderTimer = null;
});
document.querySelector('#notification-link').addEventListener('click', () => renderSection('notifications'));

api('/auth/me').then((result) => enterApp(result.user)).catch(() => {
  currentUser = null;
  authView.classList.remove('hidden');
  appView.classList.add('hidden');
});
