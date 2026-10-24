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
let facilityMap = null;
const listPages = new Map();
const notifiedDoseIds = new Set();
const NAV_ICONS = {
  overview: '<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-6v-6h-4v6H4a1 1 0 0 1-1-1z"/>',
  profile: '<circle cx="12" cy="8" r="3"/><path d="M5 20a7 7 0 0 1 14 0"/>',
  patients: '<path d="M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="10" cy="7" r="4"/><path d="M20 8v6m3-3h-6"/>',
  prescriptions: '<path d="M8 3h8l4 4v14H4V3z"/><path d="M8 12h8m-8 4h8m-8-8h3"/>',
  doses: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  safety: '<path d="M12 3 3.5 7v5c0 5 3.5 8 8.5 9 5-1 8.5-4 8.5-9V7z"/><path d="m9 12 2 2 4-4"/>',
  'medicine-search': '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5M8 10h5"/>',
  care: '<path d="M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="10" cy="7" r="4"/><path d="M19 8v6m3-3h-6"/>',
  alerts: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 8-3 8h18s-3-1-3-8"/><path d="M10 20h4"/>',
  history: '<path d="M3 12a9 9 0 1 0 2.6-6.4L3 8"/><path d="M3 3v5h5m4-1v5l3 2"/>',
  facilities: '<path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/>',
  notifications: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M10 21h4"/>',
  admin: '<path d="M12 3 4 6v5c0 5 3 8 8 10 5-2 8-5 8-10V6z"/><path d="m9 12 2 2 4-4"/>',
};

const NAV_ITEMS = {
  overview: 'Overview',
  profile: 'My profile',
  patients: 'Patients',
  prescriptions: 'Prescriptions',
  doses: 'Dose schedule',
  safety: 'Safety checks',
  'medicine-search': 'Medicine guide',
  care: 'Care team',
  alerts: 'Alerts',
  history: 'Change history',
  facilities: 'Find care',
  notifications: 'Notifications',
  admin: 'Doctor review',
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
  for (const name of ['login', 'register', 'forgot', 'reset']) {
    document.querySelector(`#${name}-form`).classList.toggle('hidden', tab !== name);
  }
  showMessage('');
}

function sectionsForRole(role) {
  if (role === 'patient') return [
    ['overview', 'Overview'], ['profile', 'My profile'], ['prescriptions', 'Prescriptions'],
    ['doses', 'Dose schedule'], ['safety', 'Safety checks'], ['medicine-search', 'Medicine guide'], ['care', 'Care team'],
    ['alerts', 'Alerts'], ['history', 'Change history'], ['facilities', 'Find care'], ['notifications', 'Notifications'],
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
  updateNotificationBadge(user.unreadNotifications || 0);
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

function updateNotificationBadge(count) {
  const badge = document.querySelector('#notif-badge');
  const unread = Math.max(0, Number(count) || 0);
  badge.textContent = unread > 99 ? '99+' : String(unread);
  badge.classList.toggle('hidden', unread === 0);
  document.querySelector('#notification-link').setAttribute('aria-label', `Open notifications${unread ? `, ${unread} unread` : ''}`);
}

function renderNav() {
  const section = sectionsForRole(currentUser.role).find(([id]) => id === activeSection);
  if (section) {
    const [, label] = section;
    document.querySelector('#section-eyebrow').textContent = currentUser.role === 'patient' ? 'YOUR CARE' : `${currentUser.role.toUpperCase()} WORKSPACE`;
    document.querySelector('#welcome-title').textContent = activeSection === 'overview' ? `Welcome, ${currentUser.name}` : label;
  }
  nav.innerHTML = sectionsForRole(currentUser.role).map(([id, label]) => {
    const icon = NAV_ICONS[id] || '';
    return `<button class="nav-button ${id === activeSection ? 'active' : ''}" type="button" data-section="${id}" aria-current="${id === activeSection ? 'page' : 'false'}"><span class="nav-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${icon}</svg></span><span>${NAV_ITEMS[id] || label}</span></button>`;
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

function pageNumber(key) {
  return listPages.get(key) || 1;
}

function paginationControls(key, pagination) {
  if (!pagination || pagination.pages <= 1) return '';
  const previous = Math.max(1, pagination.page - 1);
  const next = Math.min(pagination.pages, pagination.page + 1);
  return `<nav class="pagination-controls" aria-label="List pages"><button type="button" class="button secondary small" data-action="list-page" data-list="${esc(key)}" data-page="${previous}" ${pagination.page <= 1 ? 'disabled' : ''}>Previous</button><span>Page ${esc(pagination.page)} of ${esc(pagination.pages)} · ${esc(pagination.total)} records</span><button type="button" class="button secondary small" data-action="list-page" data-list="${esc(key)}" data-page="${next}" ${pagination.page >= pagination.pages ? 'disabled' : ''}>Next</button></nav>`;
}

async function pagedContextData(path, key) {
  const patientId = await getContextId();
  if (!patientId) return null;
  const params = new URLSearchParams({ page: String(pageNumber(key)), limit: '10' });
  if (currentUser.role !== 'patient') params.set('patientId', patientId);
  return api(`${path}?${params}`);
}

function panel(title, body, tools = '') {
  return `<section class="panel"><div class="panel-head"><h2>${title}</h2>${tools}</div>${body}</section>`;
}

function iconSvg(name) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${NAV_ICONS[name] || ''}</svg>`;
}

function dosePillIcon() {
  return '<span class="dose-pill-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4.9 19.1a5 5 0 0 1 0-7.1l7.1-7.1a5 5 0 0 1 7.1 7.1L12 19.1a5 5 0 0 1-7.1 0Z"/><path d="m8.4 8.4 7.1 7.1"/></svg></span>';
}

function doseStatusActions(dose) {
  if (!['upcoming', 'missed'].includes(dose.status)) return '';
  if (currentUser.role !== 'patient') return '<span class="dose-action-hint">Sign in as the patient to record this dose</span>';
  if (dose.status === 'missed' && !dose.autoMarked) return '';
  return `<div class="dose-actions" aria-label="Record dose status"><button class="button primary small" type="button" data-action="dose-status" data-id="${esc(dose._id)}" data-status="taken">Mark taken</button><button class="button secondary small" type="button" data-action="dose-status" data-id="${esc(dose._id)}" data-status="skipped">Skip dose</button></div>`;
}

function table(headers, rows) {
  if (!rows.length) return empty('No records yet.');
  return `<div class="table-wrap"><table><thead><tr>${headers.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
}

function adherenceRing(value, breakdown = {}) {
  const score = value === null || value === undefined ? null : Math.max(0, Math.min(100, Number(value)));
  const circumference = 226.2;
  const total = Number(breakdown.eligible) || 0;
  let offset = 0;
  const segments = total ? ['taken', 'skipped', 'missed'].map((key) => {
    const amount = Math.max(0, Number(breakdown[key]) || 0);
    const length = circumference * amount / total;
    const segment = `<circle class="score-segment ${key}" cx="47" cy="47" r="36" stroke-dasharray="${length.toFixed(2)} ${(circumference - length).toFixed(2)}" stroke-dashoffset="${(-offset).toFixed(2)}"></circle>`;
    offset += length;
    return segment;
  }).join('') : `<circle class="score-progress" cx="47" cy="47" r="36" stroke-dasharray="${score === null || !Number.isFinite(score) ? 0 : (circumference * score / 100).toFixed(2)} ${circumference}"></circle>`;
  return `<div class="score-ring"><svg class="score-ring-svg" viewBox="0 0 94 94" aria-hidden="true"><circle class="score-track" cx="47" cy="47" r="36"></circle>${segments}</svg><span>${score === null || !Number.isFinite(score) ? '—' : `${score}%`}</span></div>`;
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
    setupPrescriptionWizard();
    closeMobileSidebar();
  } catch (error) {
    content.innerHTML = `${patientSelectorMarkup()}${panel('Could not load this section', `<div class="callout warning">${esc(error.message)}</div><button class="button secondary" type="button" data-action="refresh">Try again</button>`)}`;
  }
}

function setupPrescriptionWizard() {
  const form = document.querySelector('#prescription-form');
  if (!form || form.dataset.wizardReady === 'true') return;
  form.dataset.wizardReady = 'true';
  const nodes = Array.from(form.children);
  const submit = nodes.find((node) => node.querySelector?.('[type="submit"]'));
  const fields = nodes.filter((node) => node.tagName === 'LABEL');
  const groups = [fields.slice(0, 4), fields.slice(4, 9), fields.slice(9)];
  const labels = ['Medicine', 'Schedule', 'Instructions'];
  const indicator = document.createElement('div');
  indicator.className = 'wizard-steps';
  indicator.setAttribute('aria-label', 'Prescription form steps');
  const panels = groups.map((items, index) => {
    const step = document.createElement('div');
    step.className = `wizard-panel form-grid${index ? ' hidden' : ''}`;
    step.dataset.wizardPanel = String(index);
    items.forEach((item) => step.append(item));
    if (index === groups.length - 1 && submit) step.append(submit);
    const mark = document.createElement('span');
    mark.className = `wizard-step${index === 0 ? ' active' : ''}`;
    mark.dataset.wizardStep = String(index);
    mark.textContent = `${index + 1}. ${labels[index]}`;
    indicator.append(mark);
    return step;
  });
  const navigation = document.createElement('div');
  navigation.className = 'wizard-navigation';
  navigation.innerHTML = '<button type="button" class="button secondary" data-action="wizard-prev" disabled>Back</button><span class="wizard-position" aria-live="polite">Step 1 of 3</span><button type="button" class="button primary" data-action="wizard-next">Continue</button>';
  form.replaceChildren(indicator, ...panels, navigation);
}

function setPrescriptionWizardStep(stepIndex) {
  const form = document.querySelector('#prescription-form');
  if (!form) return;
  const panels = [...form.querySelectorAll('[data-wizard-panel]')];
  if (!panels.length) return;
  const nextIndex = Math.max(0, Math.min(panels.length - 1, stepIndex));
  const current = panels.find((panel) => !panel.classList.contains('hidden'));
  const currentIndex = panels.indexOf(current);
  if (!current || currentIndex < 0) return;
  if (nextIndex > currentIndex) {
    const invalidField = [...current.querySelectorAll('input, select, textarea')].find((field) => !field.checkValidity());
    if (invalidField) {
      invalidField.reportValidity();
      invalidField.focus();
      return;
    }
  }
  panels.forEach((panel, index) => panel.classList.toggle('hidden', index !== nextIndex));
  form.querySelectorAll('[data-wizard-step]').forEach((step) => {
    const index = Number(step.dataset.wizardStep);
    step.classList.toggle('active', index === nextIndex);
    step.classList.toggle('done', index < nextIndex);
  });
  const previous = form.querySelector('[data-action="wizard-prev"]');
  const next = form.querySelector('[data-action="wizard-next"]');
  previous.disabled = nextIndex === 0;
  next.classList.toggle('hidden', nextIndex === panels.length - 1);
  form.querySelector('.wizard-position').textContent = `Step ${nextIndex + 1} of ${panels.length}`;
}

function closeMobileSidebar() {
  appView.classList.remove('sidebar-open');
  document.querySelector('#mobile-nav-toggle')?.setAttribute('aria-expanded', 'false');
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
  const todaysDoses = schedule.todaySchedule || [];
  const reminderButton = currentUser.role === 'patient' ? `<button class="button secondary small" type="button" data-action="enable-browser-reminders">${typeof Notification === 'undefined' ? 'Browser reminders unavailable' : Notification.permission === 'granted' ? 'Browser reminders on' : 'Enable browser reminders'}</button>` : '';
  return `${patientSelectorMarkup()}
    ${errors.length ? panel('Some data could not be loaded', `<div class="callout warning">${errors.map(esc).join('<br>')}</div>`) : ''}
    <div class="grid stats-grid">
      ${panel(`<div class="metric-label"><span class="metric-icon">${iconSvg('prescriptions')}</span>Active medicines</div>`, `<p class="metric">${activeCount}</p><p class="metric-note">Current prescriptions on record.</p>`)}
      ${panel(`<div class="metric-label"><span class="metric-icon">${iconSvg('doses')}</span>Upcoming doses</div>`, `<p class="metric">${upcoming.length}</p><p class="metric-note">${nextDose ? `Next · ${esc(nextDose.prescription?.medicineName)} at ${esc(dateText(nextDose.scheduledAt))}` : 'Nothing scheduled in the next seven days.'}</p>`)}
      ${panel(`<div class="metric-label"><span class="metric-icon">${iconSvg('safety')}</span>Adherence</div>`, `<p class="metric">${score === null ? '—' : `${score}%`}</p><p class="metric-note">Based on recorded doses; pending doses are excluded.</p>`)}
      ${panel(`<div class="metric-label"><span class="metric-icon">${iconSvg('alerts')}</span>Open alerts</div>`, `<p class="metric">${openAlerts.length}</p><p class="metric-note">${missed.length} missed in recent history.</p>`)}
    </div>
    <div class="overview-grid">
      <div class="overview-main">
        ${panel('Today’s schedule', `${todaysDoses.length ? `<div class="dose-card-list">${todaysDoses.map((dose) => `<article class="dose-card">${dosePillIcon()}<div class="dose-time">${esc(dose.localTime)}</div><div><div class="dose-name">${esc(dose.prescription?.medicineName || 'Medicine')}</div><div class="dose-instructions">${esc(dose.prescription?.dosageInstructions || '')}</div></div><div class="dose-card-status">${statusTag(dose.status)}${doseStatusActions(dose)}</div></article>`).join('')}</div>` : empty('No doses scheduled for today.')}${panelActions('doses', 'View full schedule')}`)}
        ${panel('Medication safety', `<div class="safety-banner"><span class="safety-mark">!</span><span>Automated checks are a limited prototype, not a comprehensive interaction checker. Review sourced findings with a qualified professional; never change medication based only on this tool.</span></div>${panelActions('safety', 'Review safety checks')}`)}
      </div>
      <div class="overview-side">
        ${panel('Adherence snapshot', `<div class="score-layout">${adherenceRing(score, adherence)}<div class="score-legend"><span><i class="legend-dot"></i>${adherence.taken || 0} taken</span><span><i class="legend-dot skipped"></i>${adherence.skipped || 0} skipped</span><span><i class="legend-dot missed"></i>${adherence.missed || 0} missed</span></div></div><p class="metric-note">${score === null ? 'Adherence appears after a scheduled dose is recorded.' : `Of ${adherence.eligible} eligible doses over ${adherence.days} days.`}</p>`)}
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
  const result = await pagedContextData('/prescriptions', 'prescriptions');
  const list = result.items || [];
  const today = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const cards = list.map((r) => {
    const findings = r.lastSafetyCheck?.findings || [];
    const warningFindings = findings.filter((finding) => finding.type !== 'missing_info');
    const safetyLabel = r.lastSafetyCheck?.interactionStatus || 'not checked';
    const safetyClass = warningFindings.length ? 'warn' : ['partial', 'unavailable'].includes(safetyLabel) ? 'unknown' : 'ok';
    const warningBadges = warningFindings.map((finding) => {
      const severeAllergy = finding.type === 'allergy_match' && /severe/i.test(finding.severity || '');
      const moderateAllergy = finding.type === 'allergy_match' && /moderate/i.test(finding.severity || '');
      const klass = severeAllergy ? 'major' : moderateAllergy ? 'moderate' : 'unrated';
      const label = severeAllergy ? 'Review · severe allergy' : moderateAllergy ? 'Review · moderate allergy' : 'Review · not rated by source';
      return `<span class="severity-badge severity-${klass}" title="${esc(finding.title)}">${esc(label)}</span>`;
    }).join('');
    return `<article class="rx-card">
      <div class="rx-card-head"><div><div class="rx-card-name">${esc(r.medicineName)}</div><div class="rx-card-sub">${esc(r.strength)} · ${esc(r.route)} · ${esc(r.prescriberName || 'Prescriber not listed')}</div></div>${statusTag(r.status)}</div>
      <div class="rx-card-body">${esc(r.dosageInstructions)} · ${esc(r.frequency)} (${esc((r.scheduleTimes || []).join(', '))})<br>${esc(r.startDate)} – ${esc(r.endDate || 'ongoing')}</div>
      <div class="rx-card-footer"><span class="interaction-badge ${safetyClass}">Safety check: ${esc(safetyLabel)}</span>${warningBadges || (!warningFindings.length && r.lastSafetyCheck ? '<span class="muted">No explicit interaction findings recorded; not a safety guarantee.</span>' : '')}</div>
      ${currentUser.role === 'doctor' && r.status === 'active' ? `<div class="action-stack"><button class="button secondary small" type="button" data-action="recheck" data-id="${esc(r._id)}">Recheck safety</button><button class="button danger small" type="button" data-action="discontinue" data-id="${esc(r._id)}" data-name="${esc(r.medicineName)}">Discontinue</button><details class="editor-details"><summary>Edit prescription</summary>${prescriptionEditor(r)}</details></div>` : ''}
    </article>`;
  }).join('');
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
      <label>Scheduled times (HH:MM, comma-separated) <input name="scheduleTimes" required pattern="(?:[01]\\d|2[0-3]):[0-5]\\d(?:\\s*,\\s*(?:[01]\\d|2[0-3]):[0-5]\\d){0,7}" title="Enter 24-hour times separated by commas, such as 08:00, 20:00" placeholder="08:00, 20:00"></label>
      <label>Start date <input name="startDate" type="date" value="${today}" required></label>
      <label>End date (optional) <input name="endDate" type="date"></label>
      <label>Duration in days (optional) <input name="durationDays" type="number" min="1" max="3650"></label>
      <label class="wide">Additional instructions <textarea name="additionalInstructions" maxlength="1000"></textarea></label>
      <label class="wide">Reason / clinical context (recorded in change history) <input name="reason" maxlength="300"></label>
      <div class="wide"><button class="button primary" type="submit">Check safety and create prescription</button></div>
    </form>
    <p class="muted">Prescription creation records the check result, including any unavailable or uncertain information. Review findings before making clinical decisions.</p>` : '';
  return `${patientSelectorMarkup()}${panel('Prescription list', `${cards ? `<div class="rx-card-list">${cards}</div>` : empty('No prescriptions on record.')}${paginationControls('prescriptions', result.pagination)}`)}
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
      ${dosePillIcon()}
      <div class="dose-time">${esc(d.localTime)}</div>
      <div><div class="dose-name">${esc(d.prescription?.medicineName || 'Medicine')} ${esc(d.prescription?.strength || '')}</div><div class="dose-instructions">${esc(d.prescription?.dosageInstructions || '')}${d.overdue ? ' · Overdue' : ''}${d.note ? ` · ${esc(d.note)}` : ''}</div></div>
      <div class="dose-card-status">${statusTag(d.status)}${doseStatusActions(d)}</div>
    </article>`);
  const historyRows = (result.history || []).map((d) => `<tr><td>${esc(d.localDate)} ${esc(d.localTime)}</td><td>${esc(d.prescription?.medicineName || 'Medicine')}</td><td>${statusTag(d.status)}</td><td>${esc(d.note || '')}</td></tr>`);
  const adherence = result.adherence || {};
  const adherenceText = adherence.adherencePercent === null ? 'Not enough recorded outcomes to calculate.' : `${adherence.adherencePercent}% (${adherence.taken} taken / ${adherence.eligible} eligible doses)`;
  return `${patientSelectorMarkup()}
    ${panel('Adherence summary', `<div class="score-layout">${adherenceRing(adherence.adherencePercent, adherence)}<div><strong>${esc(adherenceText)}</strong><p class="metric-note">${esc(adherence.formula || '')}</p></div></div><p class="metric-note">Timezone: ${esc(result.timezone || '—')}. Unrecorded doses are marked missed after ${esc(result.rules?.missedAfterMinutes ?? '—')} minutes.</p>`)}
    ${panel('Medication schedule', `<div class="day-strip">${dayStrip}</div><div class="dose-card-list">${rows.length ? rows.join('') : empty('No doses are scheduled for this day.')}</div>`)}
    ${panel('Upcoming', (result.upcoming || []).length ? `<ul>${result.upcoming.map((d) => `<li>${esc(d.localDate)} ${esc(d.localTime)} · ${esc(d.prescription?.medicineName || 'Medicine')}</li>`).join('')}</ul>` : empty('No upcoming doses in the next seven days.'))}
    ${panel('Recent recorded dose history', table(['Scheduled', 'Medicine', 'Status', 'Note'], historyRows))}`;
}

async function safetyView() {
  const id = await getContextId();
  if (!id) return `${patientSelectorMarkup()}${panel('Medication safety', empty('Select an authorized patient.'))}`;
  const result = await pagedContextData('/safety/checks', 'safety');
  const checks = result?.items || [];
  const doctorForm = currentUser.role === 'doctor' ? `<h3>Check a proposed medicine</h3><form id="safety-form" class="form-grid">
      <label>Medicine name <input name="medicineName" required maxlength="200"></label>
      <label>Active ingredients (optional; comma-separated) <input name="activeIngredients"></label>
      <div class="wide"><button class="button primary" type="submit">Run sourced check</button></div>
    </form>` : '';
  const cards = checks.map((c) => {
    const findings = (c.findings || []).map((f) => {
      const allergySeverity = (f.severity || '').match(/patient-recorded:\s*(severe|moderate|mild)/i)?.[1]?.toLowerCase();
      const severityClass = f.type === 'allergy_match' && allergySeverity === 'severe' ? 'major'
        : f.type === 'allergy_match' && allergySeverity === 'moderate' ? 'moderate'
          : f.type === 'missing_info' ? 'information' : 'unrated';
      const severityLabel = severityClass === 'major' ? 'Major · patient-recorded severe allergy'
        : severityClass === 'moderate' ? 'Moderate · patient-recorded allergy'
          : severityClass === 'information' ? 'Information unavailable' : 'Clinical severity not rated by source';
      return `<article class="finding-card finding-${severityClass}"><span class="severity-badge severity-${severityClass}">${esc(severityLabel)}</span><h4>${esc(f.title)}</h4><p>${esc(f.detail)}</p>${f.excerpt ? `<blockquote>${esc(f.excerpt)}</blockquote>` : ''}<small>Source: ${esc(f.source || 'Not supplied')}${f.severity ? ` · Source severity: ${esc(f.severity)}` : ''}</small>${f.sourceUrl ? ` <a href="${esc(f.sourceUrl)}" target="_blank" rel="noopener noreferrer">Source details</a>` : ''}</article>`;
    }).join('');
    return `<article class="safety-result-card"><div class="safety-result-head"><div><p class="eyebrow">SOURCED CHECK · ${esc(dateText(c.createdAt))}</p><h3>${esc(c.proposed?.name || 'Proposed medicine')}</h3></div>${statusTag(c.interactionStatus)}</div><p class="metric-note">Ingredients: ${esc(c.proposed?.ingredients?.join(', ') || 'unknown')} (${esc(c.proposed?.ingredientSource || 'source unavailable')})</p>
      ${findings ? `<div class="finding-list">${findings}</div>` : '<p class="callout">No findings returned by this limited check. This is not confirmation that a combination is safe.</p>'}
      ${c.limitations?.length ? `<p class="muted">Limitations: ${esc(c.limitations.join(' '))}</p>` : ''}
      <p class="muted">${esc(c.disclaimer || '')}</p></article>`;
  }).join('');
  return `${patientSelectorMarkup()}
    ${panel('Safety-check status', `<div class="callout warning">Prototype only: RxNorm provides ingredient matching; FDA label text is not a comprehensive interaction database. Missing or unavailable data is reported as such. A missing finding does not mean a medicine combination is safe. Do not start, stop, or change medicines based on this tool.</div>${doctorForm}`)}
    ${panel('Saved safety-check results', `${cards ? `<div class="safety-result-list">${cards}</div>` : empty('No saved safety checks yet.')}${paginationControls('safety', result?.pagination)}`)}`;
}

async function careView() {
  const result = await api(`/care?page=${pageNumber('care')}&limit=10`);
  const grants = result.items || [];
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
  return `${panel(patient ? 'Caregiver and doctor authorizations' : 'Patient access', `${table(['Account', 'Role', 'Status', patient ? 'Permissions' : '', 'Actions'], rows)}${paginationControls('care', result.pagination)}`)}
    ${panel('Patient-controlled access', invite)}`;
}

async function alertsView() {
  const id = await getContextId();
  if (!id && currentUser.role !== 'patient') return `${patientSelectorMarkup()}${panel('Alerts', empty('Select a patient or request authorization.'))}`;
  const params = new URLSearchParams({ page: String(pageNumber('alerts')), limit: '10' });
  if (currentUser.role !== 'patient') params.set('patientId', id);
  const data = await api(`/alerts?${params}`);
  const cards = (data.alerts || []).map((a) => `<article class="list-item"><h3>${esc(a.patient?.name || 'Patient')} · ${esc(a.prescription?.medicineName || 'Medicine')}</h3><p>${esc(a.missedCount)} missed doses in ${esc(a.windowDays)} days; threshold ${esc(a.threshold)}. Created ${esc(dateText(a.createdAt))}.</p><p>Status: ${statusTag(a.status)}</p>${a.doses?.length ? `<ul>${a.doses.map((d) => `<li>${esc(d.localDate)} ${esc(d.localTime)} — ${esc(d.status)}</li>`).join('')}</ul>` : ''}${currentUser.role === 'doctor' && a.status === 'open' ? `<button class="button secondary small" type="button" data-action="resolve-alert" data-id="${esc(a._id)}">Resolve</button>` : ''}</article>`).join('');
  return `${patientSelectorMarkup()}${panel('Missed-dose alerts', `<p class="muted">Repeated-dose threshold: ${esc(data.threshold)} within ${esc(data.windowDays)} days.</p>${cards ? `<div class="list">${cards}</div>` : empty('No alerts are visible for this account.')}${paginationControls('alerts', data.pagination)}`)}`;
}

async function historyView() {
  const id = await getContextId();
  if (!id) return `${patientSelectorMarkup()}${panel('Prescription history', empty('Select a patient.'))}`;
  const result = await pagedContextData(currentUser.role === 'patient' ? '/patients/me/audit-log' : '/prescriptions/history', 'history');
  const list = result.items || [];
  const rows = list.map((log) => `<tr><td>${esc(dateText(log.createdAt))}</td><td>${esc(log.action)}</td><td>${esc(log.medicineName || log.entityType)}</td><td>${esc(log.actor?.name || 'System')}</td><td>${esc((log.changes || []).map((c) => `${c.field}: ${JSON.stringify(c.from)} → ${JSON.stringify(c.to)}`).join('; ') || JSON.stringify(log.meta || {}))}</td></tr>`);
  return `${patientSelectorMarkup()}${panel(currentUser.role === 'patient' ? 'My account and medication activity' : 'Patient activity history', `<p class="metric-note">${currentUser.role === 'patient' ? 'A record of changes made to your medication and profile, and access events involving your care.' : 'Recorded patient-related changes visible to your account.'}</p>${table(['When', 'Action', 'Record', 'Changed by', 'Details'], rows)}${paginationControls('history', result.pagination)}`)}`;
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
  const doctorsResult = await api(`/admin/doctors?status=${encodeURIComponent(doctorFilter)}&page=${pageNumber('admin')}&limit=10`);
  const doctors = doctorsResult.items || [];
  const rows = doctors.map((doctor) => `<tr>
    <td><strong>${esc(doctor.user?.name || 'Account')}</strong><br><small>${esc(doctor.user?.email || '')}</small></td>
    <td>${esc(doctor.licenseNumber || 'Not provided')}</td>
    <td>${esc(doctor.specialty || 'Not provided')}</td>
    <td>${esc(doctor.organization || 'Not provided')}</td>
    <td>${statusTag(doctor.verificationStatus)}</td>
    <td>${doctor.verificationStatus !== 'verified' ? `<button class="button primary small" type="button" data-action="doctor-review" data-id="${esc(doctor.user?._id)}" data-status="verified">Verify</button>` : ''}${doctor.verificationStatus !== 'rejected' ? `<button class="button danger small" type="button" data-action="doctor-review" data-id="${esc(doctor.user?._id)}" data-status="rejected">Reject</button>` : ''}</td>
  </tr>`);
  return `${panel('Doctor verification queue', `<div class="section-toolbar"><p class="metric-note">Review professional registration details before granting a doctor access to patient records.</p><label>Show<select id="doctor-filter"><option value="pending" ${doctorFilter === 'pending' ? 'selected' : ''}>Pending review</option><option value="verified" ${doctorFilter === 'verified' ? 'selected' : ''}>Verified</option><option value="rejected" ${doctorFilter === 'rejected' ? 'selected' : ''}>Rejected</option></select></label></div>${table(['Doctor', 'License', 'Specialty', 'Organization', 'Status', 'Decision'], rows)}${paginationControls('admin', doctorsResult.pagination)}`)}
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
    const facilities = result.results || [];
    resultsBox.innerHTML = `<p class="muted">${esc(result.source)} · ${esc(result.note)}</p>
      <div class="facility-layout">
        <div class="facility-list">${facilities.length ? `<div class="list">${facilities.map((facility) => `<article class="list-item"><h3>${esc(facility.name)} ${statusTag(facility.type)}</h3><p>${esc(facility.address || 'Address not listed')}${facility.distanceKm !== undefined ? ` · ${esc(facility.distanceKm)} km` : ''}</p><p>${facility.phone ? `Phone: ${esc(facility.phone)} · ` : ''}${facility.openingHours ? `Hours: ${esc(facility.openingHours)}` : ''}</p><p><a href="${esc(facility.directionsUrl)}" target="_blank" rel="noopener noreferrer">Directions</a> · <a href="${esc(facility.osmUrl)}" target="_blank" rel="noopener noreferrer">OpenStreetMap</a></p></article>`).join('')}</div>` : empty('No facilities were found in this area.')}</div>
        <div id="facility-map" class="facility-map" role="region" aria-label="Map of nearby facilities"></div>
      </div>`;
    if (facilityMap) facilityMap.remove();
    const mapElement = document.querySelector('#facility-map');
    if (!window.L || !mapElement) {
      resultsBox.insertAdjacentHTML('beforeend', '<div class="callout warning">The interactive map could not load. Facility results and directions remain available.</div>');
      return;
    }
    facilityMap = window.L.map(mapElement).setView([lat, lon], Number(radius) <= 3000 ? 14 : Number(radius) <= 5000 ? 13 : 12);
    window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors</a>',
    }).addTo(facilityMap);
    window.L.marker([lat, lon]).addTo(facilityMap).bindPopup('Search location');
    const markers = [];
    for (const facility of facilities) {
      if (!Number.isFinite(Number(facility.lat)) || !Number.isFinite(Number(facility.lon))) continue;
      const marker = window.L.marker([Number(facility.lat), Number(facility.lon)]).addTo(facilityMap);
      marker.bindPopup(`<strong>${esc(facility.name)}</strong><br>${esc(facility.type)}<br>${esc(facility.address || 'Address not listed')}`);
      markers.push(marker);
    }
    if (markers.length) {
      const group = window.L.featureGroup(markers);
      facilityMap.fitBounds(group.getBounds().pad(0.12), { maxZoom: 15 });
    }
    setTimeout(() => facilityMap?.invalidateSize(), 0);
  } catch (error) {
    resultsBox.innerHTML = `<div class="callout warning">${esc(error.message)}</div>`;
    throw error;
  }
}

async function notificationsView() {
  const data = await api(`/notifications?page=${pageNumber('notifications')}&limit=10`);
  updateNotificationBadge(data.unread);
  currentUser.unreadNotifications = data.unread;
  const preferences = currentUser.notificationPreferences || {};
  const rows = data.items.map((n) => `<article class="notif-item ${n.readAt ? '' : 'unread'}"><span class="notif-icon" aria-hidden="true">${iconSvg('notifications')}</span><div class="notif-body"><div class="notif-title">${esc(n.title)} ${n.readAt ? '<span class="muted">(read)</span>' : statusTag('unread')}</div><p class="notif-msg">${esc(n.message)}</p><div class="notif-meta">${esc(dateText(n.createdAt))} · In-app: ${esc(n.channels?.inApp || 'enabled')} · email: ${esc(n.channels?.email || 'not configured')} · SMS: ${esc(n.channels?.sms || 'not configured')}</div>${!n.readAt ? `<button class="button secondary small" type="button" data-action="read-notification" data-id="${esc(n._id)}">Mark read</button>` : ''}</div></article>`).join('');
  const settings = `<form id="notification-preferences-form" class="form-grid notification-preferences">
    <label class="checkbox-label"><input type="checkbox" name="email" ${preferences.email ? 'checked' : ''}> Send email notifications</label>
    <label class="checkbox-label"><input type="checkbox" name="sms" ${preferences.sms ? 'checked' : ''}> Send SMS notifications</label>
    <label class="wide">Mobile number for SMS <input name="notificationPhone" type="tel" value="${esc(currentUser.notificationPhone || '')}" placeholder="+14155550123" autocomplete="tel"><small>Use international E.164 format. Enabling SMS is optional; standard carrier charges may apply.</small></label>
    <div class="wide"><button class="button secondary" type="submit">Save delivery preferences</button></div>
  </form>`;
  return `${panel('Delivery preferences', `<p class="muted">In-app notices remain enabled. Email and SMS require server-side provider configuration and your explicit opt-in.</p>${settings}`)}
    ${panel(`Notifications (${data.unread} unread)`, `<button class="button secondary small" type="button" data-action="read-all">Mark all read</button>${rows ? `<div class="list">${rows}</div>` : empty('No notifications yet.')}${paginationControls('notifications', data.pagination)}`)}`;
}

function formObject(form) { return Object.fromEntries(new FormData(form).entries()); }
function parseTimes(value) { return value.split(',').map((s) => s.trim()).filter(Boolean); }
function setBusy(form, busy) { const button = form.querySelector('[type="submit"]'); if (button) { button.disabled = busy; if (busy) button.dataset.originalText = button.textContent; button.textContent = busy ? 'Please wait…' : button.dataset.originalText || button.textContent; } }

async function handleAuthSubmit(event) {
  const form = event.target;
  if (!['login-form', 'register-form', 'forgot-form', 'reset-form'].includes(form.id)) return false;
  event.preventDefault();
  setBusy(form, true);
  try {
    const values = formObject(form);
    if (form.id === 'login-form' || form.id === 'register-form') {
      const result = await api(`/auth/${form.id === 'login-form' ? 'login' : 'register'}`, { method: 'POST', body: values });
      await enterApp(result.user);
    } else if (form.id === 'forgot-form') {
      const result = await api('/auth/forgot-password', { method: 'POST', body: values });
      document.querySelector('#reset-form [name="email"]').value = values.email;
      setAuthTab('reset');
      showMessage(result.message, 'success');
    } else {
      const result = await api('/auth/reset-password', { method: 'POST', body: values });
      setAuthTab('login');
      showMessage(result.message, 'success');
    }
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
    } else if (form.id === 'notification-preferences-form') {
      const result = await api('/auth/notification-preferences', {
        method: 'PUT',
        body: {
          email: form.elements.email.checked,
          sms: form.elements.sms.checked,
          notificationPhone: values.notificationPhone || '',
        },
      });
      currentUser.notificationPreferences = result.notificationPreferences;
      currentUser.notificationPhone = result.notificationPhone;
      showMessage('Notification preferences saved.', 'success');
      await renderSection('notifications');
    }
  } catch (error) {
    showMessage(error.message, 'error');
  } finally { setBusy(form, false); }
}

async function handleAction(button) {
  const action = button.dataset.action;
  const id = button.dataset.id;
  if (action === 'refresh') return renderSection();
  if (action === 'list-page') {
    const key = button.dataset.list;
    listPages.set(key, Number(button.dataset.page));
    await renderSection(activeSection);
    return;
  }
  if (action === 'wizard-next' || action === 'wizard-prev') {
    const form = button.closest('#prescription-form');
    const active = [...form.querySelectorAll('[data-wizard-panel]')].findIndex((panel) => !panel.classList.contains('hidden'));
    setPrescriptionWizardStep(active + (action === 'wizard-next' ? 1 : -1));
    return;
  }
  if (action === 'select-patient') {
    selectedPatientId = id;
    listPages.clear();
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
    const doseActions = button.closest('.dose-actions');
    doseActions?.querySelectorAll('button').forEach((actionButton) => { actionButton.disabled = true; });
    try {
      await api(`/doses/${encodeURIComponent(id)}/status`, { method: 'POST', body: { status: button.dataset.status } });
      showMessage('Dose status saved.', 'success');
      await renderSection(activeSection);
      return;
    } catch (err) {
      showMessage(err.message, 'error');
      await renderSection(activeSection);
      return;
    } finally {
      doseActions?.querySelectorAll('button').forEach((actionButton) => { actionButton.disabled = false; });
    }
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
document.querySelector('#forgot-form').addEventListener('submit', handleSubmit);
document.querySelector('#reset-form').addEventListener('submit', handleSubmit);
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
    listPages.set('admin', 1);
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
document.querySelector('#mobile-nav-toggle').addEventListener('click', () => {
  const open = appView.classList.toggle('sidebar-open');
  document.querySelector('#mobile-nav-toggle').setAttribute('aria-expanded', String(open));
});
document.querySelector('#sidebar-backdrop').addEventListener('click', closeMobileSidebar);

api('/auth/me').then((result) => enterApp(result.user)).catch(() => {
  currentUser = null;
  authView.classList.remove('hidden');
  appView.classList.add('hidden');
});
