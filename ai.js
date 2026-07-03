// ai.js — Multi-provider AI integration (Gemini, Groq, OpenRouter)
// All AI feature functions called from popup.js

'use strict';

const AI_PROVIDERS = {
  gemini: {
    label: 'Google Gemini',
    model:  'gemini-2.5-flash-lite'
  },
  groq: {
    label: 'Groq',
    model:  'llama-3.3-70b-versatile'
  },
  openrouter: {
    label: 'OpenRouter',
    model:  'meta-llama/llama-3.3-70b-instruct:free'
  }
};

// ─── CORE API CALLER ───────────────────────────────────────────────────────────

async function _aiCall(prompt, maxTokens = 2048) {
  const settings  = await getSettings();
  const providers = _getProviderOrder(settings);

  if (!providers.length) {
    throw new Error('No AI API key found. Click ⚙️ Settings to add a Gemini, Groq, or OpenRouter key.');
  }

  let lastError;
  for (const providerId of providers) {
    try {
      return await _callProvider(providerId, settings, prompt, maxTokens);
    } catch (err) {
      lastError = err;
      if (providers.length === 1) throw err;
    }
  }

  throw lastError || new Error('All configured AI providers failed.');
}

function _getProviderOrder(settings) {
  const primary = settings.aiProvider || 'gemini';
  const hasKey  = {
    gemini:     !!settings.geminiApiKey,
    groq:       !!settings.groqApiKey,
    openrouter: !!settings.openrouterApiKey
  };

  if (primary === 'auto') {
    return ['gemini', 'groq', 'openrouter'].filter(id => hasKey[id]);
  }

  const order = hasKey[primary] ? [primary] : [];
  if (settings.aiFallback) {
    ['gemini', 'groq', 'openrouter'].forEach(id => {
      if (id !== primary && hasKey[id] && !order.includes(id)) order.push(id);
    });
  }

  return order;
}

async function _callProvider(providerId, settings, prompt, maxTokens) {
  switch (providerId) {
    case 'gemini':     return _geminiCall(settings.geminiApiKey, prompt, maxTokens);
    case 'groq':       return _openAiStyleCall('https://api.groq.com/openai/v1/chat/completions', settings.groqApiKey, AI_PROVIDERS.groq.model, prompt, maxTokens, 'Groq');
    case 'openrouter': return _openAiStyleCall('https://openrouter.ai/api/v1/chat/completions', settings.openrouterApiKey, AI_PROVIDERS.openrouter.model, prompt, maxTokens, 'OpenRouter');
    default:           throw new Error(`Unknown AI provider: ${providerId}`);
  }
}

async function _geminiCall(apiKey, prompt, maxTokens) {
  const model = AI_PROVIDERS.gemini.model;
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature:     0.65,
          maxOutputTokens: maxTokens,
          topP:            0.9
        }
      })
    }
  );

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `Gemini error (HTTP ${res.status})`);
  }

  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Gemini returned an empty response.');
  return text.trim();
}

async function _openAiStyleCall(endpoint, apiKey, model, prompt, maxTokens, providerName) {
  const res = await fetch(endpoint, {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.65,
      max_tokens:  maxTokens
    })
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const msg = err.error?.message || `${providerName} error (HTTP ${res.status})`;
    throw new Error(msg);
  }

  const data = await res.json();
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error(`${providerName} returned an empty response.`);
  return text.trim();
}

// Helper — safely parse the first JSON array from a string
function _parseJsonArray(text) {
  const match = text.match(/\[[\s\S]*?\]/);
  if (match) {
    try { return JSON.parse(match[0]); } catch {}
  }
  return text.split('\n')
    .map(l => l.replace(/^[\d.\-*•›\s]+/, '').replace(/^["']|["']$/g, '').trim())
    .filter(l => l.length > 3);
}

// Helper — safely parse the first JSON object from a string
function _parseJsonObject(text) {
  const match = text.match(/\{[\s\S]*\}/);
  if (match) {
    try { return JSON.parse(match[0]); } catch {}
  }
  return null;
}

function _normalizeProfileRefinements(items) {
  if (!Array.isArray(items)) return [];

  return items
    .map(item => {
      if (typeof item === 'string') {
        const normalized = item.trim().replace(/,$/, '');
        if (normalized.startsWith('{') && normalized.endsWith('}')) {
          try {
            item = JSON.parse(normalized);
          } catch {
            return null;
          }
        } else {
          return { sourceIndex: null, task: normalized };
        }
      }

      if (!item || typeof item !== 'object') return null;

      const rawIndex = Number(item.index ?? item.sourceIndex ?? item.source_index);
      const task = String(item.task || item.title || item.description || '').trim();
      if (!task) return null;

      return {
        sourceIndex: Number.isFinite(rawIndex) ? Math.max(0, rawIndex - 1) : null,
        task
      };
    })
    .filter(Boolean);
}

async function _getUserProfile() {
  const settings = await getSettings();
  return String(settings.userProfile || '').trim();
}

async function _getWorkCategoryTags() {
  const settings = await getSettings();
  if (typeof getConfiguredWorkCategories === 'function') {
    return getConfiguredWorkCategories(settings);
  }
  if (typeof parseWorkCategoryTags === 'function') {
    return parseWorkCategoryTags(settings.workCategoryTags);
  }
  return String(settings.workCategoryTags || '')
    .split(',')
    .map(tag => tag.trim())
    .filter(Boolean);
}

function _categoryPreferenceRules(tags) {
  if (!tags || !tags.length) return '';
  return `When categories are needed, prefer this user-provided category list when it fits the tasks: ${tags.join(' | ')}.
You may add a more precise category only when none of these tags accurately describes the task.`;
}

function _profileContext(profile) {
  if (!profile) return '';
  return `The user's profile is exactly: ${profile}.
Before classifying tabs, silently derive a role definition for this profile:
1. Normal responsibilities and deliverables for "${profile}"
2. Common tools, websites, apps, documents, platforms, and learning resources used by "${profile}"
3. Activities that are clearly unrelated to "${profile}"

Classify a tab as work ONLY if its title/context directly supports that derived role definition.
Do not classify generic productivity, generic research, generic YouTube, generic social media, or generic communication as work unless it clearly connects to "${profile}".
Learning content, courses, docs, tutorials, and YouTube count as work only when the topic clearly supports "${profile}".
Entertainment videos, shorts, music, gaming, movies, celebrity content, sports highlights, personal shopping, personal messages, and unrelated browsing are non-work.
Evaluate every tab independently. The same tab may be work for one profile and non-work for another.
When uncertain, skip the activity.`;
}

function _dynamicCategoryRules(profile) {
  return `Create categories dynamically for the user's exact profile: ${profile}.
Use concise category names that are specific to "${profile}" and the actual tasks.
Prefer 4-8 useful categories when possible.
Do not reuse a generic developer/student/social-media category set unless it truly matches "${profile}".
Avoid non-work categories.`;
}

// ─── FEATURE 1A: TASK REFINEMENT ──────────────────────────────────────────────

async function refineTasks(rawTitles) {
  if (!rawTitles || rawTitles.length === 0) return [];

  const list = rawTitles.map((t, i) => `${i + 1}. ${t}`).join('\n');
  const userProfile = await _getUserProfile();
  const workCategoryTags = await _getWorkCategoryTags();

  if (userProfile) {
    const prompt = `You are a professional work assistant.
${_profileContext(userProfile)}
${_categoryPreferenceRules(workCategoryTags)}

Convert these raw browser tab titles into clear, professional work task descriptions for this user profile.

Raw tab titles:
${list}

Rules:
- Convert each work-related tab title into 1 concise professional task description
- Skip every non-work or unrelated tab for the user's profile
- For localhost/127.0.0.1/IP addresses, include them only when local development/testing fits the profile
- Include YouTube only when the video/title clearly supports this profile's work, study, learning, or skill development
- For collaboration tools such as Slack/Teams/email, include them only when the title/context fits work for the profile
- Be specific but concise (max 12 words per task)
- Return ONLY a JSON array of strings, one per valid work task, no numbering

Example: ["Reviewed campaign analytics", "Watched database lecture on YouTube", "Researched API documentation"]

Return ONLY the JSON array, nothing else.`;

    const result = await _aiCall(prompt, 1024);
    return _parseJsonArray(result);
  }

  const prompt = `You are a professional work assistant helping a software developer.
Convert these raw browser tab titles into clear, professional work task descriptions.

Raw tab titles:
${list}

Rules:
- Convert each tab title into 1 concise professional task description
- Skip non-work tabs: "New Tab", browser settings, YouTube/Netflix for entertainment, etc.
- For localhost/127.0.0.1/IP addresses → describe as local development/testing work
- For GitHub PRs → describe as code review work
- For Slack/Teams tabs → describe as communication/collaboration
- Be specific but concise (max 12 words per task)
- Return ONLY a JSON array of strings, one per valid task, no numbering

Example: ["Developed frontend components on local development server", "Reviewed and merged GitHub pull requests", "Researched Slack API integration documentation"]

Return ONLY the JSON array, nothing else.`;

  const result = await _aiCall(prompt, 1024);
  return _parseJsonArray(result);
}

async function refineProfileTasks(rawTitles) {
  if (!rawTitles || rawTitles.length === 0) return [];

  const userProfile = await _getUserProfile();
  const workCategoryTags = await _getWorkCategoryTags();
  if (!userProfile) {
    const tasks = await refineTasks(rawTitles);
    return tasks.map((task, sourceIndex) => ({ sourceIndex, task }));
  }

  const list = rawTitles.map((t, i) => `${i + 1}. ${t}`).join('\n');
  const prompt = `You are a professional work assistant.
${_profileContext(userProfile)}
${_categoryPreferenceRules(workCategoryTags)}

Review these raw browser tab titles and keep only work-related activity for this user profile.

Raw tab titles:
${list}

Rules:
- Include only tabs that are work-related for the user's profile
- Skip unrelated personal, entertainment, shopping, gaming, generic browsing, and off-role activity
- For localhost/127.0.0.1/IP addresses, include them only when local development/testing fits the profile
- Include YouTube only when the video/title clearly supports this profile's work, study, learning, or skill development
- For collaboration tools such as Slack/Teams/email, include them only when the title/context fits work for the profile
- Convert each included tab into 1 concise professional task description, max 12 words
- Preserve the original 1-based tab number in the "index" field
- Return ONLY a JSON array of objects shaped exactly like [{"index":1,"task":"Task description"}]

Example: [{"index":2,"task":"Reviewed campaign analytics"},{"index":4,"task":"Watched calculus lecture on YouTube"}]

Return ONLY the JSON array, nothing else.`;

  const result = await _aiCall(prompt, 1024);
  return _normalizeProfileRefinements(_parseJsonArray(result));
}

// ─── FEATURE 1B: DAILY SUMMARY ────────────────────────────────────────────────

async function generateSummary(tasks) {
  if (!tasks || tasks.length === 0) return 'No tasks available to summarize.';

  const list = Array.isArray(tasks) ? tasks.join(', ') : tasks;
  const userProfile = await _getUserProfile();

  if (userProfile) {
    const prompt = `Write a concise 1-2 sentence professional daily work summary for a ${userProfile}.
Tasks completed: ${list}

Requirements:
- Sound like a professional writing to their team lead or manager
- Be specific about profile-relevant work done
- Natural, conversational tone (not robotic)
- No bullet points, just flowing text
Return ONLY the summary text.`;

    return await _aiCall(prompt, 256);
  }

  const prompt = `Write a concise 1–2 sentence professional daily work summary.
Tasks completed: ${list}

Requirements:
- Sound like a senior developer writing to their team lead
- Be specific about the work done
- Natural, conversational tone (not robotic)
- No bullet points, just flowing text
Return ONLY the summary text.`;

  return await _aiCall(prompt, 256);
}

// ─── FEATURE 1C: TASK CATEGORIZATION ──────────────────────────────────────────

async function categorizeTasks(tasks) {
  if (!tasks || tasks.length === 0) return {};

  const list = tasks.map((t, i) => `${i + 1}. ${t}`).join('\n');
  const userProfile = await _getUserProfile();
  const workCategoryTags = await _getWorkCategoryTags();

  if (userProfile) {
    const prompt = `Categorize each work task for a ${userProfile}.
${_profileContext(userProfile)}

${_dynamicCategoryRules(userProfile)}
${_categoryPreferenceRules(workCategoryTags)}

Tasks:
${list}

Rules:
- Assign each task to exactly one work category
- Do not include non-work categories
- Only include categories that have at least one task
- Return ONLY a valid JSON object where keys are category names and values are arrays of task strings

Return ONLY the JSON object, nothing else.`;

    const result = await _aiCall(prompt, 1024);
    const parsed = _parseJsonObject(result);
    return parsed || { 'Other': tasks };
  }

  const categoryLine = workCategoryTags.length
    ? workCategoryTags.join(' | ')
    : 'Frontend Development | Backend Development | Salesforce | Meetings | Research | DevOps | Testing | Design | Other';

  const prompt = `Categorize each work task into exactly one of these categories:
${categoryLine}

Tasks:
${list}

Return ONLY a valid JSON object where keys are category names and values are arrays of task strings.
Only include categories that have at least one task.
Example: {"Frontend Development": ["Built login page UI"], "Research": ["Read Slack API docs"]}

Return ONLY the JSON object, nothing else.`;

  const result = await _aiCall(prompt, 1024);
  const parsed = _parseJsonObject(result);
  return parsed || { 'Other': tasks };
}

// ─── FEATURE 4: STANDUP GENERATOR ─────────────────────────────────────────────

async function generateStandup(tasks, format = 'short', date = null) {
  if (!tasks || tasks.length === 0) throw new Error('No tasks to generate standup from.');

  const dateLabel = date
    ? new Date(date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
    : new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

  const taskList = tasks.map(t => `• ${t}`).join('\n');

  const userProfile = await _getUserProfile();
  const roleLine = userProfile
    ? `The user is a ${userProfile}. Make the standup sound appropriate for that role.\n\n`
    : '';

  let prompt;

  if (format === 'short') {
    prompt = `Generate a SHORT professional daily standup for ${dateLabel}.
${roleLine}

Tasks worked on:
${taskList}

Format exactly like this:
*Today:*
• [concise task 1]
• [concise task 2]
• [concise task 3]

Keep each bullet under 10 words. Return ONLY the standup text.`;

  } else if (format === 'detailed') {
    prompt = `Write a DETAILED daily standup narrative for ${dateLabel}.
${roleLine}

Tasks worked on:
${taskList}

Write 2–4 sentences describing the work in detail, mentioning specific areas worked on.
Sound professional and confident. Return ONLY the narrative paragraph.`;

  } else if (format === 'scrum') {
    prompt = `Generate a SCRUM format daily standup for ${dateLabel}.
${roleLine}

Tasks completed:
${taskList}

Format exactly like this:
*Yesterday:*
• [what was completed]

*Today:*
• [logical next steps based on yesterday's work]

*Blockers:*
• None

Return ONLY the standup in this exact format.`;
  }

  return await _aiCall(prompt, 512);
}

// ─── FEATURE 3: TIMELINE GENERATION ───────────────────────────────────────────

async function generateTimeline(tabHistory) {
  if (!tabHistory || tabHistory.length === 0) {
    throw new Error('No activity recorded today. Browse some tabs first.');
  }

  const sorted = [...tabHistory]
    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

  const logLines = sorted.map(e => {
    const t = new Date(e.timestamp).toLocaleTimeString('en-US', {
      hour: '2-digit', minute: '2-digit', hour12: true
    });
    return `${t} → ${e.title || e.domain || e.url}`;
  }).join('\n');

  const userProfile = await _getUserProfile();
  const profileRules = userProfile
    ? `${_profileContext(userProfile)}
- Focus only on timeline entries that are work-related for this profile
- Skip unrelated personal or entertainment activity
`
    : '';

  const prompt = `You are analyzing a ${userProfile || 'developer'}'s browser activity log.
Generate a clean chronological work timeline.
${profileRules}

Activity log:
${logLines}

Rules:
- Every timestamp MUST be copied exactly from the activity log (same HH:MM AM/PM)
- Do not invent, infer, interpolate, round, or add timestamps for gaps
- Group closely related activities (< 5 mins apart) into one entry using the earliest timestamp from that group
- Use professional activity descriptions based on page titles in the log
- Format each line EXACTLY as: "HH:MM AM – Activity description"
- Include up to 12 timeline entries
- Focus on meaningful work, skip brief page visits

Return ONLY the timeline, one entry per line, no other text.`;

  return await _aiCall(prompt, 512);
}

// ─── FEATURE 1D: PRODUCTIVITY INSIGHTS ────────────────────────────────────────

async function generateInsight(stats) {
  const { totalTabs, topDomains, categories } = stats;

  const domainStr = (topDomains || []).slice(0, 4).map(([d, c]) => `${d}(${c})`).join(', ');
  const catStr    = Object.entries(categories || {}).map(([c, n]) => `${c}: ${n}`).join(', ');
  const userProfile = await _getUserProfile();

  const prompt = `Based on a ${userProfile || 'developer'}'s daily work data, write a 1-sentence productivity insight.

Data:
- Total tabs tracked: ${totalTabs}
- Top domains: ${domainStr || 'N/A'}
- Work categories: ${catStr || 'N/A'}

Be specific, encouraging, and mention actual patterns you see.
Return ONLY the insight sentence.`;

  return await _aiCall(prompt, 128);
}
