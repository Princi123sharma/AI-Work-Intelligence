// background.js — Service worker
// Responsibilities:
//   1. Forward Slack webhook POST requests (from popup)
//   2. Auto-track tab visits with timestamps → Chrome Storage

'use strict';

// ─── SLACK FORWARDING ──────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'SEND_TO_SLACK') {
    _sendToSlack(message.webhookUrl, message.text)
      .then(() => sendResponse({ ok: true }))
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true; // keep channel open for async response
  }
});

async function _sendToSlack(webhookUrl, text) {
  const url = (webhookUrl || '').trim();
  if (!url.startsWith('https://hooks.slack.com/')) {
    throw new Error('Invalid Slack webhook URL.');
  }

  const res = await fetch(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ text })
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    if (res.status === 404) throw new Error('Slack webhook not found (404). Create a new webhook in Slack.');
    if (res.status === 410) throw new Error('Slack webhook expired (410). Create a new webhook in Slack.');
    throw new Error(body || `Slack request failed — HTTP ${res.status}`);
  }
}

// ─── TAB TRACKING ─────────────────────────────────────────────────────────────

function _todayKey() {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,'0')}-${String(n.getDate()).padStart(2,'0')}`;
}

function _generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function _domainOf(url) {
  try {
    if (!url || url.startsWith('chrome://') || url.startsWith('about:') ||
        url.startsWith('chrome-extension://')) return null;
    return new URL(url).hostname.replace(/^www\./, '');
  } catch { return null; }
}

async function _recordTab(tabId) {
  let tab;
  try { tab = await chrome.tabs.get(tabId); } catch { return; }

  const url    = tab.url   || '';
  const title  = (tab.title || '').trim();
  const domain = _domainOf(url);

  if (!domain || !title || title === 'New Tab' || title === 'about:blank') return;

  const storageKey = `tabHistory_${_todayKey()}`;
  const ts         = new Date().toISOString();

  const result  = await chrome.storage.local.get([storageKey]);
  const history = result[storageKey] || [];

  // Deduplicate: skip if same URL visited within last 90 seconds
  const isDuplicate = history.some(e =>
    e.url === url && (Date.now() - new Date(e.timestamp).getTime()) < 90_000
  );
  if (isDuplicate) return;

  history.push({
    id:          _generateId(),
    timestamp:   ts,
    title,
    url,
    domain,
    category:    null,
    refinedTitle: null
  });

  await chrome.storage.local.set({ [storageKey]: history });
}

// Listen for tab switches
chrome.tabs.onActivated.addListener(({ tabId }) => {
  _recordTab(tabId);
});

// Listen for tab navigation completion
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'complete') {
    _recordTab(tabId);
  }
});
