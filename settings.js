// settings.js - Settings page logic

'use strict';

const SETTINGS_KEYS = [
  'aiProvider', 'aiFallback',
  'geminiApiKey', 'groqApiKey', 'openrouterApiKey',
  'slackWebhookUrl', 'activeDestination', 'destinationConfig',
  'userProfile', 'workCategoryTags'
];

function _destinationConfigFromForm() {
  return {
    slack: {
      webhookUrl: document.getElementById('slackWebhookUrl').value.trim()
    },
    teams: {
      webhookUrl: document.getElementById('teamsWebhookUrl').value.trim()
    },
    googleChat: {
      webhookUrl: document.getElementById('googleChatWebhookUrl').value.trim()
    },
    customApi: {
      url: document.getElementById('customApiUrl').value.trim(),
      authToken: document.getElementById('customApiAuthToken').value.trim()
    }
  };
}

function _activeDestinationLabel() {
  const select = document.getElementById('activeDestination');
  return select.options[select.selectedIndex]?.textContent || 'destination';
}

function _showDestinationPanel() {
  const active = document.getElementById('activeDestination').value;
  document.querySelectorAll('[data-destination-panel]').forEach(panel => {
    panel.style.display = panel.dataset.destinationPanel === active ? 'block' : 'none';
  });
}

function _loadSettings() {
  chrome.storage.sync.get(SETTINGS_KEYS, result => {
    const destinationConfig = result.destinationConfig || {};
    const legacySlackUrl = result.slackWebhookUrl || '';
    const activeDestination = result.activeDestination || 'slack';

    if (result.aiProvider) document.getElementById('aiProvider').value = result.aiProvider;
    if (result.geminiApiKey) document.getElementById('geminiApiKey').value = result.geminiApiKey;
    if (result.groqApiKey) document.getElementById('groqApiKey').value = result.groqApiKey;
    if (result.openrouterApiKey) document.getElementById('openrouterApiKey').value = result.openrouterApiKey;
    if (result.userProfile) document.getElementById('userProfile').value = result.userProfile;
    if (result.workCategoryTags) document.getElementById('workCategoryTags').value = result.workCategoryTags;
    document.getElementById('aiFallback').checked = result.aiFallback !== false;
    document.getElementById('activeDestination').value = activeDestination;

    document.getElementById('slackWebhookUrl').value = destinationConfig.slack?.webhookUrl || legacySlackUrl;
    document.getElementById('teamsWebhookUrl').value = destinationConfig.teams?.webhookUrl || '';
    document.getElementById('googleChatWebhookUrl').value = destinationConfig.googleChat?.webhookUrl || '';
    document.getElementById('customApiUrl').value = destinationConfig.customApi?.url || '';
    document.getElementById('customApiAuthToken').value = destinationConfig.customApi?.authToken || '';

    _showDestinationPanel();
  });
}

document.addEventListener('DOMContentLoaded', () => {
  _loadSettings();
  document.getElementById('activeDestination').addEventListener('change', _showDestinationPanel);
});

document.getElementById('saveBtn').addEventListener('click', () => {
  const destinationConfig = _destinationConfigFromForm();

  chrome.storage.sync.set({
    aiProvider: document.getElementById('aiProvider').value,
    aiFallback: document.getElementById('aiFallback').checked,
    geminiApiKey: document.getElementById('geminiApiKey').value.trim(),
    groqApiKey: document.getElementById('groqApiKey').value.trim(),
    openrouterApiKey: document.getElementById('openrouterApiKey').value.trim(),
    activeDestination: document.getElementById('activeDestination').value,
    destinationConfig,
    slackWebhookUrl: destinationConfig.slack.webhookUrl,
    userProfile: document.getElementById('userProfile').value.trim(),
    workCategoryTags: document.getElementById('workCategoryTags').value.trim()
  }, () => {
    const badge = document.getElementById('savedBadge');
    badge.classList.add('show');
    setTimeout(() => badge.classList.remove('show'), 3000);
  });
});

document.getElementById('testGeminiBtn').addEventListener('click', () => {
  _testGemini(
    document.getElementById('geminiApiKey').value.trim(),
    document.getElementById('geminiStatus')
  );
});

document.getElementById('testGroqBtn').addEventListener('click', () => {
  _testOpenAiProvider({
    apiKey: document.getElementById('groqApiKey').value.trim(),
    statusEl: document.getElementById('groqStatus'),
    endpoint: 'https://api.groq.com/openai/v1/chat/completions',
    model: 'llama-3.3-70b-versatile',
    label: 'Groq'
  });
});

document.getElementById('testOpenrouterBtn').addEventListener('click', () => {
  _testOpenAiProvider({
    apiKey: document.getElementById('openrouterApiKey').value.trim(),
    statusEl: document.getElementById('openrouterStatus'),
    endpoint: 'https://openrouter.ai/api/v1/chat/completions',
    model: 'meta-llama/llama-3.3-70b-instruct:free',
    label: 'OpenRouter'
  });
});

async function _testGemini(apiKey, statusEl) {
  if (!apiKey) {
    _showStatus(statusEl, 'error', 'Please enter a Gemini API key first.');
    return;
  }

  _showStatus(statusEl, 'info', 'Testing Gemini...');

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: 'Reply with exactly: OK' }] }],
          generationConfig: { maxOutputTokens: 8 }
        })
      }
    );

    if (res.ok) {
      _showStatus(statusEl, 'success', 'Gemini key is valid. Flash-Lite is ready.');
    } else {
      const err = await res.json().catch(() => ({}));
      _showStatus(statusEl, 'error', err.error?.message || 'Invalid API key.');
    }
  } catch (e) {
    _showStatus(statusEl, 'error', `Network error: ${e.message}`);
  }
}

async function _testOpenAiProvider({ apiKey, statusEl, endpoint, model, label }) {
  if (!apiKey) {
    _showStatus(statusEl, 'error', `Please enter a ${label} API key first.`);
    return;
  }

  _showStatus(statusEl, 'info', `Testing ${label}...`);

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'Reply with exactly: OK' }],
        max_tokens: 8
      })
    });

    if (res.ok) {
      _showStatus(statusEl, 'success', `${label} key is valid.`);
    } else {
      const err = await res.json().catch(() => ({}));
      _showStatus(statusEl, 'error', err.error?.message || 'Invalid API key.');
    }
  } catch (e) {
    _showStatus(statusEl, 'error', `Network error: ${e.message}`);
  }
}

document.getElementById('testDestinationBtn').addEventListener('click', async () => {
  const statusEl = document.getElementById('destinationStatus');
  const activeDestination = document.getElementById('activeDestination').value;
  const destinationConfig = _destinationConfigFromForm();

  _showStatus(statusEl, 'info', `Sending test to ${_activeDestinationLabel()}...`);

  try {
    await chrome.storage.sync.set({
      activeDestination,
      destinationConfig,
      slackWebhookUrl: destinationConfig.slack.webhookUrl
    });
    await dispatchReport(buildDestinationTestPayload(_activeDestinationLabel()));
    _showStatus(statusEl, 'success', `Test sent to ${_activeDestinationLabel()}.`);
  } catch (e) {
    _showStatus(statusEl, 'error', e.message);
  }
});

function _showStatus(el, type, msg) {
  el.className = `status-msg status-${type}`;
  el.textContent = msg;
  el.style.display = 'block';
}
