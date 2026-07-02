/* =====================================================================
   CONFIGURATION — edit these before use
   ===================================================================== */
const CONFIG = {
  // Paste the Web App URL from Deploy > Manage deployments in Apps
  // Script. It looks like: https://script.google.com/macros/s/XXXX/exec
  API_URL: 'https://script.google.com/macros/s/AKfycbxNAkiO7obV1e94M4Px5g9yzobHBdzysfzmpz5SBSonvuGcpsx3Kbdjgc0GngwuC2sJCA/exec',

  // Must exactly match the API_KEY constant at the top of Code.gs.
  API_KEY: 'my-journal-secret-2026',

  // Optional: personalizes the dashboard greeting ("Good evening, Heng").
  // Leave blank for a generic greeting.
  USER_NAME: ''
};

/* =====================================================================
   STATE
   ===================================================================== */
let state = {
  entries: [],
  currentView: 'dashboard',
  currentEditId: null,
  currentViewId: null,
  pendingDeleteId: null,
  selectedMood: '😊',
  tags: [],
  theme: 'light'
};

/* =====================================================================
   INITIALIZATION
   ===================================================================== */
document.addEventListener('DOMContentLoaded', init);

async function init() {
  loadTheme();
  bindEvents();
  setDefaultDate();
  renderGreeting();
  renderDayArc();

  if (!isConfigured()) {
    showConfigBanner();
    renderAll();
    return;
  }

  await loadEntries();
  startAutoRefresh();
}

function isConfigured() {
  return Boolean(CONFIG.API_URL) && !CONFIG.API_URL.includes('PASTE_YOUR');
}

/* =====================================================================
   API — every operation goes through doPost as text/plain to dodge
   Apps Script's lack of CORS-preflight support (see Code.gs header).
   ===================================================================== */
async function apiCall(action, data) {
  const controller = new AbortController();
  const timeoutId = setTimeout(function () { controller.abort(); }, 20000);

  try {
    const res = await fetch(CONFIG.API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: action, apiKey: CONFIG.API_KEY, data: data || {} }),
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    if (!res.ok) throw new Error('Server responded with status ' + res.status + '.');
    const json = await res.json();
    if (json.status === 'error') throw new Error(json.message || 'Something went wrong.');
    return json;
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      throw new Error('Request timed out. Check your connection and try again.');
    }
    throw err;
  }
}

async function loadEntries() {
  hideErrorBanner();
  const firstLoad = state.entries.length === 0;
  showLoading(firstLoad);

  try {
    const res = await apiCall('list');
    state.entries = res.entries || [];
    renderAll();
  } catch (err) {
    showErrorBanner(err.message || 'Could not load your journal entries.');
    if (!firstLoad) showToast(err.message || 'Failed to refresh entries.', 'error');
  } finally {
    showLoading(false);
  }
}

/**
 * Quietly re-fetches entries in the background — used for automatic
 * triggers (tab regains focus/visibility, periodic polling) rather than
 * explicit user actions. This is what makes an entry added on your
 * phone show up on an already-open desktop tab without a manual
 * reload. Deliberately silent: no loading spinner, no error toast — it
 * just re-renders if something changed, since the user never asked for
 * this refresh and shouldn't be interrupted by it. Skips entirely while
 * a modal is open, so it never swaps data out from under an active
 * edit or view.
 */
let isRefreshing = false;
async function silentRefresh() {
  if (isRefreshing || !isConfigured() || anyModalOpen()) return;
  isRefreshing = true;
  renderGreeting();
  renderDayArc();
  try {
    const res = await apiCall('list');
    state.entries = res.entries || [];
    renderAll();
    hideErrorBanner();
  } catch (err) {
    // Stay quiet — an explicit action (the refresh button, opening the
    // app fresh) will surface a genuine connection problem instead.
  } finally {
    isRefreshing = false;
  }
}

function startAutoRefresh() {
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') silentRefresh();
  });
  window.addEventListener('focus', silentRefresh);
  setInterval(function () {
    if (document.visibilityState === 'visible') silentRefresh();
  }, 60000);
}

/* =====================================================================
   THEME
   ===================================================================== */
function loadTheme() {
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  setTheme(prefersDark ? 'dark' : 'light');
}

function setTheme(theme) {
  state.theme = theme;
  document.documentElement.setAttribute('data-theme', theme);
  document.getElementById('themeToggle').textContent = theme === 'dark' ? '☀️' : '🌙';
  document.getElementById('themeColorMeta').setAttribute('content', theme === 'dark' ? '#14171F' : '#EEF1EE');
}

function toggleTheme() {
  setTheme(state.theme === 'dark' ? 'light' : 'dark');
}

/* =====================================================================
   SIGNATURE VISUAL — the day/night arc in the dashboard hero
   ===================================================================== */
function renderDayArc() {
  const path = document.getElementById('dayArcPath');
  const dot = document.getElementById('dayArcDot');
  if (!path || !dot) return;

  const now = new Date();
  const hour = now.getHours() + now.getMinutes() / 60;
  const isDaytime = hour >= 6 && hour <= 20;

  let fraction;
  if (isDaytime) {
    fraction = (hour - 6) / 14; // 6am -> 8pm mapped to 0..1 along the arc
  } else {
    fraction = hour < 6 ? 0 : 1; // rests at the horizon overnight
  }
  fraction = Math.max(0, Math.min(1, fraction));

  const totalLength = path.getTotalLength();
  const point = path.getPointAtLength(totalLength * fraction);

  dot.setAttribute('cx', point.x);
  dot.setAttribute('cy', point.y);
  dot.setAttribute('r', isDaytime ? 6 : 4.5);
  dot.setAttribute('fill', isDaytime ? 'var(--accent)' : 'var(--secondary)');
}

/* =====================================================================
   NAVIGATION
   ===================================================================== */
function switchView(view) {
  state.currentView = view;
  document.getElementById('dashboardView').classList.toggle('active', view === 'dashboard');
  document.getElementById('entriesView').classList.toggle('active', view === 'entries');

  document.querySelectorAll('.nav-btn').forEach(function (btn) {
    btn.classList.toggle('active', btn.dataset.view === view);
  });
  document.querySelectorAll('.bottom-nav-btn').forEach(function (btn) {
    btn.classList.toggle('active', btn.dataset.view === view);
  });

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* =====================================================================
   DATE / GREETING HELPERS
   ===================================================================== */
function toDateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + day;
}

function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const parts = dateStr.split('-').map(Number);
  const date = new Date(parts[0], parts[1] - 1, parts[2]);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  if (isSameDay(date, today)) return 'Today';
  if (isSameDay(date, yesterday)) return 'Yesterday';
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function getGreeting() {
  const hour = new Date().getHours();
  let greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  if (CONFIG.USER_NAME) greeting += ', ' + CONFIG.USER_NAME;
  return greeting;
}

function renderGreeting() {
  document.getElementById('greeting').textContent = getGreeting();
  document.getElementById('todayDate').textContent = new Date().toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric'
  });
}

function setDefaultDate() {
  document.getElementById('entryDate').value = toDateStr(new Date());
}

/* =====================================================================
   RENDERING — dashboard & entries list
   ===================================================================== */
function renderAll() {
  renderDashboard();
  renderEntriesList();
}

function renderDashboard() {
  const stats = computeStats(state.entries);
  document.getElementById('statTotal').textContent = stats.total;
  document.getElementById('statStreak').textContent = stats.streak;
  document.getElementById('statMonth').textContent = stats.thisMonth;
  document.getElementById('statMood').textContent = stats.topMood;

  const todayStr = toDateStr(new Date());
  const hasToday = state.entries.some(function (e) { return e.date === todayStr; });
  document.getElementById('todayPrompt').classList.toggle('hidden', hasToday);

  const container = document.getElementById('recentEntriesList');
  container.innerHTML = '';
  const recent = state.entries.slice(0, 5);

  if (recent.length === 0) {
    container.appendChild(buildEmptyState('📝', 'No entries yet', 'Start journaling to see your recent entries here.', true));
    return;
  }
  recent.forEach(function (entry) { container.appendChild(renderEntryCard(entry)); });
}

function computeStats(entries) {
  const total = entries.length;
  const streak = computeStreak(entries);

  const now = new Date();
  const thisMonth = entries.filter(function (e) {
    const parts = e.date.split('-').map(Number);
    return parts[0] === now.getFullYear() && (parts[1] - 1) === now.getMonth();
  }).length;

  const moodCounts = {};
  entries.forEach(function (e) {
    if (e.mood) moodCounts[e.mood] = (moodCounts[e.mood] || 0) + 1;
  });
  let topMood = '—';
  let topCount = 0;
  Object.keys(moodCounts).forEach(function (mood) {
    if (moodCounts[mood] > topCount) { topMood = mood; topCount = moodCounts[mood]; }
  });

  return { total: total, streak: streak, thisMonth: thisMonth, topMood: topMood };
}

function computeStreak(entries) {
  const dateSet = new Set(entries.map(function (e) { return e.date; }));
  const cursor = new Date();
  cursor.setHours(0, 0, 0, 0);

  if (!dateSet.has(toDateStr(cursor))) {
    cursor.setDate(cursor.getDate() - 1); // no entry yet today — still count an active streak through yesterday
  }

  let streak = 0;
  while (dateSet.has(toDateStr(cursor))) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

function renderEntriesList() {
  populateTagFilter();
  const filtered = getFilteredEntries();
  const container = document.getElementById('allEntriesList');
  container.innerHTML = '';

  if (filtered.length === 0) {
    const hasAny = state.entries.length > 0;
    container.appendChild(buildEmptyState(
      hasAny ? '🔍' : '📝',
      hasAny ? 'No matching entries' : 'No entries yet',
      hasAny ? 'Try adjusting your search or filters.' : 'Start journaling to build your collection.',
      !hasAny
    ));
    return;
  }
  filtered.forEach(function (entry) { container.appendChild(renderEntryCard(entry)); });
}

function getFilteredEntries() {
  const search = document.getElementById('searchInput').value.trim().toLowerCase();
  const dateVal = document.getElementById('dateFilter').value;
  const tagVal = document.getElementById('tagFilter').value;

  return state.entries.filter(function (entry) {
    if (search) {
      const haystack = (entry.title + ' ' + entry.content + ' ' + entry.tags + ' ' + (entry.location || '')).toLowerCase();
      if (haystack.indexOf(search) === -1) return false;
    }
    if (dateVal && entry.date !== dateVal) return false;
    if (tagVal && parseTags(entry.tags).indexOf(tagVal) === -1) return false;
    return true;
  });
}

function populateTagFilter() {
  const select = document.getElementById('tagFilter');
  const currentVal = select.value;
  const allTags = new Set();
  state.entries.forEach(function (entry) { parseTags(entry.tags).forEach(function (t) { allTags.add(t); }); });
  const sorted = Array.from(allTags).sort(function (a, b) { return a.localeCompare(b); });

  select.innerHTML = '';
  const defaultOpt = document.createElement('option');
  defaultOpt.value = '';
  defaultOpt.textContent = 'All tags';
  select.appendChild(defaultOpt);

  sorted.forEach(function (tag) {
    const opt = document.createElement('option');
    opt.value = tag;
    opt.textContent = tag;
    select.appendChild(opt);
  });

  if (sorted.indexOf(currentVal) !== -1) select.value = currentVal;
}

function clearFilters() {
  document.getElementById('searchInput').value = '';
  document.getElementById('dateFilter').value = '';
  document.getElementById('tagFilter').value = '';
  renderEntriesList();
}

/* =====================================================================
   ENTRY CARD (built via DOM APIs — no innerHTML with user content)
   ===================================================================== */
function renderEntryCard(entry) {
  const card = document.createElement('article');
  card.className = 'entry-card';
  card.tabIndex = 0;
  card.setAttribute('role', 'button');
  card.setAttribute('aria-label', 'View entry: ' + entry.title);

  const header = document.createElement('div');
  header.className = 'entry-card-header';

  const mood = document.createElement('span');
  mood.className = 'entry-card-mood';
  mood.textContent = entry.mood || '📝';
  header.appendChild(mood);

  const titleWrap = document.createElement('div');
  titleWrap.className = 'entry-card-title-wrap';

  const title = document.createElement('h3');
  title.className = 'entry-card-title';
  title.textContent = entry.title;

  const date = document.createElement('span');
  date.className = 'entry-card-date';
  date.textContent = formatDate(entry.date);

  titleWrap.appendChild(title);
  titleWrap.appendChild(date);
  header.appendChild(titleWrap);
  card.appendChild(header);

  const preview = document.createElement('p');
  preview.className = 'entry-card-preview';
  preview.textContent = truncate(entry.content, 130);
  card.appendChild(preview);

  const tags = parseTags(entry.tags);
  if (tags.length || entry.location) {
    const footer = document.createElement('div');
    footer.className = 'entry-card-footer';
    tags.forEach(function (tag) {
      const chip = document.createElement('span');
      chip.className = 'tag-chip';
      chip.textContent = tag;
      footer.appendChild(chip);
    });
    if (entry.location) {
      const loc = document.createElement('span');
      loc.className = 'entry-card-location';
      loc.textContent = '📍 ' + entry.location;
      footer.appendChild(loc);
    }
    card.appendChild(footer);
  }

  function open() { openViewModal(entry.id); }
  card.addEventListener('click', open);
  card.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
  });

  return card;
}

function buildEmptyState(icon, title, message, showCta) {
  const wrap = document.createElement('div');
  wrap.className = 'empty-state';

  const iconEl = document.createElement('div');
  iconEl.className = 'empty-state-icon';
  iconEl.textContent = icon;

  const titleEl = document.createElement('h3');
  titleEl.textContent = title;

  const msgEl = document.createElement('p');
  msgEl.textContent = message;

  wrap.appendChild(iconEl);
  wrap.appendChild(titleEl);
  wrap.appendChild(msgEl);

  if (showCta) {
    const btn = document.createElement('button');
    btn.className = 'btn btn-primary';
    btn.textContent = '+ Write your first entry';
    btn.addEventListener('click', openNewEntryModal);
    wrap.appendChild(btn);
  }
  return wrap;
}

/* =====================================================================
   MODALS
   ===================================================================== */
function openModal(id) {
  const modal = document.getElementById(id);
  modal.classList.remove('hidden');
  document.body.classList.add('modal-open');
  const focusTarget = modal.querySelector('input, textarea, button:not([data-close])');
  if (focusTarget) setTimeout(function () { focusTarget.focus(); }, 60);
}

function closeModal(id) {
  document.getElementById(id).classList.add('hidden');
  const anyOpen = document.querySelectorAll('.modal-overlay:not(.hidden)').length > 0;
  if (!anyOpen) document.body.classList.remove('modal-open');
}

function closeAllModals() {
  document.querySelectorAll('.modal-overlay').forEach(function (m) { m.classList.add('hidden'); });
  document.body.classList.remove('modal-open');
}

function anyModalOpen() {
  return document.querySelectorAll('.modal-overlay:not(.hidden)').length > 0;
}

/* ---- Entry Form (create / edit) ---- */
function openNewEntryModal() {
  state.currentEditId = null;
  document.getElementById('formModalTitle').textContent = 'New Entry';
  document.getElementById('entryForm').reset();
  document.getElementById('entryId').value = '';
  setDefaultDate();
  state.selectedMood = '😊';
  updateMoodSelection();
  state.tags = [];
  renderTagChips();
  updateCharCount();
  openModal('entryFormModal');
}

function openEditModal(id) {
  const entry = state.entries.find(function (e) { return e.id === id; });
  if (!entry) return;

  state.currentEditId = id;
  document.getElementById('formModalTitle').textContent = 'Edit Entry';
  document.getElementById('entryId').value = entry.id;
  document.getElementById('entryDate').value = entry.date;
  document.getElementById('entryTitle').value = entry.title;
  document.getElementById('entryContent').value = entry.content;
  document.getElementById('entryLocation').value = entry.location || '';
  state.selectedMood = entry.mood || '😊';
  updateMoodSelection();
  state.tags = parseTags(entry.tags);
  renderTagChips();
  updateCharCount();
  autoResizeTextarea(document.getElementById('entryContent'));

  closeModal('viewEntryModal');
  openModal('entryFormModal');
}

/* ---- View Entry ---- */
function openViewModal(id) {
  const entry = state.entries.find(function (e) { return e.id === id; });
  if (!entry) return;

  state.currentViewId = id;
  document.getElementById('viewEntryTitle').textContent = entry.title;
  document.getElementById('viewEntryDate').textContent = formatDate(entry.date);
  document.getElementById('viewEntryMood').textContent = entry.mood || '';
  document.getElementById('viewEntryLocation').textContent = entry.location ? '📍 ' + entry.location : '';
  document.getElementById('viewEntryContent').textContent = entry.content;

  const tagsContainer = document.getElementById('viewEntryTags');
  tagsContainer.innerHTML = '';
  parseTags(entry.tags).forEach(function (tag) {
    const chip = document.createElement('span');
    chip.className = 'tag-chip';
    chip.textContent = tag;
    tagsContainer.appendChild(chip);
  });

  openModal('viewEntryModal');
}

/* ---- Confirm Delete ---- */
function openConfirmDelete(id) {
  if (!id) return;
  state.pendingDeleteId = id;
  openModal('confirmModal');
}

/* =====================================================================
   MOOD PICKER
   ===================================================================== */
function updateMoodSelection() {
  document.querySelectorAll('.mood-option').forEach(function (btn) {
    const selected = btn.dataset.mood === state.selectedMood;
    btn.classList.toggle('selected', selected);
    btn.setAttribute('aria-pressed', selected ? 'true' : 'false');
  });
}

/* =====================================================================
   TAG CHIPS
   ===================================================================== */
function parseTags(tagsStr) {
  if (!tagsStr) return [];
  return tagsStr.split(',').map(function (t) { return t.trim(); }).filter(Boolean);
}

function addTag(raw) {
  const tag = raw.trim();
  if (!tag) return;
  if (state.tags.indexOf(tag) !== -1) return;
  if (state.tags.length >= 10) {
    showToast('Up to 10 tags per entry.', 'error');
    return;
  }
  state.tags.push(tag);
  renderTagChips();
}

function removeTag(tag) {
  state.tags = state.tags.filter(function (t) { return t !== tag; });
  renderTagChips();
}

function renderTagChips() {
  const container = document.getElementById('tagChips');
  container.innerHTML = '';
  state.tags.forEach(function (tag) {
    const chip = document.createElement('span');
    chip.className = 'tag-chip removable';

    const label = document.createElement('span');
    label.textContent = tag;
    chip.appendChild(label);

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'tag-remove';
    removeBtn.setAttribute('aria-label', 'Remove tag ' + tag);
    removeBtn.textContent = '×';
    removeBtn.addEventListener('click', function () { removeTag(tag); });
    chip.appendChild(removeBtn);

    container.appendChild(chip);
  });
  populateTagSuggestions();
}

/**
 * Fills the tag input's <datalist> with every tag already used anywhere
 * in the journal, minus whatever's already on the entry being edited —
 * so typing offers a pick from past tags (avoiding "Work" vs "work"
 * drift) while leaving typing a brand new tag completely unaffected.
 * Picking a suggestion (or typing one out fully) still requires Enter/
 * comma/blur to add it, same as any other tag — this only assists
 * typing, it never adds a tag on its own.
 */
function populateTagSuggestions() {
  const datalist = document.getElementById('tagSuggestions');
  const allTags = new Set();
  state.entries.forEach(function (entry) {
    parseTags(entry.tags).forEach(function (t) { allTags.add(t); });
  });

  datalist.innerHTML = '';
  Array.from(allTags)
    .filter(function (tag) { return state.tags.indexOf(tag) === -1; })
    .sort(function (a, b) { return a.localeCompare(b); })
    .forEach(function (tag) {
      const opt = document.createElement('option');
      opt.value = tag;
      datalist.appendChild(opt);
    });
}

function handleTagInputKeydown(e) {
  if (e.key === 'Enter' || e.key === ',') {
    e.preventDefault();
    addTag(e.target.value.replace(/,$/, ''));
    e.target.value = '';
  } else if (e.key === 'Backspace' && e.target.value === '' && state.tags.length) {
    removeTag(state.tags[state.tags.length - 1]);
  }
}

/* =====================================================================
   FORM SUBMISSION
   ===================================================================== */
function updateCharCount() {
  const contentEl = document.getElementById('entryContent');
  const count = contentEl.value.length;
  const counter = document.getElementById('charCount');
  counter.textContent = count.toLocaleString();
  counter.parentElement.classList.toggle('char-count-warning', count > 18000);
}

function autoResizeTextarea(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 480) + 'px';
}

async function handleFormSubmit(e) {
  e.preventDefault();

  const payload = {
    date: document.getElementById('entryDate').value,
    title: document.getElementById('entryTitle').value.trim(),
    content: document.getElementById('entryContent').value.trim(),
    mood: state.selectedMood,
    tags: state.tags.join(', '),
    location: document.getElementById('entryLocation').value.trim()
  };

  if (!payload.date || !payload.title || !payload.content) {
    showToast('Please fill in the date, title, and content.', 'error');
    return;
  }

  const saveBtn = document.getElementById('saveEntryBtn');
  setButtonLoading(saveBtn, true);

  try {
    if (state.currentEditId) {
      payload.id = state.currentEditId;
      await apiCall('update', payload);
      showToast('Entry updated.', 'success');
    } else {
      await apiCall('create', payload);
      showToast('Entry saved.', 'success');
    }
    closeModal('entryFormModal');
    await loadEntries();
  } catch (err) {
    showToast(err.message || 'Could not save your entry. Please try again.', 'error');
  } finally {
    setButtonLoading(saveBtn, false);
  }
}

async function confirmDelete() {
  const id = state.pendingDeleteId;
  if (!id) return;

  const btn = document.getElementById('confirmDeleteBtn');
  setButtonLoading(btn, true);

  try {
    await apiCall('delete', { id: id });
    showToast('Entry deleted.', 'success');
    closeModal('confirmModal');
    closeModal('viewEntryModal');
    state.pendingDeleteId = null;
    await loadEntries();
  } catch (err) {
    showToast(err.message || 'Could not delete this entry.', 'error');
  } finally {
    setButtonLoading(btn, false);
  }
}

function setButtonLoading(btn, loading) {
  btn.disabled = loading;
  const text = btn.querySelector('.btn-text');
  const spinner = btn.querySelector('.btn-spinner');
  if (text) text.classList.toggle('hidden', loading);
  if (spinner) spinner.classList.toggle('hidden', !loading);
}

/* =====================================================================
   TOASTS / LOADING / BANNERS
   ===================================================================== */
function showToast(message, type) {
  type = type || 'info';
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = 'toast toast-' + type;

  const icon = document.createElement('span');
  icon.className = 'toast-icon';
  icon.textContent = type === 'success' ? '✓' : type === 'error' ? '✕' : 'ℹ';

  const text = document.createElement('span');
  text.textContent = message;

  toast.appendChild(icon);
  toast.appendChild(text);
  container.appendChild(toast);

  requestAnimationFrame(function () { toast.classList.add('show'); });
  setTimeout(function () {
    toast.classList.remove('show');
    setTimeout(function () { toast.remove(); }, 300);
  }, 3200);
}

function showLoading(show) {
  document.getElementById('loadingOverlay').classList.toggle('hidden', !show);
}

function showConfigBanner() {
  document.getElementById('configBanner').classList.remove('hidden');
}

function showErrorBanner(message) {
  document.getElementById('errorBannerText').textContent = message;
  document.getElementById('errorBanner').classList.remove('hidden');
}

function hideErrorBanner() {
  document.getElementById('errorBanner').classList.add('hidden');
}

/* =====================================================================
   UTILITIES
   ===================================================================== */
function truncate(str, maxLen) {
  if (!str) return '';
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen).trim() + '…';
}

function debounce(fn, delay) {
  let timer;
  return function () {
    const args = arguments;
    const ctx = this;
    clearTimeout(timer);
    timer = setTimeout(function () { fn.apply(ctx, args); }, delay);
  };
}

function isTypingInField(el) {
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

/* =====================================================================
   KEYBOARD SHORTCUTS
   ===================================================================== */
function handleGlobalKeydown(e) {
  const isSaveCombo = (e.ctrlKey || e.metaKey) && e.key === 'Enter';
  const formOpen = !document.getElementById('entryFormModal').classList.contains('hidden');

  if (isSaveCombo && formOpen) {
    e.preventDefault();
    document.getElementById('entryForm').requestSubmit();
    return;
  }
  if (e.key === 'Escape' && anyModalOpen()) {
    closeAllModals();
    return;
  }
  if (e.key === 'n' && !isTypingInField(e.target) && !anyModalOpen()) {
    e.preventDefault();
    openNewEntryModal();
  }
}

/* =====================================================================
   EVENT BINDING
   ===================================================================== */
function bindEvents() {
  document.querySelectorAll('.nav-btn, .bottom-nav-btn').forEach(function (btn) {
    btn.addEventListener('click', function () { switchView(btn.dataset.view); });
  });

  document.querySelectorAll('.new-entry-trigger').forEach(function (btn) {
    btn.addEventListener('click', openNewEntryModal);
  });

  document.getElementById('themeToggle').addEventListener('click', toggleTheme);

  document.getElementById('refreshBtn').addEventListener('click', async function () {
    const btn = document.getElementById('refreshBtn');
    btn.classList.add('spinning');
    btn.disabled = true;
    await loadEntries();
    btn.classList.remove('spinning');
    btn.disabled = false;
  });

  document.querySelectorAll('[data-close]').forEach(function (btn) {
    btn.addEventListener('click', function () { closeModal(btn.dataset.close); });
  });
  document.querySelectorAll('.modal-overlay').forEach(function (overlay) {
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) closeModal(overlay.id);
    });
  });

  document.getElementById('entryForm').addEventListener('submit', handleFormSubmit);

  document.getElementById('moodPicker').addEventListener('click', function (e) {
    const btn = e.target.closest('.mood-option');
    if (!btn) return;
    state.selectedMood = btn.dataset.mood;
    updateMoodSelection();
  });

  const tagInput = document.getElementById('tagInput');
  tagInput.addEventListener('keydown', handleTagInputKeydown);
  tagInput.addEventListener('blur', function () {
    if (tagInput.value.trim()) { addTag(tagInput.value); tagInput.value = ''; }
  });

  const contentEl = document.getElementById('entryContent');
  contentEl.addEventListener('input', function () {
    updateCharCount();
    autoResizeTextarea(contentEl);
  });

  document.getElementById('editEntryBtn').addEventListener('click', function () { openEditModal(state.currentViewId); });
  document.getElementById('deleteEntryBtn').addEventListener('click', function () { openConfirmDelete(state.currentViewId); });
  document.getElementById('confirmDeleteBtn').addEventListener('click', confirmDelete);

  document.getElementById('searchInput').addEventListener('input', debounce(renderEntriesList, 200));
  document.getElementById('dateFilter').addEventListener('change', renderEntriesList);
  document.getElementById('tagFilter').addEventListener('change', renderEntriesList);
  document.getElementById('clearFiltersBtn').addEventListener('click', clearFilters);

  document.getElementById('todayPromptBtn').addEventListener('click', openNewEntryModal);
  document.getElementById('retryBtn').addEventListener('click', loadEntries);

  document.addEventListener('keydown', handleGlobalKeydown);
}