'use strict';
// Fetches today's headlines from free RSS feeds (no key) and, optionally, the GNews free API.
const { stripHtml, decodeEntities } = require('./util');

const UA = 'ThunderStudyNewsBot/1.0 (+https://news.thunderstudy.online/about/)';

async function get(url, ms = 15000) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/rss+xml, application/xml, text/xml, application/json;q=0.9, */*;q=0.5' }, signal: AbortSignal.timeout(ms), redirect: 'follow' });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.text();
}

const pick = (block, tag) => {
  const m = block.match(new RegExp('<' + tag + '(?:\\s[^>]*)?>([\\s\\S]*?)</' + tag + '>', 'i'));
  if (!m) return '';
  return m[1].replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, '$1');
};

function parseFeed(xml) {
  const out = [];
  const items = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) || xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) || [];
  for (const it of items) {
    const title = stripHtml(pick(it, 'title'));
    let link = stripHtml(pick(it, 'link'));
    if (!link) { const m = it.match(/<link[^>]+href=["']([^"']+)["']/i); if (m) link = decodeEntities(m[1]); }
    const desc = stripHtml(pick(it, 'description') || pick(it, 'summary') || pick(it, 'content:encoded') || pick(it, 'content'));
    const date = pick(it, 'pubDate') || pick(it, 'published') || pick(it, 'updated') || pick(it, 'dc:date');
    const t = date ? new Date(stripHtml(date)) : null;
    if (!title || !/^https?:\/\//.test(link)) continue;
    out.push({ title, url: link, summary: desc, published: t && !isNaN(t) ? t.toISOString() : null });
  }
  return out;
}

async function fromFeeds(cfg) {
  const all = [];
  await Promise.all(cfg.feeds.map(async (f) => {
    try {
      const items = parseFeed(await get(f.url));
      items.forEach((i) => all.push(Object.assign(i, { category: f.category, source: f.name })));
      console.log(`  feed ok   ${f.name} / ${f.category}: ${items.length}`);
    } catch (e) { console.warn(`  feed FAIL ${f.name} / ${f.category}: ${e.message}`); }
  }));
  return all;
}

async function fromGNews(cfg, key) {
  const all = [];
  const jobs = Object.entries(cfg.gnews.topics).map(([topic, category]) => ({ category, url: `https://gnews.io/api/v4/top-headlines?category=${topic}&lang=en&country=in&max=10&apikey=${key}` }));
  jobs.push({ category: 'education', url: `https://gnews.io/api/v4/search?q=${encodeURIComponent(cfg.gnews.educationQuery)}&lang=en&country=in&max=10&apikey=${key}` });
  for (const j of jobs) {
    try {
      const data = JSON.parse(await get(j.url));
      (data.articles || []).forEach((a) => all.push({
        title: stripHtml(a.title), url: a.url, summary: stripHtml([a.description, a.content].filter(Boolean).join(' ')).replace(/\[\d+ chars\]$/, '').trim(),
        published: a.publishedAt || null, category: j.category, source: (a.source && a.source.name) || 'GNews',
      }));
      console.log(`  gnews ok  ${j.category}: ${(data.articles || []).length}`);
    } catch (e) { console.warn(`  gnews FAIL ${j.category}: ${e.message.replace(key, '***')}`); }
  }
  return all;
}

async function fetchCandidates(cfg) {
  const lists = [await fromFeeds(cfg)];
  if (process.env.GNEWS_API_KEY) lists.push(await fromGNews(cfg, process.env.GNEWS_API_KEY));
  return lists.flat();
}

module.exports = { fetchCandidates, parseFeed };
