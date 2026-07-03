// popup.js — Main popup controller
// Depends on: storage.js, formatter.js, destinations.js, ai.js, analytics.js

'use strict';

// ─── STATE ────────────────────────────────────────────────────────────────────

const STATE = {
  todayRefined:     [],   // AI-refined task strings
  standupFormat:    'short',
  lastTimelineText: '',
  currentReportStats: null,
  currentReportPeriod: 'weekly',
  workCategories:   [],
  destinationLabel: 'destination',

  historyDate:      '',
  historyTasks:     [],   // tab-history entries for selected date
  historyRefined:     [],
  historyCategories:  {},
  historyStandupFormat: 'short',

  timelineSession:  null,
  timelineGroups:   [],
  timelineTotalActiveMs: 0,

  reportPeriod:     'weekly'
};

// ─── CATEGORY → CSS CLASS MAP ─────────────────────────────────────────────────

const CAT_CLASS = {
  'Frontend Development': 'cat-frontend',
  'Backend Development':  'cat-backend',
  'Salesforce':           'cat-salesforce',
  'Salesforce Development': 'cat-salesforce',
  'Apex/LWC':             'cat-salesforce',
  'Configuration':        'cat-devops',
  'Integrations':         'cat-backend',
  'API/Database':         'cat-backend',
  'Code Review':          'cat-testing',
  'Meetings':             'cat-meetings',
  'Research':             'cat-research',
  'DevOps':               'cat-devops',
  'Testing':              'cat-testing',
  'Design':               'cat-design',
  'Content Planning':     'cat-design',
  'Content Creation':     'cat-frontend',
  'Publishing':           'cat-devops',
  'Community Management': 'cat-meetings',
  'Analytics':            'cat-research',
  'Campaign Management':  'cat-salesforce',
  'Lectures':             'cat-research',
  'YouTube Learning':     'cat-research',
  'Assignments':          'cat-testing',
  'Exam Preparation':     'cat-devops',
  'Notes':                'cat-design',
  'Projects':             'cat-frontend',
  'Coding Practice':      'cat-backend',
  'Study Groups':         'cat-meetings',
  'Recruiting':           'cat-research',
  'Candidate Screening':  'cat-testing',
  'Interviews':           'cat-meetings',
  'Onboarding':           'cat-devops',
  'Employee Engagement':  'cat-design',
  'HR Operations':        'cat-salesforce',
  'Compliance':           'cat-testing',
  'Design Review':        'cat-design',
  'Other':                'cat-other'
};

function catClass(cat) {
  if (CAT_CLASS[cat]) return CAT_CLASS[cat];
  if (!cat) return 'cat-other';
  let hash = 0;
  for (let i = 0; i < cat.length; i++) hash = ((hash << 5) - hash) + cat.charCodeAt(i);
  const palette = ['cat-frontend', 'cat-backend', 'cat-research', 'cat-design', 'cat-testing', 'cat-devops', 'cat-meetings'];
  return palette[Math.abs(hash) % palette.length];
}

function _workCategorySet() {
  const categories = STATE.workCategories.length
    ? STATE.workCategories
    : (typeof getConfiguredWorkCategories === 'function' ? getConfiguredWorkCategories({}) : []);
  return new Set(categories);
}

async function _loadDestinationContext() {
  const settings = await getSettings();
  STATE.workCategories = typeof getConfiguredWorkCategories === 'function'
    ? getConfiguredWorkCategories(settings)
    : [];
  STATE.destinationLabel = getActiveDestinationLabel(settings.activeDestination || 'slack');
  _refreshSendButtons();
}

function _sendButtonLabel(withEmoji = true) {
  const prefix = withEmoji ? '📤 ' : '';
  return `${prefix}Send to ${STATE.destinationLabel}`;
}

function _refreshSendButtons() {
  const label = _sendButtonLabel();
  ['todaySlackBtn', 'standupSlackBtn', 'timelineSlackBtn', 'reportSlackBtn'].forEach(id => {
    const btn = $(id);
    if (btn && btn.dataset.loading !== 'true') btn.textContent = label;
  });
  const historyBtn = $('historyStandupSlackBtn');
  if (historyBtn && historyBtn.dataset.loading !== 'true') {
    historyBtn.textContent = `Send to ${STATE.destinationLabel}`;
  }
}

function filterWorkTasks(entries, userProfile = '') {
  const profile = String(userProfile || '').trim().toLowerCase();
  return (entries || []).filter(entry => {
    if (entry.manual) return true;
    if (profile) {
      const entryProfile = String(entry.workProfile || '').trim().toLowerCase();
      if (entryProfile === profile && entry.workRelevant === true) return true;
      return isEntryRelevantForProfile(entry, profile);
    }
    if (entry.category && _workCategorySet().has(entry.category)) return true;
    return isGenericWorkEntry(entry);
  });
}

function isGenericWorkEntry(entry) {
  const text = buildEntrySearchText(entry);
  if (!text) return false;
  if (isEntertainmentActivity(text) && !isEducationalYoutube(text)) return false;
  if (isEducationalYoutube(text)) return true;

  return textMatchesAny(text, [
    /\b(github|gitlab|bitbucket|stackoverflow|stack overflow|localhost|127\.0\.0\.1|jira|linear|asana|trello|notion|slack|teams|meet|zoom|figma|canva|postman|swagger|aws|azure|vercel|netlify|docker)\b/i,
    /\b(code|coding|programming|developer|frontend|backend|bug|debug|pull request|merge request|commit|branch|deploy|build|test|api|database|sql|typescript|javascript|python|java|react|node|css|html)\b/i,
    /\b(salesforce|trailhead|apex|visualforce|lightning|lwc|soql|flow builder|sandbox)\b/i,
    /\b(resume|candidate|interview|recruit|onboarding|payroll|employee|campaign|analytics|content calendar|caption|brand|insights)\b/i
  ]);
}

function uniqueTasks(tasks) {
  const seen = new Set();
  return (tasks || [])
    .map(task => normalizeTaskText(task))
    .filter(task => {
      const key = task.toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function normalizeTaskText(task) {
  let value = String(task || '').trim().replace(/,$/, '');
  if (value.startsWith('{') && value.endsWith('}')) {
    try {
      const parsed = JSON.parse(value);
      value = String(parsed.task || parsed.title || parsed.description || value).trim();
    } catch {
      // Keep the original text if it is not valid JSON.
    }
  }
  return value;
}

function _sourceIndexFromProfileItem(item, fallbackIndex) {
  const hasSourceIndex = item && item.sourceIndex !== null && item.sourceIndex !== undefined;
  return hasSourceIndex && Number.isFinite(Number(item.sourceIndex))
    ? Number(item.sourceIndex)
    : fallbackIndex;
}

function _filterProfileItemsBySource(items, sourceEntries, profile) {
  const strictItems = (items || []).filter((item, fallbackIndex) => {
    const sourceEntry = sourceEntries[_sourceIndexFromProfileItem(item, fallbackIndex)];
    return sourceEntry && isEntryRelevantForProfile(sourceEntry, profile);
  });

  return strictItems.length ? strictItems : items;
}

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

function runtimeMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, response => {
      const err = chrome.runtime.lastError;
      if (err) {
        reject(new Error(err.message));
        return;
      }
      resolve(response);
    });
  });
}

function formatDurationMs(ms) {
  const totalMinutes = Math.max(0, Math.round(Number(ms || 0) / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours && minutes) return `${hours}h ${minutes}m`;
  if (hours) return `${hours}h`;
  return `${minutes}m`;
}

function formatClockTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  });
}

function hashString(text) {
  let hash = 0;
  const value = String(text || '');
  for (let i = 0; i < value.length; i += 1) {
    hash = ((hash << 5) - hash) + value.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function domainColor(domain) {
  const hue = hashString(domain) % 360;
  return `hsl(${hue}, 72%, 56%)`;
}

function minutesToTimeLabel(minutes) {
  const value = Math.max(0, Math.min(1439, Number(minutes || 0)));
  const hours = Math.floor(value / 60);
  const mins = value % 60;
  const suffix = hours >= 12 ? 'PM' : 'AM';
  const displayHour = hours % 12 || 12;
  return `${displayHour}:${String(mins).padStart(2, '0')} ${suffix}`;
}

function getTodayTimeRange() {
  const startValue = Number($('todayStartTime').value);
  const endValue = Number($('todayEndTime').value);
  return {
    start: Math.min(startValue, endValue),
    end: Math.max(startValue, endValue)
  };
}

function entryMinuteOfDay(entry) {
  const date = new Date(entry.timestamp);
  if (Number.isNaN(date.getTime())) return null;
  return date.getHours() * 60 + date.getMinutes();
}

function isEntryInTimeRange(entry, start, end) {
  const minute = entryMinuteOfDay(entry);
  return minute !== null && minute >= start && minute <= end;
}

function updateTodayTimeRangeUi() {
  const { start, end } = getTodayTimeRange();
  const track = $('todayTimeRangeTrack');
  if (track) {
    track.style.setProperty('--range-start', `${(start / 1439) * 100}%`);
    track.style.setProperty('--range-end', `${(end / 1439) * 100}%`);
  }
  $('todayTimeRangeLabel').textContent = `${minutesToTimeLabel(start)} - ${minutesToTimeLabel(end)}`;
}

function truncateText(text, maxLength) {
  const value = String(text || '').trim();
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 1)).trim()}…`;
}

function textMatchesAny(text, patterns) {
  return patterns.some(pattern => pattern.test(text));
}

function buildEntrySearchText(entry) {
  return [
    entry.title,
    entry.refinedTitle,
    entry.domain,
    entry.url
  ].filter(Boolean).join(' ').toLowerCase();
}

function isYoutubeActivity(text) {
  return /\b(youtube\.com|youtu\.be|youtube)\b/i.test(text);
}

function isEducationalYoutube(text) {
  if (!isYoutubeActivity(text)) return false;
  return textMatchesAny(text, [
    /\b(tutorial|course|lecture|class|lesson|learn|learning|study|studying|explained|guide|training|webinar|masterclass|crash course|roadmap|playlist|project)\b/i,
    /\b(math|science|physics|chemistry|biology|history|geography|economics|english|exam|neet|jee|upsc|ielts|coding|programming|javascript|typescript|python|java|salesforce|apex|lwc|react|node|database|sql)\b/i
  ]);
}

function isStudentLearningActivity(text) {
  return textMatchesAny(text, [
    /\b(classroom|google classroom|canvas|moodle|blackboard|coursera|udemy|khan academy|byju|unacademy|wikipedia)\b/i,
    /\b(homework|assignment|notes|syllabus|exam|lecture|lesson|study|studying|course|tutorial|learn|learning|practice|quiz|worksheet|textbook|chapter)\b/i,
    /\b(math|science|physics|chemistry|biology|history|geography|economics|english|computer science|coding|programming|javascript|python|java)\b/i
  ]);
}

function isDeveloperLearningActivity(text) {
  return textMatchesAny(text, [
    /\b(github|gitlab|bitbucket|stackoverflow|stack overflow|localhost|127\.0\.0\.1|jira|linear|vercel|netlify|aws|azure|docker|kubernetes|postman|swagger|api|database|sql|mongodb|redis)\b/i,
    /\b(code|coding|programming|developer|frontend|backend|full stack|bug|debug|pull request|merge request|commit|branch|deploy|build|test|typescript|javascript|python|java|react|node|css|html)\b/i,
    /\b(salesforce|trailhead|apex|visualforce|lightning|lwc|soql|sosl|sales cloud|service cloud|force\.com|developer console|sandbox|org|flow builder)\b/i,
    /\b(tutorial|course|lecture|learn|learning|explained|guide|training|webinar|project|roadmap)\b/i
  ]);
}

function isEntertainmentActivity(text) {
  return textMatchesAny(text, [
    /\b(movie|movies|trailer|song|songs|music|lyrics|shorts|comedy|funny|gaming|gameplay|netflix|prime video|hotstar|anime|celebrity|sports highlights|meme|memes|reels)\b/i,
    /\b(shopping|cart|wishlist|amazon|flipkart|myntra|instagram reels)\b/i
  ]);
}

function profileKind(profile) {
  const value = String(profile || '').toLowerCase();
  if (/\bstudent|school|college|university|learner|study\b/.test(value)) return 'student';
  if (/\bsocial\s*media|smm|content\s*(manager|marketer|creator)|community\s*manager|digital\s*marketing\b/.test(value)) return 'social';
  if (/\bhr|human\s*resources|recruiter|talent|people\s*ops\b/.test(value)) return 'hr';
  if (/\bsalesforce|apex|visualforce|lightning|lwc\b/.test(value)) return 'salesforce';
  if (/\bfull\s*stack|frontend|front-end|backend|back-end|developer|software|engineer|programmer|coder\b/.test(value)) return 'developer';
  return 'generic';
}

function isEntryRelevantForProfile(entry, profile) {
  const text = buildEntrySearchText(entry);
  if (!text) return false;

  const kind = profileKind(profile);
  const isYoutube = isYoutubeActivity(text);
  const isEntertainment = isEntertainmentActivity(text);
  const entertainmentOnly = isEntertainment && !isEducationalYoutube(text);

  if (kind === 'student') {
    return isYoutube
      ? !entertainmentOnly && (isEducationalYoutube(text) || isStudentLearningActivity(text))
      : !entertainmentOnly && isStudentLearningActivity(text);
  }

  if (kind === 'social') {
    if (entertainmentOnly && !textMatchesAny(text, [/\b(analytics|campaign|brand|content|caption|social media|audience|insights|youtube studio)\b/i])) return false;
    return textMatchesAny(text, [
      /\b(meta business|business suite|creator studio|facebook|instagram|linkedin|x\.com|twitter|tiktok|youtube studio|buffer|hootsuite|later\.com|canva|figma|mailchimp|hubspot|analytics)\b/i,
      /\b(content calendar|campaign|post|caption|hashtag|social media|community|engagement|brand|influencer|creative|copywriting|reel|shorts analytics|audience|insights)\b/i
    ]);
  }

  if (kind === 'hr') {
    if (entertainmentOnly) return false;
    return textMatchesAny(text, [
      /\b(linkedin|naukri|indeed|workday|greenhouse|lever|bamboohr|zoho people|jobvite|ats|resume|cv|candidate|interview|recruit|onboarding|payroll|attendance|employee|hr policy)\b/i
    ]);
  }

  if (kind === 'salesforce') {
    return isYoutube
      ? !entertainmentOnly && isDeveloperLearningActivity(text)
      : !entertainmentOnly && isDeveloperLearningActivity(text);
  }

  if (kind === 'developer') {
    return isYoutube
      ? !entertainmentOnly && isDeveloperLearningActivity(text)
      : !entertainmentOnly && isDeveloperLearningActivity(text);
  }

  const roleWords = String(profile || '').toLowerCase().split(/[^a-z0-9]+/).filter(word => word.length > 2);
  if (isEntertainment && !isEducationalYoutube(text)) return false;
  return roleWords.some(word => text.includes(word)) || isEducationalYoutube(text);
}

// ─── INIT ─────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  // Header date
  $('headerDate').textContent = new Date().toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric'
  });

  await _loadDestinationContext();

  // Default history date = today
  $('historyDateInput').value = getTodayKey();   // from storage.js

  _initTabs();
  _initSettings();
  _initToday();
  _initHistory();
  _initTimeline();
  _initReports();

  // Pre-load available dates for history tab
  _ensureHistoryImported().then(() => _loadDateChips());

  // Pre-load reports
  _loadReport('weekly');

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
    if (changes.activeDestination || changes.destinationConfig || changes.workCategoryTags || changes.userProfile) {
      _loadDestinationContext();
    }
  });
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
      if (btn.dataset.tab === 'timeline') _loadTimelineView();
      if (btn.dataset.tab === 'history') _openHistoryTab();
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
  ['todayStartTime', 'todayEndTime'].forEach(id => {
    $(id).addEventListener('input', updateTodayTimeRangeUi);
  });
  updateTodayTimeRangeUi();

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

  ['summaryCard','refinedCard','standupCard'].forEach(id => hide(id));
  $('todaySlackBtn').disabled = true;
  STATE.todayRefined = [];

  try {
    const { start, end } = getTodayTimeRange();
    const rangeLabel = `${minutesToTimeLabel(start)} - ${minutesToTimeLabel(end)}`;
    setStatus('todayStatus', 'info', `🔍 Scanning today from ${rangeLabel}…`);

    const result = await _extractTasksForDate(getTodayKey(), { start, end, rangeLabel });
    STATE.todayRefined = result.refined;
    _renderRefined(result.refined);
    _renderSummary(result.summary);

    clearStatus('todayStatus');
    setStatus('todayStatus', 'success', `✅ ${result.refined.length} tasks refined for ${rangeLabel}! Edit below or send your report.`);
    $('todaySlackBtn').disabled = false;
    showBlock('standupCard');
  } catch (err) {
    setStatus('todayStatus', 'error', `❌ ${err.message}`);
  }

  setBtn('extractBtn', false, '✨ Extract &amp; Refine Today\'s Tasks');
}

async function _extractTasksForDate(dateStr, { start = 0, end = 1439, rangeLabel } = {}) {
  const history = await getTabHistory(dateStr);
  const entries = history
    .filter(entry => isEntryInTimeRange(entry, start, end))
    .filter(entry => (entry.title || entry.refinedTitle || '').trim());

  if (!entries.length) {
    const label = rangeLabel || 'selected range';
    throw new Error(`No tracked activity found from ${label}.`);
  }

  const { userProfile } = await getSettings();
  const profile = String(userProfile || '').trim();
  let refined;
  let summary;
  let categories;
  let displayEntries = [];

  if (profile) {
    const rawTitles = entries.map(t => t.title || t.refinedTitle);
    const profileItems = await refineProfileTasks(rawTitles);
    if (!profileItems.length) {
      await mergeRefinedDataForEntries(dateStr, entries, [], {}, { userProfile: profile });
      throw new Error(`No ${profile}-related work tasks found from ${rangeLabel || 'selected range'}.`);
    }

    const workItems = _filterProfileItemsBySource(profileItems, entries, profile);
    refined = uniqueTasks(workItems.map(item => item.task));
    if (!refined.length) {
      await mergeRefinedDataForEntries(dateStr, entries, [], {}, { userProfile: profile });
      throw new Error(`No ${profile}-related work tasks found from ${rangeLabel || 'selected range'}.`);
    }

    displayEntries = workItems
      .map((item, fallbackIndex) => {
        const sourceIndex = _sourceIndexFromProfileItem(item, fallbackIndex);
        return entries[sourceIndex];
      })
      .filter(Boolean);
    summary = await generateSummary(refined);
    categories = await categorizeTasks(refined);
    await mergeRefinedDataForEntries(dateStr, entries, workItems, categories, { userProfile: profile });
  } else {
    const workEntries = entries.filter(entry => isGenericWorkEntry(entry));
    if (!workEntries.length) {
      await mergeRefinedDataForEntries(dateStr, entries, [], {});
      throw new Error(`No work-related activity found from ${rangeLabel || 'selected range'}. Add your job profile in Settings for better filtering.`);
    }

    const rawTitles = workEntries.map(t => t.refinedTitle || t.title);
    [refined, summary, categories] = await Promise.all([
      refineTasks(rawTitles),
      generateSummary(rawTitles),
      categorizeTasks(rawTitles)
    ]);
    refined = uniqueTasks(refined);
    if (!refined.length) {
      await mergeRefinedDataForEntries(dateStr, workEntries, [], categories);
      throw new Error(`No work-related activity found from ${rangeLabel || 'selected range'}. Add your job profile in Settings for better filtering.`);
    }
    displayEntries = workEntries;
    await mergeRefinedDataForEntries(dateStr, workEntries, refined, categories);
  }

  return { entries: displayEntries, refined, summary, categories };
}

// ─── Render: raw tabs ─────────────────────────────────────────────────────────
// ─── Render: refined task list (editable + deletable) ─────────────────────────
function _renderRefined(tasks) {
  const list = $('refinedList');
  const displayTasks = uniqueTasks(tasks);
  STATE.todayRefined = displayTasks;
  list.innerHTML = displayTasks.map((t, i) => `
    <li class="task-item">
      <span class="task-bullet">•</span>
      <span class="task-text" contenteditable="true" data-idx="${i}">${htmlEscape(t)}</span>
      <button class="task-delete" data-idx="${i}" title="Remove">✕</button>
    </li>`).join('');

  $('refinedCount').textContent = `(${displayTasks.length})`;
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
  await _dispatchReportWithFeedback({
    payload:  buildStandupReportPayload(dateLabel, text),
    statusId: 'todayStatus',
    btnId:    'standupSlackBtn',
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

async function _dispatchReportWithFeedback({ payload, statusId, btnId, emptyMsg }) {
  if (!payload) {
    setStatus(statusId, 'error', emptyMsg || 'Nothing to send.');
    return;
  }

  const btn = $(btnId);
  const defaultLabel = btnId === 'historyStandupSlackBtn'
    ? `Send to ${STATE.destinationLabel}`
    : _sendButtonLabel();
  if (btn) btn.dataset.loading = 'true';
  setBtn(btnId, true, 'Sending...');

  try {
    await dispatchReport(payload);
    setStatus(statusId, 'success', `✅ Sent to ${STATE.destinationLabel}! Check your channel.`);
  } catch (e) {
    setStatus(statusId, 'error', `❌ ${e.message}`);
  }

  if (btn) btn.dataset.loading = 'false';
  setBtn(btnId, false, defaultLabel);
}

async function _handleTodaySlack() {
  const tasks = _getTodayRefinedTasks();
  if (!tasks.length) {
    setStatus('todayStatus', 'error', 'No tasks to send. Extract tasks first or add them manually.');
    return;
  }

  const dateLabel = new Date().toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });

  await _dispatchReportWithFeedback({
    payload:  buildTaskListReportPayload(dateLabel, tasks, 'Daily Work Report'),
    statusId: 'todayStatus',
    btnId:    'todaySlackBtn',
    emptyMsg: 'No tasks to send.'
  });

  $('todaySlackBtn').disabled = false;
}

function _getTodayRefinedTasks() {
  const fromDom = [...$('refinedList').querySelectorAll('[contenteditable]')]
    .map(el => el.textContent.trim())
    .filter(Boolean);
  if (fromDom.length) return fromDom;
  return STATE.todayRefined.map(t => (t || '').trim()).filter(Boolean);
}

function _getHistoryDateLabel() {
  return new Date(STATE.historyDate + 'T12:00:00').toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });
}

function _getHistoryStandupTasks() {
  const seen = new Set();
  const refined = (STATE.historyRefined || []).map(t => String(t || '').trim()).filter(Boolean);
  const source = refined.length
    ? refined
    : STATE.historyTasks
      .filter(t => t.refinedTitle && t.refinedTitle.trim())
      .map(t => t.refinedTitle.trim());

  return source
    .filter(title => {
      const key = title.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function _resetHistoryStandup() {
  hide('historyStandupOutput');
  hide('historyStandupActions');
  $('historyStandupOutput').textContent = '';
}

// ══════════════════════════════════════════════════════════════════════════════
// TAB 2: HISTORY
// ══════════════════════════════════════════════════════════════════════════════

function _initHistory() {
  $('searchBtn').addEventListener('click', _handleHistorySearch);
  $('historyExtractBtn').addEventListener('click', _handleHistoryExtract);
  $('importHistoryBtn').addEventListener('click', _handleImportHistory);
  $('historyDateInput').addEventListener('keydown', e => { if (e.key === 'Enter') _handleHistorySearch(); });
  $('historyDateInput').addEventListener('change', _handleHistorySearch);
  $('historyGenStandupBtn').addEventListener('click', _handleHistoryGenStandup);
  $('historyCopyStandupBtn').addEventListener('click', _handleHistoryCopyStandup);
  $('historyStandupSlackBtn').addEventListener('click', _handleHistoryStandupSlack);
  $('addHistoryBtn').addEventListener('click', _handleAddHistoryTask);
  $('addHistoryInput').addEventListener('keydown', e => { if (e.key === 'Enter') _handleAddHistoryTask(); });

  document.querySelectorAll('.history-format-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.history-format-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      STATE.historyStandupFormat = btn.dataset.format;
    });
  });
}

async function _ensureHistoryImported() {
  try {
    const dates = await getAllHistoryDates();
    if (dates.length) return;
    await runtimeMessage({ type: 'IMPORT_BROWSER_HISTORY', daysBack: 30 });
  } catch {
    // Ignore import failures on startup; user can retry manually.
  }
}

async function _openHistoryTab() {
  await _loadDateChips();
  if (!$('historyDateInput').value) {
    $('historyDateInput').value = getTodayKey();
  }
  await _handleHistorySearch();
}

async function _handleImportHistory() {
  setBtn('importHistoryBtn', true, '↺ Import last 30 days from Chrome');
  clearStatus('historyStatus');
  setStatus('historyStatus', 'info', 'Importing browsing history from Chrome…');

  try {
    const response = await runtimeMessage({ type: 'IMPORT_BROWSER_HISTORY', daysBack: 30 });
    if (!response || !response.ok) {
      throw new Error(response?.error || 'Import failed.');
    }
    await _loadDateChips();
    await _handleHistorySearch();
    setStatus('historyStatus', 'success', `✅ Imported ${response.importedCount || 0} visits across ${response.dateCount || 0} days.`);
  } catch (e) {
    setStatus('historyStatus', 'error', `❌ ${e.message}`);
  }

  setBtn('importHistoryBtn', false, '↺ Import last 30 days from Chrome');
}

async function _handleHistoryExtract() {
  const dateStr = $('historyDateInput').value;
  if (!dateStr) {
    setStatus('historyStatus', 'error', 'Please select a date first.');
    return;
  }

  STATE.historyDate = dateStr;
  setBtn('historyExtractBtn', true, '✨ Extract &amp; Refine');
  clearStatus('historyStatus');
  hide('historySummaryCard');
  hide('historyCategoriesCard');
  hide('historyStandupOutput');
  hide('historyStandupActions');

  const dateLabel = new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric'
  });

  try {
    setStatus('historyStatus', 'info', `🤖 AI is analysing activity for ${dateLabel}…`);
    const result = await _extractTasksForDate(dateStr, { start: 0, end: 1439, rangeLabel: dateLabel });
    STATE.historyRefined = result.refined;
    STATE.historyCategories = result.categories;

    await _handleHistorySearch();
    $('historyAiSummary').textContent = result.summary;
    _renderHistoryCategories(result.categories);
    showBlock('historySummaryCard');
    showBlock('historyCategoriesCard');
    setStatus('historyStatus', 'success', `✅ ${result.refined.length} tasks refined for ${dateLabel}.`);
  } catch (e) {
    setStatus('historyStatus', 'error', `❌ ${e.message}`);
  }

  setBtn('historyExtractBtn', false, '✨ Extract &amp; Refine');
}

function _renderHistoryCategories(categories) {
  const entries = Object.entries(categories || {});
  if (!entries.length) {
    $('historyCategoriesContent').innerHTML = '';
    return;
  }

  $('historyCategoriesContent').innerHTML = entries.map(([cat, tasks]) => `
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
}

async function _handleHistorySearch() {
  const dateStr = $('historyDateInput').value;
  if (!dateStr) { setStatus('historyStatus', 'error', 'Please select a date.'); return; }

  STATE.historyDate = dateStr;
  clearStatus('historyStatus');
  hide('historyResults'); hide('historyEmpty');
  hide('historySummaryCard');
  hide('historyCategoriesCard');
  hide('historyStandupCard');
  _resetHistoryStandup();
  setStatus('historyStatus', 'info', '🔍 Searching…');

  try {
    let history = await getTabHistory(dateStr);
    if (!history.length) {
      setStatus('historyStatus', 'info', 'Importing recent Chrome history...');
      const response = await runtimeMessage({ type: 'IMPORT_BROWSER_HISTORY', daysBack: 30 });
      if (!response || !response.ok) {
        throw new Error(response?.error || 'Chrome history import failed.');
      }
      await _loadDateChips();
      history = await getTabHistory(dateStr);
    }
    const { userProfile } = await getSettings();
    const visibleHistory = userProfile && userProfile.trim()
      ? filterWorkTasks(history, userProfile)
      : history;

    STATE.historyTasks = visibleHistory;
    STATE.historyRefined = visibleHistory
      .map(t => (t.refinedTitle || '').trim())
      .filter(Boolean);
    clearStatus('historyStatus');

    if (!visibleHistory.length) {
      _renderHistoryList([]);
      showBlock('historyEmpty');
      return;
    }

    const dateLabel = new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', {
      weekday: 'long', month: 'long', day: 'numeric', year: 'numeric'
    });
    $('historySelectedDateLabel').textContent = dateLabel;
    _renderHistoryList(visibleHistory);
    showBlock('historyResults');
    showBlock('historyStandupCard');

  } catch (e) {
    setStatus('historyStatus', 'error', `❌ ${e.message}`);
  }
}

function _renderHistoryList(tasks) {
  const list = $('historyList');
  if (!list) return;
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

  if ($('historyCount')) $('historyCount').textContent = `(${tasks.length})`;

  // Edit
  list.querySelectorAll('[contenteditable]').forEach(el => {
    el.addEventListener('blur', async () => {
      const id  = el.dataset.id;
      const val = el.textContent.trim();
      await updateTabEntry(STATE.historyDate, id, val);
      const idx = STATE.historyTasks.findIndex(t => t.id === id);
      if (idx !== -1) { STATE.historyTasks[idx].refinedTitle = val; STATE.historyTasks[idx].title = val; }
      _resetHistoryStandup();
    });
  });

  // Delete
  list.querySelectorAll('.task-delete').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      const allTasks = await deleteTabEntry(STATE.historyDate, id);
      const { userProfile } = await getSettings();
      STATE.historyTasks = userProfile && userProfile.trim()
        ? filterWorkTasks(allTasks, userProfile)
        : allTasks;
      _renderHistoryList(STATE.historyTasks);
      _resetHistoryStandup();
      if (!STATE.historyTasks.length) { hide('historyResults'); hide('historyStandupCard'); showBlock('historyEmpty'); }
    });
  });
}

async function _handleAddHistoryTask() {
  const input = $('addHistoryInput');
  if (!input) return;
  const title = input.value.trim();
  if (!title || !STATE.historyDate) return;
  const allTasks = await addManualTask(STATE.historyDate, title);
  const { userProfile } = await getSettings();
  STATE.historyTasks = userProfile && userProfile.trim()
    ? filterWorkTasks(allTasks, userProfile)
    : allTasks;
  _renderHistoryList(STATE.historyTasks);
  showBlock('historyResults'); hide('historyEmpty');
  showBlock('historyStandupCard');
  _resetHistoryStandup();
  input.value = '';
}

async function _handleHistorySlack() {
  if (!$('historySlackBtn')) return;
  if (!STATE.historyTasks.length) {
    setStatus('historyStatus', 'error', 'No tasks to send. Search a date with activity first.');
    return;
  }

  const dateLabel = new Date(STATE.historyDate + 'T12:00:00').toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });
  const tasks = STATE.historyTasks
    .map(t => (t.refinedTitle || t.title || '').trim())
    .filter(Boolean);

  await _dispatchReportWithFeedback({
    payload:  buildTaskListReportPayload(dateLabel, tasks, 'Daily Work Report'),
    statusId: 'historyStatus',
    btnId:    'historySlackBtn',
    emptyMsg: 'No tasks to send.'
  });

  if ($('historySlackBtn')) $('historySlackBtn').disabled = false;
}

// ─── Date chips (available history) ──────────────────────────────────────────
async function _handleHistoryGenStandup() {
  if (!STATE.historyDate) {
    setStatus('historyStatus', 'error', 'Please select a date first.');
    return;
  }

  setBtn('historyGenStandupBtn', true, 'Generate Standup');
  _resetHistoryStandup();

  try {
    let tasks = _getHistoryStandupTasks();
    if (!tasks.length) {
      setStatus('historyStatus', 'info', `Refining highlighted tasks for ${_getHistoryDateLabel()}...`);
      const result = await _extractTasksForDate(STATE.historyDate, {
        start: 0,
        end: 1439,
        rangeLabel: _getHistoryDateLabel()
      });
      STATE.historyTasks = result.entries;
      STATE.historyRefined = result.refined;
      STATE.historyCategories = result.categories;
      _renderHistoryList(STATE.historyTasks);
      showBlock('historyResults');
      showBlock('historyStandupCard');
      tasks = _getHistoryStandupTasks();
    }

    if (!tasks.length) {
      throw new Error('No refined tasks found for the selected date.');
    }

    const text = await generateStandup(tasks, STATE.historyStandupFormat, STATE.historyDate);
    $('historyStandupOutput').textContent = text;
    showBlock('historyStandupOutput');
    showBlock('historyStandupActions');
    setStatus('historyStatus', 'success', `Standup generated for ${_getHistoryDateLabel()}.`);
  } catch (e) {
    setStatus('historyStatus', 'error', `❌ ${e.message}`);
  }

  setBtn('historyGenStandupBtn', false, 'Generate Standup');
}

function _handleHistoryCopyStandup() {
  const text = $('historyStandupOutput').textContent.trim();
  if (!text) {
    setStatus('historyStatus', 'error', 'Generate a standup first.');
    return;
  }

  navigator.clipboard.writeText(text).then(() => {
    $('historyCopyStandupBtn').textContent = 'Copied!';
    setTimeout(() => { $('historyCopyStandupBtn').textContent = 'Copy to Clipboard'; }, 2000);
  });
}

async function _handleHistoryStandupSlack() {
  const text = $('historyStandupOutput').textContent.trim();
  const dateLabel = _getHistoryDateLabel();
  await _dispatchReportWithFeedback({
    payload:  buildStandupReportPayload(dateLabel, text),
    statusId: 'historyStatus',
    btnId:    'historyStandupSlackBtn',
    emptyMsg: 'Generate a standup first.'
  });
}

async function _loadDateChips() {
  const dates = await getAllHistoryDates();
  const container = $('dateChips');

  if (!dates.length) {
    container.innerHTML = '<span style="font-size:11px;color:var(--text-muted);">No history yet — start browsing tabs.</span>';
    return;
  }

  container.innerHTML = dates.slice(0, 30).map(d => {
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

async function _loadTimelineView() {
  clearStatus('timelineStatus');
  hide('timelineEmpty');
  hide('timelineSlackBtn');
  hide('aiTimelineCard');

  try {
    const session = await _fetchTimelineSession();
    if (!session.groups.length) {
      hide('sessionTimelineCard');
      hide('groupedTimelineCard');
      showBlock('timelineEmpty');
      return;
    }

    _renderTimelineChart(session.groups, session.totalActiveMs);
    _renderGroupedTimeline(session.groups);
    showBlock('sessionTimelineCard');
    showBlock('groupedTimelineCard');
  } catch (e) {
    setStatus('timelineStatus', 'error', `❌ ${e.message}`);
  }
}

async function _handleGenTimeline() {
  setBtn('genTimelineBtn', true, '🔄 Refresh Timeline');
  clearStatus('timelineStatus');
  hide('sessionTimelineCard'); hide('groupedTimelineCard'); hide('aiTimelineCard'); hide('timelineEmpty'); hide('timelineSlackBtn');
  STATE.lastTimelineText = '';

  try {
    const session = await _fetchTimelineSession();

    if (!session.groups.length) {
      showBlock('timelineEmpty');
      setBtn('genTimelineBtn', false, '🔄 Refresh Timeline');
      return;
    }

    _renderTimelineChart(session.groups, session.totalActiveMs);
    _renderGroupedTimeline(session.groups);
    showBlock('sessionTimelineCard');
    showBlock('groupedTimelineCard');

    const { userProfile } = await getSettings();
    const allHistory = await getTabHistory(getTodayKey());
    const history = userProfile && userProfile.trim()
      ? filterWorkTasks(allHistory, userProfile)
      : allHistory;
    if (!history.length) {
      hide('aiTimelineCard');
      hide('timelineSlackBtn');
      setStatus('timelineStatus', 'info', 'No stored tab history found for today yet.');
      setBtn('genTimelineBtn', false, '🔄 Refresh Timeline');
      return;
    }

    setStatus('timelineStatus', 'info', 'Building AI timeline from your tab history...');
    let aiText = '';
    try {
      aiText = await generateTimeline(history);
    } catch (err) {
      aiText = _buildTimelineTextFromHistory(history);
      if (!aiText) throw err;
    }

    STATE.lastTimelineText = aiText;
    _renderAiTimeline(aiText);
    showBlock('timelineSlackBtn');
    clearStatus('timelineStatus');

  } catch (e) {
    setStatus('timelineStatus', 'error', `❌ ${e.message}`);
  }

  setBtn('genTimelineBtn', false, '🔄 Refresh Timeline');
}

async function _fetchTimelineSession() {
  const response = await runtimeMessage({ type: 'TIMELINE_GET_SESSION' });
  if (!response || !response.ok) {
    return { groups: [], totalActiveMs: 0, updatedAt: null };
  }

  const session = response.session || { groups: [], totalActiveMs: 0, updatedAt: null };
  STATE.timelineSession = session;
  STATE.timelineGroups = session.groups || [];
  STATE.timelineTotalActiveMs = Number(session.totalActiveMs || 0);
  return session;
}

function _buildTimelineTextFromHistory(history) {
  const sorted = [...(history || [])]
    .filter(entry => entry && entry.timestamp && (entry.refinedTitle || entry.title || entry.domain || entry.url))
    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

  return sorted.map(entry => {
    const time = new Date(entry.timestamp).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    });
    const title = entry.refinedTitle || entry.title || entry.domain || entry.url;
    return `${time} - ${title}`;
  }).join('\n');
}

function _renderTimelineChart(groups, totalActiveMs) {
  const chartWrap = $('timelineChartWrap');
  const legendEl = $('timelineLegend');
  const summaryEl = $('timelineSessionSummary');

  if (!groups.length) {
    chartWrap.innerHTML = '';
    legendEl.innerHTML = '';
    summaryEl.textContent = '';
    return;
  }

  const total = Math.max(1, Number(totalActiveMs || groups.reduce((sum, group) => sum + Number(group.totalActiveMs || 0), 0)));

  chartWrap.innerHTML = groups.map((group, index) => {
    const label = group.domain || group.title || 'Unknown';
    const color = domainColor(label || String(index));
    const pct = Math.max(3, Math.round((Number(group.totalActiveMs || 0) / total) * 100));
    const timeLabel = formatDurationMs(group.totalActiveMs);

    return `
      <div class="timeline-bar-row">
        <span class="timeline-bar-label" title="${htmlEscape(label)}">${htmlEscape(truncateText(label, 18))}</span>
        <div class="timeline-bar-track" aria-hidden="true">
          <div class="timeline-bar-fill" style="width:${pct}%;background:${color};"></div>
        </div>
        <span class="timeline-bar-duration">${htmlEscape(timeLabel)}</span>
      </div>`;
  }).join('');

  legendEl.innerHTML = '';

  summaryEl.textContent = `Total active time this session: ${formatDurationMs(total)}`;
}

function _renderGroupedTimeline(groups) {
  const content = $('groupedTimelineContent');

  content.innerHTML = groups.map((group, index) => {
    const favicon = group.faviconUrl
      ? `<img class="timeline-favicon" src="${htmlEscape(group.faviconUrl)}" alt="" onerror="this.style.display='none'; this.nextElementSibling.style.display='inline-flex';" />`
      : `<span class="timeline-favicon timeline-favicon-fallback">${htmlEscape((group.domain || group.title || '?').slice(0, 1).toUpperCase())}</span>`;

    const summaryTitle = truncateText(group.title || group.domain || 'Unknown tab', 48);
    const visitLabel = group.visitCount === 1 ? 'visited 1 time this session' : `visited ${group.visitCount} times this session`;

    return `
      <details class="timeline-group" ${index === 0 ? 'open' : ''}>
        <summary class="timeline-group-summary">
          ${favicon}
          <div class="timeline-group-main">
            <div class="timeline-summary-line">${htmlEscape(summaryTitle)} — ${htmlEscape(formatDurationMs(group.totalActiveMs))} (${htmlEscape(visitLabel)})</div>
            <div class="timeline-summary-meta">${htmlEscape(group.domain || '')}</div>
          </div>
          <span class="timeline-group-caret">▾</span>
        </summary>
        <div class="timeline-group-details">
          ${group.visits.map(visit => `
            <div class="timeline-segment">
              <div>
                <div class="timeline-segment-time">${htmlEscape(formatClockTime(visit.startedAt))}${visit.isActive ? ' - active now' : ` - ${htmlEscape(formatClockTime(visit.endedAt || visit.startedAt))}`}</div>
                <div class="timeline-segment-meta">${htmlEscape(formatDurationMs(visit.activeMs))}${visit.title ? ` · ${htmlEscape(truncateText(visit.title, 38))}` : ''}</div>
              </div>
            </div>`).join('')}
        </div>
      </details>`;
  }).join('');
}

function _renderAiTimeline(rawText) {
  const lines = rawText.split('\n').map(l => l.trim()).filter(Boolean);
  $('aiTimelineContent').innerHTML = lines.map(line => {
    const m = line.match(/^(\d{1,2}:\d{2}(?:\s*(?:AM|PM))?)\s*[–\-→]\s*(.+)$/i);
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
  await _dispatchReportWithFeedback({
    payload:  buildTimelineReportPayload(dateLabel, STATE.lastTimelineText),
    statusId: 'timelineStatus',
    btnId:    'timelineSlackBtn',
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
    ? buildAnalyticsReportPayload(STATE.currentReportStats, STATE.currentReportPeriod)
    : null;

  await _dispatchReportWithFeedback({
    payload,
    statusId: 'reportsStatus',
    btnId:    'reportSlackBtn',
    emptyMsg: 'No report data yet. Browse tabs to build your history first.'
  });
}
