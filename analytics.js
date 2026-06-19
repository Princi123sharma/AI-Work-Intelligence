// analytics.js — Productivity analytics: daily / weekly / monthly reports

'use strict';

// Work-focused categories for scoring
const WORK_CATEGORIES = new Set([
  'Frontend Development', 'Backend Development', 'Salesforce',
  'Testing', 'DevOps', 'Design', 'Meetings', 'Research'
]);

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

function computeStats(history) {
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

  // Productivity score: (work-related tabs / total) × 70 + domain diversity × 2, capped at 100
  const workCount = history.filter(e => WORK_CATEGORIES.has(e.category)).length;
  const total     = history.length;
  const score = total > 0
    ? Math.min(100, Math.round((workCount / total) * 70 + Object.keys(domains).length * 2))
    : 0;

  return { totalTabs: total, domains, categories, topDomains, score };
}

// ─── DAILY STATS ──────────────────────────────────────────────────────────────

async function getDailyStats(dateStr) {
  const history = await _loadDay(dateStr);
  return computeStats(history);
}

// ─── WEEKLY STATS (last 7 days including today) ────────────────────────────────

async function getWeeklyStats() {
  const dayKeys = Array.from({ length: 7 }, (_, i) => {
    const daysAgo = 6 - i;   // oldest → newest
    return _dateKey(daysAgo);
  });

  const dayData = await Promise.all(dayKeys.map(k => _loadDay(k)));

  const allHistory = dayData.flat();
  const stats = computeStats(allHistory);

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

  const dayData = await Promise.all(dayKeys.map(k => _loadDay(k)));

  const allHistory = dayData.flat();
  const stats = computeStats(allHistory);

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
