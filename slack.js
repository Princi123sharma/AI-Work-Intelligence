// slack.js — Deprecated compatibility shim
// Use formatter.js + destinations.js instead.

'use strict';

function buildTasksPayload(dateLabel, tasks, title) {
  return buildTaskListReportPayload(dateLabel, tasks, title || 'Daily Work Report');
}

function buildStandupPayload(dateLabel, standupText) {
  return buildStandupReportPayload(dateLabel, standupText);
}

function buildTimelinePayload(dateLabel, timelineText) {
  return buildTimelineReportPayload(dateLabel, timelineText);
}

function buildReportPayload(stats, period) {
  return buildAnalyticsReportPayload(stats, period);
}

function buildTestPayload() {
  return buildDestinationTestPayload('Slack');
}

async function postToSlack(webhookUrl, content) {
  const payload = typeof content === 'string'
    ? {
        title: 'AI Work Intelligence',
        timestamp: new Date().toISOString(),
        summaryText: content,
        sections: [],
        metadata: { kind: 'test' }
      }
    : content;

  await chrome.storage.sync.set({
    activeDestination: 'slack',
    destinationConfig: { slack: { webhookUrl: String(webhookUrl || '').trim() } },
    slackWebhookUrl: String(webhookUrl || '').trim()
  });
  await dispatchReport(payload);
}
