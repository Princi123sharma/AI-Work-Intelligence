'use strict';

const IDLE_THRESHOLD_MS = 30_000;

let isTracking = false;
let idleTimer = null;

function clearIdleTimer() {
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
}

function getMeta() {
  return {
    url: location.href,
    title: document.title || '',
    timestamp: new Date().toISOString()
  };
}

function send(type, extra = {}) {
  chrome.runtime.sendMessage({ type, ...getMeta(), ...extra }).catch(() => {});
}

function stopTracking(reason) {
  if (!isTracking) return;
  clearIdleTimer();
  isTracking = false;
  // Stop the segment immediately so idle and hidden time are excluded.
  send('TIMELINE_VISIBILITY', { visible: false, focused: false, reason });
}

function pauseForIdle() {
  if (!isTracking) return;
  clearIdleTimer();
  isTracking = false;
  // Pause after the idle threshold so only active engagement is counted.
  send('TIMELINE_IDLE', { reason: 'idle-timeout' });
}

function startTracking() {
  if (document.hidden || !document.hasFocus()) return;

  if (!isTracking) {
    isTracking = true;
    send('TIMELINE_ACTIVITY', { reason: 'activity' });
  }

  clearIdleTimer();
  idleTimer = setTimeout(() => {
    pauseForIdle();
  }, IDLE_THRESHOLD_MS);
}

function handleActivity() {
  if (document.hidden || !document.hasFocus()) return;
  startTracking();
}

document.addEventListener('mousemove', handleActivity, { passive: true });
document.addEventListener('click', handleActivity, { passive: true });
document.addEventListener('scroll', handleActivity, { passive: true });
document.addEventListener('keydown', handleActivity);

document.addEventListener('visibilitychange', () => {
  if (document.hidden) stopTracking('visibilitychange');
});

window.addEventListener('blur', () => {
  stopTracking('window-blur');
});

window.addEventListener('focus', () => {
  clearIdleTimer();
});

window.addEventListener('beforeunload', () => {
  stopTracking('beforeunload');
  send('TIMELINE_PAGE_UNLOAD', { reason: 'beforeunload' });
});