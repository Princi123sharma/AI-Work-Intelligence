// formatter.js - maps extension data into StandardizedReportPayload objects

'use strict';

function _cleanText(value) {
  return String(value || '').trim();
}

function _cleanItems(items) {
  return (items || []).map(_cleanText).filter(Boolean);
}

function _standardPayload({ title, summaryText = '', sections = [], metadata = {} }) {
  const cleanSections = (sections || [])
    .map(section => ({
      heading: _cleanText(section.heading),
      items: _cleanItems(section.items)
    }))
    .filter(section => section.heading || section.items.length);

  return {
    title: _cleanText(title) || 'AI Work Intelligence Report',
    timestamp: new Date().toISOString(),
    summaryText: _cleanText(summaryText),
    sections: cleanSections,
    metadata
  };
}

function buildTaskListReportPayload(dateLabel, tasks, title = 'Daily Work Report') {
  const items = _cleanItems(tasks);
  if (!items.length) return null;

  return _standardPayload({
    title,
    summaryText: `${items.length} task${items.length === 1 ? '' : 's'} tracked for ${dateLabel}.`,
    sections: [{ heading: dateLabel, items }],
    metadata: { kind: 'tasks', dateLabel }
  });
}

function buildStandupReportPayload(dateLabel, standupText) {
  const text = _cleanText(standupText);
  if (!text) return null;

  return _standardPayload({
    title: 'Daily Standup',
    summaryText: text,
    sections: [{ heading: dateLabel, items: text.split('\n') }],
    metadata: { kind: 'standup', dateLabel }
  });
}

function buildTimelineReportPayload(dateLabel, timelineText) {
  const items = _cleanItems(String(timelineText || '').split('\n'));
  if (!items.length) return null;

  return _standardPayload({
    title: 'Work Timeline',
    summaryText: `${items.length} activit${items.length === 1 ? 'y' : 'ies'} recorded for ${dateLabel}.`,
    sections: [{ heading: dateLabel, items }],
    metadata: { kind: 'timeline', dateLabel }
  });
}

function buildAnalyticsReportPayload(stats, period) {
  if (!stats || !stats.totalTabs) return null;

  const periodLabel = period === 'weekly' ? 'Weekly' : 'Monthly';
  const sections = [];
  const categories = Object.entries(stats.categories || {}).sort((a, b) => b[1] - a[1]);
  const topDomains = stats.topDomains || [];

  sections.push({
    heading: 'Overview',
    items: [
      `Tabs tracked: ${stats.totalTabs}`,
      `Unique sites: ${Object.keys(stats.domains || {}).length}`,
      `Categories: ${Object.keys(stats.categories || {}).length}`,
      `Productivity: ${Math.min(100, stats.score || 0)}/100`
    ]
  });

  if (categories.length) {
    sections.push({
      heading: 'Work Distribution',
      items: categories.slice(0, 8).map(([category, count]) => `${category}: ${count}`)
    });
  }

  if (topDomains.length) {
    sections.push({
      heading: 'Top Sites',
      items: topDomains.slice(0, 6).map(([domain, count]) => `${domain}: ${count} visits`)
    });
  }

  if (stats.dailyBreakdown && stats.dailyBreakdown.length) {
    sections.push({
      heading: period === 'weekly' ? 'Daily Activity' : 'Most Active Days',
      items: stats.dailyBreakdown
        .filter(day => period === 'weekly' || day.count > 0)
        .map(day => `${day.label}: ${day.count} tabs`)
    });
  }

  return _standardPayload({
    title: `${periodLabel} Work Report`,
    summaryText: `Tracked ${stats.totalTabs} tabs with a productivity score of ${Math.min(100, stats.score || 0)}/100.`,
    sections,
    metadata: { kind: 'report', period }
  });
}

function buildDestinationTestPayload(destinationName = 'destination') {
  return _standardPayload({
    title: 'Connection Test',
    summaryText: `AI Work Intelligence is connected to ${destinationName}.`,
    sections: [{
      heading: 'Status',
      items: ['Connected', 'Reports are ready to send.']
    }],
    metadata: { kind: 'test' }
  });
}
