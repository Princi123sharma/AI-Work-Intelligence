// destinations.js - destination orchestrator and provider adapters

'use strict';

const DESTINATION_LABELS = {
  slack: 'Slack',
  teams: 'Microsoft Teams',
  googleChat: 'Google Chat',
  customApi: 'Custom API'
};

const DESTINATION_COLORS = {
  tasks: '#7C3AED',
  standup: '#6366F1',
  timeline: '#3B82F6',
  report: '#10B981',
  test: '#4A154B'
};

function _destinationLabel(destination) {
  return DESTINATION_LABELS[destination] || 'destination';
}

function _escapeSlack(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function _plainLines(payload) {
  const lines = [payload.title];
  if (payload.summaryText) lines.push('', payload.summaryText);
  (payload.sections || []).forEach(section => {
    if (section.heading) lines.push('', section.heading);
    (section.items || []).forEach(item => lines.push(`- ${item}`));
  });
  return lines.filter(line => line !== null && line !== undefined).join('\n');
}

function _validatePayload(payload) {
  if (!payload || typeof payload !== 'object') {
    throw new Error('No report payload to send.');
  }
  if (!String(payload.title || '').trim() && !String(payload.summaryText || '').trim() && !(payload.sections || []).length) {
    throw new Error('No report content to send.');
  }
}

function _configUrl(config, key = 'webhookUrl') {
  return String(config && config[key] || '').trim();
}

function _formatDispatchError(responseText, status, destination = '') {
  const prefix = destination ? `${destination} dispatch failed` : 'Dispatch failed';

  if (status === 404) {
    return `${prefix} (404). The webhook may have been deleted — verify the URL in Settings.`;
  }
  if (status === 410) {
    return `${prefix} (410). The webhook expired — create a new one and update Settings.`;
  }
  if (responseText && responseText !== 'ok') {
    try {
      const parsed = JSON.parse(responseText);
      if (parsed.error) return `${prefix}: ${parsed.error}`;
    } catch {
      // Fall through to plain-text handling.
    }
    return `${prefix} (HTTP ${status}): ${responseText.slice(0, 240)}`;
  }
  return `${prefix} — HTTP ${status}.`;
}

async function _postJson(url, body, headers = {}, destination = '') {
  if (!url) throw new Error('Destination webhook URL is not configured. Open Settings and save your integration.');

  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body)
    });
  } catch (err) {
    throw new Error(`Network error while sending to ${_destinationLabel(destination)}: ${err.message}`);
  }

  if (!res.ok) {
    const responseText = await res.text().catch(() => '');
    throw new Error(_formatDispatchError(responseText, res.status, _destinationLabel(destination)));
  }
}

function _slackBlocks(payload) {
  const blocks = [
    { type: 'header', text: { type: 'plain_text', text: payload.title.slice(0, 150), emoji: true } }
  ];

  const contextParts = [];
  if (payload.metadata && payload.metadata.dateLabel) contextParts.push(payload.metadata.dateLabel);
  contextParts.push(new Date(payload.timestamp || Date.now()).toLocaleString());
  blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: _escapeSlack(contextParts.join('  |  ')) }] });

  if (payload.summaryText) {
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: _escapeSlack(payload.summaryText).slice(0, 3000) } });
  }

  (payload.sections || []).forEach(section => {
    if (blocks.length >= 48) return;
    if (section.heading) {
      blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `*${_escapeSlack(section.heading)}*` } });
    }
    const items = (section.items || []).map(item => `- ${_escapeSlack(item)}`);
    for (let i = 0; i < items.length && blocks.length < 48; i += 8) {
      blocks.push({ type: 'section', text: { type: 'mrkdwn', text: items.slice(i, i + 8).join('\n').slice(0, 3000) } });
    }
  });

  blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: '_Posted via AI Work Intelligence_' }] });
  return blocks.slice(0, 50);
}

function formatForSlack(payload) {
  const kind = payload.metadata && payload.metadata.kind || 'tasks';
  return {
    text: `${payload.title}${payload.metadata && payload.metadata.dateLabel ? ` - ${payload.metadata.dateLabel}` : ''}`,
    attachments: [{
      color: DESTINATION_COLORS[kind] || DESTINATION_COLORS.tasks,
      blocks: _slackBlocks(payload)
    }]
  };
}

function formatForTeams(payload) {
  const body = [
    { type: 'TextBlock', text: payload.title, weight: 'Bolder', size: 'Medium', wrap: true }
  ];

  if (payload.summaryText) {
    body.push({ type: 'TextBlock', text: payload.summaryText, wrap: true, spacing: 'Small' });
  }

  (payload.sections || []).forEach(section => {
    if (section.heading) body.push({ type: 'TextBlock', text: section.heading, weight: 'Bolder', wrap: true, spacing: 'Medium' });
    (section.items || []).forEach(item => {
      body.push({ type: 'TextBlock', text: `- ${item}`, wrap: true, spacing: 'None' });
    });
  });

  return {
    type: 'message',
    attachments: [{
      contentType: 'application/vnd.microsoft.card.adaptive',
      contentUrl: null,
      content: {
        $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
        type: 'AdaptiveCard',
        version: '1.4',
        body
      }
    }]
  };
}

function formatForGoogleChat(payload) {
  const widgets = [];
  if (payload.summaryText) {
    widgets.push({ textParagraph: { text: payload.summaryText } });
  }

  (payload.sections || []).forEach(section => {
    const text = (section.items || []).map(item => `- ${item}`).join('<br>');
    widgets.push({
      decoratedText: {
        topLabel: section.heading || 'Details',
        text: text || section.heading || payload.title,
        wrapText: true
      }
    });
  });

  return {
    text: _plainLines(payload),
    cardsV2: [{
      cardId: 'ai-work-intelligence-report',
      card: {
        header: {
          title: payload.title,
          subtitle: new Date(payload.timestamp || Date.now()).toLocaleString()
        },
        sections: [{ widgets: widgets.length ? widgets : [{ textParagraph: { text: payload.title } }] }]
      }
    }]
  };
}

function formatForCustomApi(payload) {
  return payload;
}

async function sendToSlack(payload, config) {
  const url = _configUrl(config, 'webhookUrl');
  if (!url) {
    throw new Error('Slack webhook not configured. Open Settings, paste your webhook URL, and click Save.');
  }
  if (!url.startsWith('https://hooks.slack.com/')) {
    throw new Error('Invalid Slack webhook URL. It must start with https://hooks.slack.com/.');
  }
  await _postJson(url, formatForSlack(payload), {}, 'slack');
}

async function sendToTeams(payload, config) {
  const url = _configUrl(config, 'webhookUrl');
  if (!url) throw new Error('Microsoft Teams webhook URL is not configured.');
  if (!/^https:\/\/.+/i.test(url)) throw new Error('Microsoft Teams webhook URL must start with https://.');
  await _postJson(url, formatForTeams(payload), {}, 'teams');
}

async function sendToGoogleChat(payload, config) {
  const url = _configUrl(config, 'webhookUrl');
  if (!url) throw new Error('Google Chat webhook URL is not configured.');
  if (!/^https:\/\/.+/i.test(url)) throw new Error('Google Chat webhook URL must start with https://.');
  await _postJson(url, formatForGoogleChat(payload), {}, 'googleChat');
}

async function sendToCustomApi(payload, config) {
  const url = _configUrl(config, 'url');
  if (!url) throw new Error('Custom API endpoint URL is not configured.');
  if (!/^https?:\/\/.+/i.test(url)) throw new Error('Custom API URL must start with http:// or https://.');

  const headers = {};
  const token = String(config && config.authToken || '').trim();
  if (token) headers.Authorization = token.match(/^(Bearer|Basic)\s+/i) ? token : `Bearer ${token}`;
  await _postJson(url, formatForCustomApi(payload), headers, 'customApi');
}

function getActiveDestinationLabel(activeDestination) {
  return DESTINATION_LABELS[activeDestination] || 'destination';
}

async function dispatchReport(payload) {
  _validatePayload(payload);

  const settings = await getSettings();
  const destinationConfig = settings.destinationConfig || {};
  const legacySlackUrl = String(settings.slackWebhookUrl || '').trim();

  destinationConfig.slack ||= {};
  if (!destinationConfig.slack.webhookUrl && legacySlackUrl) {
    destinationConfig.slack.webhookUrl = legacySlackUrl;
  }

  const activeDestination = settings.activeDestination || (legacySlackUrl ? 'slack' : '');
  const config = destinationConfig[activeDestination] || {};

  if (!activeDestination) {
    throw new Error('No active destination configured. Open Settings and choose where reports should be sent.');
  }

  if (activeDestination === 'slack') return sendToSlack(payload, config);
  if (activeDestination === 'teams') return sendToTeams(payload, config);
  if (activeDestination === 'googleChat') return sendToGoogleChat(payload, config);
  if (activeDestination === 'customApi') return sendToCustomApi(payload, config);

  throw new Error(`Unsupported destination: ${activeDestination}`);
}
