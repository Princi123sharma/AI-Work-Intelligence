// slack.js — Slack incoming webhook helper with colorful Block Kit messages

'use strict';

const SLACK_COLORS = {
  tasks:    '#7C3AED',
  standup:  '#6366F1',
  timeline: '#3B82F6',
  report:   '#10B981',
  test:     '#4A154B'
};

const CAT_EMOJI = {
  'Frontend Development': '🎨',
  'Backend Development':  '⚙️',
  'Salesforce':           '☁️',
  'Meetings':             '🤝',
  'Research':             '🔍',
  'DevOps':               '🚀',
  'Testing':              '🧪',
  'Design':               '✨',
  'Other':                '📌'
};

// ─── CORE POST ────────────────────────────────────────────────────────────────

async function postToSlack(webhookUrl, content) {
  const url = (webhookUrl || '').trim();

  if (!url) {
    throw new Error('Slack webhook not configured. Open Settings, paste your webhook URL, and click Save.');
  }

  if (!url.startsWith('https://hooks.slack.com/')) {
    throw new Error('Invalid Slack webhook URL. It must start with https://hooks.slack.com/');
  }

  const body = typeof content === 'string'
    ? { text: content }
    : content;

  if (!body?.text?.trim() && !body?.blocks?.length && !body?.attachments?.length) {
    throw new Error('No message content to post.');
  }

  const res = await fetch(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body)
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    throw new Error(_formatSlackError(errBody, res.status));
  }
}

function _formatSlackError(body, status) {
  if (status === 404) {
    return 'Slack webhook not found (404). The webhook may have been deleted — create a new one in Slack.';
  }
  if (status === 410) {
    return 'Slack webhook expired (410). Create a new incoming webhook in Slack and update Settings.';
  }
  if (body && body !== 'ok') {
    try {
      const parsed = JSON.parse(body);
      if (parsed.error) return `Slack error: ${parsed.error}`;
    } catch {}
    return `Slack error (HTTP ${status}): ${body.slice(0, 200)}`;
  }
  return `Slack request failed — HTTP ${status}`;
}

// ─── BLOCK HELPERS ────────────────────────────────────────────────────────────

function _mrkdwn(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function _header(emoji, title) {
  return {
    type: 'header',
    text: { type: 'plain_text', text: `${emoji} ${title}`, emoji: true }
  };
}

function _context(text) {
  return {
    type: 'context',
    elements: [{ type: 'mrkdwn', text }]
  };
}

function _divider() {
  return { type: 'divider' };
}

function _section(text) {
  return {
    type: 'section',
    text: { type: 'mrkdwn', text }
  };
}

function _fields(pairs) {
  return {
    type: 'section',
    fields: pairs.map(([label, value]) => ({
      type: 'mrkdwn',
      text: `*${_mrkdwn(label)}*\n${_mrkdwn(value)}`
    }))
  };
}

function _wrapPayload(fallbackText, color, blocks) {
  return {
    text: fallbackText,
    attachments: [{ color, blocks: blocks.slice(0, 50) }]
  };
}

function _chunkList(items, formatter, size = 8) {
  const sections = [];
  for (let i = 0; i < items.length; i += size) {
    const chunk = items.slice(i, i + size);
    sections.push(_section(chunk.map(formatter).join('\n')));
  }
  return sections;
}

// ─── PAYLOAD BUILDERS ─────────────────────────────────────────────────────────

function buildTasksPayload(dateLabel, tasks, title = 'Daily Standup Report') {
  const list = (tasks || []).map(t => (t || '').trim()).filter(Boolean);
  if (!list.length) return null;

  const blocks = [
    _header('📋', title),
    _context(`📅 *${_mrkdwn(dateLabel)}*  ·  ${list.length} task${list.length === 1 ? '' : 's'}`),
    _divider(),
    ..._chunkList(list, t => `✅ ${_mrkdwn(t)}`),
    _context('_Posted via AI Work Intelligence_')
  ];

  return _wrapPayload(
    `${title} — ${dateLabel}`,
    SLACK_COLORS.tasks,
    blocks
  );
}

function buildStandupPayload(dateLabel, standupText) {
  const text = (standupText || '').trim();
  if (!text) return null;

  const blocks = [
    _header('📝', 'Daily Standup'),
    _context(`📅 *${_mrkdwn(dateLabel)}*`),
    _divider(),
    _section(_mrkdwn(text).replace(/\n/g, '\n')),
    _context('_Posted via AI Work Intelligence_')
  ];

  return _wrapPayload(
    `Daily Standup — ${dateLabel}`,
    SLACK_COLORS.standup,
    blocks
  );
}

function buildTimelinePayload(dateLabel, timelineText) {
  const lines = (timelineText || '').split('\n').map(l => l.trim()).filter(Boolean);
  if (!lines.length) return null;

  const blocks = [
    _header('⏱️', 'Work Timeline'),
    _context(`📅 *${_mrkdwn(dateLabel)}*  ·  ${lines.length} activit${lines.length === 1 ? 'y' : 'ies'}`),
    _divider()
  ];

  lines.forEach(line => {
    const match = line.match(/^(\d{1,2}:\d{2}\s*(?:AM|PM))\s*[–\-]\s*(.+)$/i);
    if (match) {
      blocks.push(_fields([
        ['🕐 Time', match[1]],
        ['💼 Activity', match[2]]
      ]));
    } else {
      blocks.push(_section(`• ${_mrkdwn(line)}`));
    }
  });

  blocks.push(_context('_Posted via AI Work Intelligence_'));

  return _wrapPayload(
    `Work Timeline — ${dateLabel}`,
    SLACK_COLORS.timeline,
    blocks
  );
}

function buildReportPayload(stats, period) {
  if (!stats?.totalTabs) return null;

  const { totalTabs, domains, categories, topDomains, score, dailyBreakdown } = stats;
  const periodLabel = period === 'weekly' ? 'Weekly' : 'Monthly';
  const scoreVal    = Math.min(100, score || 0);
  const scoreEmoji  = scoreVal >= 80 ? '🔥' : scoreVal >= 60 ? '✅' : '📈';

  const blocks = [
    _header('📊', `${periodLabel} Work Report`),
    _context(`🧠 *AI Work Intelligence*  ·  Productivity ${scoreEmoji}`),
    _divider(),
    _fields([
      ['Tabs Tracked', String(totalTabs)],
      ['Unique Sites', String(Object.keys(domains || {}).length)],
      ['Categories',   String(Object.keys(categories || {}).length)],
      ['Productivity', `${scoreVal}/100`]
    ])
  ];

  const catEntries = Object.entries(categories || {}).sort((a, b) => b[1] - a[1]).slice(0, 6);
  if (catEntries.length) {
    blocks.push(_divider());
    blocks.push(_section(
      '*🗂 Work Distribution*\n' +
      catEntries.map(([cat, count]) => {
        const emoji = CAT_EMOJI[cat] || '📌';
        return `${emoji} *${_mrkdwn(cat)}* — ${count}`;
      }).join('\n')
    ));
  }

  if ((topDomains || []).length) {
    blocks.push(_divider());
    blocks.push(_section(
      '*🌐 Top Sites*\n' +
      topDomains.slice(0, 5).map(([domain, count], i) => {
        const medal = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣'][i] || '•';
        return `${medal} *${_mrkdwn(domain)}* — ${count} visits`;
      }).join('\n')
    ));
  }

  if (period === 'weekly' && dailyBreakdown?.length) {
    blocks.push(_divider());
    blocks.push(_section(
      '*📅 Daily Activity*\n' +
      dailyBreakdown.map(d => `• *${_mrkdwn(d.label)}* — ${d.count} tabs`).join('\n')
    ));
  }

  if (period === 'monthly' && dailyBreakdown?.length) {
    const productiveDays = dailyBreakdown.filter(d => d.count > 0).slice(0, 5);
    if (productiveDays.length) {
      blocks.push(_divider());
      blocks.push(_section(
        '*🏆 Most Productive Days*\n' +
        productiveDays.map((d, i) => {
          const label = new Date(d.date + 'T12:00:00').toLocaleDateString('en-US', {
            weekday: 'short', month: 'short', day: 'numeric'
          });
          const medal = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣'][i] || '•';
          return `${medal} *${_mrkdwn(label)}* — ${d.count} tabs`;
        }).join('\n')
      ));
    }
  }

  blocks.push(_context('_Posted via AI Work Intelligence_'));

  return _wrapPayload(
    `${periodLabel} Work Report`,
    SLACK_COLORS.report,
    blocks
  );
}

function buildTestPayload() {
  const blocks = [
    _header('🧪', 'Connection Test'),
    _divider(),
    _section('✅ *AI Work Intelligence* is connected to Slack!\nYour colorful standup posts are ready to go.'),
    _fields([
      ['Status', 'Connected'],
      ['Extension', 'AI Work Intelligence v2.0']
    ]),
    _context('_Test message from extension settings_')
  ];

  return _wrapPayload(
    'AI Work Intelligence — Slack connection test',
    SLACK_COLORS.test,
    blocks
  );
}
