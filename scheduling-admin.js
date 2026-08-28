// ============================================================
// Provo YSA 8th Ward - Scheduling Admin Dashboard Logic
// Supports Supabase PostgreSQL backend + LocalStorage offline sync
// ============================================================

// Global Admin State
const SCHEDULING_STATE = {
  authenticated: false,
  activeSubTab: 'dashboard', // 'dashboard', 'announce', 'admins'
  activeDashPanel: 'appointments', // 'appointments', 'types', 'weekly' — nested inside the Dashboard tab
  selectedDate: new Date(),
  currentCalendarMonth: new Date().getMonth(),
  currentCalendarYear: new Date().getFullYear(),
  settings: {
    ward_name: 'Provo YSA 8th Ward',
    accepting_appointments: true,
    timezone: 'America/Denver'
  },
  meetingTypes: [],
  weeklyAvailability: [],
  dateOverrides: [],
  appointments: [],
  supabaseClient: null,
  activeDaysSelected: [0, 3], // Default: Sunday (0) & Wednesday (3)
  currentAdmin: null // { id, email, role } once logged in
};

// Sends appointment confirmation/cancellation emails via the Vercel API route
// (api/send-email.js — Node + nodemailer, Gmail App Password auth).
async function sendAppointmentEmail(action, appointment) {
  try {
    const res = await fetch('/api/send-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, appointment })
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      console.warn('send-email API error:', data && data.error);
    }
    return data;
  } catch (err) {
    console.warn('send-email API request failed:', err);
    return null;
  }
}

// Mirrors a booked/rescheduled/cancelled appointment onto the bishop's
// personal Google Calendar via the Vercel API route (api/calendar-sync.js).
// Best-effort — failures are logged but never block the booking flow.
async function syncAppointmentToGoogleCalendar(action, appointment) {
  try {
    const res = await fetch('/api/calendar-sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, appointment })
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || (data && data.success === false && !data.skipped)) {
      console.warn('calendar-sync API error:', data && (data.error || data.reason));
    }
    return data;
  } catch (err) {
    console.warn('calendar-sync API request failed:', err);
    return null;
  }
}

// Shared helper for every admin-only Vercel API route (api/admin-*.js).
// Automatically attaches the session token and surfaces a friendly error
// via toast on failure (401/403 included — e.g. after another tab deletes
// this admin's account). Returns the parsed response body, or null on
// failure.
async function adminApiFetch(path, body = {}) {
  try {
    const token = sessionStorage.getItem('ward_admin_session');
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, ...body })
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      if (res.status === 401) {
        showToast('Your session is no longer valid. Please sign in again.', 'error');
        handleAdminLogout();
      } else {
        showToast((data && data.error) || 'Something went wrong. Please try again.', 'error');
      }
      return null;
    }
    return data;
  } catch (err) {
    console.warn(`${path} request failed:`, err);
    showToast('Network error. Please try again.', 'error');
    return null;
  }
}

// Helper to get ISO date offsets for demo data
function getFormattedDateOffset(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

function getISOOffsetTime(dayOffset, hours, minutes) {
  const d = new Date();
  d.setDate(d.getDate() + dayOffset);
  d.setHours(hours, minutes, 0, 0);
  return d.toISOString();
}

// Default seed data for 7 standard ward meeting types
const DEFAULT_MEETING_TYPES = [
  {
    id: 'mt-1',
    title: 'Ecclesiastical Endorsement',
    description: 'Please schedule your meeting for the earliest available time to prevent gaps. Submit your endorsement before your appointment. Thank you! https://honorcode.byu.edu/ecclesiastical-endorsements-and-resources',
    duration_minutes: 15,
    buffer_minutes: 0,
    assigned_to: 'Bishopric',
    location: '395 E 600 N, Manavu chapel, up the stairs',
    is_active: true
  },
  {
    id: 'mt-2',
    title: 'Temple Recommend Renewal',
    description: 'If you have been in the ward for more than a year, please contact one of the secretaries for a temple recommend renewal.\n\nAlso, please schedule your meeting for the earliest available time to prevent gaps, thank you!',
    duration_minutes: 15,
    buffer_minutes: 0,
    assigned_to: 'Bishopric',
    location: '395 E 600 N, Manavu chapel, up the stairs',
    is_active: true
  },
  {
    id: 'mt-3',
    title: 'Temple Recommend for Own Endowment',
    description: 'Please schedule an interview with the stake before scheduling with the bishop.\n\nAlso, please schedule your meeting for the earliest available time to prevent gaps, thank you!',
    duration_minutes: 45,
    buffer_minutes: 0,
    assigned_to: 'Bishop',
    location: '395 E 600 N, Manavu chapel, up the stairs',
    is_active: true
  },
  {
    id: 'mt-4',
    title: 'Temple Recommend for Own Sealing',
    description: 'Please schedule an interview with the stake before scheduling with the bishop.\n\nAlso, please schedule your meeting for the earliest available time to prevent gaps, thank you!',
    duration_minutes: 45,
    buffer_minutes: 0,
    assigned_to: 'Bishop',
    location: '395 E 600 N, Manavu chapel, up the stairs',
    is_active: true
  },
  {
    id: 'mt-5',
    title: '15 Minute Personal Meeting',
    description: 'Please schedule your meeting for the earliest available time to prevent gaps, thank you!',
    duration_minutes: 15,
    buffer_minutes: 0,
    assigned_to: 'Bishop',
    location: '395 E 600 N, Manavu chapel, up the stairs',
    is_active: true
  },
  {
    id: 'mt-6',
    title: '30 Minute Personal Meeting',
    description: 'Please schedule your meeting for the earliest available time to prevent gaps, thank you!',
    duration_minutes: 30,
    buffer_minutes: 0,
    assigned_to: 'Bishop',
    location: '395 E 600 N, Manavu chapel, up the stairs',
    is_active: true
  },
  {
    id: 'mt-7',
    title: '45 Minute Personal Meeting',
    description: 'Please schedule your meeting for the earliest available time to prevent gaps, thank you!',
    duration_minutes: 45,
    buffer_minutes: 0,
    assigned_to: 'Bishop',
    location: '395 E 600 N, Manavu chapel, up the stairs',
    is_active: true
  }
];

const DEFAULT_WEEKLY_AVAILABILITY = [
  { id: 'wa-1', day_of_week: 0, start_time: '10:00:00', end_time: '10:45:00' },
  { id: 'wa-2', day_of_week: 0, start_time: '14:00:00', end_time: '16:00:00' },
  { id: 'wa-3', day_of_week: 3, start_time: '18:30:00', end_time: '20:00:00' }
];

const DEFAULT_DATE_OVERRIDES = [
  {
    id: 'do-1',
    override_date: getFormattedDateOffset(5),
    is_unavailable: false,
    start_time: '14:00:00',
    end_time: '17:00:00'
  },
  {
    id: 'do-2',
    override_date: getFormattedDateOffset(12),
    is_unavailable: true,
    start_time: null,
    end_time: null
  }
];

const DEFAULT_APPOINTMENTS = [];

/**
 * Initialize Supabase Client if credentials exist
 */
function initSupabaseClient() {
  const config = window.SUPABASE_CONFIG || {};
  let url = config.url || '';
  let key = config.anonKey || '';

  // Clean URL (strip /rest/v1 if included by mistake)
  if (url) {
    url = url.replace(/\/rest\/v1\/?$/, '').trim();
  }

  const isValidKey = key && !key.includes('PASTE_YOUR_ANON_KEY') && key.length > 20;

  if (url && isValidKey && window.supabase && typeof window.supabase.createClient === 'function') {
    try {
      SCHEDULING_STATE.supabaseClient = window.supabase.createClient(url.trim(), key.trim());
      console.log('Supabase client connected for Scheduling Admin.');
      return true;
    } catch (e) {
      console.warn('Supabase initialization failed:', e);
      SCHEDULING_STATE.supabaseClient = null;
    }
  }
  return false;
}

/**
 * Open Admin Login Modal or Navigate if already signed in
 */
function openAdminLoginModal() {
  const isAuth = hasValidAdminSession() || SCHEDULING_STATE.authenticated;
  if (isAuth) {
    navigateTab('admin-scheduling');
  } else {
    const emailInput = document.getElementById('modal-admin-email-input');
    const passwordInput = document.getElementById('modal-admin-password-input');
    if (emailInput) emailInput.classList.remove('border-error');
    if (passwordInput) {
      passwordInput.value = '';
      passwordInput.classList.remove('border-error');
    }
    openModal('admin-login-modal');
    setTimeout(() => {
      if (emailInput) emailInput.focus();
    }, 150);
  }
}

/**
 * Reads the signed session token from a successful /api/admin-login call and
 * checks whether it has expired. The signature itself isn't re-verified
 * client-side (the browser already trusts its own sessionStorage) — this
 * just auto-expires stale sessions after the server-issued TTL.
 */
function hasValidAdminSession() {
  const token = sessionStorage.getItem('ward_admin_session');
  if (!token || sessionStorage.getItem('ward_admin_authenticated') !== 'true') return false;

  const [payloadB64] = token.split('.');
  try {
    const payload = JSON.parse(atob(payloadB64.replace(/-/g, '+').replace(/_/g, '/')));
    return typeof payload.exp === 'number' && Date.now() < payload.exp;
  } catch (e) {
    return false;
  }
}

// Restores { id, email, role } into SCHEDULING_STATE.currentAdmin from
// sessionStorage so identity/role survive a page reload without re-login.
function restoreCurrentAdminFromSession() {
  try {
    const raw = sessionStorage.getItem('ward_admin_identity');
    SCHEDULING_STATE.currentAdmin = raw ? JSON.parse(raw) : null;
  } catch (e) {
    SCHEDULING_STATE.currentAdmin = null;
  }
}

/**
 * Check Authentication and show/hide Admin tabs dynamically
 */
function checkAdminAuth() {
  const isAuth = hasValidAdminSession();
  if (!isAuth) {
    sessionStorage.removeItem('ward_admin_authenticated');
    sessionStorage.removeItem('ward_admin_session');
    sessionStorage.removeItem('ward_admin_identity');
    SCHEDULING_STATE.currentAdmin = null;
  } else {
    restoreCurrentAdminFromSession();
  }
  SCHEDULING_STATE.authenticated = isAuth;

  const authGate = document.getElementById('admin-auth-gate');
  const adminContent = document.getElementById('admin-main-content');
  const desktopNavBtn = document.getElementById('nav-btn-admin-scheduling');
  const mobileNavBtn = document.getElementById('tab-admin-scheduling');
  const headerIcon = document.getElementById('header-admin-icon');
  const headerText = document.getElementById('header-admin-text');

  if (isAuth) {
    // Show admin tab in desktop & mobile navigation
    if (desktopNavBtn) desktopNavBtn.classList.remove('hidden');
    if (mobileNavBtn) mobileNavBtn.classList.remove('hidden');

    // Update header status (Clean 'Admin', no 'Active' text)
    if (headerIcon) headerIcon.textContent = 'admin_panel_settings';
    if (headerText) headerText.textContent = 'Admin';
    renderHeaderAdminIdentity();

    // Show workspace
    if (authGate) authGate.classList.add('hidden');
    if (adminContent) adminContent.classList.remove('hidden');
    loadAllSchedulingData();
    applyRoleBasedVisibility();
    // Silently (re-)ensure the push subscription is registered on reload —
    // won't prompt if permission was never granted. full_access/
    // scheduling_access only (see api/push-subscription.js).
    if (SCHEDULING_STATE.currentAdmin && adminCanSchedule(SCHEDULING_STATE.currentAdmin.role)) {
      initAdminPushNotifications();
    }
  } else {
    // Hide admin tab from navigation until signed in
    if (desktopNavBtn) desktopNavBtn.classList.add('hidden');
    if (mobileNavBtn) mobileNavBtn.classList.add('hidden');

    // Update header status
    if (headerIcon) headerIcon.textContent = 'lock';
    if (headerText) headerText.textContent = 'Admin';
    renderHeaderAdminIdentity();

    // Show gate
    if (authGate) authGate.classList.remove('hidden');
    if (adminContent) adminContent.classList.add('hidden');
  }
}

// Role → label, shared by the header identity chip and the Admins list.
const ADMIN_ROLE_LABELS = {
  full_access: 'Full Access',
  scheduling_access: 'Scheduling',
  announcements_only: 'Announcements Only',
};
function adminRoleLabel(role) {
  return ADMIN_ROLE_LABELS[role] || role;
}
// full_access and scheduling_access can both see the scheduling dashboard
// (meeting types, weekly availability, appointments); only full_access can
// also manage other admin accounts.
function adminCanSchedule(role) {
  return role === 'full_access' || role === 'scheduling_access';
}

// Shows "Signed in as {email}" + role badge in the header dropdown, since
// there's no per-admin identity display in the plain-PIN model this replaces.
function renderHeaderAdminIdentity() {
  const el = document.getElementById('header-admin-identity');
  if (!el) return;
  const admin = SCHEDULING_STATE.currentAdmin;
  if (!admin) {
    el.textContent = '';
    el.classList.add('hidden');
    return;
  }
  el.textContent = `${admin.email} · ${adminRoleLabel(admin.role)}`;
  el.classList.remove('hidden');
}

// Hides the Dashboard tab (appointments/types/weekly all live inside it) for
// announcements_only admins, and the admins tab for anyone but full_access —
// UX only; the real authorization boundary is each admin-*.js endpoint's
// server-side requireAdmin() check.
function applyRoleBasedVisibility() {
  const admin = SCHEDULING_STATE.currentAdmin;
  const role = admin ? admin.role : 'full_access';
  const canSchedule = adminCanSchedule(role);
  const isFullAccess = role === 'full_access';

  ['dashboard'].forEach((tab) => {
    const desktopBtn = document.getElementById(`subtab-btn-${tab}`);
    const mobileBtn = document.getElementById(`admin-mob-tab-${tab}`);
    if (desktopBtn) desktopBtn.classList.toggle('hidden', !canSchedule);
    if (mobileBtn) mobileBtn.classList.toggle('hidden', !canSchedule);
  });

  const adminsDesktopBtn = document.getElementById('subtab-btn-admins');
  const adminsMobileBtn = document.getElementById('admin-mob-tab-admins');
  if (adminsDesktopBtn) adminsDesktopBtn.classList.toggle('hidden', !isFullAccess);
  if (adminsMobileBtn) adminsMobileBtn.classList.toggle('hidden', !isFullAccess);

  if (!canSchedule && SCHEDULING_STATE.activeSubTab !== 'announce') {
    switchAdminSubTab('announce');
  } else if (!isFullAccess && SCHEDULING_STATE.activeSubTab === 'admins') {
    switchAdminSubTab('announce');
  }
}

/**
 * Handle Header Admin Button Click (Toggle dropdown if logged in, otherwise open login modal)
 */
function handleHeaderAdminClick(event) {
  if (event) event.stopPropagation();
  const isAuth = hasValidAdminSession() || SCHEDULING_STATE.authenticated;

  if (isAuth) {
    const dropdown = document.getElementById('header-admin-dropdown');
    if (dropdown) {
      dropdown.classList.toggle('hidden');
    }
  } else {
    openAdminLoginModal();
  }
}

function closeHeaderAdminDropdown() {
  const dropdown = document.getElementById('header-admin-dropdown');
  if (dropdown) {
    dropdown.classList.add('hidden');
  }
}

// Close header dropdown when clicking outside
document.addEventListener('click', (e) => {
  const dropdown = document.getElementById('header-admin-dropdown');
  const btn = document.getElementById('header-admin-btn');
  if (dropdown && !dropdown.classList.contains('hidden')) {
    if (!dropdown.contains(e.target) && (!btn || !btn.contains(e.target))) {
      dropdown.classList.add('hidden');
    }
  }
});

/**
 * Handle Login from In-Page Gate
 */
async function handleAdminLogin(event) {
  if (event) event.preventDefault();
  const emailInput = document.getElementById('admin-email-input');
  const passwordInput = document.getElementById('admin-password-input');
  const email = emailInput ? emailInput.value.trim() : '';
  const password = passwordInput ? passwordInput.value : '';
  await processAdminLogin(email, password, passwordInput);
}

/**
 * Handle Login from Popup Modal
 */
async function handleAdminModalLogin(event) {
  if (event) event.preventDefault();
  const emailInput = document.getElementById('modal-admin-email-input');
  const passwordInput = document.getElementById('modal-admin-password-input');
  const email = emailInput ? emailInput.value.trim() : '';
  const password = passwordInput ? passwordInput.value : '';
  const success = await processAdminLogin(email, password, passwordInput);
  if (success) {
    closeModal('admin-login-modal');
    navigateTab('admin-scheduling');
  }
}

/**
 * Core login logic — verified server-side via /api/admin-login so
 * passwords are never checkable from the browser's JS.
 */
async function processAdminLogin(email, password, inputElement) {
  if (!email || !password) return false;

  // Kick off the permission prompt synchronously, still inside this click's
  // user-activation window — browsers can silently ignore requestPermission()
  // if it's only called after an intervening network round-trip.
  const permissionPromise = ('Notification' in window && Notification.permission === 'default')
    ? Notification.requestPermission()
    : Promise.resolve('Notification' in window ? Notification.permission : 'denied');

  try {
    const res = await fetch('/api/admin-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();

    if (res.ok && data.success && data.token) {
      sessionStorage.setItem('ward_admin_session', data.token);
      sessionStorage.setItem('ward_admin_authenticated', 'true');
      sessionStorage.setItem('ward_admin_identity', JSON.stringify(data.admin));
      SCHEDULING_STATE.authenticated = true;
      SCHEDULING_STATE.currentAdmin = data.admin;
      if (inputElement) inputElement.value = '';
      showToast(`Signed in as ${data.admin.email}`, 'verified_user');
      checkAdminAuth();
      const permission = await permissionPromise;
      if (adminCanSchedule(data.admin.role)) {
        initAdminPushNotifications({ permission });
      }
      return true;
    }

    showToast(data.error || 'Incorrect email or password.', 'error');
  } catch (err) {
    console.error('Admin login request failed:', err);
    showToast('Could not reach the server. Please try again.', 'error');
  }

  if (inputElement) {
    inputElement.classList.add('border-error');
    setTimeout(() => inputElement.classList.remove('border-error'), 2000);
    inputElement.focus();
  }
  return false;
}

async function handleAdminLogout() {
  await unsubscribeAdminPushNotifications();
  sessionStorage.removeItem('ward_admin_authenticated');
  sessionStorage.removeItem('ward_admin_session');
  sessionStorage.removeItem('ward_admin_identity');
  SCHEDULING_STATE.authenticated = false;
  SCHEDULING_STATE.currentAdmin = null;
  showToast('Logged out of Admin Portal', 'lock');
  checkAdminAuth();
  navigateTab('ward');
}

/**
 * ------------------------------------------------------------
 * Admin Push Notifications (new-appointment alerts)
 * Only ever set up for a signed-in full_access admin (see
 * api/push-subscription.js, which requires a valid session).
 * ------------------------------------------------------------
 */
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

async function initAdminPushNotifications({ permission } = {}) {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return;
  if (!window.VAPID_PUBLIC_KEY) return;

  // No explicit permission passed (e.g. the silent page-load re-check) —
  // read the current state instead of prompting, since there's no user
  // gesture to anchor a permission request to here.
  const effectivePermission = permission || Notification.permission;
  if (effectivePermission !== 'granted') return;

  try {
    const registration = await navigator.serviceWorker.register('sw.js');
    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(window.VAPID_PUBLIC_KEY),
      });
    }

    const token = sessionStorage.getItem('ward_admin_session');
    await fetch('/api/push-subscription', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, action: 'subscribe', subscription: subscription.toJSON() }),
    });
  } catch (err) {
    console.warn('Push notification setup failed:', err);
  }
}

async function unsubscribeAdminPushNotifications() {
  try {
    if (!('serviceWorker' in navigator)) return;
    const registration = await navigator.serviceWorker.getRegistration('sw.js');
    if (!registration) return;
    const subscription = await registration.pushManager.getSubscription();
    if (!subscription) return;

    const token = sessionStorage.getItem('ward_admin_session');
    await fetch('/api/push-subscription', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, action: 'unsubscribe', endpoint: subscription.endpoint }),
    });
    await subscription.unsubscribe();
  } catch (err) {
    console.warn('Push notification teardown failed:', err);
  }
}

/**
 * Send an admin-written push notification to everyone who has installed
 * the app (see api/admin-broadcast.js).
 */
async function handleSendBroadcast(event) {
  event.preventDefault();

  const titleInput = document.getElementById('broadcast-title');
  const bodyInput = document.getElementById('broadcast-body');
  const btn = document.getElementById('btn-send-broadcast');
  const btnText = document.getElementById('btn-send-broadcast-text');

  const title = titleInput.value.trim();
  const body = bodyInput.value.trim();
  if (!title || !body) return;

  const originalText = btnText.textContent;
  btn.disabled = true;
  btnText.textContent = 'Sending...';

  try {
    const res = await fetch('/api/admin-broadcast', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: sessionStorage.getItem('ward_admin_session'), title, body }),
    });
    const data = await res.json();

    if (res.ok && data.success) {
      showToast(`Sent to ${data.sent} of ${data.total} device${data.total === 1 ? '' : 's'}`, 'campaign');
      titleInput.value = '';
      bodyInput.value = '';
    } else {
      showToast(data.error || 'Failed to send announcement.', 'error');
    }
  } catch (err) {
    console.error('Broadcast send failed:', err);
    showToast('Could not reach the server. Please try again.', 'error');
  } finally {
    btn.disabled = false;
    btnText.textContent = originalText;
  }
}

/**
 * Load all data from Supabase (or fallback to localStorage / defaults)
 */
async function loadAllSchedulingData() {
  initSupabaseClient();
  const sb = SCHEDULING_STATE.supabaseClient;

  // 1. Settings
  try {
    if (sb) {
      const { data, error } = await sb.from('ward_scheduling_settings').select('*').limit(1).single();
      if (!error && data) {
        SCHEDULING_STATE.settings = data;
      }
    } else {
      const localSettings = localStorage.getItem('ward_scheduling_settings');
      if (localSettings) SCHEDULING_STATE.settings = JSON.parse(localSettings);
    }
  } catch (e) {
    console.warn('Error loading settings:', e);
  }

  // 2. Meeting Types
  try {
    if (sb) {
      // Defaults are seeded server-side (schema.sql) rather than from the
      // client — anon can no longer INSERT meeting_types, and schema.sql's
      // own "WHERE NOT EXISTS" seed already guarantees they exist.
      const { data, error } = await sb.from('meeting_types').select('*').order('created_at', { ascending: true });
      if (!error && data && data.length > 0) {
        SCHEDULING_STATE.meetingTypes = data;
        localStorage.setItem('ward_meeting_types', JSON.stringify(data));
      } else {
        SCHEDULING_STATE.meetingTypes = DEFAULT_MEETING_TYPES;
      }
    } else {
      const localTypes = localStorage.getItem('ward_meeting_types');
      SCHEDULING_STATE.meetingTypes = localTypes ? JSON.parse(localTypes) : DEFAULT_MEETING_TYPES;
    }
  } catch (e) {
    console.warn('Error loading meeting types:', e);
    SCHEDULING_STATE.meetingTypes = DEFAULT_MEETING_TYPES;
  }

  // 3. Weekly Availability
  try {
    if (sb) {
      const { data, error } = await sb.from('weekly_availability').select('*').order('day_of_week', { ascending: true });
      if (!error && data && data.length > 0) {
        SCHEDULING_STATE.weeklyAvailability = data;
      } else {
        SCHEDULING_STATE.weeklyAvailability = DEFAULT_WEEKLY_AVAILABILITY;
      }
    } else {
      const localWeekly = localStorage.getItem('ward_weekly_availability');
      SCHEDULING_STATE.weeklyAvailability = localWeekly ? JSON.parse(localWeekly) : DEFAULT_WEEKLY_AVAILABILITY;
    }
  } catch (e) {
    console.warn('Error loading weekly availability:', e);
    SCHEDULING_STATE.weeklyAvailability = DEFAULT_WEEKLY_AVAILABILITY;
  }

  // Keep the "active day" pills in the availability editor in sync with
  // whatever days actually have hours saved (e.g. rows seeded directly in
  // the database) — otherwise a day with real availability can end up with
  // no card/delete button in the admin UI at all, since activeDaysSelected
  // only ever started as a hardcoded [Sunday, Wednesday].
  const daysWithHours = [...new Set(SCHEDULING_STATE.weeklyAvailability.map(s => s.day_of_week))].sort((a, b) => a - b);
  SCHEDULING_STATE.activeDaysSelected = daysWithHours;

  // 4. Date Overrides
  try {
    if (sb) {
      const { data, error } = await sb.from('date_overrides').select('*').order('override_date', { ascending: true });
      if (!error && data) {
        SCHEDULING_STATE.dateOverrides = data;
      }
    } else {
      const localOverrides = localStorage.getItem('ward_date_overrides');
      SCHEDULING_STATE.dateOverrides = localOverrides ? JSON.parse(localOverrides) : DEFAULT_DATE_OVERRIDES;
    }
  } catch (e) {
    console.warn('Error loading date overrides:', e);
    SCHEDULING_STATE.dateOverrides = DEFAULT_DATE_OVERRIDES;
  }

  // 5. Appointments — full records (with attendee PII) require full_access
  // or scheduling_access and come from the authenticated api/admin-data.js
  // (resource:'appointments', action:'admin_feed'), not a direct anon-key
  // Supabase read (anon can only read non-PII columns; see schema.sql's
  // column-level GRANT on appointments).
  try {
    // This function runs on every page load (public visitors included, via
    // the DOMContentLoaded handler) as well as after admin login — only a
    // confirmed full_access/scheduling_access session should ever request
    // the full-PII feed.
    const canViewFullAppointments = SCHEDULING_STATE.currentAdmin && adminCanSchedule(SCHEDULING_STATE.currentAdmin.role);
    if (sb && canViewFullAppointments) {
      const result = await adminApiFetch('/api/admin-data', { resource: 'appointments', action: 'admin_feed' });
      const data = result && result.success ? result.appointments : null;
      if (data) {
        SCHEDULING_STATE.appointments = data.map(a => ({
          ...a,
          meeting_type_title: a.meeting_types ? a.meeting_types.title : 'Appointment'
        }));
      } else {
        SCHEDULING_STATE.appointments = [];
      }
    } else if (sb) {
      // Public visitors and announcements_only admins: non-PII slot data
      // only, readable with the anon key (same query as
      // refreshAppointmentsFromSupabase, used by the booking wizard).
      const { data, error } = await sb.from('appointments').select('id, meeting_type_id, start_time, end_time, status, meeting_types(title)').order('start_time', { ascending: true });
      SCHEDULING_STATE.appointments = (!error && data)
        ? data.map(a => ({ ...a, meeting_type_title: a.meeting_types ? a.meeting_types.title : 'Appointment' }))
        : [];
    } else {
      const localAppointments = localStorage.getItem('ward_appointments');
      if (localAppointments) {
        try {
          const parsed = JSON.parse(localAppointments);
          // Filter out legacy mock test appointments (apt-1, apt-2, apt-3)
          SCHEDULING_STATE.appointments = Array.isArray(parsed) 
            ? parsed.filter(a => a && !['apt-1', 'apt-2', 'apt-3'].includes(a.id))
            : [];
          localStorage.setItem('ward_appointments', JSON.stringify(SCHEDULING_STATE.appointments));
        } catch (_) {
          SCHEDULING_STATE.appointments = [];
        }
      } else {
        SCHEDULING_STATE.appointments = [];
      }
    }
  } catch (e) {
    console.warn('Error loading appointments:', e);
    SCHEDULING_STATE.appointments = [];
  }

  // Render active views
  renderAllAdminViews();
}

/**
 * Render All Sub-Views
 */
function renderAllAdminViews() {
  updateSettingsHeader();
  renderAppointmentsFeed();
  renderMeetingTypesList();
  renderWeeklyAvailabilityEditor();
  renderDateOverridesCalendar();
  renderUpcomingOverridesList();
  renderMyAppointmentsSection();
}

/**
 * Switch Sub-Tab inside Scheduling Admin (Dashboard, Types, Weekly, Overrides)
 */
function switchAdminSubTab(subTabId) {
  // announcements_only admins may only ever land on 'announce', and only
  // full_access may land on 'admins' — defensive client-side guards; the
  // real boundary is each endpoint's server-side requireAdmin() check.
  const admin = SCHEDULING_STATE.currentAdmin;
  const role = admin ? admin.role : 'full_access';
  if (!adminCanSchedule(role) && subTabId !== 'announce') {
    subTabId = 'announce';
  } else if (role !== 'full_access' && subTabId === 'admins') {
    subTabId = 'announce';
  }

  SCHEDULING_STATE.activeSubTab = subTabId;
  const subTabs = ['dashboard', 'announce', 'admins'];

  // Toggle Sub-View Containers
  subTabs.forEach(tab => {
    const el = document.getElementById(`admin-subview-${tab}`);
    if (el) {
      if (tab === subTabId) {
        el.classList.remove('hidden');
        el.classList.add('animate-fade-in');
      } else {
        el.classList.add('hidden');
        el.classList.remove('animate-fade-in');
      }
    }
  });

  // Update Segmented Tab Buttons (Desktop & Tablet)
  subTabs.forEach(tab => {
    const btn = document.getElementById(`subtab-btn-${tab}`);
    if (btn) {
      if (tab === subTabId) {
        btn.className = "flex-1 min-w-0 px-2 sm:px-4 py-2 rounded-xl text-xs font-bold transition-all bg-secondary-container text-on-secondary-container shadow-sm flex items-center justify-center gap-1.5";
      } else {
        btn.className = "flex-1 min-w-0 px-2 sm:px-4 py-2 rounded-xl text-xs font-semibold text-on-surface-variant hover:text-primary transition-all flex items-center justify-center gap-1.5";
      }
    }
  });

  // Update Mini Bottom Navigation (Mobile)
  subTabs.forEach(tab => {
    const mBtn = document.getElementById(`admin-mob-tab-${tab}`);
    if (mBtn) {
      if (tab === subTabId) {
        mBtn.className = "flex flex-col items-center justify-center bg-secondary-container text-on-secondary-container rounded-2xl py-1.5 px-3 font-bold transition-all shadow-sm";
      } else {
        mBtn.className = "flex flex-col items-center justify-center text-on-surface-variant hover:text-primary py-1.5 px-3 transition-all";
      }
    }
  });

  if (subTabId === 'admins') {
    renderAdminUsersList();
  }

  // Re-sync whichever nested Dashboard panel (appointments/types/weekly) was
  // last active, since the Dashboard tab may have been left mid-panel.
  if (subTabId === 'dashboard') {
    switchDashboardPanel(SCHEDULING_STATE.activeDashPanel || 'appointments');
  }

  // Scroll to top of container
  const container = document.getElementById('view-admin-scheduling');
  if (container) window.scrollTo({ top: container.offsetTop - 70, behavior: 'smooth' });
}

/**
 * Switch nested panel inside the Dashboard tab: appointments, meeting types,
 * or availability. These used to be top-level tabs; they now live inside
 * the Dashboard tab to cut down the number of tabs shown.
 */
function switchDashboardPanel(panelId) {
  SCHEDULING_STATE.activeDashPanel = panelId;
  const panels = ['appointments', 'types', 'weekly'];

  panels.forEach((panel) => {
    const el = document.getElementById(`admin-dash-panel-${panel}`);
    if (el) {
      if (panel === panelId) {
        el.classList.remove('hidden');
        el.classList.add('animate-fade-in');
      } else {
        el.classList.add('hidden');
        el.classList.remove('animate-fade-in');
      }
    }
  });

  panels.forEach((panel) => {
    const btn = document.getElementById(`dashtab-btn-${panel}`);
    if (btn) {
      if (panel === panelId) {
        btn.className = "flex-1 min-w-0 px-2 sm:px-4 py-2 rounded-xl text-xs font-bold transition-all bg-white dark:bg-[#2d3137] text-primary dark:text-white shadow-sm flex items-center justify-center gap-1.5";
      } else {
        btn.className = "flex-1 min-w-0 px-2 sm:px-4 py-2 rounded-xl text-xs font-semibold text-on-surface-variant hover:text-primary transition-all flex items-center justify-center gap-1.5";
      }
    }
  });

  // If entering availability, render current active mini-tab
  if (panelId === 'weekly') {
    if (SCHEDULING_STATE.availMiniTab === 'overrides') {
      renderDateOverridesCalendar();
      renderUpcomingOverridesList();
    } else {
      renderWeeklyAvailabilityEditor();
    }
  }
}

function switchAvailabilityMiniTab(mode) {
  SCHEDULING_STATE.availMiniTab = mode;
  const hoursSection = document.getElementById('avail-section-hours');
  const overridesSection = document.getElementById('avail-section-overrides');
  const hoursBtn = document.getElementById('avail-mini-tab-hours');
  const overridesBtn = document.getElementById('avail-mini-tab-overrides');
  const title = document.getElementById('avail-header-title');
  const subtitle = document.getElementById('avail-header-subtitle');

  if (mode === 'hours') {
    if (hoursSection) {
      hoursSection.classList.remove('hidden');
      hoursSection.classList.add('animate-fade-in');
    }
    if (overridesSection) overridesSection.classList.add('hidden');
    if (hoursBtn) hoursBtn.className = "px-3.5 py-1 rounded-full font-bold bg-white dark:bg-[#2d3137] text-primary dark:text-white shadow-sm transition-all";
    if (overridesBtn) overridesBtn.className = "px-3.5 py-1 rounded-full font-medium text-on-surface-variant hover:text-primary transition-all";
    if (title) title.textContent = "Edit Weekly Availability";
    if (subtitle) subtitle.textContent = "Set recurring open hours";
    renderWeeklyAvailabilityEditor();
  } else {
    if (hoursSection) hoursSection.classList.add('hidden');
    if (overridesSection) {
      overridesSection.classList.remove('hidden');
      overridesSection.classList.add('animate-fade-in');
    }
    if (hoursBtn) hoursBtn.className = "px-3.5 py-1 rounded-full font-medium text-on-surface-variant hover:text-primary transition-all";
    if (overridesBtn) overridesBtn.className = "px-3.5 py-1 rounded-full font-bold bg-white dark:bg-[#2d3137] text-primary dark:text-white shadow-sm transition-all";
    if (title) title.textContent = "Date Overrides";
    if (subtitle) subtitle.textContent = "Block dates or set special hours for specific calendar days";
    renderDateOverridesCalendar();
    renderUpcomingOverridesList();
  }
}

/**
 * ------------------------------------------------------------
 * 1. DASHBOARD OVERVIEW & APPOINTMENTS FEED
 * ------------------------------------------------------------
 */
function updateSettingsHeader() {
  const acceptingToggle = document.getElementById('toggle-accepting-appointments');
  if (acceptingToggle) {
    acceptingToggle.checked = SCHEDULING_STATE.settings.accepting_appointments !== false;
  }
  const tzLabel = document.getElementById('weekly-timezone-label');
  if (tzLabel) {
    const tz = SCHEDULING_STATE.settings.timezone || 'America/Denver';
    tzLabel.textContent = tz === 'America/Denver' ? 'Mountain Time - US & Canada (America/Denver)' : tz;
  }
}

async function handleToggleAcceptingAppointments(e) {
  const isAccepting = e.target.checked;
  SCHEDULING_STATE.settings.accepting_appointments = isAccepting;
  localStorage.setItem('ward_scheduling_settings', JSON.stringify(SCHEDULING_STATE.settings));

  const sb = SCHEDULING_STATE.supabaseClient;
  if (sb && SCHEDULING_STATE.settings.id) {
    await adminApiFetch('/api/admin-data', { resource: 'settings', id: SCHEDULING_STATE.settings.id, accepting_appointments: isAccepting });
  }

  showToast(isAccepting ? 'Ward is accepting appointments' : 'Appointments paused', isAccepting ? 'check_circle' : 'pause_circle');
}

function renderAppointmentsFeed() {
  const container = document.getElementById('admin-appointments-feed');
  if (!container) return;

  const apts = SCHEDULING_STATE.appointments || [];
  if (apts.length === 0) {
    container.innerHTML = `
      <div class="p-8 text-center bg-surface-container-low rounded-2xl border border-outline-variant/30 flex flex-col items-center gap-2">
        <span class="material-symbols-outlined text-4xl text-on-surface-variant/40">event_available</span>
        <p class="text-sm font-medium text-on-surface-variant">No appointments booked yet.</p>
      </div>
    `;
    return;
  }

  const now = new Date();
  const todayDateStr = now.toDateString();
  const tomorrow = new Date();
  tomorrow.setDate(now.getDate() + 1);
  const tomorrowDateStr = tomorrow.toDateString();

  // Group appointments by date (past appointments live in the separate
  // "Past Appointments" collapsible section instead — see renderPastAppointmentsFeed)
  const grouped = {};
  apts.forEach(apt => {
    const aptDate = new Date(apt.start_time);
    const aptEndDate = new Date(apt.end_time || apt.start_time);
    if (aptEndDate < now) return;

    let groupKey = aptDate.toDateString();

    if (groupKey === todayDateStr) {
      groupKey = 'Today';
    } else if (groupKey === tomorrowDateStr) {
      groupKey = 'Tomorrow';
    } else {
      groupKey = aptDate.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
    }

    if (!grouped[groupKey]) grouped[groupKey] = [];
    grouped[groupKey].push(apt);
  });

  if (Object.keys(grouped).length === 0) {
    container.innerHTML = `
      <div class="p-6 text-center bg-surface-container-low rounded-2xl border border-outline-variant/30">
        <p class="text-sm text-on-surface-variant">No upcoming appointments.</p>
      </div>
    `;
  } else {
    let html = '';
    for (const [dateLabel, list] of Object.entries(grouped)) {
      html += `
        <div class="flex flex-col gap-2.5">
          <span class="text-xs font-mono font-bold uppercase tracking-wider text-on-surface-variant px-1">${escapeHtml(dateLabel)}</span>
          <div class="flex flex-col gap-2.5">
            ${list.map(apt => renderAppointmentCard(apt)).join('')}
          </div>
        </div>
      `;
    }
    container.innerHTML = html;
  }

  renderPastAppointmentsFeed();
}

/**
 * Render the collapsible "Past Appointments" section on the admin dashboard.
 * Only actually draws the list into the DOM when expanded; while collapsed
 * it just keeps the count badge up to date.
 */
function renderPastAppointmentsFeed() {
  const countBadge = document.getElementById('past-appointments-count');
  const section = document.getElementById('admin-past-appointments-section');
  const container = document.getElementById('admin-past-appointments-feed');
  if (!container) return;

  const now = new Date();
  const apts = (SCHEDULING_STATE.appointments || [])
    .filter(apt => new Date(apt.end_time || apt.start_time) < now)
    .sort((a, b) => new Date(b.start_time) - new Date(a.start_time));

  if (countBadge) countBadge.textContent = apts.length;
  if (section) section.classList.toggle('hidden', apts.length === 0);

  // Skip re-rendering the list while it's collapsed — nothing to save, but
  // avoids doing the work on every booking/cancel until an admin actually opens it.
  if (container.classList.contains('hidden')) return;

  if (apts.length === 0) {
    container.innerHTML = `
      <div class="p-6 text-center bg-surface-container-low rounded-2xl border border-outline-variant/30">
        <p class="text-sm text-on-surface-variant">No past appointments yet.</p>
      </div>
    `;
    return;
  }

  const grouped = {};
  apts.forEach(apt => {
    const groupKey = new Date(apt.start_time).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' });
    if (!grouped[groupKey]) grouped[groupKey] = [];
    grouped[groupKey].push(apt);
  });

  let html = '';
  for (const [dateLabel, list] of Object.entries(grouped)) {
    html += `
      <div class="flex flex-col gap-2.5">
        <span class="text-xs font-mono font-bold uppercase tracking-wider text-on-surface-variant px-1">${escapeHtml(dateLabel)}</span>
        <div class="flex flex-col gap-2.5">
          ${list.map(apt => renderAppointmentCard(apt)).join('')}
        </div>
      </div>
    `;
  }
  container.innerHTML = html;
}

/**
 * Toggle the "Past Appointments" dropdown open/closed on the admin dashboard.
 */
function togglePastAppointments() {
  const container = document.getElementById('admin-past-appointments-feed');
  const chevron = document.getElementById('past-appointments-chevron');
  if (!container) return;

  container.classList.toggle('hidden');
  const isOpen = !container.classList.contains('hidden');

  if (chevron) chevron.style.transform = isOpen ? 'rotate(180deg)' : 'rotate(0deg)';
  if (isOpen) renderPastAppointmentsFeed();
}

function renderAppointmentCard(apt) {
  const startDate = new Date(apt.start_time);
  const timeFormatted = startDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });

  return `
    <div onclick="openAppointmentDetailsModal('${escapeHtml(apt.id)}')" class="bg-surface-container-lowest card-shadow rounded-2xl p-4 sm:p-5 border border-surface-blue-tint flex items-center justify-between gap-3 hover:border-primary/50 hover:bg-surface-blue-tint/20 transition-all cursor-pointer group active:scale-[0.99]">
      <div class="flex items-start gap-3.5">
        <div class="w-10 h-10 rounded-xl bg-surface-blue-tint text-primary flex items-center justify-center shrink-0 mt-0.5 group-hover:scale-105 transition-transform">
          <span class="material-symbols-outlined text-2xl">person</span>
        </div>
        <div class="flex flex-col">
          <span class="font-headline font-bold text-base text-primary">${escapeHtml(apt.attendee_name)}</span>
          <span class="text-xs font-medium text-on-surface-variant">${escapeHtml(apt.meeting_type_title || 'Meeting')}</span>
          <div class="flex items-center gap-3 mt-1.5 text-xs font-mono text-on-surface-variant flex-wrap">
            <span class="flex items-center gap-1 text-primary font-semibold">
              <span class="material-symbols-outlined text-[15px]">schedule</span>
              ${timeFormatted}
            </span>
            ${apt.attendee_email ? `<span class="flex items-center gap-1"><span class="material-symbols-outlined text-[14px]">mail</span>${escapeHtml(apt.attendee_email)}</span>` : ''}
            ${apt.notes ? `<span class="text-[11px] italic bg-surface-container px-2 py-0.5 rounded-md truncate max-w-xs">&ldquo;${escapeHtml(apt.notes)}&rdquo;</span>` : ''}
          </div>
        </div>
      </div>
      <div class="flex items-center gap-1 shrink-0 text-on-surface-variant group-hover:text-primary transition-colors">
        <span class="material-symbols-outlined text-[24px] group-hover:translate-x-1 transition-transform">chevron_right</span>
      </div>
    </div>
  `;
}

function openAppointmentDetailsModal(aptId) {
  SCHEDULING_STATE.selectedAppointmentId = aptId;
  const apt = (SCHEDULING_STATE.appointments || []).find(a => a.id === aptId || String(a.id) === String(aptId)) ||
              (typeof DEFAULT_APPOINTMENTS !== 'undefined' ? DEFAULT_APPOINTMENTS.find(a => a.id === aptId || String(a.id) === String(aptId)) : null);
  if (!apt) return;

  const modalBody = document.getElementById('appointment-modal-body');
  if (!modalBody) return;

  const start = new Date(apt.start_time);
  const end = new Date(apt.end_time);

  modalBody.innerHTML = `
    <div class="flex flex-col gap-3.5 text-sm">
      <div class="p-4 bg-surface-blue-tint rounded-2xl border border-surface-blue-tint flex flex-col gap-1">
        <span class="font-headline font-bold text-lg text-primary">${escapeHtml(apt.attendee_name)}</span>
        <span class="font-mono text-xs text-primary/80">${escapeHtml(apt.meeting_type_title || 'Appointment')}</span>
      </div>
      <div class="p-3 bg-surface-container-low rounded-xl border border-outline-variant/30 text-xs">
        <span class="font-mono text-on-surface-variant block uppercase text-[10px] mb-0.5">Email Address</span>
        <a href="mailto:${escapeHtml(apt.attendee_email)}" class="font-semibold text-primary underline text-sm">${escapeHtml(apt.attendee_email)}</a>
      </div>
      <div class="p-3 bg-surface-container-low rounded-xl border border-outline-variant/30 text-xs">
        <span class="font-mono text-on-surface-variant block uppercase text-[10px] mb-0.5">Scheduled Time</span>
        <span class="font-semibold text-on-surface text-xs sm:text-sm">${start.toLocaleString('en-US', { dateStyle: 'full', timeStyle: 'short' })} – ${end.toLocaleTimeString('en-US', { timeStyle: 'short' })}</span>
      </div>
      ${apt.notes ? `
        <div class="p-3 bg-surface-container rounded-xl text-xs">
          <span class="font-mono font-bold text-on-surface-variant block text-[10px] uppercase mb-0.5">Attendee Notes</span>
          <p class="text-on-surface">${escapeHtml(apt.notes)}</p>
        </div>
      ` : ''}
    </div>
  `;

  openModal('appointment-details-modal');
}


async function handleCancelSelectedMeetingAdmin() {
  const aptId = SCHEDULING_STATE.selectedAppointmentId;
  const apt = (SCHEDULING_STATE.appointments || []).find(a => a.id === aptId || String(a.id) === String(aptId)) ||
              (typeof DEFAULT_APPOINTMENTS !== 'undefined' ? DEFAULT_APPOINTMENTS.find(a => a.id === aptId || String(a.id) === String(aptId)) : null);
  if (!apt) return;

  closeModal('manage-meeting-modal');
  closeModal('appointment-details-modal');

  const detailsEl = document.getElementById('cancel-appointment-modal-details');
  if (detailsEl) {
    const startDate = new Date(apt.start_time);
    const dateFormatted = !isNaN(startDate.getTime())
      ? startDate.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })
      : (apt.start_time || '');

    detailsEl.innerHTML = `
      <div class="font-bold text-primary dark:text-white text-sm">${escapeHtml(apt.attendee_name)}</div>
      <div class="text-on-surface-variant font-mono font-semibold text-xs">${escapeHtml(apt.meeting_type_title || 'Appointment')}</div>
      <div class="text-on-surface-variant font-mono text-[11px]">${escapeHtml(dateFormatted)}</div>
      <div class="text-primary underline text-[11px] truncate">${escapeHtml(apt.attendee_email)}</div>
    `;
  }

  openModal('cancel-appointment-modal');
}

async function executeConfirmedAppointmentCancellation() {
  const aptId = SCHEDULING_STATE.selectedAppointmentId;
  if (!aptId) return;

  const btn = document.getElementById('btn-confirm-cancel-appointment');
  const originalContent = btn ? btn.innerHTML : '';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<span class="material-symbols-outlined animate-spin text-[16px]">progress_activity</span><span>Cancelling...</span>`;
  }

  try {
    closeModal('cancel-appointment-modal');
    await handleCancelAppointmentAdmin(aptId);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = originalContent;
    }
  }
}

async function handleRescheduleMeetingAdmin() {
  const aptId = SCHEDULING_STATE.selectedAppointmentId;
  const apt = (SCHEDULING_STATE.appointments || []).find(a => a.id === aptId || String(a.id) === String(aptId));
  if (!apt) return;

  // 1. Close modals
  closeModal('manage-meeting-modal');
  closeModal('appointment-details-modal');

  // 2. Set rescheduling context
  PUBLIC_BOOKING_STATE.reschedulingAppointment = apt;

  // 3. Match meeting type
  const types = (SCHEDULING_STATE.meetingTypes && SCHEDULING_STATE.meetingTypes.length > 0)
    ? SCHEDULING_STATE.meetingTypes
    : DEFAULT_MEETING_TYPES;

  const foundType = types.find(t => t.id === apt.meeting_type_id) ||
                    types.find(t => (t.title || '').toLowerCase() === (apt.meeting_type_title || '').toLowerCase()) ||
                    types[0];

  PUBLIC_BOOKING_STATE.selectedTypeId = foundType ? foundType.id : types[0].id;
  PUBLIC_BOOKING_STATE.selectedType = foundType || types[0];
  PUBLIC_BOOKING_STATE.selectedDate = null;
  PUBLIC_BOOKING_STATE.selectedSlotTime = null;

  // 4. Pre-fill attendee contact info in Step 4
  const nameInput = document.getElementById('booking-input-name');
  const emailInput = document.getElementById('booking-input-email');
  const phoneInput = document.getElementById('booking-input-phone');
  const notesInput = document.getElementById('booking-input-notes');

  if (nameInput) nameInput.value = apt.attendee_name || '';
  if (emailInput) emailInput.value = apt.attendee_email || '';
  if (phoneInput) phoneInput.value = apt.attendee_phone || '';
  if (notesInput) notesInput.value = apt.notes || '';

  // 5. Navigate to schedule tab
  if (typeof navigateTab === 'function') {
    navigateTab('schedule');
  } else {
    window.location.hash = 'schedule';
  }

  // 6. Jump straight to Step 2 (Select Date & Time)
  goToBookingStep(2);

  showToast(`Rescheduling for ${apt.attendee_name}. Please pick a new date and time.`, 'info');
}

/**
 * Admin: start booking a new appointment with the Bishop on behalf of
 * someone else (e.g. a member who called or stopped by in person).
 * Reuses the same public booking wizard, just entered from the dashboard.
 */
function handleAdminBookForSomeone() {
  PUBLIC_BOOKING_STATE.reschedulingAppointment = null;
  PUBLIC_BOOKING_STATE.adminBookingMode = true;
  PUBLIC_BOOKING_STATE.selectedTypeId = null;
  PUBLIC_BOOKING_STATE.selectedType = null;
  PUBLIC_BOOKING_STATE.selectedDate = null;
  PUBLIC_BOOKING_STATE.selectedSlotTime = null;

  if (typeof navigateTab === 'function') {
    navigateTab('schedule');
  } else {
    window.location.hash = 'schedule';
  }

  // Don't carry over this device's own saved member identity (name/email) —
  // initPublicBookingUI() may have just prefilled them from localStorage.
  const nameInput = document.getElementById('booking-input-name');
  const emailInput = document.getElementById('booking-input-email');
  const phoneInput = document.getElementById('booking-input-phone');
  const notesInput = document.getElementById('booking-input-notes');
  if (nameInput) nameInput.value = '';
  if (emailInput) emailInput.value = '';
  if (phoneInput) phoneInput.value = '';
  if (notesInput) notesInput.value = '';

  goToBookingStep(1);
  showToast('Booking a meeting with the Bishop for someone else.', 'info');
}

/**
 * Admin: abandon the "book for someone else" flow and return to the dashboard.
 */
function cancelAdminBooking() {
  PUBLIC_BOOKING_STATE.adminBookingMode = false;
  PUBLIC_BOOKING_STATE.selectedType = null;
  PUBLIC_BOOKING_STATE.selectedTypeId = null;
  PUBLIC_BOOKING_STATE.selectedDate = null;
  PUBLIC_BOOKING_STATE.selectedSlotTime = null;

  if (typeof navigateTab === 'function') {
    navigateTab('admin-scheduling');
  } else {
    window.location.hash = 'admin-scheduling';
  }
}

async function handleCancelAppointmentAdmin(aptId) {
  const cancelledApt = (SCHEDULING_STATE.appointments || []).find(a => a.id === aptId || String(a.id) === String(aptId));
  const aptIndex = (SCHEDULING_STATE.appointments || []).findIndex(a => a.id === aptId || String(a.id) === String(aptId));
  if (aptIndex !== -1) {
    SCHEDULING_STATE.appointments.splice(aptIndex, 1);
    localStorage.setItem('ward_appointments', JSON.stringify(SCHEDULING_STATE.appointments));
  }

  const sb = SCHEDULING_STATE.supabaseClient;
  if (sb) {
    const isUUID = (str) => typeof str === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
    if (isUUID(aptId)) {
      const result = await adminApiFetch('/api/admin-data', { resource: 'appointments', action: 'cancel', id: aptId });
      if (result && result.success) {
        console.log('Successfully deleted appointment from Supabase:', aptId);
      }
    }

    // Send cancellation email via Vercel API route
    if (cancelledApt) {
      try {
        await sendAppointmentEmail('cancel', cancelledApt);
      } catch (fnEx) {
        console.warn('Error sending cancellation email:', fnEx);
      }

      // Remove the matching event from the bishop's Google Calendar
      try {
        await syncAppointmentToGoogleCalendar('delete', cancelledApt);
      } catch (calEx) {
        console.warn('Error removing appointment from Google Calendar:', calEx);
      }
    }
  }

  showToast('Meeting cancelled and deleted from database.', 'delete');
  renderAppointmentsFeed();
  renderMyAppointmentsSection();
}

function formatMeetingDescription(desc) {
  if (!desc) return '';
  const escaped = escapeHtml(desc);
  // Convert URLs into clickable links
  return escaped.replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer" class="text-primary dark:text-primary-fixed underline font-semibold hover:opacity-80 break-all" onclick="event.stopPropagation()">$1</a>');
}

/**
 * ------------------------------------------------------------
 * 2. MEETING TYPES MANAGER
 * ------------------------------------------------------------
 */
function renderMeetingTypesList() {
  const container = document.getElementById('admin-meeting-types-list');
  const previewContainer = document.getElementById('dashboard-meeting-types-preview');
  
  const types = SCHEDULING_STATE.meetingTypes || [];

  const renderItem = (type) => `
    <div class="bg-surface-container-lowest card-shadow rounded-2xl p-4 sm:p-5 border border-surface-blue-tint flex flex-col sm:flex-row sm:items-center justify-between gap-4 group hover:border-primary/40 transition-all">
      <div class="flex items-start gap-3.5">
        <div class="w-11 h-11 rounded-xl bg-primary-container text-white flex items-center justify-center shrink-0 shadow-sm mt-0.5">
          <span class="material-symbols-outlined text-2xl">calendar_add_on</span>
        </div>
        <div class="flex flex-col gap-1 max-w-xl">
          <div class="flex items-center gap-2 flex-wrap">
            <h4 class="font-headline font-bold text-base text-primary">${escapeHtml(type.title)}</h4>
            <span class="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-surface-container text-on-surface-variant">
              ${type.duration_minutes} mins
            </span>
            ${type.buffer_minutes ? `<span class="px-2 py-0.5 rounded-full text-[10px] font-mono bg-surface-blue-tint text-primary">+${type.buffer_minutes}m buffer</span>` : ''}
          </div>
          ${type.description ? `<p class="text-xs text-on-surface-variant whitespace-pre-line leading-relaxed">${formatMeetingDescription(type.description)}</p>` : ''}
        </div>
      </div>
      <div class="flex items-center gap-2 self-end sm:self-center">
        <!-- Active switch -->
        <label class="relative inline-flex items-center cursor-pointer mr-2" title="Toggle Active">
          <input type="checkbox" ${type.is_active !== false ? 'checked' : ''} onchange="handleToggleMeetingTypeActive('${escapeHtml(type.id)}', this.checked)" class="sr-only peer">
          <div class="w-9 h-5 bg-outline-variant/50 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-secondary-container"></div>
        </label>
        <button onclick="openEditMeetingTypeModal('${escapeHtml(type.id)}')" class="p-2 rounded-xl text-on-surface-variant hover:text-primary hover:bg-surface-container transition-all" title="Edit">
          <span class="material-symbols-outlined text-[20px]">edit</span>
        </button>
        <button onclick="openDeleteMeetingTypeModal('${escapeHtml(type.id)}')" class="p-2 rounded-xl text-on-surface-variant hover:text-error hover:bg-error-container/20 transition-all" title="Delete">
          <span class="material-symbols-outlined text-[20px]">delete</span>
        </button>
      </div>
    </div>
  `;

  if (container) {
    if (types.length === 0) {
      container.innerHTML = `<div class="p-8 text-center bg-surface-container-low rounded-2xl"><p class="text-sm text-on-surface-variant">No meeting types yet. Create your first one!</p></div>`;
    } else {
      container.innerHTML = types.map(renderItem).join('');
    }
  }

  if (previewContainer) {
    previewContainer.innerHTML = types.slice(0, 4).map(t => `
      <div class="flex items-center justify-between p-3 bg-surface-container-low rounded-xl border border-outline-variant/20">
        <div class="flex flex-col">
          <span class="font-headline font-bold text-xs text-primary">${escapeHtml(t.title)}</span>
          <span class="font-mono text-[10px] text-on-surface-variant">${t.duration_minutes}m</span>
        </div>
        <span class="w-2.5 h-2.5 rounded-full ${t.is_active !== false ? 'bg-success-green' : 'bg-outline-variant'}"></span>
      </div>
    `).join('');
  }
}

function openCreateMeetingTypeModal() {
  document.getElementById('meeting-type-form').reset();
  document.getElementById('mt-modal-id').value = '';
  document.getElementById('mt-modal-title-header').textContent = 'New Meeting Type';
  const delBtn = document.getElementById('btn-delete-from-edit-mt');
  if (delBtn) delBtn.classList.add('hidden');
  openModal('meeting-type-modal');
}

function openEditMeetingTypeModal(typeId) {
  const type = SCHEDULING_STATE.meetingTypes.find(t => t.id === typeId);
  if (!type) return;

  document.getElementById('mt-modal-id').value = type.id;
  document.getElementById('mt-modal-title').value = type.title || '';
  document.getElementById('mt-modal-desc').value = type.description || '';
  document.getElementById('mt-modal-duration').value = type.duration_minutes || 15;
  document.getElementById('mt-modal-buffer').value = type.buffer_minutes || 0;
  const assignedInput = document.getElementById('mt-modal-assigned');
  if (assignedInput) assignedInput.value = type.assigned_to || '';
  document.getElementById('mt-modal-active').checked = type.is_active !== false;

  const delBtn = document.getElementById('btn-delete-from-edit-mt');
  if (delBtn) delBtn.classList.remove('hidden');

  document.getElementById('mt-modal-title-header').textContent = 'Edit Meeting Type';
  openModal('meeting-type-modal');
}

function handleDeleteFromEditModal() {
  const id = document.getElementById('mt-modal-id').value;
  if (!id) return;
  closeModal('meeting-type-modal');
  openDeleteMeetingTypeModal(id);
}

let pendingDeleteMeetingTypeId = null;

function openDeleteMeetingTypeModal(typeId) {
  const type = (SCHEDULING_STATE.meetingTypes || []).find(t => t.id === typeId || String(t.id) === String(typeId));
  if (!type) return;

  pendingDeleteMeetingTypeId = type.id;

  const detailsEl = document.getElementById('delete-meeting-type-modal-details');
  if (detailsEl) {
    detailsEl.innerHTML = `
      <div class="font-bold text-primary dark:text-white text-sm">${escapeHtml(type.title)}</div>
      <div class="text-on-surface-variant font-mono text-[11px]">${type.duration_minutes} minutes duration ${type.buffer_minutes ? `(+${type.buffer_minutes}m buffer)` : ''}</div>
      ${type.description ? `<div class="text-on-surface-variant text-[11px] line-clamp-2">${escapeHtml(type.description)}</div>` : ''}
    `;
  }

  openModal('delete-meeting-type-modal');
}

async function executeConfirmedMeetingTypeDeletion() {
  const typeId = pendingDeleteMeetingTypeId;
  if (!typeId) return;

  const btn = document.getElementById('btn-confirm-delete-meeting-type');
  const originalContent = btn ? btn.innerHTML : '';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<span class="material-symbols-outlined animate-spin text-[16px]">progress_activity</span><span>Deleting...</span>`;
  }

  try {
    closeModal('delete-meeting-type-modal');
    await handleDeleteMeetingType(typeId);
  } finally {
    pendingDeleteMeetingTypeId = null;
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = originalContent;
    }
  }
}

async function handleSaveMeetingTypeForm(event) {
  event.preventDefault();
  const id = document.getElementById('mt-modal-id').value;
  const title = document.getElementById('mt-modal-title').value.trim();
  const description = document.getElementById('mt-modal-desc').value.trim();
  const duration_minutes = parseInt(document.getElementById('mt-modal-duration').value, 10) || 15;
  const buffer_minutes = parseInt(document.getElementById('mt-modal-buffer').value, 10) || 0;
  const assignedInput = document.getElementById('mt-modal-assigned');
  const existingType = id ? SCHEDULING_STATE.meetingTypes.find(t => t.id === id) : null;
  const assigned_to = assignedInput ? assignedInput.value : (existingType ? existingType.assigned_to : null);
  const is_active = document.getElementById('mt-modal-active').checked;

  if (!title) return;

  const sb = SCHEDULING_STATE.supabaseClient;
  const typePayload = {
    title,
    description,
    duration_minutes,
    buffer_minutes,
    assigned_to,
    is_active
  };

  if (id) {
    // Update existing
    const idx = SCHEDULING_STATE.meetingTypes.findIndex(t => t.id === id);
    if (idx !== -1) {
      SCHEDULING_STATE.meetingTypes[idx] = { ...SCHEDULING_STATE.meetingTypes[idx], ...typePayload };
    }
    if (sb) {
      await adminApiFetch('/api/admin-data', { resource: 'meeting_types', action: 'update', id, ...typePayload });
    }
    showToast('Meeting type updated!', 'check_circle');
  } else {
    // Create new
    const newId = 'mt-' + Date.now();
    const newRecord = { id: newId, ...typePayload, created_at: new Date().toISOString() };
    SCHEDULING_STATE.meetingTypes.push(newRecord);

    if (sb) {
      const result = await adminApiFetch('/api/admin-data', { resource: 'meeting_types', action: 'create', ...typePayload });
      if (result && result.success && result.meeting_type) {
        newRecord.id = result.meeting_type.id;
      }
    }
    showToast('Meeting type created!', 'add_circle');
  }

  localStorage.setItem('ward_meeting_types', JSON.stringify(SCHEDULING_STATE.meetingTypes));
  closeModal('meeting-type-modal');
  renderMeetingTypesList();
  if (typeof renderPublicMeetingTypes === 'function') {
    renderPublicMeetingTypes();
  }
}

async function handleToggleMeetingTypeActive(typeId, isActive) {
  const type = SCHEDULING_STATE.meetingTypes.find(t => t.id === typeId);
  if (type) {
    type.is_active = isActive;
    localStorage.setItem('ward_meeting_types', JSON.stringify(SCHEDULING_STATE.meetingTypes));
  }

  const sb = SCHEDULING_STATE.supabaseClient;
  if (sb) {
    await adminApiFetch('/api/admin-data', { resource: 'meeting_types', action: 'toggle_active', id: typeId, is_active: isActive });
  }

  showToast(isActive ? 'Meeting type enabled' : 'Meeting type disabled', 'check');
}

async function handleDeleteMeetingType(typeId) {
  const isUUID = (str) => typeof str === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);

  // 1. Delete from Supabase if connected
  const sb = SCHEDULING_STATE.supabaseClient;
  if (sb) {
    if (isUUID(typeId)) {
      const result = await adminApiFetch('/api/admin-data', { resource: 'meeting_types', action: 'delete', id: typeId });
      if (!result || !result.success) return;
      console.log('Successfully deleted meeting type from Supabase:', typeId);
    }
  }

  // 2. Remove locally
  const idx = SCHEDULING_STATE.meetingTypes.findIndex(t => t.id === typeId || String(t.id) === String(typeId));
  if (idx !== -1) {
    SCHEDULING_STATE.meetingTypes.splice(idx, 1);
    localStorage.setItem('ward_meeting_types', JSON.stringify(SCHEDULING_STATE.meetingTypes));
  }

  showToast('Meeting type deleted', 'delete');
  renderMeetingTypesList();
  if (typeof renderPublicMeetingTypes === 'function') {
    renderPublicMeetingTypes();
  }
}

/**
 * ------------------------------------------------------------
 * ADMINS TAB — manage other admin accounts (full_access only;
 * server-side enforced by api/admin-users-*.js's requireAdmin check).
 * Mirrors the meeting-type modal pattern above.
 * ------------------------------------------------------------
 */
let pendingDeleteAdminId = null;

async function renderAdminUsersList() {
  const container = document.getElementById('admin-users-list');
  if (!container) return;

  container.innerHTML = `<div class="p-6 text-center text-sm text-on-surface-variant">Loading admins…</div>`;

  const result = await adminApiFetch('/api/admin-users', { action: 'list' });
  const admins = result && result.success ? result.admins : [];

  if (!admins || admins.length === 0) {
    container.innerHTML = `<div class="p-6 text-center bg-surface-container-low rounded-2xl"><p class="text-sm text-on-surface-variant">No admins found.</p></div>`;
    return;
  }

  const currentId = SCHEDULING_STATE.currentAdmin && SCHEDULING_STATE.currentAdmin.id;

  const roleBadgeClasses = {
    full_access: 'bg-emerald-100 text-emerald-800',
    scheduling_access: 'bg-blue-100 text-blue-800',
    announcements_only: 'bg-secondary-container text-on-secondary-container',
  };

  container.innerHTML = admins.map(admin => {
    const roleLabel = adminRoleLabel(admin.role);
    const created = admin.created_at ? new Date(admin.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
    const isSelf = admin.id === currentId;

    return `
      <div class="bg-surface-container-lowest card-shadow rounded-2xl p-4 border border-surface-blue-tint flex items-center justify-between gap-3">
        <div class="flex items-center gap-3 min-w-0">
          <div class="w-10 h-10 rounded-xl bg-surface-blue-tint text-primary flex items-center justify-center shrink-0">
            <span class="material-symbols-outlined text-[20px]">person</span>
          </div>
          <div class="flex flex-col min-w-0">
            <span class="font-headline font-bold text-sm text-primary truncate">${escapeHtml(admin.email)}${isSelf ? ' <span class="text-on-surface-variant font-normal">(you)</span>' : ''}</span>
            <div class="mt-0.5 flex items-center gap-2 flex-wrap">
              <span class="px-2.5 py-0.5 rounded-full text-xs font-mono font-bold ${roleBadgeClasses[admin.role] || 'bg-secondary-container text-on-secondary-container'}">${roleLabel}</span>
              ${admin.status === 'pending' ? `<span class="px-2.5 py-0.5 rounded-full text-xs font-mono font-bold bg-amber-100 text-amber-800">Pending Invite</span>` : ''}
              ${created ? `<span class="text-xs text-on-surface-variant">Added ${created}</span>` : ''}
            </div>
          </div>
        </div>
        <div class="flex items-center gap-1 shrink-0">
          <button onclick="openEditAdminModal('${escapeHtml(admin.id)}', '${escapeHtml(admin.email)}', '${escapeHtml(admin.role)}')" class="p-2 rounded-xl text-on-surface-variant hover:text-primary hover:bg-surface-blue-tint transition-all" title="Edit permission level">
            <span class="material-symbols-outlined text-[20px]">edit</span>
          </button>
          <button onclick="openDeleteAdminModal('${escapeHtml(admin.id)}', '${escapeHtml(admin.email)}')" class="p-2 rounded-xl text-on-surface-variant hover:text-error hover:bg-error-container/20 transition-all" title="Remove admin">
            <span class="material-symbols-outlined text-[20px]">delete</span>
          </button>
        </div>
      </div>
    `;
  }).join('');
}

// Tracks whether the shared admin-user-modal is creating a new invite or
// editing an existing admin's permission level — null means "create".
let editingAdminId = null;

function openCreateAdminModal() {
  editingAdminId = null;
  const form = document.getElementById('admin-user-form');
  if (form) form.reset();

  const emailInput = document.getElementById('admin-user-modal-email');
  if (emailInput) emailInput.disabled = false;

  document.getElementById('admin-user-modal-title').textContent = 'Invite Admin';
  document.getElementById('admin-user-modal-subtitle').textContent = "They'll get an email with a link to set their own password.";
  document.getElementById('admin-user-modal-submit').textContent = 'Send Invite';

  openModal('admin-user-modal');
}

function openEditAdminModal(adminId, email, role) {
  editingAdminId = adminId;
  const form = document.getElementById('admin-user-form');
  if (form) form.reset();

  const emailInput = document.getElementById('admin-user-modal-email');
  if (emailInput) {
    emailInput.value = email;
    emailInput.disabled = true;
  }
  document.getElementById('admin-user-modal-role').value = role;

  document.getElementById('admin-user-modal-title').textContent = 'Edit Admin Access';
  document.getElementById('admin-user-modal-subtitle').textContent = `Change the permission level for ${email}.`;
  document.getElementById('admin-user-modal-submit').textContent = 'Save Changes';

  openModal('admin-user-modal');
}

async function handleSaveAdminUserForm(event) {
  event.preventDefault();
  const role = document.getElementById('admin-user-modal-role').value;
  if (!role) return;

  if (editingAdminId) {
    const result = await adminApiFetch('/api/admin-users', { action: 'update', id: editingAdminId, role });
    if (result && result.success) {
      closeModal('admin-user-modal');
      showToast('Admin access updated', 'check_circle');
      renderAdminUsersList();
    }
    return;
  }

  const email = document.getElementById('admin-user-modal-email').value.trim();
  if (!email) return;

  const result = await adminApiFetch('/api/admin-users', { action: 'create', email, role });
  if (result && result.success) {
    closeModal('admin-user-modal');
    renderAdminUsersList();
    if (result.emailSent) {
      showToast(`Invite sent to ${email}`, 'mail');
    } else {
      // Email sending isn't configured/failed — surface the link directly
      // so the inviting admin can share it manually instead of losing it.
      window.alert(`Couldn't send the invite email. Share this link with ${email} manually:\n\n${result.inviteUrl}`);
    }
  }
}

function openDeleteAdminModal(adminId, email) {
  pendingDeleteAdminId = adminId;
  const detailsEl = document.getElementById('delete-admin-modal-details');
  if (detailsEl) {
    detailsEl.innerHTML = `<div class="font-bold text-primary dark:text-white text-sm">${escapeHtml(email)}</div>`;
  }
  openModal('delete-admin-modal');
}

async function executeConfirmedAdminDeletion() {
  if (!pendingDeleteAdminId) return;
  const result = await adminApiFetch('/api/admin-users', { action: 'delete', id: pendingDeleteAdminId });
  closeModal('delete-admin-modal');
  if (result && result.success) {
    showToast('Admin removed', 'delete');
    renderAdminUsersList();
  }
  pendingDeleteAdminId = null;
}

/**
 * ------------------------------------------------------------
 * 3. WEEKLY RECURRING AVAILABILITY EDITOR & TIME PICKER
 * ------------------------------------------------------------
 */
const DAYS_OF_WEEK = [
  { day: 0, label: 'Sun', full: 'Sundays' },
  { day: 1, label: 'Mon', full: 'Mondays' },
  { day: 2, label: 'Tue', full: 'Tuesdays' },
  { day: 3, label: 'Wed', full: 'Wednesdays' },
  { day: 4, label: 'Thu', full: 'Thursdays' },
  { day: 5, label: 'Fri', full: 'Fridays' },
  { day: 6, label: 'Sat', full: 'Saturdays' }
];

const TIME_PICKER_STATE = {
  slotId: null,
  dayNum: null,
  isStartMode: true,
  start: { hour: 10, minute: 0, period: 'AM' },
  end: { hour: 10, minute: 45, period: 'AM' }
};

function formatTime12h(timeStr) {
  if (!timeStr) return '10:00 AM';
  const parts = timeStr.split(':');
  let h = parseInt(parts[0], 10);
  const m = parts[1] || '00';
  const period = h >= 12 ? 'PM' : 'AM';
  if (h === 0) h = 12;
  else if (h > 12) h -= 12;
  return `${h}:${m.padStart(2, '0')} ${period}`;
}

function parseTime24hToParts(timeStr) {
  if (!timeStr) return { hour: 10, minute: 0, period: 'AM' };
  const parts = timeStr.split(':');
  let h = parseInt(parts[0], 10);
  const m = parseInt(parts[1] || '0', 10);
  const period = h >= 12 ? 'PM' : 'AM';
  if (h === 0) h = 12;
  else if (h > 12) h -= 12;
  return { hour: h, minute: m, period };
}

function partsTo24h(hour, minute, period) {
  let h = parseInt(hour, 10);
  if (period === 'PM' && h < 12) h += 12;
  if (period === 'AM' && h === 12) h = 0;
  const mStr = String(minute).padStart(2, '0');
  const hStr = String(h).padStart(2, '0');
  return `${hStr}:${mStr}:00`;
}

function generateTimeSelectOptions(selectedTime24h) {
  const options = [];
  const selectedShort = (selectedTime24h || '10:00:00').slice(0, 5);
  for (let h = 6; h <= 22; h++) {
    for (let m = 0; m < 60; m += 15) {
      const h24 = String(h).padStart(2, '0');
      const mStr = String(m).padStart(2, '0');
      const val24 = `${h24}:${mStr}`;
      const label12 = formatTime12h(`${val24}:00`);
      const isSel = val24 === selectedShort;
      options.push(`<option value="${val24}:00" ${isSel ? 'selected' : ''}>${label12}</option>`);
    }
  }
  return options.join('');
}

async function toggleWeeklyDayChip(dayNum) {
  const index = SCHEDULING_STATE.activeDaysSelected.indexOf(dayNum);
  if (index === -1) {
    SCHEDULING_STATE.activeDaysSelected.push(dayNum);
    const existingSlot = SCHEDULING_STATE.weeklyAvailability.find(s => s.day_of_week === dayNum);
    if (!existingSlot) {
      SCHEDULING_STATE.weeklyAvailability.push({
        id: 'wa-' + Date.now(),
        day_of_week: dayNum,
        start_time: '10:00:00',
        end_time: '10:45:00'
      });
      localStorage.setItem('ward_weekly_availability', JSON.stringify(SCHEDULING_STATE.weeklyAvailability));
    }
  } else {
    SCHEDULING_STATE.activeDaysSelected.splice(index, 1);
    SCHEDULING_STATE.weeklyAvailability = SCHEDULING_STATE.weeklyAvailability.filter(s => s.day_of_week !== dayNum);
    localStorage.setItem('ward_weekly_availability', JSON.stringify(SCHEDULING_STATE.weeklyAvailability));

    const sb = SCHEDULING_STATE.supabaseClient;
    if (sb) {
      await adminApiFetch('/api/admin-data', { resource: 'weekly_availability', action: 'delete_day', day_of_week: dayNum });
    }
  }
  renderWeeklyAvailabilityEditor();
}

function handleToggleSameHours(event) {
  const isSame = event.target.checked;
  if (isSame && SCHEDULING_STATE.weeklyAvailability.length > 0) {
    const templateSlots = SCHEDULING_STATE.weeklyAvailability.filter(s => s.day_of_week === SCHEDULING_STATE.activeDaysSelected[0]);
    if (templateSlots.length > 0) {
      const newAvailability = [];
      SCHEDULING_STATE.activeDaysSelected.forEach(dayNum => {
        templateSlots.forEach(ts => {
          newAvailability.push({
            id: 'wa-' + Date.now() + '-' + dayNum + '-' + Math.random().toString(36).substr(2, 4),
            day_of_week: dayNum,
            start_time: ts.start_time,
            end_time: ts.end_time
          });
        });
      });
      SCHEDULING_STATE.weeklyAvailability = newAvailability;
      renderWeeklyAvailabilityEditor();
      showToast('Applied same hours to all active days', 'sync');
    }
  }
}

function renderWeeklyAvailabilityEditor() {
  const container = document.getElementById('weekly-hours-container');
  const chipContainer = document.getElementById('weekly-day-chips');
  if (!container || !chipContainer) return;

  // Render Circular Day Pills (matching screenshot)
  chipContainer.innerHTML = DAYS_OF_WEEK.map(d => {
    const isSelected = SCHEDULING_STATE.activeDaysSelected.includes(d.day);
    return `
      <button onclick="toggleWeeklyDayChip(${d.day})" class="w-11 h-11 rounded-full font-mono text-xs font-bold transition-all flex items-center justify-center ${
        isSelected
          ? 'bg-[#003057] text-white shadow-md ring-2 ring-primary/40 active:scale-95'
          : 'bg-surface-container-high/60 dark:bg-surface-container-high/30 text-on-surface-variant hover:bg-surface-container-high border border-outline-variant/30 active:scale-95'
      }">
        ${d.label}
      </button>
    `;
  }).join('');

  if (SCHEDULING_STATE.activeDaysSelected.length === 0) {
    container.innerHTML = `
      <div class="p-8 text-center bg-surface-container-low rounded-2xl border border-outline-variant/30 flex flex-col items-center gap-2">
        <span class="material-symbols-outlined text-3xl text-on-surface-variant/40">event_busy</span>
        <p class="text-sm font-medium text-on-surface-variant">No active days selected. Tap a day circle above to set recurring hours.</p>
      </div>
    `;
    return;
  }

  const sortedDays = [...SCHEDULING_STATE.activeDaysSelected].sort((a, b) => a - b);

  container.innerHTML = sortedDays.map(dayNum => {
    const dayConfig = DAYS_OF_WEEK.find(d => d.day === dayNum);
    const daySlots = SCHEDULING_STATE.weeklyAvailability.filter(s => s.day_of_week === dayNum);

    return `
      <div class="bg-surface-container-lowest card-shadow rounded-2xl p-4 sm:p-5 border border-surface-blue-tint flex flex-col gap-3">
        <div class="flex items-center justify-between">
          <span class="font-headline font-bold text-base text-primary dark:text-white">${dayConfig.full}</span>
          <button onclick="addWeeklySlotForDay(${dayNum})" class="text-xs font-mono font-bold text-primary dark:text-primary-fixed bg-surface-blue-tint hover:bg-primary-fixed/50 px-3 py-1 rounded-xl flex items-center gap-1 transition-all active:scale-95">
            <span class="material-symbols-outlined text-[15px]">add</span>
            <span>Add Window</span>
          </button>
        </div>

        <div class="flex flex-col gap-2.5">
          ${daySlots.length === 0 ? `<p class="text-xs text-on-surface-variant italic py-1">No hours set for this day.</p>` : ''}
          ${daySlots.map(slot => {
            const startStr = formatTime12h(slot.start_time);
            const endStr = formatTime12h(slot.end_time);

            return `
              <div class="flex items-center justify-between gap-3 p-3 bg-surface-container-low dark:bg-[#202327] rounded-xl border border-outline-variant/30">
                
                <!-- MOBILE VIEW ONLY: Single Clickable Pill (Opens Mobile Bottom Sheet Wheel Picker) -->
                <div class="md:hidden flex items-center">
                  <button onclick="openMobileTimePicker('${escapeHtml(slot.id)}', ${dayNum})" class="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-white dark:bg-[#2d3137] border border-outline-variant/40 hover:border-primary text-xs font-mono font-bold text-primary dark:text-white shadow-sm active:scale-95 transition-all">
                    <span class="material-symbols-outlined text-[16px] text-secondary">schedule</span>
                    <span>${startStr} – ${endStr}</span>
                  </button>
                </div>

                <!-- DESKTOP VIEW ONLY: Clean Dropdowns (Start Time to End Time) -->
                <div class="hidden md:flex items-center gap-2 text-xs font-mono">
                  <div class="relative flex items-center">
                    <select onchange="handleWeeklySlotTimeChange('${escapeHtml(slot.id)}', 'start_time', this.value)" class="bg-white dark:bg-[#2d3137] border border-outline-variant/50 focus:border-primary rounded-xl px-3.5 py-2 font-mono text-xs font-semibold text-primary dark:text-white focus:outline-none focus:ring-2 focus:ring-primary/20 shadow-sm cursor-pointer transition-all">
                      ${generateTimeSelectOptions(slot.start_time)}
                    </select>
                  </div>
                  <span class="text-on-surface-variant font-bold px-1">to</span>
                  <div class="relative flex items-center">
                    <select onchange="handleWeeklySlotTimeChange('${escapeHtml(slot.id)}', 'end_time', this.value)" class="bg-white dark:bg-[#2d3137] border border-outline-variant/50 focus:border-primary rounded-xl px-3.5 py-2 font-mono text-xs font-semibold text-primary dark:text-white focus:outline-none focus:ring-2 focus:ring-primary/20 shadow-sm cursor-pointer transition-all">
                      ${generateTimeSelectOptions(slot.end_time)}
                    </select>
                  </div>
                </div>

                <!-- Delete trash button -->
                <button onclick="removeWeeklySlot('${escapeHtml(slot.id)}')" class="p-2 rounded-xl text-on-surface-variant hover:text-error hover:bg-error-container/20 transition-all active:scale-90" title="Delete slot">
                  <span class="material-symbols-outlined text-[20px]">delete</span>
                </button>

              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;
  }).join('');
}

function addWeeklySlotForDay(dayNum) {
  const newSlot = {
    id: 'wa-' + Date.now(),
    day_of_week: dayNum,
    start_time: '10:00:00',
    end_time: '10:45:00'
  };
  SCHEDULING_STATE.weeklyAvailability.push(newSlot);
  renderWeeklyAvailabilityEditor();
}

function handleWeeklySlotTimeChange(slotId, field, value) {
  const slot = SCHEDULING_STATE.weeklyAvailability.find(s => s.id === slotId);
  if (slot && value) {
    slot[field] = value.length === 5 ? value + ':00' : value;
    renderWeeklyAvailabilityEditor();
  }
}

async function removeWeeklySlot(slotId) {
  const slot = SCHEDULING_STATE.weeklyAvailability.find(s => s.id === slotId);
  SCHEDULING_STATE.weeklyAvailability = SCHEDULING_STATE.weeklyAvailability.filter(s => s.id !== slotId);
  localStorage.setItem('ward_weekly_availability', JSON.stringify(SCHEDULING_STATE.weeklyAvailability));

  const sb = SCHEDULING_STATE.supabaseClient;
  if (sb && slot) {
    const isUUID = (str) => typeof str === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
    if (isUUID(slot.id)) {
      await adminApiFetch('/api/admin-data', { resource: 'weekly_availability', action: 'delete_slot', id: slot.id });
    } else {
      await adminApiFetch('/api/admin-data', { resource: 'weekly_availability', action: 'delete_slot', day_of_week: slot.day_of_week, start_time: slot.start_time });
    }
  }

  showToast('Availability window removed from database', 'delete');
  renderWeeklyAvailabilityEditor();
}

/**
 * ------------------------------------------------------------
 * MOBILE WHEEL TIME PICKER CONTROLLER
 * ------------------------------------------------------------
 */
function openMobileTimePicker(slotId, dayNum) {
  TIME_PICKER_STATE.slotId = slotId;
  TIME_PICKER_STATE.dayNum = dayNum;

  const slot = SCHEDULING_STATE.weeklyAvailability.find(s => s.id === slotId);
  if (slot) {
    TIME_PICKER_STATE.start = parseTime24hToParts(slot.start_time);
    TIME_PICKER_STATE.end = parseTime24hToParts(slot.end_time);
  } else {
    TIME_PICKER_STATE.start = { hour: 10, minute: 0, period: 'AM' };
    TIME_PICKER_STATE.end = { hour: 10, minute: 45, period: 'AM' };
  }

  updatePickerDisplayTabs();
  switchPickerMode(true);
  openModal('mobile-time-picker-modal');
}

function switchPickerMode(isStart) {
  TIME_PICKER_STATE.isStartMode = isStart;

  const tabStart = document.getElementById('picker-tab-start');
  const tabEnd = document.getElementById('picker-tab-end');

  if (tabStart && tabEnd) {
    if (isStart) {
      tabStart.className = "p-3 rounded-xl flex flex-col items-center bg-white dark:bg-[#2d3137] card-shadow text-primary dark:text-white transition-all";
      tabEnd.className = "p-3 rounded-xl flex flex-col items-center text-on-surface-variant dark:text-outline-variant hover:text-primary transition-all";
    } else {
      tabStart.className = "p-3 rounded-xl flex flex-col items-center text-on-surface-variant dark:text-outline-variant hover:text-primary transition-all";
      tabEnd.className = "p-3 rounded-xl flex flex-col items-center bg-white dark:bg-[#2d3137] card-shadow text-primary dark:text-white transition-all";
    }
  }

  renderWheelColumns();
}

function updatePickerDisplayTabs() {
  const dispStart = document.getElementById('picker-display-start');
  const dispEnd = document.getElementById('picker-display-end');
  const s = TIME_PICKER_STATE.start;
  const e = TIME_PICKER_STATE.end;

  if (dispStart) dispStart.textContent = `${s.hour}:${String(s.minute).padStart(2, '0')} ${s.period}`;
  if (dispEnd) dispEnd.textContent = `${e.hour}:${String(e.minute).padStart(2, '0')} ${e.period}`;
}

function renderWheelColumns() {
  const current = TIME_PICKER_STATE.isStartMode ? TIME_PICKER_STATE.start : TIME_PICKER_STATE.end;

  const hoursCol = document.getElementById('wheel-hours');
  const minutesCol = document.getElementById('wheel-minutes');
  const ampmCol = document.getElementById('wheel-ampm');

  if (!hoursCol || !minutesCol || !ampmCol) return;

  // Hours (1..12)
  const hoursList = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
  hoursCol.innerHTML = hoursList.map(h => {
    const isSelected = h === current.hour;
    return `
      <div onclick="setWheelHour(${h})" class="wheel-item py-1.5 cursor-pointer transition-all ${
        isSelected
          ? 'text-xl font-headline font-extrabold text-primary dark:text-white scale-110'
          : 'text-sm font-medium text-on-surface-variant/40 dark:text-outline-variant/40 hover:text-on-surface-variant'
      }">
        ${h}
      </div>
    `;
  }).join('');

  // Minutes (00, 05, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55)
  const minuteList = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55];
  minutesCol.innerHTML = minuteList.map(m => {
    const isSelected = m === current.minute;
    return `
      <div onclick="setWheelMinute(${m})" class="wheel-item py-1.5 cursor-pointer transition-all ${
        isSelected
          ? 'text-xl font-headline font-extrabold text-primary dark:text-white scale-110'
          : 'text-sm font-medium text-on-surface-variant/40 dark:text-outline-variant/40 hover:text-on-surface-variant'
      }">
        ${String(m).padStart(2, '0')}
      </div>
    `;
  }).join('');

  // AM / PM
  const ampmList = ['AM', 'PM'];
  ampmCol.innerHTML = ampmList.map(p => {
    const isSelected = p === current.period;
    return `
      <div onclick="setWheelPeriod('${p}')" class="wheel-item py-2 cursor-pointer transition-all ${
        isSelected
          ? 'text-xl font-headline font-extrabold text-primary dark:text-white scale-110'
          : 'text-sm font-medium text-on-surface-variant/40 dark:text-outline-variant/40 hover:text-on-surface-variant'
      }">
        ${p}
      </div>
    `;
  }).join('');
}

function setWheelHour(h) {
  if (TIME_PICKER_STATE.isStartMode) {
    TIME_PICKER_STATE.start.hour = h;
  } else {
    TIME_PICKER_STATE.end.hour = h;
  }
  updatePickerDisplayTabs();
  renderWheelColumns();
}

function setWheelMinute(m) {
  if (TIME_PICKER_STATE.isStartMode) {
    TIME_PICKER_STATE.start.minute = m;
  } else {
    TIME_PICKER_STATE.end.minute = m;
  }
  updatePickerDisplayTabs();
  renderWheelColumns();
}

function setWheelPeriod(p) {
  if (TIME_PICKER_STATE.isStartMode) {
    TIME_PICKER_STATE.start.period = p;
  } else {
    TIME_PICKER_STATE.end.period = p;
  }
  updatePickerDisplayTabs();
  renderWheelColumns();
}

function applyMobileTimePicker() {
  const slotId = TIME_PICKER_STATE.slotId;
  const s = TIME_PICKER_STATE.start;
  const e = TIME_PICKER_STATE.end;

  const start24h = partsTo24h(s.hour, s.minute, s.period);
  const end24h = partsTo24h(e.hour, e.minute, e.period);

  if (TIME_PICKER_STATE.isOverrideMode) {
    const startSel = document.getElementById('override-start-select');
    const endSel = document.getElementById('override-end-select');
    const pillText = document.getElementById('override-time-pill-text');

    if (startSel) startSel.value = start24h;
    if (endSel) endSel.value = end24h;
    if (pillText) pillText.textContent = `${formatTime12h(start24h)} – ${formatTime12h(end24h)}`;

    closeModal('mobile-time-picker-modal');
    showToast('Override hours set', 'check_circle');
    return;
  }

  const slot = SCHEDULING_STATE.weeklyAvailability.find(item => item.id === slotId);
  if (slot) {
    slot.start_time = start24h;
    slot.end_time = end24h;
  }

  // If "Use same hours for all days" is checked, apply to all slots
  const sameToggle = document.getElementById('toggle-same-hours');
  if (sameToggle && sameToggle.checked) {
    SCHEDULING_STATE.weeklyAvailability.forEach(item => {
      item.start_time = start24h;
      item.end_time = end24h;
    });
  }

  closeModal('mobile-time-picker-modal');
  renderWeeklyAvailabilityEditor();
  showToast('Time window updated!', 'check_circle');
}

function openOverrideMobileTimePicker() {
  TIME_PICKER_STATE.isOverrideMode = true;
  TIME_PICKER_STATE.slotId = null;

  const startSel = document.getElementById('override-start-select');
  const endSel = document.getElementById('override-end-select');

  const startVal = startSel ? startSel.value : '09:00:00';
  const endVal = endSel ? endSel.value : '12:00:00';

  TIME_PICKER_STATE.start = parseTime24hToParts(startVal);
  TIME_PICKER_STATE.end = parseTime24hToParts(endVal);

  updatePickerDisplayTabs();
  switchPickerMode(true);
  openModal('mobile-time-picker-modal');
}

function handleOverrideSelectChange() {
  const startSel = document.getElementById('override-start-select');
  const endSel = document.getElementById('override-end-select');
  const pillText = document.getElementById('override-time-pill-text');

  if (startSel && endSel && pillText) {
    pillText.textContent = `${formatTime12h(startSel.value)} – ${formatTime12h(endSel.value)}`;
  }
}

async function handleSaveWeeklyAvailability() {
  localStorage.setItem('ward_weekly_availability', JSON.stringify(SCHEDULING_STATE.weeklyAvailability));

  const sb = SCHEDULING_STATE.supabaseClient;
  if (sb) {
    const slots = SCHEDULING_STATE.weeklyAvailability.map(s => ({
      day_of_week: s.day_of_week,
      start_time: s.start_time,
      end_time: s.end_time
    }));
    await adminApiFetch('/api/admin-data', { resource: 'weekly_availability', action: 'replace_all', slots });
  }

  showToast('Weekly recurring availability saved to database!', 'check_circle');
}

/**
 * ------------------------------------------------------------
 * 4. DATE OVERRIDES & CALENDAR
 * ------------------------------------------------------------
 */
function renderDateOverridesCalendar() {
  const monthTitle = document.getElementById('override-calendar-month');
  const daysGrid = document.getElementById('override-calendar-days');
  if (!monthTitle || !daysGrid) return;

  const year = SCHEDULING_STATE.currentCalendarYear;
  const month = SCHEDULING_STATE.currentCalendarMonth;
  const monthDate = new Date(year, month, 1);

  monthTitle.textContent = monthDate.toLocaleString('en-US', { month: 'long', year: 'numeric' });

  const firstDayIndex = monthDate.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const selectedDateStr = SCHEDULING_STATE.selectedDate.toISOString().split('T')[0];

  let html = '';

  // Blank days before first day of month
  for (let i = 0; i < firstDayIndex; i++) {
    html += `<div class="h-9"></div>`;
  }

  // Days of month
  for (let day = 1; day <= daysInMonth; day++) {
    const currentIterDate = new Date(year, month, day);
    const yyyy = currentIterDate.getFullYear();
    const mm = String(currentIterDate.getMonth() + 1).padStart(2, '0');
    const dd = String(currentIterDate.getDate()).padStart(2, '0');
    const dateStr = `${yyyy}-${mm}-${dd}`;

    const isSelected = dateStr === selectedDateStr;
    const hasOverride = SCHEDULING_STATE.dateOverrides.some(o => o.override_date === dateStr);

    html += `
      <button onclick="handleSelectCalendarDate('${dateStr}')" class="h-9 w-9 mx-auto rounded-xl flex flex-col items-center justify-center font-mono text-xs font-semibold relative transition-all ${
        isSelected
          ? 'bg-primary text-white font-bold shadow-md scale-105'
          : 'hover:bg-surface-blue-tint text-on-surface'
      }">
        <span>${day}</span>
        ${hasOverride ? `<span class="w-1.5 h-1.5 rounded-full ${isSelected ? 'bg-secondary-container' : 'bg-warning-amber'} absolute bottom-1"></span>` : ''}
      </button>
    `;
  }

  daysGrid.innerHTML = html;

  // Update override form header for selected date
  const selDateDisplay = document.getElementById('override-selected-date-display');
  if (selDateDisplay) {
    selDateDisplay.textContent = SCHEDULING_STATE.selectedDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  // Check if selected date already has an override and prefill
  const existing = SCHEDULING_STATE.dateOverrides.find(o => o.override_date === selectedDateStr);
  const unavailRadio = document.getElementById('override-type-unavailable');
  const availRadio = document.getElementById('override-type-available');
  const timeSlotFields = document.getElementById('override-timeslot-fields');
  const startSelect = document.getElementById('override-start-select');
  const endSelect = document.getElementById('override-end-select');
  const pillText = document.getElementById('override-time-pill-text');
  const deleteBtn = document.getElementById('btn-delete-date-override');

  const defaultStart = (existing && existing.start_time) ? existing.start_time : '09:00:00';
  const defaultEnd = (existing && existing.end_time) ? existing.end_time : '12:00:00';

  if (startSelect) startSelect.innerHTML = generateTimeSelectOptions(defaultStart);
  if (endSelect) endSelect.innerHTML = generateTimeSelectOptions(defaultEnd);
  if (pillText) pillText.textContent = `${formatTime12h(defaultStart)} – ${formatTime12h(defaultEnd)}`;

  if (existing) {
    if (deleteBtn) deleteBtn.classList.remove('hidden');
    if (existing.is_unavailable) {
      if (unavailRadio) unavailRadio.checked = true;
      if (timeSlotFields) timeSlotFields.classList.add('hidden');
    } else {
      if (availRadio) availRadio.checked = true;
      if (timeSlotFields) timeSlotFields.classList.remove('hidden');
    }
  } else {
    if (deleteBtn) deleteBtn.classList.add('hidden');
    if (availRadio) availRadio.checked = true;
    if (timeSlotFields) timeSlotFields.classList.remove('hidden');
  }
}

function handleSelectCalendarDate(dateStr) {
  const parts = dateStr.split('-');
  SCHEDULING_STATE.selectedDate = new Date(parts[0], parts[1] - 1, parts[2]);
  renderDateOverridesCalendar();
}

function handleCalendarPrevMonth() {
  if (SCHEDULING_STATE.currentCalendarMonth === 0) {
    SCHEDULING_STATE.currentCalendarMonth = 11;
    SCHEDULING_STATE.currentCalendarYear -= 1;
  } else {
    SCHEDULING_STATE.currentCalendarMonth -= 1;
  }
  renderDateOverridesCalendar();
}

function handleCalendarNextMonth() {
  if (SCHEDULING_STATE.currentCalendarMonth === 11) {
    SCHEDULING_STATE.currentCalendarMonth = 0;
    SCHEDULING_STATE.currentCalendarYear += 1;
  } else {
    SCHEDULING_STATE.currentCalendarMonth += 1;
  }
  renderDateOverridesCalendar();
}

function handleOverrideTypeChange(isUnavailable) {
  const timeFields = document.getElementById('override-timeslot-fields');
  if (timeFields) {
    if (isUnavailable) {
      timeFields.classList.add('hidden');
    } else {
      timeFields.classList.remove('hidden');
    }
  }
}

async function handleSaveDateOverrideForm(event) {
  if (event) event.preventDefault();

  const isUnavailable = document.getElementById('override-type-unavailable').checked;
  const startSelect = document.getElementById('override-start-select');
  const endSelect = document.getElementById('override-end-select');

  const startTime = startSelect ? startSelect.value : '09:00:00';
  const endTime = endSelect ? endSelect.value : '12:00:00';

  const yyyy = SCHEDULING_STATE.selectedDate.getFullYear();
  const mm = String(SCHEDULING_STATE.selectedDate.getMonth() + 1).padStart(2, '0');
  const dd = String(SCHEDULING_STATE.selectedDate.getDate()).padStart(2, '0');
  const dateStr = `${yyyy}-${mm}-${dd}`;

  const payload = {
    override_date: dateStr,
    is_unavailable: isUnavailable,
    start_time: isUnavailable ? null : startTime,
    end_time: isUnavailable ? null : endTime
  };

  // Remove previous override for this date if exists
  const existingIdx = SCHEDULING_STATE.dateOverrides.findIndex(o => o.override_date === dateStr);
  if (existingIdx !== -1) {
    SCHEDULING_STATE.dateOverrides[existingIdx] = { id: SCHEDULING_STATE.dateOverrides[existingIdx].id, ...payload };
  } else {
    SCHEDULING_STATE.dateOverrides.push({ id: 'do-' + Date.now(), ...payload });
  }

  localStorage.setItem('ward_date_overrides', JSON.stringify(SCHEDULING_STATE.dateOverrides));

  const sb = SCHEDULING_STATE.supabaseClient;
  if (sb) {
    await adminApiFetch('/api/admin-data', { resource: 'date_overrides', action: 'save', override_date: dateStr, ...payload });
  }

  showToast(`Saved override for ${SCHEDULING_STATE.selectedDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`, 'check_circle');
  renderDateOverridesCalendar();
  renderUpcomingOverridesList();
}

function renderUpcomingOverridesList() {
  const container = document.getElementById('upcoming-overrides-list');
  if (!container) return;

  const overrides = SCHEDULING_STATE.dateOverrides || [];
  if (overrides.length === 0) {
    container.innerHTML = `<div class="p-6 text-center bg-surface-container-low rounded-2xl"><p class="text-sm text-on-surface-variant">No date overrides configured.</p></div>`;
    return;
  }

  container.innerHTML = overrides.map(ov => {
    const parts = ov.override_date.split('-');
    const d = new Date(parts[0], parts[1] - 1, parts[2]);
    const dateFormatted = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });

    let statusText = '';
    if (ov.is_unavailable) {
      statusText = `<span class="px-2.5 py-0.5 rounded-full text-xs font-mono font-bold bg-error-container/60 text-error">Unavailable (Full Day)</span>`;
    } else {
      const start = ov.start_time ? formatTimeString(ov.start_time) : '9:00 AM';
      const end = ov.end_time ? formatTimeString(ov.end_time) : '5:00 PM';
      statusText = `<span class="px-2.5 py-0.5 rounded-full text-xs font-mono font-bold bg-emerald-100 text-emerald-800">Available: ${start} – ${end}</span>`;
    }

    return `
      <div class="bg-surface-container-lowest card-shadow rounded-2xl p-4 border border-surface-blue-tint flex items-center justify-between gap-3">
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-xl bg-surface-blue-tint text-primary flex items-center justify-center shrink-0">
            <span class="material-symbols-outlined text-[20px]">event</span>
          </div>
          <div class="flex flex-col">
            <span class="font-headline font-bold text-sm text-primary">${dateFormatted}</span>
            <div class="mt-0.5">${statusText}</div>
          </div>
        </div>
        <button onclick="handleDeleteDateOverride('${escapeHtml(ov.id)}')" class="p-2 rounded-xl text-on-surface-variant hover:text-error hover:bg-error-container/20 transition-all" title="Remove override">
          <span class="material-symbols-outlined text-[20px]">delete</span>
        </button>
      </div>
    `;
  }).join('');
}

async function handleDeleteDateOverride(overrideId) {
  const ov = SCHEDULING_STATE.dateOverrides.find(o => o.id === overrideId || o.override_date === overrideId);
  SCHEDULING_STATE.dateOverrides = SCHEDULING_STATE.dateOverrides.filter(o => o.id !== overrideId && o.override_date !== overrideId);
  localStorage.setItem('ward_date_overrides', JSON.stringify(SCHEDULING_STATE.dateOverrides));

  const sb = SCHEDULING_STATE.supabaseClient;
  if (sb && ov) {
    const isUUID = (str) => typeof str === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
    await adminApiFetch('/api/admin-data', {
      resource: 'date_overrides',
      action: 'delete',
      id: isUUID(ov.id) ? ov.id : undefined,
      override_date: ov.override_date,
    });
  }

  showToast('Date override removed from database', 'delete');
  renderDateOverridesCalendar();
  renderUpcomingOverridesList();
}

async function handleDeleteSelectedDateOverride() {
  const yyyy = SCHEDULING_STATE.selectedDate.getFullYear();
  const mm = String(SCHEDULING_STATE.selectedDate.getMonth() + 1).padStart(2, '0');
  const dd = String(SCHEDULING_STATE.selectedDate.getDate()).padStart(2, '0');
  const dateStr = `${yyyy}-${mm}-${dd}`;
  await handleDeleteDateOverride(dateStr);
}

function formatTimeString(timeStr) {
  if (!timeStr) return '';
  const [h, m] = timeStr.split(':');
  const hours = parseInt(h, 10);
  const ampm = hours >= 12 ? 'PM' : 'AM';
  const displayHours = hours % 12 || 12;
  return `${displayHours}:${m} ${ampm}`;
}

// Global initialization on DOM ready
document.addEventListener('DOMContentLoaded', () => {
  loadAllSchedulingData();
  checkAdminAuth();
  initPublicBookingUI();
});

// ============================================================
// 6. PUBLIC SCHEDULING FLOW (4-STEP WIZARD) & .ICS GENERATOR
// ============================================================

const PUBLIC_BOOKING_STATE = {
  step: 1,
  selectedTypeId: 'mt-1',
  selectedType: null,
  calendarYear: new Date().getFullYear(),
  calendarMonth: new Date().getMonth(),
  selectedDate: null,
  selectedSlotTime: null,
  reschedulingAppointment: null,
  adminBookingMode: false,
  lastBookedAppointment: null,
  lastIcsContent: null,
  lastIcsFilename: 'Provo8thWard_Appointment.ics'
};

/**
 * Initialize Public Booking UI
 */
function initPublicBookingUI() {
  // Pre-fill name from Sunday check-in if saved
  const savedName = localStorage.getItem('ward_member_name');
  const nameInput = document.getElementById('booking-input-name');
  if (savedName && nameInput && !nameInput.value) {
    nameInput.value = savedName;
  }

  // Pre-fill email if saved
  const savedEmail = localStorage.getItem('ward_member_email');
  const emailInput = document.getElementById('booking-input-email');
  if (savedEmail && emailInput && !emailInput.value) {
    emailInput.value = savedEmail;
  }

  // Ensure default meeting type is set
  const types = (SCHEDULING_STATE.meetingTypes && SCHEDULING_STATE.meetingTypes.length > 0)
    ? SCHEDULING_STATE.meetingTypes
    : DEFAULT_MEETING_TYPES;

  if (!PUBLIC_BOOKING_STATE.selectedTypeId && types.length > 0) {
    PUBLIC_BOOKING_STATE.selectedTypeId = types[0].id;
    PUBLIC_BOOKING_STATE.selectedType = types[0];
  } else if (PUBLIC_BOOKING_STATE.selectedTypeId) {
    PUBLIC_BOOKING_STATE.selectedType = types.find(t => t.id === PUBLIC_BOOKING_STATE.selectedTypeId) || types[0];
  }

  renderPublicMeetingTypes();
  renderPublicBookingCalendar();
  renderMyAppointmentsSection();
}

/**
 * Find this visitor's own upcoming appointments (matched by saved email)
 */
function getMyAppointments() {
  const email = (localStorage.getItem('ward_member_email') || '').trim().toLowerCase();
  if (!email || !Array.isArray(SCHEDULING_STATE.appointments)) return [];

  const now = Date.now();
  return SCHEDULING_STATE.appointments
    .filter(a => a && a.attendee_email && a.attendee_email.trim().toLowerCase() === email)
    .filter(a => a.status !== 'cancelled')
    .filter(a => new Date(a.end_time || a.start_time).getTime() >= now)
    .sort((a, b) => new Date(a.start_time) - new Date(b.start_time));
}

/**
 * Render the "My Appointments" card above the booking wizard
 */
function renderMyAppointmentsSection() {
  const section = document.getElementById('booking-my-appointments-section');
  const list = document.getElementById('booking-my-appointments-list');
  if (!section || !list) return;

  const appts = getMyAppointments();

  if (appts.length === 0) {
    section.classList.add('hidden');
    list.innerHTML = '';
    return;
  }

  section.classList.remove('hidden');
  list.innerHTML = appts.map(a => {
    const start = new Date(a.start_time);
    const dateText = start.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'America/Denver' });
    const timeText = start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'America/Denver' });

    return `
      <div onclick="openMyAppointmentManageModal('${escapeHtml(a.id)}')" class="flex items-center gap-3.5 bg-surface-container/60 dark:bg-surface-container-high/20 hover:bg-surface-blue-tint/40 rounded-2xl p-3.5 border border-outline-variant/30 hover:border-primary/40 cursor-pointer transition-all active:scale-[0.99] group">
        <div class="w-11 h-11 rounded-xl bg-secondary-container text-on-secondary-container flex items-center justify-center flex-shrink-0 shadow-xs">
          <span class="material-symbols-outlined text-xl" style="font-variation-settings: 'FILL' 1;">event</span>
        </div>
        <div class="flex flex-col min-w-0 flex-1">
          <span class="font-headline font-bold text-sm text-primary dark:text-white truncate">${escapeHtml(a.meeting_type_title || 'Appointment')}</span>
          <span class="text-xs text-on-surface-variant dark:text-outline-variant font-medium">${dateText} &bull; ${timeText}</span>
        </div>
        <span class="material-symbols-outlined text-[20px] text-on-surface-variant/60 group-hover:text-primary group-hover:translate-x-1 transition-all flex-shrink-0">chevron_right</span>
      </div>
    `;
  }).join('');
}

/**
 * Open the Manage Meeting modal (Reschedule / Cancel) for one of this
 * visitor's own appointments, tapped from the "My Appointments" card.
 */
function openMyAppointmentManageModal(aptId) {
  SCHEDULING_STATE.selectedAppointmentId = aptId;
  openModal('manage-meeting-modal');
}

/**
 * Render Step 1: Meeting Type Selection Cards
 */
function renderPublicMeetingTypes() {
  const container = document.getElementById('booking-meeting-types-list');
  if (!container) return;

  const types = (SCHEDULING_STATE.meetingTypes && SCHEDULING_STATE.meetingTypes.length > 0)
    ? SCHEDULING_STATE.meetingTypes.filter(t => t.is_active !== false)
    : DEFAULT_MEETING_TYPES;

  container.innerHTML = types.map(type => {
    const isSelected = PUBLIC_BOOKING_STATE.selectedTypeId === type.id;
    
    // Choose appropriate icon
    let iconName = 'schedule';
    let lowerTitle = (type.title || '').toLowerCase();
    if (lowerTitle.includes('endorsement')) iconName = 'school';
    else if (lowerTitle.includes('temple')) iconName = 'shield';
    else if (lowerTitle.includes('sealing')) iconName = 'favorite';
    else if (lowerTitle.includes('endowment')) iconName = 'temple_buddhist';
    else if (lowerTitle.includes('personal')) iconName = 'person';
    else if (lowerTitle.includes('bishop')) iconName = 'account_circle';
    else if (lowerTitle.includes('secretary')) iconName = 'support_agent';

    return `
      <div onclick="selectBookingMeetingType('${escapeHtml(type.id)}')"
           class="group bg-surface-container-lowest dark:bg-[#202227] hover:bg-surface-blue-tint/50 dark:hover:bg-primary-container/20 border ${isSelected ? 'border-primary bg-surface-blue-tint/50 shadow-md ring-2 ring-primary/30' : 'border-outline-variant/30 dark:border-white/5'} rounded-2xl p-3 sm:p-5 flex items-center justify-between gap-3 sm:gap-4 cursor-pointer transition-all duration-200 active:scale-[0.99] shadow-sm hover:shadow-md">

        <div class="flex items-start gap-2.5 sm:gap-4 min-w-0">
          <div class="w-8 h-8 sm:w-11 sm:h-11 rounded-xl sm:rounded-2xl bg-secondary-container text-on-secondary-container flex items-center justify-center flex-shrink-0 group-hover:scale-105 transition-transform shadow-xs mt-0.5">
            <span class="material-symbols-outlined text-base sm:text-2xl" style="font-variation-settings: 'FILL' 1;">${iconName}</span>
          </div>

          <div class="flex flex-col gap-0.5 sm:gap-1.5 text-left min-w-0">
            <div class="flex items-center gap-2.5 flex-wrap">
              <h3 class="font-headline font-bold text-sm sm:text-lg text-primary dark:text-white group-hover:text-secondary-container-dark transition-colors">
                ${escapeHtml(type.title)}
              </h3>
            </div>

            <!-- Duration Badge -->
            <div class="flex items-center gap-3 text-xs font-mono text-on-surface-variant flex-wrap">
              <span class="flex items-center gap-1 font-bold text-primary dark:text-primary-fixed">
                <span class="material-symbols-outlined text-[15px]">schedule</span>
                <span>${type.duration_minutes || 15} min</span>
              </span>
            </div>

            ${type.description ? `
              <p class="text-xs text-on-surface-variant dark:text-outline-variant leading-snug sm:leading-relaxed mt-0.5 line-clamp-2 sm:line-clamp-none sm:whitespace-pre-line">
                ${formatMeetingDescription(type.description)}
              </p>
            ` : ''}
          </div>
        </div>

        <div class="flex items-center gap-2 flex-shrink-0">
          <span class="material-symbols-outlined text-on-surface-variant/40 group-hover:text-primary group-hover:translate-x-1 transition-all text-xl sm:text-2xl">
            chevron_right
          </span>
        </div>

      </div>
    `;
  }).join('');
}

/**
 * Handle Selection of Meeting Type (Step 1 -> Step 2)
 */
function selectBookingMeetingType(typeId) {
  const types = (SCHEDULING_STATE.meetingTypes && SCHEDULING_STATE.meetingTypes.length > 0)
    ? SCHEDULING_STATE.meetingTypes
    : DEFAULT_MEETING_TYPES;

  const found = types.find(t => t.id === typeId) || types[0];
  PUBLIC_BOOKING_STATE.selectedTypeId = typeId;
  PUBLIC_BOOKING_STATE.selectedType = found;

  // Picking a type from Step 1 always starts a fresh booking. Reschedule
  // mode is entered by jumping straight to Step 2 (see
  // handleRescheduleMeetingAdmin), so it never reaches this function —
  // clearing it here prevents a later abandoned-reschedule context from
  // silently overwriting someone's old appointment instead of creating
  // a new one.
  PUBLIC_BOOKING_STATE.reschedulingAppointment = null;

  goToBookingStep(2);
}

/**
 * Step Navigation Router for Wizard
 */
function goToBookingStep(step) {
  if (step < 1) step = 1;
  if (step > 4) step = 4;

  PUBLIC_BOOKING_STATE.step = step;

  // Show a banner (with a way back to the dashboard) while an admin is
  // booking this appointment on behalf of someone else.
  const adminBanner = document.getElementById('admin-booking-banner');
  if (adminBanner) adminBanner.classList.toggle('hidden', !PUBLIC_BOOKING_STATE.adminBookingMode);

  const step4Subtitle = document.getElementById('booking-step4-subtitle');
  if (step4Subtitle) {
    step4Subtitle.textContent = PUBLIC_BOOKING_STATE.adminBookingMode
      ? "Please review details and provide the attendee's contact information."
      : 'Please review details and provide your contact information.';
  }

  // Toggle step containers
  for (let i = 1; i <= 4; i++) {
    const el = document.getElementById(`booking-step-${i}`);
    if (el) {
      if (i === step) {
        el.classList.remove('hidden');
        el.classList.add('animate-fade-in');
      } else {
        el.classList.add('hidden');
        el.classList.remove('animate-fade-in');
      }
    }
  }

  // No step counter or progress bar (per ward request) — just a Back
  // button, visible from Step 2 onward.
  const backBtn = document.getElementById('booking-nav-back-btn');
  if (backBtn) {
    if (step > 1) {
      backBtn.classList.remove('invisible');
    } else {
      backBtn.classList.add('invisible');
    }
  }

  // Specific renders per step
  if (step === 1) {
    renderPublicMeetingTypes();
  } else if (step === 2) {
    renderPublicBookingCalendar();
  } else if (step === 3) {
    renderPublicTimeSlots();
  } else if (step === 4) {
    renderPublicBookingSummary();
  }

  // Scroll to top of wizard shell smoothly
  const viewEl = document.getElementById('view-schedule');
  if (viewEl) viewEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function handleBookingBackStep() {
  if (PUBLIC_BOOKING_STATE.step > 1) {
    goToBookingStep(PUBLIC_BOOKING_STATE.step - 1);
  }
}

/**
 * Change Calendar Month for Booking Picker
 */
function changeBookingMonth(delta) {
  PUBLIC_BOOKING_STATE.calendarMonth += delta;
  if (PUBLIC_BOOKING_STATE.calendarMonth > 11) {
    PUBLIC_BOOKING_STATE.calendarMonth = 0;
    PUBLIC_BOOKING_STATE.calendarYear++;
  } else if (PUBLIC_BOOKING_STATE.calendarMonth < 0) {
    PUBLIC_BOOKING_STATE.calendarMonth = 11;
    PUBLIC_BOOKING_STATE.calendarYear--;
  }
  renderPublicBookingCalendar();
}

/**
 * Check if a given date has open availability slots
 */
function hasAvailabilityOnDate(dateStr) {
  const selectedType = PUBLIC_BOOKING_STATE.selectedType || DEFAULT_MEETING_TYPES[0];
  const duration = selectedType.duration_minutes || 15;
  const slots = calculateAvailableSlotsForDate(dateStr, duration);
  return slots.some(s => !s.booked);
}

/**
 * Render Step 2: Month Calendar Picker Widget
 */
function renderPublicBookingCalendar() {
  const container = document.getElementById('booking-calendar-grid');
  const monthYearLabel = document.getElementById('booking-calendar-month-year');
  if (!container || !monthYearLabel) return;

  // Keep the type pill + full description in sync with whatever meeting
  // type is selected — covers both picking a type on Step 1 and the
  // reschedule flow, which jumps straight to Step 2. The description shows
  // here in full since Step 1's cards clamp it to 2 lines on mobile.
  const selectedType = PUBLIC_BOOKING_STATE.selectedType || DEFAULT_MEETING_TYPES[0];
  const pillName = document.getElementById('booking-step2-type-name');
  if (pillName) pillName.textContent = selectedType.title;
  const descEl = document.getElementById('booking-step2-type-description');
  if (descEl) {
    if (selectedType.description) {
      descEl.innerHTML = formatMeetingDescription(selectedType.description);
      descEl.classList.remove('hidden');
    } else {
      descEl.innerHTML = '';
      descEl.classList.add('hidden');
    }
  }

  const year = PUBLIC_BOOKING_STATE.calendarYear;
  const month = PUBLIC_BOOKING_STATE.calendarMonth;

  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];
  monthYearLabel.textContent = `${monthNames[month]} ${year}`;

  // First day of month & total days
  const firstDayIndex = new Date(year, month, 1).getDay(); // 0 (Sun) to 6 (Sat)
  const totalDays = new Date(year, month + 1, 0).getDate();

  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

  let html = '';

  // Blank filler cells for days before the 1st
  for (let i = 0; i < firstDayIndex; i++) {
    html += `<div class="aspect-square"></div>`;
  }

  // Days in month
  for (let day = 1; day <= totalDays; day++) {
    const dayStr = String(day).padStart(2, '0');
    const monthStr = String(month + 1).padStart(2, '0');
    const dateStr = `${year}-${monthStr}-${dayStr}`;

    const dateObj = new Date(year, month, day, 23, 59, 59);
    const isPast = dateObj < new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const isToday = dateStr === todayStr;
    const isSelected = dateStr === PUBLIC_BOOKING_STATE.selectedDate;
    
    // Check if slots exist on this day
    const isAvailable = !isPast && hasAvailabilityOnDate(dateStr);

    let classes = ['booking-calendar-day'];
    if (isPast) {
      classes.push('day-disabled');
    } else if (isSelected) {
      classes.push('day-selected');
    } else if (isAvailable) {
      classes.push('day-has-slots text-primary dark:text-white font-semibold hover:bg-secondary-container/30');
    } else {
      classes.push('text-on-surface-variant/50 hover:bg-surface-container');
    }

    if (isToday) {
      classes.push('day-today');
    }

    const clickAction = !isPast ? `onclick="selectBookingDate('${dateStr}')"` : '';

    html += `
      <button type="button" ${clickAction} class="${classes.join(' ')}">
        <span>${day}</span>
      </button>
    `;
  }

  container.innerHTML = html;
}

/**
 * Handle Day Selection on Calendar
 */
async function selectBookingDate(dateStr) {
  PUBLIC_BOOKING_STATE.selectedDate = dateStr;
  PUBLIC_BOOKING_STATE.selectedSlotTime = null; // reset slot
  renderPublicBookingCalendar();

  // Pull the latest booked appointments before showing slots, so a time
  // someone else just booked shows up crossed out instead of stale-available.
  await refreshAppointmentsFromSupabase();

  // Auto-advance to time selection for fluid UX
  setTimeout(() => {
    goToBookingStep(3);
  }, 120);
}

/**
 * Refetch appointments from Supabase so slot availability reflects the
 * latest bookings (reduces the window for two people double-booking a slot).
 */
// Public booking-wizard read — only the non-PII columns anon is granted
// (id, meeting_type_id, start_time, end_time, status) are needed to compute
// slot availability. Full attendee records are admin-only; see
// api/admin-data.js and loadAllSchedulingData().
async function refreshAppointmentsFromSupabase() {
  const sb = SCHEDULING_STATE.supabaseClient;
  if (!sb) return;
  try {
    const { data, error } = await sb.from('appointments').select('id, meeting_type_id, start_time, end_time, status, meeting_types(title)').order('start_time', { ascending: true });
    if (!error && data) {
      SCHEDULING_STATE.appointments = data.map(a => ({
        ...a,
        meeting_type_title: a.meeting_types ? a.meeting_types.title : 'Appointment'
      }));
    }
  } catch (err) {
    console.warn('Error refreshing appointments from Supabase:', err);
  }
}

/**
 * Check if a specific time slot on a given date overlaps with any booked appointment
 */
function isSlotBookedByAppointments(dateStr, slotStartMins, slotEndMins, allAppointments) {
  if (!allAppointments || allAppointments.length === 0) return false;

  const [y, m, d] = dateStr.split('-').map(Number);
  const slotStartDate = new Date(y, m - 1, d, Math.floor(slotStartMins / 60), slotStartMins % 60, 0);
  const slotEndDate = new Date(y, m - 1, d, Math.floor(slotEndMins / 60), slotEndMins % 60, 0);
  const slotStartMs = slotStartDate.getTime();
  const slotEndMs = slotEndDate.getTime();

  return allAppointments.some(apt => {
    if (!apt || apt.status === 'cancelled') return false;

    // 1. Direct timestamp & Date object overlap check
    if (apt.start_time) {
      const aptStartDate = new Date(apt.start_time);
      const aptEndDate = apt.end_time ? new Date(apt.end_time) : new Date(aptStartDate.getTime() + 15 * 60 * 1000);
      const aptStartMs = aptStartDate.getTime();
      const aptEndMs = aptEndDate.getTime();

      if (!isNaN(aptStartMs) && !isNaN(aptEndMs)) {
        if (slotStartMs < aptEndMs && slotEndMs > aptStartMs) {
          return true;
        }

        // Local date matching
        const aptLocalY = aptStartDate.getFullYear();
        const aptLocalM = String(aptStartDate.getMonth() + 1).padStart(2, '0');
        const aptLocalD = String(aptStartDate.getDate()).padStart(2, '0');
        const aptLocalDate = `${aptLocalY}-${aptLocalM}-${aptLocalD}`;

        if (aptLocalDate === dateStr) {
          const aStartM = aptStartDate.getHours() * 60 + aptStartDate.getMinutes();
          const aEndM = aptEndDate.getHours() * 60 + aptEndDate.getMinutes();
          if (slotStartMins < aEndM && slotEndMins > aStartM) {
            return true;
          }
        }
      }

      // 2. String fallback matching for ISO strings with raw date
      if (typeof apt.start_time === 'string') {
        const raw = apt.start_time;
        if (raw.startsWith(dateStr)) {
          const timeMatch = raw.match(/T(\d{2}):(\d{2})/);
          if (timeMatch) {
            const rawMins = parseInt(timeMatch[1], 10) * 60 + parseInt(timeMatch[2], 10);
            let rawEndMins = rawMins + 15;
            if (typeof apt.end_time === 'string' && apt.end_time.startsWith(dateStr)) {
              const endMatch = apt.end_time.match(/T(\d{2}):(\d{2})/);
              if (endMatch) {
                rawEndMins = parseInt(endMatch[1], 10) * 60 + parseInt(endMatch[2], 10);
              }
            }
            if (slotStartMins < rawEndMins && slotEndMins > rawMins) {
              return true;
            }
          }
        }
      }
    }

    return false;
  });
}

/**
 * Core Algorithm: Calculate Dynamic Available Appointment Slots for a Date
 */
function calculateAvailableSlotsForDate(dateStr, durationMinutes = 15) {
  if (!dateStr) return [];

  const [y, m, d] = dateStr.split('-').map(Number);
  const targetDate = new Date(y, m - 1, d);
  const dayOfWeek = targetDate.getDay(); // 0 = Sunday, 1 = Monday, ..., 6 = Saturday

  // Check Settings
  if (SCHEDULING_STATE.settings && SCHEDULING_STATE.settings.accepting_appointments === false) {
    return [];
  }

  // 1. Check Date Overrides first
  const overrides = SCHEDULING_STATE.dateOverrides || DEFAULT_DATE_OVERRIDES;
  const matchOverride = overrides.find(o => o.override_date === dateStr);

  let windows = [];

  if (matchOverride) {
    if (matchOverride.is_unavailable) {
      return []; // Day completely blocked off
    }
    if (matchOverride.start_time && matchOverride.end_time) {
      windows.push({
        start_time: matchOverride.start_time,
        end_time: matchOverride.end_time
      });
    }
  } else {
    // 2. Check Weekly Availability for this day of week
    const weekly = (SCHEDULING_STATE.weeklyAvailability && SCHEDULING_STATE.weeklyAvailability.length > 0)
      ? SCHEDULING_STATE.weeklyAvailability
      : DEFAULT_WEEKLY_AVAILABILITY;

    const dayWindows = weekly.filter(w => w.day_of_week === dayOfWeek);
    if (dayWindows.length > 0) {
      windows = dayWindows;
    }
  }

  if (windows.length === 0) {
    return [];
  }

  // 3. Slice each time window into discrete slots based on duration
  const candidateSlots = [];

  windows.forEach(win => {
    const startMins = timeStrToMinutes(win.start_time);
    const endMins = timeStrToMinutes(win.end_time);

    let current = startMins;
    while (current + durationMinutes <= endMins) {
      const slotTimeStr = minutesToTimeStr(current);
      candidateSlots.push({
        start_time: slotTimeStr,
        end_time: minutesToTimeStr(current + durationMinutes),
        start_minutes: current,
        end_minutes: current + durationMinutes
      });
      current += durationMinutes;
    }
  });

  // 4. Tag each candidate slot as booked/available instead of dropping it,
  //    so already-booked times are shown grayed out, crossed out, and unclickable.
  // While rescheduling, exclude the appointment's own (still-current) slot —
  // otherwise the time it already occupies shows as booked/crossed out even
  // though it's free to re-select (or for other slots on the same day to open up).
  const reschedulingId = PUBLIC_BOOKING_STATE.reschedulingAppointment && PUBLIC_BOOKING_STATE.reschedulingAppointment.id;
  const allAppointments = (SCHEDULING_STATE.appointments || DEFAULT_APPOINTMENTS)
    .filter(apt => !reschedulingId || String(apt.id) !== String(reschedulingId));

  const taggedSlots = candidateSlots.map(slot => {
    const booked = isSlotBookedByAppointments(dateStr, slot.start_minutes, slot.end_minutes, allAppointments);
    return { ...slot, booked };
  });

  // 5. If date is Today, drop time slots that have already passed
  //    (distinct from "booked" — these just aren't offered at all)
  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

  if (dateStr === todayStr) {
    const currentMins = now.getHours() * 60 + now.getMinutes();
    return taggedSlots.filter(s => s.start_minutes > currentMins + 15); // At least 15 min buffer from now
  }

  return taggedSlots;
}

function timeStrToMinutes(timeStr) {
  if (!timeStr) return 0;
  const parts = timeStr.split(':').map(Number);
  return (parts[0] || 0) * 60 + (parts[1] || 0);
}

function minutesToTimeStr(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`;
}

/**
 * Format a Date string into readable format: "Thursday, October 24th, 2026"
 */
function formatHumanReadableDate(dateStr) {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d);

  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  const dayName = days[date.getDay()];
  const monthName = months[date.getMonth()];
  const dayNum = date.getDate();

  // Add st/nd/rd/th suffix
  let suffix = 'th';
  if (dayNum % 10 === 1 && dayNum !== 11) suffix = 'st';
  else if (dayNum % 10 === 2 && dayNum !== 12) suffix = 'nd';
  else if (dayNum % 10 === 3 && dayNum !== 13) suffix = 'rd';

  return `${dayName}, ${monthName} ${dayNum}${suffix}, ${date.getFullYear()}`;
}

/**
 * Render Step 3: Available Time Slots Grid
 */
function renderPublicTimeSlots() {
  const container = document.getElementById('booking-time-slots-grid');
  const noSlotsMsg = document.getElementById('booking-no-slots-msg');
  const dateSubtitle = document.getElementById('booking-step3-date-subtitle');
  if (!container || !noSlotsMsg) return;

  const dateStr = PUBLIC_BOOKING_STATE.selectedDate;
  if (dateSubtitle && dateStr) {
    dateSubtitle.textContent = formatHumanReadableDate(dateStr);
  }

  const selectedType = PUBLIC_BOOKING_STATE.selectedType || DEFAULT_MEETING_TYPES[0];
  const duration = selectedType.duration_minutes || 15;
  const availableSlots = calculateAvailableSlotsForDate(dateStr, duration);

  if (availableSlots.length === 0) {
    container.innerHTML = '';
    noSlotsMsg.classList.remove('hidden');
    return;
  }

  noSlotsMsg.classList.add('hidden');

  container.innerHTML = availableSlots.map(slot => {
    const formatted12h = formatTime12h(slot.start_time);
    const isSelected = PUBLIC_BOOKING_STATE.selectedSlotTime === slot.start_time;

    if (slot.booked) {
      return `
        <button type="button" disabled aria-disabled="true" title="Already booked - unavailable"
                class="slot-btn-booked py-3 px-3 rounded-2xl font-mono text-xs sm:text-sm font-bold border transition-all duration-200 text-center flex items-center justify-center gap-1.5 cursor-not-allowed opacity-40 line-through bg-gray-200/80 dark:bg-gray-800 text-gray-500 dark:text-gray-400 border-gray-300 dark:border-gray-700 pointer-events-none select-none shadow-none">
          <span class="material-symbols-outlined text-[15px] opacity-70">event_busy</span>
          <span class="line-through">${formatted12h}</span>
        </button>
      `;
    }

    return `
      <button type="button" onclick="selectBookingSlot('${slot.start_time}')"
              class="py-3 px-3 rounded-2xl font-mono text-xs sm:text-sm font-bold border transition-all duration-200 active:scale-95 text-center flex items-center justify-center gap-1.5 shadow-sm ${
                isSelected
                  ? 'slot-btn-selected bg-secondary-container text-on-secondary-container border-secondary-fixed shadow-md'
                  : 'bg-white dark:bg-[#202227] hover:bg-surface-blue-tint dark:hover:bg-primary-container/20 text-primary dark:text-white border-outline-variant/30 hover:border-primary'
              }">
        <span class="material-symbols-outlined text-[15px] opacity-70">schedule</span>
        <span>${formatted12h}</span>
      </button>
    `;
  }).join('');
}

/**
 * Handle Slot Selection (Step 3)
 */
function selectBookingSlot(slotTime) {
  PUBLIC_BOOKING_STATE.selectedSlotTime = slotTime;
  renderPublicTimeSlots();

  // Auto-advance to confirmation after a brief pause
  setTimeout(() => {
    goToBookingStep(4);
  }, 120);
}

/**
 * Render Step 4: Booking Summary Review
 */
function renderPublicBookingSummary() {
  const titleEl = document.getElementById('booking-summary-title');
  const dateEl = document.getElementById('booking-summary-date');
  const timeEl = document.getElementById('booking-summary-time');
  const locationEl = document.getElementById('booking-summary-location');
  const iconEl = document.getElementById('booking-summary-icon');

  const selectedType = PUBLIC_BOOKING_STATE.selectedType || DEFAULT_MEETING_TYPES[0];
  const dateStr = PUBLIC_BOOKING_STATE.selectedDate;
  const slotTime = PUBLIC_BOOKING_STATE.selectedSlotTime || '14:00:00';
  const duration = selectedType.duration_minutes || 15;

  if (titleEl) titleEl.textContent = selectedType.title;
  if (dateEl) dateEl.textContent = formatHumanReadableDate(dateStr);

  const start12h = formatTime12h(slotTime);
  const endMinutes = timeStrToMinutes(slotTime) + duration;
  const end12h = formatTime12h(minutesToTimeStr(endMinutes));

  if (timeEl) timeEl.textContent = `${start12h} – ${end12h} (MST)`;
  
  if (locationEl) {
    locationEl.textContent = selectedType.assigned_to === 'Executive Secretary' 
      ? 'Bishopric Office / Phone / Google Meet'
      : "Bishop's Office (LSB 2nd Floor) / In Person";
  }

  if (iconEl) {
    const lower = (selectedType.title || '').toLowerCase();
    if (lower.includes('temple')) iconEl.textContent = 'shield';
    else if (lower.includes('endorsement')) iconEl.textContent = 'school';
    else if (lower.includes('secretary')) iconEl.textContent = 'support_agent';
    else iconEl.textContent = 'groups';
  }

  // Pre-fill attendee details if rescheduling or saved
  const nameInput = document.getElementById('booking-input-name');
  const emailInput = document.getElementById('booking-input-email');
  const phoneInput = document.getElementById('booking-input-phone');
  const notesInput = document.getElementById('booking-input-notes');

  if (PUBLIC_BOOKING_STATE.reschedulingAppointment) {
    const apt = PUBLIC_BOOKING_STATE.reschedulingAppointment;
    if (nameInput && apt.attendee_name) nameInput.value = apt.attendee_name;
    if (emailInput && apt.attendee_email) emailInput.value = apt.attendee_email;
    if (phoneInput && apt.attendee_phone) phoneInput.value = apt.attendee_phone;
    if (notesInput && apt.notes) notesInput.value = apt.notes;
  }
}

/**
 * Submit Public Booking & Generate Instant .ICS Calendar File
 */
async function handlePublicBookingSubmit(event) {
  event.preventDefault();

  const name = document.getElementById('booking-input-name').value.trim();
  const email = document.getElementById('booking-input-email').value.trim();
  const phone = document.getElementById('booking-input-phone') ? document.getElementById('booking-input-phone').value.trim() : null;
  const notes = document.getElementById('booking-input-notes') ? document.getElementById('booking-input-notes').value.trim() : '';

  if (!name || !email) {
    showToast('Please provide your name and email address.', 'warning');
    return;
  }

  // Save member credentials for instant recall next time — skip this when an
  // admin is booking on behalf of someone else, so the attendee's info doesn't
  // overwrite this device's own saved identity (and "My Appointments" list).
  if (!PUBLIC_BOOKING_STATE.adminBookingMode) {
    localStorage.setItem('ward_member_name', name);
    localStorage.setItem('ward_member_email', email);
  }

  const submitBtn = document.getElementById('btn-booking-submit');
  const originalBtnContent = submitBtn ? submitBtn.innerHTML : '';
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = `
      <span class="material-symbols-outlined animate-spin text-[18px]">progress_activity</span>
      <span>${PUBLIC_BOOKING_STATE.reschedulingAppointment ? 'Rescheduling Appointment...' : 'Scheduling Appointment...'}</span>
    `;
  }

  try {
    const selectedType = PUBLIC_BOOKING_STATE.selectedType || DEFAULT_MEETING_TYPES[0];
    const dateStr = PUBLIC_BOOKING_STATE.selectedDate;
    const slotTime = PUBLIC_BOOKING_STATE.selectedSlotTime || '14:00:00';
    const duration = selectedType.duration_minutes || 15;
    const reschedulingApt = PUBLIC_BOOKING_STATE.reschedulingAppointment;

    const [y, m, d] = dateStr.split('-').map(Number);
    const [sh, sm] = slotTime.split(':').map(Number);
    const startDate = new Date(y, m - 1, d, sh, sm, 0);
    const endDate = new Date(startDate.getTime() + duration * 60 * 1000);
    const startISO = startDate.toISOString();
    const endISO = endDate.toISOString();

    // Standard RFC4122 UUID generator for tokens
    const cancelToken = (reschedulingApt && reschedulingApt.cancel_token)
      ? reschedulingApt.cancel_token
      : (window.crypto && typeof window.crypto.randomUUID === 'function')
        ? window.crypto.randomUUID()
        : '00000000-0000-4000-8000-000000000000'.replace(/0/g, () => (Math.random() * 16 | 0).toString(16));

    const isUUID = (str) => typeof str === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);

    const newAppointment = {
      id: reschedulingApt ? reschedulingApt.id : ('apt-' + Date.now()),
      meeting_type_id: selectedType.id,
      meeting_type_title: selectedType.title,
      attendee_name: name,
      attendee_email: email,
      attendee_phone: phone || null,
      notes: notes || null,
      start_time: startISO,
      end_time: endISO,
      status: 'confirmed',
      cancel_token: cancelToken,
      google_event_id: reschedulingApt ? reschedulingApt.google_event_id : null
    };

    // 1. Try Saving to Supabase if connected
    const sb = SCHEDULING_STATE.supabaseClient;
    if (sb) {
      const recordPayload = {
        attendee_name: name,
        attendee_email: email,
        attendee_phone: phone || null,
        notes: notes || null,
        start_time: startISO,
        end_time: endISO,
        status: 'confirmed',
        cancel_token: cancelToken,
        // Reset reminder-sent flags so a rescheduled appointment gets fresh
        // 24h/30m reminders for its new time instead of being skipped because
        // reminders were already sent for the old time.
        reminder_24h_sent_at: null,
        reminder_30m_sent_at: null
      };

      if (selectedType.id && isUUID(selectedType.id)) {
        recordPayload.meeting_type_id = selectedType.id;
      }

      let saveResult;
      try {
        if (reschedulingApt && isUUID(reschedulingApt.id)) {
          // Public self-service reschedule — no admin login, so ownership is
          // proven by the cancel_token instead (see api/reschedule-appointment.js).
          const res = await fetch('/api/reschedule-appointment', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              id: reschedulingApt.id,
              cancel_token: cancelToken,
              meeting_type_id: recordPayload.meeting_type_id,
              attendee_name: recordPayload.attendee_name,
              attendee_email: recordPayload.attendee_email,
              attendee_phone: recordPayload.attendee_phone,
              notes: recordPayload.notes,
              start_time: recordPayload.start_time,
              end_time: recordPayload.end_time,
            }),
          });
          const resData = await res.json().catch(() => null);
          if (!res.ok || !resData || !resData.success) {
            saveResult = { error: { message: (resData && resData.error) || 'Failed to reschedule appointment.', code: res.status === 409 ? '23P01' : undefined } };
          } else {
            saveResult = { data: [resData.appointment] };
          }
        } else {
          // Only select 'id' back — anon only holds column-level SELECT grants
          // on non-PII columns (schema.sql), so an unqualified .select() (which
          // requests every column) gets rejected with a 401 permission-denied
          // even though the INSERT itself succeeded.
          saveResult = await sb.from('appointments').insert([recordPayload]).select('id');
        }
      } catch (err) {
        console.error('Error saving appointment to Supabase:', err);
        saveResult = { error: err };
      }

      const { data, error } = saveResult;

      if (error) {
        // The DB rejects overlapping confirmed appointments (exclusion constraint)
        console.error('Supabase appointment save error:', error);
        const isConflict = error.code === '23P01' || /overlap|exclu/i.test(error.message || '');
        showToast(
          isConflict
            ? 'That time was just booked by someone else. Please choose another slot.'
            : (reschedulingApt ? 'Failed to reschedule appointment. Please try again.' : 'Failed to schedule appointment. Please try again.'),
          'error'
        );
        await refreshAppointmentsFromSupabase();
        PUBLIC_BOOKING_STATE.selectedSlotTime = null;
        goToBookingStep(3);
        return;
      }

      if (data && data.length > 0) {
        newAppointment.id = data[0].id;
        newAppointment.cancel_token = data[0].cancel_token || cancelToken;
        console.log('Successfully saved appointment to Supabase:', data[0]);

        // Confirmation email, Google Calendar sync, and admin push-notify are
        // all best-effort side effects that don't need to block the booking
        // flow — run them concurrently in the background instead of awaiting
        // each in turn (which was adding several seconds of visible wait per
        // appointment) so the user sees the confirmation immediately.
        Promise.allSettled([
          sendAppointmentEmail('create', newAppointment).then((emailResult) => {
            if (emailResult) console.log('Confirmation email result:', emailResult);
          }),
          syncAppointmentToGoogleCalendar('upsert', newAppointment).then((calResult) => {
            if (calResult && calResult.success === false) {
              console.warn('Calendar sync did not succeed:', calResult.error || calResult.reason);
            } else if (calResult && calResult.google_event_id) {
              newAppointment.google_event_id = calResult.google_event_id;
            }
          }),
          fetch('/api/notify-admins', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ appointment: newAppointment }),
          }),
        ]).then((results) => {
          results.forEach((r) => {
            if (r.status === 'rejected') console.warn('Post-booking side effect failed:', r.reason);
          });
        });

        // If this device is already installed & subscribed (e.g. subscribed
        // before ever booking), re-link the subscription to this email now
        // so reminder pushes for this appointment work without a reload.
        if (typeof initSitePushNotifications === 'function') {
          initSitePushNotifications();
        }
      }
    }

    // 2. Save locally so offline state and Admin Dashboard update immediately
    if (!SCHEDULING_STATE.appointments) SCHEDULING_STATE.appointments = [];
    if (reschedulingApt) {
      const idx = SCHEDULING_STATE.appointments.findIndex(a => a.id === reschedulingApt.id || String(a.id) === String(reschedulingApt.id));
      if (idx !== -1) {
        SCHEDULING_STATE.appointments[idx] = newAppointment;
      } else {
        SCHEDULING_STATE.appointments.push(newAppointment);
      }
    } else {
      SCHEDULING_STATE.appointments.push(newAppointment);
    }
    localStorage.setItem('ward_appointments', JSON.stringify(SCHEDULING_STATE.appointments));

    // Sync Admin views
    if (typeof renderAppointmentsFeed === 'function') {
      renderAppointmentsFeed();
    }

    const wasAdminBooking = PUBLIC_BOOKING_STATE.adminBookingMode;

    PUBLIC_BOOKING_STATE.lastBookedAppointment = newAppointment;
    PUBLIC_BOOKING_STATE.reschedulingAppointment = null; // Clear reschedule mode
    PUBLIC_BOOKING_STATE.adminBookingMode = false;

    // 3. Show the "My Appointments" card and reset the wizard for booking another
    renderMyAppointmentsSection();

    showToast(
      reschedulingApt
        ? 'Appointment successfully rescheduled! Confirmation email sent.'
        : wasAdminBooking
          ? `Appointment successfully booked for ${name}! Confirmation email sent.`
          : 'Appointment successfully scheduled! Confirmation email sent.',
      'check_circle'
    );

    PUBLIC_BOOKING_STATE.selectedDate = null;
    PUBLIC_BOOKING_STATE.selectedSlotTime = null;
    const notesField = document.getElementById('booking-input-notes');
    if (notesField) notesField.value = '';
    goToBookingStep(1);

    // Admin booked this on behalf of someone else — return to the dashboard
    // instead of leaving them sitting on the public booking wizard.
    if (wasAdminBooking && typeof navigateTab === 'function') {
      navigateTab('admin-scheduling');
    }
  } catch (ex) {
    console.error('Error submitting appointment:', ex);
    showToast('Failed to schedule appointment. Please try again.', 'error');
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = originalBtnContent;
    }
  }
}

/**
 * Generate RFC 5545 Compliant .ICS Calendar File Content
 */
function generateICSContent(appointment, meetingType) {
  const title = `${meetingType.title || 'Ward Interview'} - Provo YSA 8th Ward`;
  const location = "Bishop's Office (LSB 2nd Floor), Provo YSA 8th Ward";
  const description = `Provo YSA 8th Ward Appointment\\nMeeting Type: ${meetingType.title}\\nAttendee: ${appointment.attendee_name}\\nEmail: ${appointment.attendee_email}\\nNotes: ${appointment.notes || 'None'}\\n\\nTo cancel or reschedule, please contact the Executive Secretary.`;

  // Format UTC dates for ICS DTSTART/DTEND (e.g. 20261024T200000Z)
  const startDate = new Date(appointment.start_time);
  const endDate = new Date(appointment.end_time);

  const formatICSDate = (date) => {
    return date.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  };

  const now = new Date();
  const dtStamp = formatICSDate(now);
  const dtStart = formatICSDate(startDate);
  const dtEnd = formatICSDate(endDate);
  const uid = `apt-${appointment.id || Date.now()}@provo8ward.org`;

  const icsLines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Provo YSA 8th Ward//Scheduling Wizard//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:REQUEST',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${dtStamp}`,
    `DTSTART:${dtStart}`,
    `DTEND:${dtEnd}`,
    `SUMMARY:${title}`,
    `DESCRIPTION:${description}`,
    `LOCATION:${location}`,
    'STATUS:CONFIRMED',
    'SEQUENCE:0',
    'BEGIN:VALARM',
    'TRIGGER:-PT30M',
    'ACTION:DISPLAY',
    'DESCRIPTION:Reminder: Upcoming Provo YSA 8th Ward Appointment',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR'
  ];

  const icsString = icsLines.join('\r\n');
  const safeFilename = `${(meetingType.title || 'Appointment').replace(/[^a-zA-Z0-9]/g, '_')}_${startDate.toISOString().split('T')[0]}.ics`;

  return {
    content: icsString,
    filename: safeFilename
  };
}

/**
 * Trigger Instant Download of .ICS File
 */
function triggerICSFileDownload(icsContent, filename) {
  const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Handle Download Calendar Invite Button Click (Step 5)
 */
function handleDownloadICSClick() {
  if (PUBLIC_BOOKING_STATE.lastIcsContent && PUBLIC_BOOKING_STATE.lastIcsFilename) {
    triggerICSFileDownload(PUBLIC_BOOKING_STATE.lastIcsContent, PUBLIC_BOOKING_STATE.lastIcsFilename);
    showToast('Calendar invite (.ics) downloaded!', 'download_done');
  } else if (PUBLIC_BOOKING_STATE.lastBookedAppointment) {
    const selectedType = PUBLIC_BOOKING_STATE.selectedType || DEFAULT_MEETING_TYPES[0];
    const icsData = generateICSContent(PUBLIC_BOOKING_STATE.lastBookedAppointment, selectedType);
    triggerICSFileDownload(icsData.content, icsData.filename);
    showToast('Calendar invite (.ics) downloaded!', 'download_done');
  }
}

/**
 * Configure 1-Click Direct Calendar Links (Google & Outlook)
 */
function setupCloudCalendarLinks(appointment, meetingType) {
  const startDate = new Date(appointment.start_time);
  const endDate = new Date(appointment.end_time);

  const formatGCalDate = (date) => {
    return date.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  };

  const title = encodeURIComponent(`${meetingType.title || 'Ward Interview'} - Provo YSA 8th Ward`);
  const details = encodeURIComponent(`Provo YSA 8th Ward Appointment\nMeeting: ${meetingType.title}\nAttendee: ${appointment.attendee_name}\nNotes: ${appointment.notes || 'None'}`);
  const location = encodeURIComponent("Bishop's Office (LSB 2nd Floor), Provo YSA 8th Ward");
  
  const gcalDates = `${formatGCalDate(startDate)}/${formatGCalDate(endDate)}`;
  const gcalUrl = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&dates=${gcalDates}&details=${details}&location=${location}`;

  const outlookStart = startDate.toISOString();
  const outlookEnd = endDate.toISOString();
  const outlookUrl = `https://outlook.live.com/calendar/0/deeplink/compose?subject=${title}&startdt=${encodeURIComponent(outlookStart)}&enddt=${encodeURIComponent(outlookEnd)}&body=${details}&location=${location}`;

  const gcalBtn = document.getElementById('btn-add-gcal');
  const outlookBtn = document.getElementById('btn-add-outlook');

  if (gcalBtn) gcalBtn.href = gcalUrl;
  if (outlookBtn) outlookBtn.href = outlookUrl;
}

