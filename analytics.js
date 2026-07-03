// analytics.js — Productivity analytics: daily / weekly / monthly reports

'use strict';

// Default fallback categories for users without a custom workflow profile.
const DEFAULT_WORK_CATEGORIES = [
  'Frontend Development', 'Backend Development', 'Salesforce',
  'Testing', 'DevOps', 'Design', 'Meetings', 'Research',
  'Content Planning', 'Content Creation', 'Publishing',
  'Community Management', 'Analytics', 'Campaign Management',
  'Lectures', 'Assignments', 'Exam Preparation', 'Notes',
  'Projects', 'Coding Practice', 'Study Groups'
];

function parseWorkCategoryTags(value) {
  return String(value || '')
    .split(',')
    .map(tag => tag.trim())
    .filter(Boolean);
}

function getConfiguredWorkCategories(settings = {}) {
  const customTags = parseWorkCategoryTags(settings.workCategoryTags);
  if (customTags.length) return customTags;
  return DEFAULT_WORK_CATEGORIES;
}

async function _activeProfile() {
  const settings = typeof getSettings === 'function' ? await getSettings() : {};
  return {
    userProfile: String(settings.userProfile || '').trim(),
    workCategories: getConfiguredWorkCategories(settings)
  };
}

function _filterHistoryForProfile(history, profile) {
  const normalizedProfile = String(profile || '').trim().toLowerCase();
  if (!normalizedProfile) return history || [];

  return (history || []).filter(entry => {
    if (entry.manual) return true;
    return entry.workRelevant === true &&
      String(entry.workProfile || '').trim().toLowerCase() === normalizedProfile;
  });
}

// ─── HELPER: load one date's history ──────────────────────────────────────────

function _loadDay(dateStr) {
  return new Promise(resolve => {
    chrome.storage.local.get([`tabHistory_${dateStr}`], r => {
      resolve(r[`tabHistory_${dateStr}`] || []);
    });
  });
}

// ─── HELPER: generate YYYY-MM-DD for N days ago ──────────────────────────────

function _dateKey(daysAgo = 0) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// ─── CORE STATS from an array of tab-history entries ─────────────────────────

function computeStats(history, profile = '', workCategories = DEFAULT_WORK_CATEGORIES) {
  const domains    = {};
  const categories = {};

  history.forEach(e => {
    if (e.domain) domains[e.domain] = (domains[e.domain] || 0) + 1;
    const cat = e.category || 'Other';
    categories[cat] = (categories[cat] || 0) + 1;
  });

  const topDomains = Object.entries(domains)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6);

  const categorySet = new Set(workCategories);
  // Productivity score: (work-related tabs / total) × 70 + domain diversity × 2, capped at 100
  const workCount = profile
    ? history.length
    : history.filter(e => categorySet.has(e.category)).length;
  const total     = history.length;
  const score = total > 0
    ? Math.min(100, Math.round((workCount / total) * 70 + Object.keys(domains).length * 2))
    : 0;

  return { totalTabs: total, domains, categories, topDomains, score };
}

// ─── DAILY STATS ──────────────────────────────────────────────────────────────

async function getDailyStats(dateStr) {
  const history = await _loadDay(dateStr);
  const { userProfile, workCategories } = await _activeProfile();
  const filtered = _filterHistoryForProfile(history, userProfile);
  const stats = computeStats(filtered, userProfile, workCategories);
  if (!userProfile) {
    const categorySet = new Set(workCategories);
    stats.score = filtered.length > 0
      ? Math.min(100, Math.round((filtered.filter(e => categorySet.has(e.category)).length / filtered.length) * 70 + Object.keys(stats.domains).length * 2))
      : 0;
  }
  return stats;
}

// ─── WEEKLY STATS (last 7 days including today) ────────────────────────────────

async function getWeeklyStats() {
  const { userProfile, workCategories } = await _activeProfile();
  const dayKeys = Array.from({ length: 7 }, (_, i) => {
    const daysAgo = 6 - i;   // oldest → newest
    return _dateKey(daysAgo);
  });

  const dayData = (await Promise.all(dayKeys.map(k => _loadDay(k))))
    .map(history => _filterHistoryForProfile(history, userProfile));

  const allHistory = dayData.flat();
  const stats = computeStats(allHistory, userProfile, workCategories);
  if (!userProfile) {
    const categorySet = new Set(workCategories);
    stats.score = allHistory.length > 0
      ? Math.min(100, Math.round((allHistory.filter(e => categorySet.has(e.category)).length / allHistory.length) * 70 + Object.keys(stats.domains).length * 2))
      : 0;
  }

  const dailyBreakdown = dayKeys.map((dateStr, i) => {
    const d = new Date(dateStr + 'T12:00:00');
    return {
      date:  dateStr,
      count: dayData[i].length,
      label: d.toLocaleDateString('en-US', { weekday: 'short' })
    };
  });

  return { ...stats, dailyBreakdown };
}

// ─── MONTHLY STATS (current calendar month) ───────────────────────────────────

async function getMonthlyStats() {
  const { userProfile, workCategories } = await _activeProfile();
  const now  = new Date();
  const year = now.getFullYear();
  const mon  = now.getMonth();
  const days = new Date(year, mon + 1, 0).getDate();   // days in month

  const dayKeys = Array.from({ length: days }, (_, i) => {
    const d   = i + 1;
    const m   = String(mon + 1).padStart(2, '0');
    const day = String(d).padStart(2, '0');
    return `${year}-${m}-${day}`;
  });

  const dayData = (await Promise.all(dayKeys.map(k => _loadDay(k))))
    .map(history => _filterHistoryForProfile(history, userProfile));

  const allHistory = dayData.flat();
  const stats = computeStats(allHistory, userProfile, workCategories);
  if (!userProfile) {
    const categorySet = new Set(workCategories);
    stats.score = allHistory.length > 0
      ? Math.min(100, Math.round((allHistory.filter(e => categorySet.has(e.category)).length / allHistory.length) * 70 + Object.keys(stats.domains).length * 2))
      : 0;
  }

  // Top 7 most-active days for display
  const dailyBreakdown = dayKeys
    .map((dateStr, i) => ({
      date:  dateStr,
      count: dayData[i].length,
      label: String(i + 1)       // day number
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 7);

  return { ...stats, dailyBreakdown };
}
