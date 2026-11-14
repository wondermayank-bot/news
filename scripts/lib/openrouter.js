'use strict';
// OpenRouter client (free models). Free limits: 20 requests/minute, 50/day (1,000/day after buying $10 credits once).
const { sleep, cutWords } = require('./util');

const API = 'https://openrouter.ai/api/v1/chat/completions';
// `openrouter/free` picks any currently available free model. Put :free model ids after it as fallbacks by setting
// the OPENROUTER_MODELS repo variable (comma-separated). Free model ids rotate often, so keep this list short.
const DEFAULT_MODELS = ['openrouter/free'];
function modelList() {
  const m = (process.env.OPENROUTER_MODELS || '').split(',').map((s) => s.trim()).filter(Boolean);
  return m.length ? m : DEFAULT_MODELS;
}

async function chat(messages, { model, maxTokens = 1500, temperature = 0.3, siteUrl } = {}) {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error('OPENROUTER_API_KEY is not set');
  const body = { model, messages, temperature, max_tokens: maxTokens };
  if (process.env.OPENROUTER_JSON_MODE === '1') body.response_format = { type: 'json_object' };
  const res = await fetch(API, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', 'HTTP-Referer': siteUrl || 'https://news.thunderstudy.online', 'X-Title': 'ThunderStudy News' },
    body: JSON.stringify(body), signal: AbortSignal.timeout(120000),
  });
  if (res.status === 429) { const e = new Error('rate limited (429)'); e.retryAfter = Number(res.headers.get('retry-after')) || 0; e.rate = true; throw e; }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${(data.error && data.error.message) || 'request failed'}`);
  const text = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  if (!text || !String(text).trim()) throw new Error('empty completion from ' + (data.model || model));
  return { text: String(text), model: data.model || model };
}

function extractJSON(text) {
  let t = text.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/```json|```/gi, '').trim();
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a < 0 || b <= a) throw new Error('no JSON object in reply');
  t = t.slice(a, b + 1);
  try { return JSON.parse(t); } catch (e) { return JSON.parse(t.replace(/,\s*([}\]])/g, '$1')); }
}

const clean = (s) => String(s == null ? '' : s).replace(/<[^>]+>/g, '').replace(/[*_`#]+/g, '').replace(/\s+/g, ' ').trim();
const asArr = (v) => (Array.isArray(v) ? v : []);

function validate(raw) {
  const title = cutWords(clean(raw.title), 78);
  const description = cutWords(clean(raw.description), 160);
  const quick = cutWords(clean(raw.quick), 330);
  const points = asArr(raw.points).map(clean).filter((s) => s.length > 12).slice(0, 5).map((s) => cutWords(s, 200));
  const body = asArr(raw.body).map(clean).filter((s) => s.length > 40).slice(0, 5);
  const faq = asArr(raw.faq).map((f) => ({ q: cutWords(clean(f && f.q), 140), a: cutWords(clean(f && f.a), 400) })).filter((f) => f.q.length > 8 && f.a.length > 20).slice(0, 3);
  const keywords = asArr(raw.keywords).map((k) => clean(k).toLowerCase()).filter((k) => k && k.length < 40).slice(0, 6);
  if (title.length < 15) throw new Error('title too short');
  if (description.length < 60) throw new Error('description too short');
  if (quick.length < 60) throw new Error('quick answer too short');
  if (points.length < 3) throw new Error('need 3+ key points');
  if (body.length < 2) throw new Error('need 2+ paragraphs');
  if (faq.length < 2) throw new Error('need 2+ FAQ items');
  return { title, description, quick, points, body, faq, keywords };
}

const SYSTEM = `You are the copy desk of ThunderStudy News, an Indian English-language news site for students and curious readers. You write short, neutral, original news briefs.
Rules:
1. Use ONLY facts that appear in the SOURCE block. Never invent names, numbers, dates, quotes, causes or outcomes.
2. If the source is thin, write fewer and shorter paragraphs instead of padding. Do not speculate.
3. Rewrite everything in your own words. Do not copy sentences from the source. Plain English, neutral tone, no hype, no opinion, no emojis, no markdown, no HTML.
4. Reply with ONE JSON object and nothing else.`;

function userPrompt(c) {
  return `SOURCE
Headline: ${c.title}
Publisher: ${c.source}
Published: ${c.published || 'today'}
Section: ${c.category}
Summary from publisher: ${c.summary}

Return JSON with exactly these keys:
{
  "title": "clear news headline, max 70 characters, no clickbait, no publisher name",
  "description": "meta description, 130-155 characters, states the news and who or what it affects",
  "quick": "40-60 word direct answer to 'what happened?' that stands alone",
  "points": ["3 to 5 short key facts, each under 25 words"],
  "body": ["2 to 4 short paragraphs (2-3 sentences each): what happened, details given by the source, why it may matter to readers"],
  "faq": [{"q": "a question a reader would search", "a": "answer using only the source facts"}, {"q": "...", "a": "..."}],
  "keywords": ["3 to 6 lowercase search keywords"]
}`;
}

// Writes one story. Rotates through the model list; backs off on 429. Attempts are capped to protect the free daily limit.
async function writeStory(cand, { siteUrl, maxAttempts = 3 } = {}) {
  const models = modelList();
  let lastErr;
  for (let i = 0; i < maxAttempts; i++) {
    const model = models[i % models.length];
    try {
      const r = await chat([{ role: 'system', content: SYSTEM }, { role: 'user', content: userPrompt(cand) }], { model, siteUrl });
      const out = validate(extractJSON(r.text));
      out.model = r.model;
      return out;
    } catch (e) {
      lastErr = e;
      console.warn(`    attempt ${i + 1}/${maxAttempts} (${model}) failed: ${e.message}`);
      if (e.rate) await sleep(Math.min(Math.max(e.retryAfter * 1000, 8000), 30000)); else await sleep(2500);
    }
  }
  throw lastErr;
}

module.exports = { writeStory, extractJSON, validate, modelList };
