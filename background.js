// background.js — Service worker
// Responsibilities:
//   1. Forward Slack webhook POST requests (from popup)
//   2. Auto-track tab visits with timestamps → Chrome Storage

'use strict';

const TIMELINE_SESSION_KEY = 'timelineSessionState';

let timelineSessionCache = null;

function _timelineStorageArea() {
  return chrome.storage.session || chrome.storage.local;
}

function _emptyTimelineSession() {
  return {
    tabs: {},
    groups: {},
    updatedAt: null
  };
}

async function _loadTimelineSession() {
  if (timelineSessionCache) return timelineSessionCache;
  const result = await _timelineStorageArea().get([TIMELINE_SESSION_KEY]);
  timelineSessionCache = result[TIMELINE_SESSION_KEY] || _emptyTimelineSession();
  timelineSessionCache.visits ||= {};
  timelineSessionCache.tabs ||= {};
  timelineSessionCache.groups ||= {};
  return timelineSessionCache;
}

async function _saveTimelineSession() {
  if (!timelineSessionCache) timelineSessionCache = _emptyTimelineSession();
  timelineSessionCache.updatedAt = new Date().toISOString();
  await _timelineStorageArea().set({ [TIMELINE_SESSION_KEY]: timelineSessionCache });
}

function _timelineMetaFromSender(sender, message) {
  const tab = sender && sender.tab;
  if (!tab) return null;

  const url = message.url || tab.url || '';
  const domain = _domainOf(url);
  if (!domain) return null;

  return {
    tabId: tab.id,
    url,
    domain,
    title: (message.title || tab.title || domain || '').trim() || domain,
    faviconUrl: tab.favIconUrl || '',
    timestamp: message.timestamp || new Date().toISOString()
  };
}

function _timelineGroupKey(meta) {
  return meta.domain;
}

function _ensureTabState(session, tabId, meta) {
  const key = String(tabId);
  session.tabs[key] ||= {
    currentVisitId: null,
    currentGroupKey: null,
    currentSegmentStartAt: null
  };

  if (meta) {
    session.tabs[key].lastDomain = meta.domain;
    session.tabs[key].lastTitle = meta.title;
    session.tabs[key].lastUrl = meta.url;
    session.tabs[key].lastFaviconUrl = meta.faviconUrl;
  }

  return session.tabs[key];
}

function _ensureGroup(session, meta) {
  const groupKey = _timelineGroupKey(meta);
  session.groups[groupKey] ||= {
    groupKey,
    domain: meta.domain,
    title: meta.title,
    faviconUrl: meta.faviconUrl,
    visits: []
  };

  const group = session.groups[groupKey];
  if (meta.title) group.title = meta.title;
  if (meta.faviconUrl) group.faviconUrl = meta.faviconUrl;
  return group;
}

function _closeCurrentVisit(session, tabState, endedAt) {
  if (!tabState.currentVisitId || !tabState.currentSegmentStartAt) return null;

  const visit = session.visits[tabState.currentVisitId];
  if (!visit) return null;

  const startMs = Date.parse(tabState.currentSegmentStartAt);
  const endMs = Date.parse(endedAt);
  const durationMs = Math.max(0, endMs - startMs);
  visit.segments.push({ startAt: tabState.currentSegmentStartAt, endAt: endedAt, durationMs });
  visit.activeMs += durationMs;
  visit.endedAt = endedAt;
  tabState.currentVisitId = null;
  tabState.currentGroupKey = null;
  tabState.currentSegmentStartAt = null;
  return visit;
}

function _startNewVisit(session, tabState, meta, startedAt) {
  const visitId = _generateId();
  const group = _ensureGroup(session, meta);

  const visit = {
    id: visitId,
    tabId: meta.tabId,
    groupKey: group.groupKey,
    domain: meta.domain,
    title: meta.title,
    url: meta.url,
    faviconUrl: meta.faviconUrl,
    startedAt,
    endedAt: null,
    activeMs: 0,
    segments: []
  };

  session.visits[visitId] = visit;
  group.visits.push(visitId);
  tabState.currentVisitId = visitId;
  tabState.currentGroupKey = group.groupKey;
  tabState.currentSegmentStartAt = startedAt;
  return visit;
}

async function _handleTimelineActivity(message, sender) {
  const meta = _timelineMetaFromSender(sender, message);
  if (!meta) return { ok: false };

  const session = await _loadTimelineSession();
  session.visits ||= {};
  session.groups ||= {};
  const tabState = _ensureTabState(session, meta.tabId, meta);
  const now = message.timestamp || new Date().toISOString();

  let visit = tabState.currentVisitId ? session.visits[tabState.currentVisitId] : null;
  if (!visit || visit.endedAt || visit.groupKey !== _timelineGroupKey(meta)) {
    if (visit && !visit.endedAt) _closeCurrentVisit(session, tabState, now);
    visit = _startNewVisit(session, tabState, meta, now);
  }

  visit.title = meta.title || visit.title;
  visit.url = meta.url || visit.url;
  visit.faviconUrl = meta.faviconUrl || visit.faviconUrl;
  await _saveTimelineSession();
  return { ok: true };
}

async function _handleTimelineEnd(message, sender) {
  const meta = _timelineMetaFromSender(sender, message);
  if (!meta) return { ok: false };

  const session = await _loadTimelineSession();
  const tabState = _ensureTabState(session, meta.tabId, meta);
  const endedAt = message.timestamp || new Date().toISOString();
  const visit = _closeCurrentVisit(session, tabState, endedAt);
  if (visit) await _saveTimelineSession();
  return { ok: true };
}

function _snapshotTimelineSession(session) {
  const nowIso = new Date().toISOString();
  const liveDurationsByVisitId = {};

  Object.values(session.tabs || {}).forEach(tabState => {
    if (!tabState.currentVisitId || !tabState.currentSegmentStartAt) return;
    liveDurationsByVisitId[tabState.currentVisitId] = Math.max(0, Date.now() - Date.parse(tabState.currentSegmentStartAt));
  });

  const groups = Object.values(session.groups || {}).map(group => {
    const visits = (group.visits || [])
      .map(id => session.visits[id])
      .filter(Boolean)
      .map(visit => ({
        id: visit.id,
        tabId: visit.tabId,
        title: visit.title,
        url: visit.url,
        domain: visit.domain,
        faviconUrl: visit.faviconUrl,
        startedAt: visit.startedAt,
        endedAt: visit.endedAt,
        isActive: !visit.endedAt && Boolean(liveDurationsByVisitId[visit.id]),
        activeMs: Number(visit.activeMs || 0) + Number(liveDurationsByVisitId[visit.id] || 0),
        segments: (visit.segments || []).concat(
          liveDurationsByVisitId[visit.id]
            ? [{ startAt: visit.startedAt, endAt: nowIso, durationMs: liveDurationsByVisitId[visit.id], active: true }]
            : []
        )
      }));

    const activeMs = visits.reduce((sum, visit) => sum + Number(visit.activeMs || 0), 0);
    return {
      groupKey: group.groupKey,
      domain: group.domain,
      title: group.title,
      faviconUrl: group.faviconUrl,
      visits,
      totalActiveMs: activeMs,
      visitCount: visits.length
    };
  }).filter(group => group.totalActiveMs > 0 || group.visitCount > 0)
    .sort((a, b) => b.totalActiveMs - a.totalActiveMs);

  const totalActiveMs = groups.reduce((sum, group) => sum + group.totalActiveMs, 0);
  return { groups, totalActiveMs, updatedAt: session.updatedAt || null };
}

// ─── SLACK FORWARDING ──────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'SEND_TO_SLACK') {
    _sendToSlack(message.webhookUrl, message.text)
      .then(() => sendResponse({ ok: true }))
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true; // keep channel open for async response
  }

  if (message.type === 'TIMELINE_ACTIVITY') {
    _handleTimelineActivity(message, _sender)
      .then(result => sendResponse(result))
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (message.type === 'TIMELINE_IDLE' || message.type === 'TIMELINE_VISIBILITY' || message.type === 'TIMELINE_PAGE_UNLOAD') {
    _handleTimelineEnd(message, _sender)
      .then(result => sendResponse(result))
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (message.type === 'TIMELINE_GET_SESSION') {
    _loadTimelineSession()
      .then(session => sendResponse({ ok: true, session: _snapshotTimelineSession(session) }))
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (message.type === 'IMPORT_BROWSER_HISTORY') {
    _importBrowserHistory(Number(message.daysBack) || 30)
      .then(result => sendResponse({ ok: true, ...result }))
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true;
  }
});

const HISTORY_IMPORT_KEY = 'historyImportMeta';

function _dateKeyFromMs(ms) {
  const date = new Date(ms);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function _mergeHistoryEntries(existing, incoming) {
  const merged = [...(existing || [])];
  incoming.forEach(entry => {
    const isDuplicate = merged.some(e =>
      e.url === entry.url &&
      Math.abs(new Date(e.timestamp).getTime() - new Date(entry.timestamp).getTime()) < 90_000
    );
    if (!isDuplicate) merged.push(entry);
  });
  merged.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  return merged;
}

async function _importBrowserHistory(daysBack = 30) {
  const endTime = Date.now();
  const startTime = endTime - (Math.max(1, daysBack) * 24 * 60 * 60 * 1000);
  const results = await chrome.history.search({
    text: '',
    startTime,
    endTime,
    maxResults: 10000
  });

  const byDate = {};
  for (const item of results) {
    const title = (item.title || '').trim();
    const url = item.url || '';
    const domain = _domainOf(url);
    if (!domain || !title || title === 'New Tab') continue;

    let visits = [];
    try {
      visits = await chrome.history.getVisits({ url });
    } catch {
      visits = [];
    }

    const visitTimes = visits
      .map(visit => visit.visitTime)
      .filter(visitTime => visitTime >= startTime && visitTime <= endTime);

    if (!visitTimes.length && item.lastVisitTime >= startTime && item.lastVisitTime <= endTime) {
      visitTimes.push(item.lastVisitTime);
    }

    visitTimes.forEach(visitTime => {
      if (!visitTime) return;

      const dateKey = _dateKeyFromMs(visitTime);
      byDate[dateKey] ||= [];
      byDate[dateKey].push({
        id: _generateId(),
        timestamp: new Date(visitTime).toISOString(),
        title,
        url,
        domain,
        category: null,
        refinedTitle: null,
        imported: true
      });
    });
  }

  let importedCount = 0;
  for (const [dateKey, entries] of Object.entries(byDate)) {
    const storageKey = `tabHistory_${dateKey}`;
    const result = await chrome.storage.local.get([storageKey]);
    const existing = result[storageKey] || [];
    const before = existing.length;
    const merged = _mergeHistoryEntries(existing, entries);
    importedCount += merged.length - before;
    await chrome.storage.local.set({ [storageKey]: merged });
  }

  await chrome.storage.local.set({
    [HISTORY_IMPORT_KEY]: {
      lastImportAt: new Date().toISOString(),
      daysBack,
      importedCount
    }
  });

  return { importedCount, dateCount: Object.keys(byDate).length };
}

chrome.runtime.onInstalled.addListener(details => {
  if (details.reason === 'install' || details.reason === 'update') {
    _timelineStorageArea().remove([TIMELINE_SESSION_KEY]).catch(() => {});
    timelineSessionCache = null;
  }

  if (details.reason === 'install') {
    _importBrowserHistory(30).catch(() => {});
  } else if (details.reason === 'update') {
    _importBrowserHistory(7).catch(() => {});
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

chrome.tabs.onRemoved.addListener(async tabId => {
  const session = await _loadTimelineSession();
  const tabState = session.tabs[String(tabId)];
  if (!tabState) return;

  const visitId = tabState.currentVisitId;
  if (visitId && session.visits[visitId]) {
    const endedAt = new Date().toISOString();
    _closeCurrentVisit(session, tabState, endedAt);
    await _saveTimelineSession();
  }

  delete session.tabs[String(tabId)];
  await _saveTimelineSession();
});
