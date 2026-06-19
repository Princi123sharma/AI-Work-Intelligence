// storage.js — Chrome Storage API wrapper for tab history and settings
// Uses chrome.storage.local for history (larger capacity)
// Uses chrome.storage.sync for settings (API key, webhook URL)

'use strict';

const HISTORY_PREFIX = 'tabHistory_';

// ─── DATE HELPERS ──────────────────────────────────────────────────────────────

function getTodayKey() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function dateToKey(date) {
  if (typeof date === 'string') return date;
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// ─── SETTINGS ─────────────────────────────────────────────────────────────────

function getSettings() {
  return new Promise(resolve => {
    chrome.storage.sync.get(
      ['aiProvider', 'aiFallback', 'geminiApiKey', 'groqApiKey', 'openrouterApiKey', 'slackWebhookUrl'],
      result => {
        resolve({
          aiProvider:       result.aiProvider       || 'gemini',
          aiFallback:       result.aiFallback !== false,
          geminiApiKey:     result.geminiApiKey     || '',
          groqApiKey:       result.groqApiKey       || '',
          openrouterApiKey: result.openrouterApiKey || '',
          slackWebhookUrl:  result.slackWebhookUrl  || ''
        });
      }
    );
  });
}

function saveSettings(settings) {
  return new Promise(resolve => {
    chrome.storage.sync.set(settings, resolve);
  });
}

// ─── TAB HISTORY (read / write) ────────────────────────────────────────────────

function historyKey(dateStr) {
  return HISTORY_PREFIX + dateStr;
}

function getTabHistory(dateStr) {
  return new Promise(resolve => {
    chrome.storage.local.get([historyKey(dateStr)], result => {
      resolve(result[historyKey(dateStr)] || []);
    });
  });
}

function setTabHistory(dateStr, entries) {
  return new Promise(resolve => {
    chrome.storage.local.set({ [historyKey(dateStr)]: entries }, resolve);
  });
}

// ─── ENTRY MUTATIONS ──────────────────────────────────────────────────────────

async function updateTabEntry(dateStr, id, newTitle) {
  const history = await getTabHistory(dateStr);
  const idx = history.findIndex(e => e.id === id);
  if (idx !== -1) {
    history[idx].refinedTitle = newTitle;
    history[idx].title = newTitle;
    history[idx].edited = true;
  }
  await setTabHistory(dateStr, history);
  return history;
}

async function deleteTabEntry(dateStr, id) {
  let history = await getTabHistory(dateStr);
  history = history.filter(e => e.id !== id);
  await setTabHistory(dateStr, history);
  return history;
}

async function addManualTask(dateStr, title) {
  const history = await getTabHistory(dateStr);
  const entry = {
    id:           generateId(),
    timestamp:    new Date().toISOString(),
    title,
    refinedTitle: title,
    url:          '',
    domain:       '',
    category:     'Other',
    manual:       true
  };
  history.push(entry);
  await setTabHistory(dateStr, history);
  return history;
}

// ─── SAVE REFINED AI DATA ──────────────────────────────────────────────────────

async function mergeRefinedData(dateStr, refinedTasks, categories) {
  const history = await getTabHistory(dateStr);

  // Map refined tasks back to history entries by index (best effort)
  refinedTasks.forEach((task, i) => {
    if (history[i]) {
      history[i].refinedTitle = task;
    }
  });

  // Map categories back
  if (categories && typeof categories === 'object') {
    Object.entries(categories).forEach(([cat, tasks]) => {
      tasks.forEach(taskText => {
        const match = history.find(h =>
          (h.refinedTitle || h.title || '').toLowerCase().includes(taskText.slice(0, 20).toLowerCase())
        );
        if (match) match.category = cat;
      });
    });
  }

  await setTabHistory(dateStr, history);
  return history;
}

// ─── LIST ALL AVAILABLE DATES ──────────────────────────────────────────────────

function getAllHistoryDates() {
  return new Promise(resolve => {
    chrome.storage.local.get(null, all => {
      const dates = Object.keys(all)
        .filter(k => k.startsWith(HISTORY_PREFIX))
        .map(k => k.replace(HISTORY_PREFIX, ''))
        .sort()
        .reverse();
      resolve(dates);
    });
  });
}
