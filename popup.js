// popup.js — Main popup controller
// Orchestrates all 5 features across 4 tabs
// Depends on: storage.js, ai.js, analytics.js (loaded first in popup.html)

'use strict';

// ─── STATE ────────────────────────────────────────────────────────────────────

const STATE = {
  todayRawTabs:     [],   // raw chrome.tabs objects
  todayRefined:     [],   // AI-refined task strings
  todayCategories:  {},   // { "Frontend Dev": ["task..."], ... }
  standupFormat:    'short',
  lastTimelineText: '',
  currentReportStats: null,
  currentReportPeriod: 'weekly',

  historyDate:      '',
  historyTasks:     [],   // tab-history entries for selected date

  reportPeriod:     'weekly'
};

// ─── CATEGORY → CSS CLASS MAP ─────────────────────────────────────────────────

const CAT_CLASS = {
  'Frontend Development': 'cat-frontend',
  'Backend Development':  'cat-backend',
  'Salesforce':           'cat-salesforce',
  'Meetings':             'cat-meetings',
  'Research':             'cat-research',
  'DevOps':               'cat-devops',
  'Testing':              'cat-testing',
  'Design':               'cat-design',
  'Other':                'cat-other'
};

function catClass(cat) { return CAT_CLASS[cat] || 'cat-other'; }

// ─── DOM HELPERS ──────────────────────────────────────────────────────────────

function $(id) { return document.getElementById(id); }

function show(id) { const e = $(id); if (e) e.style.display = ''; }
function hide(id) { const e = $(id); if (e) e.style.display = 'none'; }
function showBlock(id) { const e = $(id); if (e) e.style.display = 'block'; }

function setStatus(id, type, msg) {
  const el = $(id);
  if (!el) return;
  el.className   = `status-msg status-${type}`;
  el.textContent = msg;
  el.style.display = 'block';
}
function clearStatus(id) { const el = $(id); if (el) el.style.display = 'none'; }

function htmlEscape(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function setBtn(id, loading, label) {
  const b = $(id);
  if (!b) return;
  b.disabled = loading;
  b.innerHTML = loading
    ? `<span class="spinner" style="display:inline-block;width:12px;height:12px;flex-shrink:0;"></span> Processing…`
    : label;
}

// ─── INIT ─────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  // Header date
  $('headerDate').textContent = new Date().toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric'
  });

  // Default history date = today
  $('historyDateInput').value = getTodayKey();   // from storage.js

  _initTabs();
  _initSettings();
  _initToday();
  _initHistory();
  _initTimeline();
  _initReports();

  // Pre-load available dates for history tab
  _loadDateChips();

  // Pre-load reports
  _loadReport('weekly');
});

// ─── TAB NAVIGATION ───────────────────────────────────────────────────────────

function _initTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      btn.classList.add('active');
      $(`tab-${btn.dataset.tab}`).classList.add('active');
      if (btn.dataset.tab === 'reports') _loadReport(STATE.reportPeriod);
    });
  });
}

// ─── SETTINGS BUTTON ──────────────────────────────────────────────────────────

function _initSettings() {
  $('settingsBtn').addEventListener('click', () => chrome.runtime.openOptionsPage());
}

// ══════════════════════════════════════════════════════════════════════════════
// TAB 1: TODAY
// ══════════════════════════════════════════════════════════════════════════════

function _initToday() {
  $('extractBtn').addEventListener('click', _handleExtract);
  $('todaySlackBtn').addEventListener('click', _handleTodaySlack);
  $('genStandupBtn').addEventListener('click', _handleGenStandup);
  $('copyStandupBtn').addEventListener('click', _handleCopyStandup);
  $('standupSlackBtn').addEventListener('click', _handleStandupSlack);
  $('addTodayBtn').addEventListener('click', _handleAddTodayTask);
  $('addTodayInput').addEventListener('keydown', e => { if (e.key === 'Enter') _handleAddTodayTask(); });

  document.querySelectorAll('.format-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.format-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      STATE.standupFormat = btn.dataset.format;
    });
  });
}

async function _handleExtract() {
  clearStatus('todayStatus');
  setBtn('extractBtn', true, '✨ Extract &amp; Refine Today\'s Tasks');

  // Hide previous results
  ['rawCard','summaryCard','refinedCard','categoriesCard','standupCard'].forEach(id => hide(id));
  $('todaySlackBtn').disabled = true;
  STATE.todayRefined = [];

  try {
    // ── Step 1: Get open tabs ──────────────────────────────────
    setStatus('todayStatus', 'info', '🔍 Scanning open tabs…');

    const allTabs = await new Promise(r => chrome.tabs.query({}, r));
    STATE.todayRawTabs = allTabs.filter(t => {
      const url   = t.url   || '';
      const title = (t.title || '').trim();
      return title && title !== 'New Tab' &&
             !url.startsWith('chrome://') && !url.startsWith('about:') &&
             !url.startsWith('chrome-extension://');
    });

    if (STATE.todayRawTabs.length === 0) {
      setStatus('todayStatus', 'error', '❌ No work-related tabs found.');
      setBtn('extractBtn', false, '✨ Extract &amp; Refine Today\'s Tasks');
      return;
    }

    _renderRawTabs(STATE.todayRawTabs);

    // ── Step 2: AI refinement (parallel calls) ─────────────────
    setStatus('todayStatus', 'info', `🤖 AI is analysing ${STATE.todayRawTabs.length} tabs…`);

    const rawTitles = STATE.todayRawTabs.map(t => t.title);

    const [refined, summary, categories] = await Promise.all([
      refineTasks(rawTitles),
      generateSummary(rawTitles),
      categorizeTasks(rawTitles)
    ]);

    STATE.todayRefined    = refined;
    STATE.todayCategories = categories;

    // ── Step 3: Render results ─────────────────────────────────
    _renderRefined(refined);
    _renderSummary(summary);
    _renderCategories(categories);

    // ── Step 4: Save AI data into today's stored history ───────
    await mergeRefinedData(getTodayKey(), refined, categories);

    clearStatus('todayStatus');
    setStatus('todayStatus', 'success', `✅ ${refined.length} tasks refined! Edit below or post to Slack.`);
    $('todaySlackBtn').disabled = false;
    showBlock('standupCard');

  } catch (err) {
    setStatus('todayStatus', 'error', `❌ ${err.message}`);
  }

  setBtn('extractBtn', false, '✨ Extract &amp; Refine Today\'s Tasks');
}

// ─── Render: raw tabs ─────────────────────────────────────────────────────────
function _renderRawTabs(tabs) {
  $('rawList').innerHTML = tabs.map(t => `
    <li class="task-item">
      <span class="task-bullet">•</span>
      <span class="task-text">${htmlEscape(t.title)}</span>
    </li>`).join('');
  showBlock('rawCard');
}

// ─── Render: refined task list (editable + deletable) ─────────────────────────
function _renderRefined(tasks) {
  const list = $('refinedList');
  list.innerHTML = tasks.map((t, i) => `
    <li class="task-item">
      <span class="task-bullet">•</span>
      <span class="task-text" contenteditable="true" data-idx="${i}">${htmlEscape(t)}</span>
      <button class="task-delete" data-idx="${i}" title="Remove">✕</button>
    </li>`).join('');

  $('refinedCount').textContent = `(${tasks.length})`;
  showBlock('refinedCard');

  // Inline editing
  list.querySelectorAll('[contenteditable]').forEach(el => {
    el.addEventListener('input', () => {
      STATE.todayRefined[+el.dataset.idx] = el.textContent.trim();
    });
  });

  // Delete buttons
  list.querySelectorAll('.task-delete').forEach(btn => {
    btn.addEventListener('click', () => {
      STATE.todayRefined.splice(+btn.dataset.idx, 1);
      _renderRefined(STATE.todayRefined);
    });
  });
}

// ─── Render: AI summary ────────────────────────────────────────────────────────
function _renderSummary(text) {
  $('aiSummary').textContent = text;
  showBlock('summaryCard');
}

// ─── Render: categories ───────────────────────────────────────────────────────
function _renderCategories(cats) {
  const entries = Object.entries(cats);
  if (!entries.length) return;

  $('categoriesContent').innerHTML = entries.map(([cat, tasks]) => `
    <div style="margin-bottom:12px;">
      <span class="category-badge ${catClass(cat)}">${htmlEscape(cat)}</span>
      <ul style="margin-top:5px;list-style:none;">
        ${tasks.map(t => `
          <li class="task-item" style="padding:3px 0;">
            <span class="task-bullet" style="font-size:14px;color:var(--text-muted);">›</span>
            <span class="task-text" style="font-size:11px;">${htmlEscape(t)}</span>
          </li>`).join('')}
      </ul>
    </div>`).join('');

  showBlock('categoriesCard');
}

// ─── Standup generator ────────────────────────────────────────────────────────
async function _handleGenStandup() {
  if (!STATE.todayRefined.length) {
    setStatus('todayStatus', 'error', 'Extract tasks first.');
    return;
  }
  setBtn('genStandupBtn', true, '⚡ Generate Standup');
  hide('standupOutput'); hide('standupActions');

  try {
    const text = await generateStandup(STATE.todayRefined, STATE.standupFormat);
    $('standupOutput').textContent = text;
    showBlock('standupOutput');
    showBlock('standupActions');
  } catch (e) {
    setStatus('todayStatus', 'error', `❌ ${e.message}`);
  }
  setBtn('genStandupBtn', false, '⚡ Generate Standup');
}

function _handleCopyStandup() {
  const text = $('standupOutput').textContent;
  navigator.clipboard.writeText(text).then(() => {
    $('copyStandupBtn').textContent = '✅ Copied!';
    setTimeout(() => { $('copyStandupBtn').textContent = '📋 Copy to Clipboard'; }, 2000);
  });
}

async function _handleStandupSlack() {
  const text = $('standupOutput').textContent.trim();
  const dateLabel = new Date().toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });
  await _postToSlackWithFeedback({
    payload:  buildStandupPayload(dateLabel, text),
    statusId: 'todayStatus',
    btnId:    'standupSlackBtn',
    btnLabel: '💬 Add to Slack',
    emptyMsg: 'Generate a standup first.'
  });
}

// ─── Add task manually ────────────────────────────────────────────────────────
function _handleAddTodayTask() {
  const input = $('addTodayInput');
  const val   = input.value.trim();
  if (!val) return;
  STATE.todayRefined.push(val);
  _renderRefined(STATE.todayRefined);
  input.value = '';
  $('todaySlackBtn').disabled = false;
}

async function _postToSlackWithFeedback({ payload, statusId, btnId, btnLabel, emptyMsg }) {
  if (!payload) {
    setStatus(statusId, 'error', emptyMsg || 'Nothing to post.');
    return;
  }

  setBtn(btnId, true, btnLabel);

  try {
    const { slackWebhookUrl } = await getSettings();
    await postToSlack(slackWebhookUrl, payload);
    setStatus(statusId, 'success', '✅ Posted to Slack! Check your channel.');
  } catch (e) {
    setStatus(statusId, 'error', `❌ ${e.message}`);
  }

  setBtn(btnId, false, btnLabel);
}

function _getTodayRefinedTasks() {
  const fromDom = [...$('refinedList').querySelectorAll('[contenteditable]')]
    .map(el => el.textContent.trim())
    .filter(Boolean);
  if (fromDom.length) return fromDom;
  return STATE.todayRefined.map(t => (t || '').trim()).filter(Boolean);
}

// ─── Post to Slack (Today) ────────────────────────────────────────────────────
async function _handleTodaySlack() {
  const tasks = _getTodayRefinedTasks();
  if (!tasks.length) {
    setStatus('todayStatus', 'error', 'No tasks to post. Extract tasks first or add them manually.');
    return;
  }

  setBtn('todaySlackBtn', true, '💬 Add to Slack');

  try {
    const { slackWebhookUrl } = await getSettings();
    const dateLabel = new Date().toLocaleDateString('en-US', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    });

    await postToSlack(slackWebhookUrl, buildTasksPayload(dateLabel, tasks));
    setStatus('todayStatus', 'success', '✅ Posted to Slack! Check your channel.');

  } catch (e) {
    setStatus('todayStatus', 'error', `❌ ${e.message}`);
  }

  setBtn('todaySlackBtn', false, '💬 Add to Slack');
  $('todaySlackBtn').disabled = false;
}

// ══════════════════════════════════════════════════════════════════════════════
// TAB 2: HISTORY
// ══════════════════════════════════════════════════════════════════════════════

function _initHistory() {
  $('searchBtn').addEventListener('click', _handleHistorySearch);
  $('historyDateInput').addEventListener('keydown', e => { if (e.key === 'Enter') _handleHistorySearch(); });
  $('addHistoryBtn').addEventListener('click', _handleAddHistoryTask);
  $('addHistoryInput').addEventListener('keydown', e => { if (e.key === 'Enter') _handleAddHistoryTask(); });
  $('historySlackBtn').addEventListener('click', _handleHistorySlack);
}

async function _handleHistorySearch() {
  const dateStr = $('historyDateInput').value;
  if (!dateStr) { setStatus('historyStatus', 'error', 'Please select a date.'); return; }

  STATE.historyDate = dateStr;
  clearStatus('historyStatus');
  hide('historyResults'); hide('historyEmpty');
  setStatus('historyStatus', 'info', '🔍 Searching…');

  try {
    const history = await getTabHistory(dateStr);
    STATE.historyTasks = history;
    clearStatus('historyStatus');

    if (!history.length) {
      showBlock('historyEmpty');
      return;
    }

    $('historyDateLabel').textContent = new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', {
      weekday: 'long', month: 'long', day: 'numeric', year: 'numeric'
    });
    $('historyCount').textContent = `(${history.length})`;
    _renderHistoryList(history);
    showBlock('historyResults');

  } catch (e) {
    setStatus('historyStatus', 'error', `❌ ${e.message}`);
  }
}

function _renderHistoryList(tasks) {
  const list = $('historyList');
  list.innerHTML = tasks.map(task => {
    const time = new Date(task.timestamp).toLocaleTimeString('en-US', { hour:'2-digit', minute:'2-digit' });
    const catBadge = task.category
      ? `<span class="category-badge ${catClass(task.category)}" style="font-size:9px;padding:1px 5px;">${htmlEscape(task.category)}</span>`
      : '';
    return `
      <li class="task-item">
        <span class="task-bullet">•</span>
        <span style="flex:1;min-width:0;">
          <span class="task-text" contenteditable="true" data-id="${task.id}">${htmlEscape(task.refinedTitle || task.title)}</span>
          <div class="task-meta">${time} ${task.domain ? `· ${task.domain}` : ''} ${catBadge}</div>
        </span>
        <button class="task-delete" data-id="${task.id}" title="Remove">✕</button>
      </li>`;
  }).join('');

  $('historyCount').textContent = `(${tasks.length})`;

  // Edit
  list.querySelectorAll('[contenteditable]').forEach(el => {
    el.addEventListener('blur', async () => {
      const id  = el.dataset.id;
      const val = el.textContent.trim();
      await updateTabEntry(STATE.historyDate, id, val);
      const idx = STATE.historyTasks.findIndex(t => t.id === id);
      if (idx !== -1) { STATE.historyTasks[idx].refinedTitle = val; STATE.historyTasks[idx].title = val; }
    });
  });

  // Delete
  list.querySelectorAll('.task-delete').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      STATE.historyTasks = await deleteTabEntry(STATE.historyDate, id);
      _renderHistoryList(STATE.historyTasks);
      if (!STATE.historyTasks.length) { hide('historyResults'); showBlock('historyEmpty'); }
    });
  });
}

async function _handleAddHistoryTask() {
  const input = $('addHistoryInput');
  const title = input.value.trim();
  if (!title || !STATE.historyDate) return;
  STATE.historyTasks = await addManualTask(STATE.historyDate, title);
  _renderHistoryList(STATE.historyTasks);
  showBlock('historyResults'); hide('historyEmpty');
  input.value = '';
}

async function _handleHistorySlack() {
  if (!STATE.historyTasks.length) {
    setStatus('historyStatus', 'error', 'No tasks to post. Search a date with activity first.');
    return;
  }

  setBtn('historySlackBtn', true, '💬 Add to Slack (with date)');

  try {
    const { slackWebhookUrl } = await getSettings();
    const dateLabel = new Date(STATE.historyDate + 'T12:00:00').toLocaleDateString('en-US', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    });
    const tasks = STATE.historyTasks
      .map(t => (t.refinedTitle || t.title || '').trim())
      .filter(Boolean);

    await postToSlack(slackWebhookUrl, buildTasksPayload(dateLabel, tasks));
    setStatus('historyStatus', 'success', `✅ ${tasks.length} tasks posted to Slack! Check your channel.`);

  } catch (e) {
    setStatus('historyStatus', 'error', `❌ ${e.message}`);
  }

  setBtn('historySlackBtn', false, '💬 Add to Slack (with date)');
  $('historySlackBtn').disabled = false;
}

// ─── Date chips (available history) ──────────────────────────────────────────
async function _loadDateChips() {
  const dates = await getAllHistoryDates();
  const container = $('dateChips');

  if (!dates.length) {
    container.innerHTML = '<span style="font-size:11px;color:var(--text-muted);">No history yet — start browsing tabs.</span>';
    return;
  }

  container.innerHTML = dates.slice(0, 14).map(d => {
    const label = new Date(d + 'T12:00:00').toLocaleDateString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric'
    });
    return `<button class="date-chip" data-date="${d}">${label}</button>`;
  }).join('');

  container.querySelectorAll('.date-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      $('historyDateInput').value = chip.dataset.date;
      _handleHistorySearch();
    });
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// TAB 3: TIMELINE
// ══════════════════════════════════════════════════════════════════════════════

function _initTimeline() {
  $('genTimelineBtn').addEventListener('click', _handleGenTimeline);
  $('timelineSlackBtn').addEventListener('click', _handleTimelineSlack);
}

async function _handleGenTimeline() {
  setBtn('genTimelineBtn', true, '🤖 Generate AI Timeline');
  clearStatus('timelineStatus');
  hide('aiTimelineCard'); hide('rawTimelineCard'); hide('timelineEmpty'); hide('timelineSlackBtn');
  STATE.lastTimelineText = '';

  try {
    const history = await getTabHistory(getTodayKey());

    if (!history.length) {
      showBlock('timelineEmpty');
      setBtn('genTimelineBtn', false, '🤖 Generate AI Timeline');
      return;
    }

    // Show raw timeline immediately
    _renderRawTimeline(history);

    // Generate AI narrative
    setStatus('timelineStatus', 'info', '🤖 AI is building your timeline…');
    const aiText = await generateTimeline(history);
    STATE.lastTimelineText = aiText;
    _renderAiTimeline(aiText);
    showBlock('timelineSlackBtn');
    clearStatus('timelineStatus');

  } catch (e) {
    setStatus('timelineStatus', 'error', `❌ ${e.message}`);
  }

  setBtn('genTimelineBtn', false, '🤖 Generate AI Timeline');
}

function _renderRawTimeline(history) {
  const sorted = [...history].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  $('rawTimelineContent').innerHTML = sorted.map(e => {
    const time = new Date(e.timestamp).toLocaleTimeString('en-US', { hour:'2-digit', minute:'2-digit', hour12:true });
    return `
      <div class="timeline-item">
        <div class="timeline-dot"></div>
        <div class="timeline-time">${time}</div>
        <div class="timeline-title">${htmlEscape(e.title || e.url)}</div>
        <div class="timeline-url">${htmlEscape(e.domain || '')}</div>
      </div>`;
  }).join('');
  showBlock('rawTimelineCard');
}

function _renderAiTimeline(rawText) {
  const lines = rawText.split('\n').map(l => l.trim()).filter(Boolean);
  $('aiTimelineContent').innerHTML = lines.map(line => {
    // Expect: "HH:MM AM – Activity"  or  "HH:MM AM - Activity"
    const m = line.match(/^(\d{1,2}:\d{2}\s*(?:AM|PM))\s*[–\-]\s*(.+)$/i);
    if (m) return `
      <div class="timeline-item">
        <div class="timeline-dot"></div>
        <div class="timeline-time">${htmlEscape(m[1])}</div>
        <div class="timeline-title">${htmlEscape(m[2])}</div>
      </div>`;
    return `<div style="font-size:11.5px;color:var(--text-secondary);margin-bottom:6px;">${htmlEscape(line)}</div>`;
  }).join('');
  showBlock('aiTimelineCard');
}

async function _handleTimelineSlack() {
  const dateLabel = new Date().toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });
  await _postToSlackWithFeedback({
    payload:  buildTimelinePayload(dateLabel, STATE.lastTimelineText),
    statusId: 'timelineStatus',
    btnId:    'timelineSlackBtn',
    btnLabel: '💬 Add to Slack',
    emptyMsg: 'Generate a timeline first.'
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// TAB 4: REPORTS
// ══════════════════════════════════════════════════════════════════════════════

function _initReports() {
  document.querySelectorAll('.report-toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.report-toggle-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      STATE.reportPeriod = btn.dataset.period;
      _loadReport(STATE.reportPeriod);
    });
  });
  $('reportSlackBtn').addEventListener('click', _handleReportSlack);
}

async function _loadReport(period) {
  $('reportsContent').innerHTML = '<div class="loading"><div class="spinner"></div>Loading report…</div>';
  clearStatus('reportsStatus');
  STATE.currentReportStats  = null;
  STATE.currentReportPeriod = period;

  try {
    const stats = period === 'weekly' ? await getWeeklyStats() : await getMonthlyStats();
    STATE.currentReportStats = stats;
    _renderReport(stats, period);
  } catch (e) {
    $('reportsContent').innerHTML = `<div class="status-msg status-error">❌ ${htmlEscape(e.message)}</div>`;
  }
}

function _renderReport(stats, period) {
  const { totalTabs, domains, categories, topDomains, score, dailyBreakdown } = stats;

  // ── Stat cards ────────────────────────────────────────────
  const scorePct = Math.min(100, score || 0);
  const scoreGrad = `conic-gradient(var(--accent-purple) ${scorePct * 3.6}deg, var(--bg-primary) 0deg)`;

  const statCards = `
    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-value">${totalTabs}</div>
        <div class="stat-label">Tabs Tracked</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${Object.keys(domains || {}).length}</div>
        <div class="stat-label">Unique Sites</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${Object.keys(categories || {}).length}</div>
        <div class="stat-label">Categories</div>
      </div>
      <div class="stat-card">
        <div class="score-wrapper">
          <div class="score-ring" style="background:${scoreGrad};">
            <div class="score-value">${scorePct}</div>
          </div>
          <div class="score-label">Productivity</div>
        </div>
      </div>
    </div>`;

  // ── Category distribution bars ─────────────────────────────
  const catEntries = Object.entries(categories || {}).sort((a,b) => b[1]-a[1]).slice(0,5);
  const catTotal   = catEntries.reduce((s,[,n]) => s+n, 0);
  const catSection = catEntries.length ? `
    <div class="card">
      <div class="card-title">🗂 Work Distribution</div>
      ${catEntries.map(([cat, count]) => {
        const pct = catTotal > 0 ? Math.round((count / catTotal) * 100) : 0;
        return `
          <div class="cat-bar-item">
            <div class="cat-bar-header">
              <span class="category-badge ${catClass(cat)}">${htmlEscape(cat)}</span>
              <span>${pct}%</span>
            </div>
            <div class="cat-bar-track">
              <div class="cat-bar-fill" style="width:${pct}%;"></div>
            </div>
          </div>`;
      }).join('')}
    </div>` : '';

  // ── Top domains ────────────────────────────────────────────
  const domSection = (topDomains || []).length ? `
    <div class="card">
      <div class="card-title">🌐 Top Sites</div>
      ${topDomains.slice(0,5).map(([d, c]) => `
        <div class="task-item" style="padding:5px 0;">
          <span class="task-bullet" style="font-size:14px;">•</span>
          <span class="task-text" style="font-size:11.5px;">${htmlEscape(d)}</span>
          <span style="font-size:11px;color:var(--accent-purple-l);font-weight:600;">${c}</span>
        </div>`).join('')}
    </div>` : '';

  // ── Weekly bar chart ───────────────────────────────────────
  let chartSection = '';
  if (period === 'weekly' && dailyBreakdown?.length) {
    const maxC = Math.max(...dailyBreakdown.map(d => d.count), 1);
    chartSection = `
      <div class="card">
        <div class="card-title">📅 Daily Activity</div>
        <div class="bar-chart-wrap">
          ${dailyBreakdown.map(d => {
            const h = maxC > 0 ? Math.round((d.count / maxC) * 56) : 2;
            return `
              <div class="bar-col">
                <div class="bar-fill" style="height:${h}px;"></div>
                <div class="bar-label">${htmlEscape(d.label)}</div>
              </div>`;
          }).join('')}
        </div>
      </div>`;
  }

  // ── Monthly top days ───────────────────────────────────────
  let topDaysSection = '';
  if (period === 'monthly' && dailyBreakdown?.length) {
    topDaysSection = `
      <div class="card">
        <div class="card-title">🏆 Most Productive Days</div>
        ${dailyBreakdown.filter(d => d.count > 0).map(d => {
          const label = new Date(d.date + 'T12:00:00').toLocaleDateString('en-US', {weekday:'short', month:'short', day:'numeric'});
          return `
            <div class="task-item" style="padding:5px 0;">
              <span class="task-bullet">•</span>
              <span class="task-text" style="font-size:11.5px;">${htmlEscape(label)}</span>
              <span style="font-size:11px;color:var(--accent-purple-l);font-weight:600;">${d.count} tabs</span>
            </div>`;
        }).join('')}
      </div>`;
  }

  // ── Empty fallback ─────────────────────────────────────────
  const isEmpty = !totalTabs;
  const emptyMsg = isEmpty ? `
    <div class="empty-state">
      <div class="empty-icon">📊</div>
      <p>No data for this ${period === 'weekly' ? 'week' : 'month'} yet.</p>
      <p style="margin-top:4px;font-size:11px;color:var(--text-muted);">Browse tabs to start building your history.</p>
    </div>` : '';

  $('reportsContent').innerHTML = statCards + chartSection + catSection + domSection + topDaysSection + emptyMsg;
}

async function _handleReportSlack() {
  const payload = STATE.currentReportStats
    ? buildReportPayload(STATE.currentReportStats, STATE.currentReportPeriod)
    : null;

  await _postToSlackWithFeedback({
    payload,
    statusId:  'reportsStatus',
    btnId:     'reportSlackBtn',
    btnLabel:  '💬 Add to Slack',
    emptyMsg:  'No report data yet. Browse tabs to build your history first.'
  });
}
