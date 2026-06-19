// settings.js — Settings page logic

'use strict';

const SETTINGS_KEYS = [
  'aiProvider', 'aiFallback',
  'geminiApiKey', 'groqApiKey', 'openrouterApiKey',
  'slackWebhookUrl'
];

// ─── LOAD SAVED SETTINGS ──────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  chrome.storage.sync.get(SETTINGS_KEYS, result => {
    if (result.aiProvider)       document.getElementById('aiProvider').value       = result.aiProvider;
    if (result.geminiApiKey)     document.getElementById('geminiApiKey').value     = result.geminiApiKey;
    if (result.groqApiKey)       document.getElementById('groqApiKey').value       = result.groqApiKey;
    if (result.openrouterApiKey) document.getElementById('openrouterApiKey').value = result.openrouterApiKey;
    if (result.slackWebhookUrl)  document.getElementById('slackWebhookUrl').value  = result.slackWebhookUrl;
    document.getElementById('aiFallback').checked = result.aiFallback !== false;
  });
});

// ─── SAVE ─────────────────────────────────────────────────────────────────────

document.getElementById('saveBtn').addEventListener('click', () => {
  chrome.storage.sync.set({
    aiProvider:       document.getElementById('aiProvider').value,
    aiFallback:       document.getElementById('aiFallback').checked,
    geminiApiKey:     document.getElementById('geminiApiKey').value.trim(),
    groqApiKey:       document.getElementById('groqApiKey').value.trim(),
    openrouterApiKey: document.getElementById('openrouterApiKey').value.trim(),
    slackWebhookUrl:  document.getElementById('slackWebhookUrl').value.trim()
  }, () => {
    const badge = document.getElementById('savedBadge');
    badge.classList.add('show');
    setTimeout(() => badge.classList.remove('show'), 3000);
  });
});

// ─── TEST AI PROVIDERS ────────────────────────────────────────────────────────

document.getElementById('testGeminiBtn').addEventListener('click', () => {
  _testGemini(
    document.getElementById('geminiApiKey').value.trim(),
    document.getElementById('geminiStatus')
  );
});

document.getElementById('testGroqBtn').addEventListener('click', () => {
  _testOpenAiProvider({
    apiKey:   document.getElementById('groqApiKey').value.trim(),
    statusEl: document.getElementById('groqStatus'),
    endpoint: 'https://api.groq.com/openai/v1/chat/completions',
    model:    'llama-3.3-70b-versatile',
    label:    'Groq'
  });
});

document.getElementById('testOpenrouterBtn').addEventListener('click', () => {
  _testOpenAiProvider({
    apiKey:   document.getElementById('openrouterApiKey').value.trim(),
    statusEl: document.getElementById('openrouterStatus'),
    endpoint: 'https://openrouter.ai/api/v1/chat/completions',
    model:    'meta-llama/llama-3.3-70b-instruct:free',
    label:    'OpenRouter'
  });
});

async function _testGemini(apiKey, statusEl) {
  if (!apiKey) {
    _showStatus(statusEl, 'error', '❌ Please enter a Gemini API key first.');
    return;
  }

  _showStatus(statusEl, 'info', '⏳ Testing Gemini...');

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: 'Reply with exactly: OK' }] }],
          generationConfig: { maxOutputTokens: 8 }
        })
      }
    );

    if (res.ok) {
      _showStatus(statusEl, 'success', '✅ Gemini key is valid! Flash-Lite (free tier) is ready.');
    } else {
      const err = await res.json().catch(() => ({}));
      _showStatus(statusEl, 'error', `❌ ${err.error?.message || 'Invalid API key.'}`);
    }
  } catch (e) {
    _showStatus(statusEl, 'error', `❌ Network error: ${e.message}`);
  }
}

async function _testOpenAiProvider({ apiKey, statusEl, endpoint, model, label }) {
  if (!apiKey) {
    _showStatus(statusEl, 'error', `❌ Please enter a ${label} API key first.`);
    return;
  }

  _showStatus(statusEl, 'info', `⏳ Testing ${label}...`);

  try {
    const res = await fetch(endpoint, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'Reply with exactly: OK' }],
        max_tokens: 8
      })
    });

    if (res.ok) {
      _showStatus(statusEl, 'success', `✅ ${label} key is valid! Free tier is ready.`);
    } else {
      const err = await res.json().catch(() => ({}));
      _showStatus(statusEl, 'error', `❌ ${err.error?.message || 'Invalid API key.'}`);
    }
  } catch (e) {
    _showStatus(statusEl, 'error', `❌ Network error: ${e.message}`);
  }
}

// ─── TEST SLACK WEBHOOK ────────────────────────────────────────────────────────

document.getElementById('testSlackBtn').addEventListener('click', async () => {
  const webhookUrl = document.getElementById('slackWebhookUrl').value.trim();
  const statusEl   = document.getElementById('slackStatus');

  if (!webhookUrl) {
    _showStatus(statusEl, 'error', '❌ Please enter a Slack webhook URL first.');
    return;
  }

  if (!webhookUrl.startsWith('https://hooks.slack.com/')) {
    _showStatus(statusEl, 'error', '❌ URL must start with https://hooks.slack.com/');
    return;
  }

  _showStatus(statusEl, 'info', '⏳ Sending test message...');

  try {
    await postToSlack(webhookUrl, buildTestPayload());
    _showStatus(statusEl, 'success', '✅ Test message sent to Slack! Check your channel.');
  } catch (e) {
    _showStatus(statusEl, 'error', `❌ ${e.message}`);
  }
});

// ─── HELPER ───────────────────────────────────────────────────────────────────

function _showStatus(el, type, msg) {
  el.className  = `status-msg status-${type}`;
  el.textContent = msg;
  el.style.display = 'block';
}
