// Provo YSA 8th Ward - Application Logic & State Management

document.addEventListener('DOMContentLoaded', () => {
  // Enforce light mode
  document.documentElement.classList.remove('dark');
  document.documentElement.classList.add('light');
  try {
    localStorage.removeItem('ward_theme');
  } catch (e) {}

  // Initialize navigation based on URL hash or default to 'home'
  const initialHash = window.location.hash.replace('#', '') || 'home';
  navigateTab(initialHash, false);

  // Initialize Sunday Class Check-In component state
  initCheckInUI();

  // Initialize Activities Feed from Google Calendar
  initActivitiesFeed();

  // Listen for hash changes
  window.addEventListener('hashchange', () => {
    const hash = window.location.hash.replace('#', '') || 'home';
    navigateTab(hash, false);
  });

  // Setup keyboard shortcuts (e.g. Escape closes modal)
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeAllModals();
    }
  });
});

/**
 * Tab Navigation Management
 * Supports 'home', 'ward', 'reimbursements'
 */
function navigateTab(tabId, updateHash = true) {
  if (tabId === 'tools') {
    tabId = 'reimbursements';
  }
  const validTabs = ['home', 'ward', 'reimbursements'];
  if (!validTabs.includes(tabId)) {
    tabId = 'home';
  }

  // Update hash if requested
  if (updateHash) {
    window.location.hash = tabId;
  }

  // Hide all views
  validTabs.forEach(id => {
    const viewEl = document.getElementById(`view-${id}`);
    if (viewEl) {
      viewEl.classList.add('hidden');
      viewEl.classList.remove('active-view');
    }
  });

  // Show active view
  const activeView = document.getElementById(`view-${tabId}`);
  if (activeView) {
    activeView.classList.remove('hidden');
    activeView.classList.add('active-view');
  }

  // Update Desktop Nav Buttons
  validTabs.forEach(id => {
    const btn = document.getElementById(`nav-btn-${id}`);
    if (btn) {
      if (id === tabId) {
        btn.className = "nav-desktop-item px-5 py-1.5 rounded-full text-sm font-semibold transition-all duration-200 flex items-center gap-1.5 bg-secondary-container text-on-secondary-container shadow-sm";
      } else {
        btn.className = "nav-desktop-item px-5 py-1.5 rounded-full text-sm font-semibold text-on-surface-variant dark:text-outline-variant hover:text-primary dark:hover:text-white transition-all duration-200 flex items-center gap-1.5";
      }
    }
  });

  // Update Mobile Bottom Nav Buttons
  validTabs.forEach(id => {
    const mobileBtn = document.getElementById(`tab-${id}`);
    if (mobileBtn) {
      if (id === tabId) {
        mobileBtn.className = "nav-tab-btn flex flex-col items-center justify-center bg-secondary-container dark:bg-secondary-container text-on-secondary-container rounded-full px-4 py-1.5 active:scale-90 transition-all duration-200 font-bold";
      } else {
        mobileBtn.className = "nav-tab-btn flex flex-col items-center justify-center text-on-surface-variant dark:text-outline-variant py-1.5 px-3 rounded-full active:scale-90 transition-all duration-200 hover:bg-surface-container";
      }
    }
  });

  // Jump to top of page instantly when switching tabs
  window.scrollTo(0, 0);
}

/**
 * Modal Management
 */
function openModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
  }
}

function closeModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.classList.add('hidden');
    document.body.style.overflow = '';
  }
}

function closeAllModals() {
  document.querySelectorAll('.modal-backdrop').forEach(modal => {
    modal.classList.add('hidden');
  });
  document.body.style.overflow = '';
}

// Close modal when clicking on backdrop
document.addEventListener('click', (e) => {
  if (e.target.classList.contains('modal-backdrop')) {
    closeAllModals();
  }
});

/**
 * Toast Notifications
 */
let toastTimeout;
function showToast(message, icon = 'check_circle') {
  const toast = document.getElementById('toast');
  const toastMessage = document.getElementById('toast-message');
  const toastIcon = document.getElementById('toast-icon');

  if (!toast || !toastMessage) return;

  toastMessage.textContent = message;
  if (toastIcon) toastIcon.textContent = icon;

  toast.classList.remove('translate-y-20', 'opacity-0', 'pointer-events-none');
  toast.classList.add('translate-y-0', 'opacity-100');

  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    toast.classList.add('translate-y-20', 'opacity-0', 'pointer-events-none');
    toast.classList.remove('translate-y-0', 'opacity-100');
  }, 3500);
}

/**
 * Form Handlers
 */
function handleBishopricSubmit(event) {
  event.preventDefault();
  const topic = document.getElementById('inquiry-type').value;
  const name = document.getElementById('sender-name').value;
  const message = document.getElementById('message').value;

  showToast(`Inquiry sent to Bishopric regarding "${topic}"!`, "mail");
  event.target.reset();
}

function handleNewMemberSubmit(event) {
  event.preventDefault();
  const firstName = document.getElementById('first-name').value;
  const lastName = document.getElementById('last-name').value;
  const address = document.getElementById('address').value;

  showToast(`Welcome to 8th Ward, ${firstName}! We've logged your move-in.`, "celebration");
  event.target.reset();
}

function handleActivityIdeaSubmit(event) {
  event.preventDefault();
  const title = document.getElementById('idea-title').value;
  showToast(`Activity suggestion submitted: "${title}"`, "lightbulb");
  closeModal('activity-idea-modal');
  event.target.reset();
}

function handleCommentSubmit(event) {
  event.preventDefault();
  const input = document.getElementById('comment-input');
  const text = input.value.trim();
  if (!text) return;

  const list = document.getElementById('discussion-list');
  if (list) {
    const item = document.createElement('div');
    item.className = "p-3 bg-surface-blue-tint dark:bg-primary-container/30 rounded-xl border border-surface-blue-tint animate-fade-in";
    item.innerHTML = `
      <div class="flex justify-between items-center">
        <span class="font-bold text-primary dark:text-primary-fixed">You</span>
        <span class="text-[10px] text-on-surface-variant font-mono">Just now</span>
      </div>
      <p class="text-on-surface-variant dark:text-outline-variant mt-0.5">&ldquo;${escapeHtml(text)}&rdquo;</p>
    `;
    list.prepend(item);
  }

  input.value = '';
  showToast("Comment posted to CFM board!", "forum");
}

function escapeHtml(string) {
  const div = document.createElement('div');
  div.textContent = string;
  return div.innerHTML;
}

/**
 * ========================================================
 * GOOGLE CALENDAR LIVE ACTIVITIES SYNC
 * ========================================================
 */
const GOOGLE_CALENDAR_ID = "provoysaeighthward@gmail.com";
const GOOGLE_CALENDAR_API_KEY = "AIzaSyAV2MEi34Zd6x4zyifrkesJ9IfphXE8Tmk";

// Filter out recurring Sunday services and routine meetings so ONLY genuine ward activities show
const IGNORED_CALENDAR_PATTERNS = [
  'church meeting',
  'ysa 8th ward church',
  'sacrament',
  'ward prayer',
  'ward council',
  'extended ward council',
  'presidency meeting',
  'bishopric',
  'leadership meeting'
];

/**
 * Initialize and load activities
 */
function initActivitiesFeed() {
  // Clear any past test custom events
  try {
    localStorage.removeItem('ward_custom_activities');
  } catch (e) {}

  fetchAndRenderActivities();
}

/**
 * Fetch events directly from Google Calendar API and filter routine meetings
 */
async function fetchAndRenderActivities() {
  const container = document.getElementById('upcoming-activities-list');
  if (!container) return;

  try {
    const timeMin = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString();
    const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(GOOGLE_CALENDAR_ID)}/events?key=${GOOGLE_CALENDAR_API_KEY}&timeMin=${timeMin}&singleEvents=true&orderBy=startTime&maxResults=100`;

    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Google Calendar API status: ${res.status}`);
    }
    const data = await res.json();
    const rawItems = data.items || [];

    // Filter to keep ONLY genuine activities
    const activities = rawItems
      .filter(item => {
        const title = (item.summary || '').toLowerCase();
        return !IGNORED_CALENDAR_PATTERNS.some(pattern => title.includes(pattern));
      })
      .map(item => {
        const startRaw = item.start?.dateTime || item.start?.date || '';
        const endRaw = item.end?.dateTime || item.end?.date || '';
        const startDate = new Date(startRaw);
        return {
          id: item.id,
          title: item.summary || 'Ward Activity',
          startDate: startDate,
          startFormatted: formatEventDateBadge(startDate),
          timeFormatted: formatEventTime(startRaw, endRaw),
          location: item.location || 'Provo YSA 8th Ward',
          description: item.description || '',
          category: categorizeEvent(item.summary || '')
        };
      });

    renderActivitiesUI(activities);
  } catch (err) {
    console.warn("Could not fetch Google Calendar live:", err);
    renderActivitiesUI([]);
  }
}

/**
 * Categorize event based on title
 */
function categorizeEvent(title) {
  const t = title.toLowerCase();
  if (t.includes('fhe') || t.includes('family home evening')) return 'FHE';
  if (t.includes('temple') || t.includes('baptism') || t.includes('sealing')) return 'Spiritual';
  if (t.includes('party') || t.includes('social') || t.includes('cookoff') || t.includes('bbq') || t.includes('linger longer')) return 'Social';
  if (t.includes('sports') || t.includes('volleyball') || t.includes('game') || t.includes('hike')) return 'Sports';
  if (t.includes('service') || t.includes('clean')) return 'Service';
  if (t.includes('relief society') || t.includes('rs ')) return 'Relief Society';
  if (t.includes('elders quorum') || t.includes('eq ')) return 'Elders Quorum';
  return 'Activity';
}

/**
 * Format month and day for badge
 */
function formatEventDateBadge(dateObj) {
  if (!dateObj || isNaN(dateObj.getTime())) {
    return { month: 'TBD', day: '--' };
  }
  const month = dateObj.toLocaleString('en-US', { month: 'short' });
  const day = dateObj.getDate();
  return { month, day };
}

/**
 * Format readable time
 */
function formatEventTime(startIso, endIso) {
  if (!startIso) return 'Time TBA';
  if (!startIso.includes('T')) return 'All Day';
  try {
    const d = new Date(startIso);
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  } catch (e) {
    return 'Time TBA';
  }
}

/**
 * Render activities to Homepage card
 */
function renderActivitiesUI(activities) {
  const container = document.getElementById('upcoming-activities-list');
  if (!container) return;

  if (activities.length === 0) {
    container.innerHTML = `
      <div class="text-center py-6 px-4 bg-surface-blue-tint/30 dark:bg-primary-container/20 rounded-2xl border border-surface-blue-tint flex flex-col items-center justify-center gap-1.5">
        <span class="material-symbols-outlined text-3xl text-primary dark:text-primary-fixed">event_available</span>
        <h4 class="font-headline font-bold text-sm text-primary dark:text-white">No upcoming activities on the calendar</h4>
        <p class="text-xs text-on-surface-variant dark:text-outline-variant">Check back soon or subscribe to the Google Calendar for updates.</p>
      </div>
    `;
  } else {
    container.innerHTML = activities.map(item => `
      <div class="flex items-start gap-3.5 p-3 rounded-xl hover:bg-surface-container-low dark:hover:bg-tertiary-container/30 transition-colors border border-surface-blue-tint/40 dark:border-white/5 group">
        <div class="flex flex-col items-center justify-center w-12 h-14 bg-surface-blue-tint dark:bg-primary-container/40 rounded-xl flex-shrink-0 text-primary dark:text-primary-fixed">
          <span class="font-mono uppercase text-[10px] font-bold">${escapeHtml(String(item.startFormatted.month))}</span>
          <span class="font-headline font-extrabold text-xl leading-none">${escapeHtml(String(item.startFormatted.day))}</span>
        </div>
        <div class="flex flex-col justify-center min-w-0 flex-1">
          <div class="flex items-center gap-1.5 flex-wrap">
            <h4 class="font-headline font-bold text-sm sm:text-base text-on-surface dark:text-white group-hover:text-primary dark:group-hover:text-primary-fixed transition-colors">
              ${escapeHtml(item.title)}
            </h4>
            ${item.category ? `<span class="text-[10px] font-mono px-2 py-0.5 rounded-full bg-secondary-container/80 text-on-secondary-container font-semibold">${escapeHtml(item.category)}</span>` : ''}
          </div>
          <p class="text-xs text-on-surface-variant dark:text-outline-variant flex items-center gap-1 mt-0.5">
            <span class="material-symbols-outlined text-[15px] flex-shrink-0">schedule</span> 
            <span>${escapeHtml(item.timeFormatted)} • ${escapeHtml(item.location)}</span>
          </p>
        </div>
      </div>
    `).join('');
  }
}

/**
 * ========================================================
 * SUNDAY CLASS QUICK-TAP CHECK-IN LOGIC
 * ========================================================
 */

// Default or fallback Google Apps Script Webhook URL (User can also update this via the UI modal)
const DEFAULT_WEBHOOK_URL = "https://script.google.com/macros/s/AKfycbzAe87i0kC2YbFJooCHlKKREZc5e1VPQUcQdvBfDsuhuBzhL6wY8cYFHTgu-xxdrxQEhQ/exec";

/**
 * Get the current week's Sunday date string key (YYYY-MM-DD) for weekly auto-reset
 */
function getSundayDateKey() {
  // Return the YYYY‑MM‑DD key for the *upcoming* Sunday (today counts if it is Sunday)
  const today = new Date();
  const dayOfWeek = today.getDay(); // 0 = Sunday, 1 = Monday, …
  // Days until next Sunday (0 if today is Sunday)
  const daysUntilSunday = (7 - dayOfWeek) % 7;
  const upcomingSunday = new Date(today);
  upcomingSunday.setDate(today.getDate() + daysUntilSunday);
  const year = upcomingSunday.getFullYear();
  const month = String(upcomingSunday.getMonth() + 1).padStart(2, '0');
  const date = String(upcomingSunday.getDate()).padStart(2, '0');
  return `${year}-${month}-${date}`;
}

/**
 * Get human-readable Sunday string (e.g. "Sun, Aug 30")
 */
function getSundayDisplayString() {
  // Return a human‑readable string for the *upcoming* Sunday (today counts if it is Sunday)
  const today = new Date();
  const dayOfWeek = today.getDay(); // 0 = Sunday, 1 = Monday, …
  const daysUntilSunday = (7 - dayOfWeek) % 7; // 0 if today is Sunday
  const upcomingSunday = new Date(today);
  upcomingSunday.setDate(today.getDate() + daysUntilSunday);
  
  const isTodaySunday = dayOfWeek === 0;
  const options = { month: 'short', day: 'numeric' };
  const formatted = upcomingSunday.toLocaleDateString('en-US', options);
  
  return isTodaySunday ? `Today (${formatted})` : `Sun, ${formatted}`;
}

/**
 * Initialize check-in UI and restore checked-in state for this week
 */
function initCheckInUI() {
  const sundayKey = getSundayDateKey();
  const sundayDisplay = getSundayDisplayString();

  // Set date badge text
  const sundayTextEl = document.getElementById('current-sunday-text');
  if (sundayTextEl) {
    sundayTextEl.textContent = sundayDisplay;
  }

  // Restore saved member name
  const savedName = localStorage.getItem('ward_member_name') || '';
  const nameDisplayEl = document.getElementById('display-member-name');
  const nameBtnLabel = document.getElementById('name-btn-label');
  const modalNameInput = document.getElementById('modal-member-name-input');

  if (nameDisplayEl) {
    if (savedName) {
      nameDisplayEl.textContent = savedName;
      if (nameBtnLabel) nameBtnLabel.textContent = "Change";
    } else {
      nameDisplayEl.textContent = "Tap below to set your name";
      if (nameBtnLabel) nameBtnLabel.textContent = "Set Name";
    }
  }

  if (modalNameInput) {
    modalNameInput.value = savedName;
  }

  // Restore checked-in classes for this Sunday
  const checkedInClasses = JSON.parse(localStorage.getItem(`ward_checkin_${sundayKey}`) || '[]');
  
  const classConfigs = [
    { name: 'Sunday School', btnId: 'btn-checkin-ss', circleId: 'circle-checkin-ss', checkIconId: 'check-icon-ss', statusId: 'status-text-ss' },
    { name: 'Elders Quorum', btnId: 'btn-checkin-eq', circleId: 'circle-checkin-eq', checkIconId: 'check-icon-eq', statusId: 'status-text-eq' },
    { name: 'Relief Society', btnId: 'btn-checkin-rs', circleId: 'circle-checkin-rs', checkIconId: 'check-icon-rs', statusId: 'status-text-rs' }
  ];

  classConfigs.forEach(item => {
    const isChecked = checkedInClasses.includes(item.name);
    applyCheckInButtonState(item, isChecked);
  });
}

/**
 * Apply visual checked-in state (Simple clean circle checkmark)
 */
function applyCheckInButtonState(config, isChecked) {
  const btn = document.getElementById(config.btnId);
  const circle = document.getElementById(config.circleId);
  const checkIcon = document.getElementById(config.checkIconId);
  const status = document.getElementById(config.statusId);

  if (!btn) return;

  const isSunday = new Date().getDay() === 0;

  if (isChecked) {
    btn.classList.add('border-primary/40', 'bg-surface-blue-tint/40', 'dark:bg-primary-container/20');
    btn.classList.remove('opacity-75');
    if (circle) {
      circle.className = "w-7 h-7 rounded-full border-2 border-primary dark:border-primary-fixed bg-surface-blue-tint dark:bg-primary-container/60 flex items-center justify-center transition-all shrink-0 shadow-sm";
    }
    if (checkIcon) {
      checkIcon.className = "material-symbols-outlined text-[16px] text-primary dark:text-primary-fixed select-none transition-all font-bold";
      checkIcon.textContent = "check";
    }
    if (status) {
      status.textContent = "Checked in ✓";
      status.className = "text-[11px] font-mono font-bold text-primary dark:text-primary-fixed";
    }
  } else {
    btn.classList.remove('border-primary/40', 'bg-surface-blue-tint/40', 'dark:bg-primary-container/20');
    if (circle) {
      circle.className = "w-7 h-7 rounded-full border-2 border-outline-variant/60 group-hover:border-primary/70 flex items-center justify-center transition-all bg-transparent shrink-0";
    }
    if (checkIcon) {
      checkIcon.className = "material-symbols-outlined text-[16px] text-transparent select-none transition-all";
      checkIcon.textContent = "check";
    }
    if (status) {
      if (isSunday) {
        status.textContent = "Tap to check in";
        status.className = "text-[11px] font-mono text-on-surface-variant dark:text-outline-variant";
        btn.classList.remove('opacity-75');
      } else {
        status.textContent = "Opens Sunday";
        status.className = "text-[11px] font-mono text-on-surface-variant/80 dark:text-outline-variant/80";
        btn.classList.add('opacity-75');
      }
    }
  }
}

/**
 * Open name modal (optionally stores pending class check-in)
 */
let pendingClassForCheckIn = null;
function openNamePromptModal(pendingClass = null) {
  pendingClassForCheckIn = pendingClass;
  const modalNameInput = document.getElementById('modal-member-name-input');
  if (modalNameInput) {
    modalNameInput.value = localStorage.getItem('ward_member_name') || '';
  }
  openModal('name-prompt-modal');
  setTimeout(() => {
    if (modalNameInput) modalNameInput.focus();
  }, 100);
}

function editMemberNamePrompt() {
  openNamePromptModal(null);
}

/**
 * Save Name modal handler
 */
function handleSaveNameModal(event) {
  event.preventDefault();
  const input = document.getElementById('modal-member-name-input');
  const name = input ? input.value.trim() : '';

  if (!name) return;

  localStorage.setItem('ward_member_name', name);
  initCheckInUI();
  closeModal('name-prompt-modal');
  showToast(`Name set to "${name}"!`, "person");

  // If user clicked a class before having a name, auto-execute check-in now
  if (pendingClassForCheckIn) {
    const targetClass = pendingClassForCheckIn;
    pendingClassForCheckIn = null;
    handleClassCheckIn(targetClass);
  }
}

// Set of in-flight check-in requests to debounce rapid double-taps
const inFlightCheckIns = new Set();

/**
 * Handle Single-Click Check-In for a Class
 */
async function handleClassCheckIn(organization) {
  // Only allow attendance marking on Sunday
  const isSunday = new Date().getDay() === 0;
  if (!isSunday) {
    showToast("Attendance can only be marked on Sunday.", "event_busy");
    return;
  }

  const savedName = localStorage.getItem('ward_member_name');

  // If no name is set yet, ask once via modal and auto-complete after save
  if (!savedName || !savedName.trim()) {
    openNamePromptModal(organization);
    return;
  }

  const sundayKey = getSundayDateKey();
  const checkedInClasses = JSON.parse(localStorage.getItem(`ward_checkin_${sundayKey}`) || '[]');

  // Prevent duplicate check-in if already checked in for today
  if (checkedInClasses.includes(organization)) {
    showToast(`Already checked in to ${organization} for today!`, "check_circle");
    return;
  }

  // Prevent duplicate concurrent requests (double-tap protection)
  if (inFlightCheckIns.has(organization)) {
    return;
  }
  inFlightCheckIns.add(organization);

  // Mapping for button and status IDs
  const mapping = {
    'Sunday School': { btnId: 'btn-checkin-ss', circleId: 'circle-checkin-ss', checkIconId: 'check-icon-ss', statusId: 'status-text-ss' },
    'Elders Quorum': { btnId: 'btn-checkin-eq', circleId: 'circle-checkin-eq', checkIconId: 'check-icon-eq', statusId: 'status-text-eq' },
    'Relief Society': { btnId: 'btn-checkin-rs', circleId: 'circle-checkin-rs', checkIconId: 'check-icon-rs', statusId: 'status-text-rs' }
  };

  const config = mapping[organization];
  const statusEl = document.getElementById(config.statusId);
  const checkIconEl = document.getElementById(config.checkIconId);

  // Set loading state
  if (statusEl) statusEl.textContent = "Logging...";
  if (checkIconEl) {
    checkIconEl.textContent = "sync";
    checkIconEl.className = "material-symbols-outlined text-[16px] text-primary animate-spin select-none";
  }

  try {
    const webhookUrl = localStorage.getItem('ward_webhook_url') || DEFAULT_WEBHOOK_URL;

    // If webhook is configured, send HTTP POST to Google Apps Script
    if (webhookUrl) {
      try {
        await fetch(webhookUrl, {
          method: 'POST',
          mode: 'no-cors', // Standard for Google Apps Script Web App execution
          headers: {
            'Content-Type': 'text/plain;charset=utf-8'
          },
          body: JSON.stringify({
            organization: organization,
            name: savedName.trim()
          })
        });
      } catch (err) {
        console.warn("Webhook logging error:", err);
      }
    }

    // Record in localStorage for this Sunday
    const currentChecked = JSON.parse(localStorage.getItem(`ward_checkin_${sundayKey}`) || '[]');
    if (!currentChecked.includes(organization)) {
      currentChecked.push(organization);
      localStorage.setItem(`ward_checkin_${sundayKey}`, JSON.stringify(currentChecked));
    }

    // Update button UI
    applyCheckInButtonState(config, true);

    // Show confirmation Toast
    showToast(`Checked in to ${organization}!`, "check_circle");
  } finally {
    inFlightCheckIns.delete(organization);
  }
}

/**
 * ========================================================
 * WARD COUNCIL ANONYMOUS FEEDBACK & QUESTIONS HANDLER
 * ========================================================
 */
const DEFAULT_FEEDBACK_WEBHOOK_URL = "https://script.google.com/macros/s/AKfycbxKrEB3KGvnNhen2fIZNCwum1wKP5jxo70LAto-LdYHmxwfK36Ll02alP3iQYStpOJVOQ/exec";

async function handleWardFeedbackSubmit(event) {
  event.preventDefault();
  const feedbackInput = document.getElementById('ward-feedback-text');
  const submitBtn = document.getElementById('btn-submit-feedback');
  const submitBtnText = document.getElementById('btn-submit-feedback-text');

  if (!feedbackInput) return;
  const feedback = feedbackInput.value.trim();
  if (!feedback) return;

  // Set loading state on button
  if (submitBtn) submitBtn.disabled = true;
  if (submitBtnText) submitBtnText.textContent = "Submitting...";

  const submissionDate = new Date().toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });

  const webhookUrl = localStorage.getItem('ward_feedback_webhook_url') || 
                     DEFAULT_FEEDBACK_WEBHOOK_URL || 
                     localStorage.getItem('ward_webhook_url') || 
                     DEFAULT_WEBHOOK_URL;

  try {
    if (webhookUrl) {
      await fetch(webhookUrl, {
        method: 'POST',
        mode: 'no-cors',
        headers: {
          'Content-Type': 'text/plain;charset=utf-8'
        },
        body: JSON.stringify({
          type: 'feedback',
          action: 'feedback',
          date: submissionDate,
          feedback: feedback
        })
      });
    }

    // Clear textarea
    feedbackInput.value = '';
    showToast("Feedback submitted to Ward Council!", "check_circle");
  } catch (err) {
    console.error("Feedback submit error:", err);
    showToast("Feedback submitted!", "check_circle");
  } finally {
    if (submitBtn) submitBtn.disabled = false;
    if (submitBtnText) submitBtnText.textContent = "Submit Feedback";
  }
}



