'use strict';
// Gathers candidates for one section ("news" or "study"):
//   rss     -> headline + summary from a news/press-release feed
//   notice  -> new links on an official web page (CBSE, NTA, UGC, SSC, IBPS, MPESB...), kept as short factual notices
//   gnews   -> optional GNews free plan when GNEWS_API_KEY is set
const { stripHtml, decodeEntities } = require('./util');

const UA = 'ThunderStudyNewsBot/1.0 (+https://news.thunderstudy.online/about/)';

async function get(url, ms = 20000) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html,application/rss+xml,application/xml,text/xml,application/json;q=0.9,*/*;q=0.5' }, signal: AbortSignal.timeout(ms), redirect: 'follow' });
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

// Links on an official page that look like notices, results, circulars, vacancies...
const NOTICE_WORDS = /(notice|notification|result|admit card|date sheet|datesheet|exam|registration|apply|application|vacanc|recruitment|schedule|answer key|counsell?ing|admission|syllabus|circular|advertisement|cut.?off|city intimation|correction|extended|revised|scorecard|merit list|time table|timetable|sample paper|public notice|press release)/i;
const SKIP_TEXT = /^(home|contact us?|about us?|sitemap|login|register here|click here|read more|more|skip to|screen reader|faq|disclaimer|privacy|terms|feedback|rti|help|archive)/i;
function parseNotices(html, baseUrl) {
  const seen = new Set(), out = [];
  const re = /<a\s[^>]*href=(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html))) {
    const href = decodeEntities(m[2]).trim();
    if (!href || /^(javascript:|mailto:|tel:|#)/i.test(href)) continue;
    let url; try { url = new URL(href, baseUrl).toString(); } catch (e) { continue; }
    const text = stripHtml(m[3]);
    if (text.length < 18 || text.length > 220 || SKIP_TEXT.test(text)) continue;
    if (!(NOTICE_WORDS.test(text) || /\.pdf(\?|$)/i.test(url))) continue;
    if (seen.has(url)) continue;
    seen.add(url); out.push({ title: text.replace(/\s*\(\s*\d+(\.\d+)?\s*(kb|mb)\s*\)\s*$/i, '').trim(), url });
  }
  return out;
}

function classify(c, kw) {
  const hay = ' ' + (c.title + ' ' + c.summary).toLowerCase() + ' ';
  for (const slug of ['cbse', 'cuet', 'jee', 'neet', 'ssc', 'banking', 'mp', 'more']) if ((kw[slug] || []).some((k) => hay.includes(k))) return slug;
  return null;
}

async function gnewsGet(url, key) { try { return JSON.parse(await get(url)); } catch (e) { throw new Error(e.message.replace(key, '***')); } }

async function fetchSection(cfg, section) {
  const sec = cfg[section];
  const rss = [], notices = [];
  await Promise.all(sec.feeds.map(async (f) => {
    try {
      const body = await get(f.url);
      if (f.type === 'notice') {
        const links = parseNotices(body, f.url);
        notices.push({ source: f.name, category: f.category, url: f.url, links });
        console.log(`  notice ok ${f.name}: ${links.length} links`);
      } else {
        const items = parseFeed(body);
        items.forEach((i) => rss.push(Object.assign(i, { category: f.category, source: f.name })));
        console.log(`  feed ok   ${f.name} / ${f.category}: ${items.length}`);
      }
    } catch (e) { console.warn(`  FAIL ${f.name} (${f.type}): ${e.message}`); }
  }));

  const key = process.env.GNEWS_API_KEY;
  if (key && sec.gnews) {
    const jobs = section === 'news'
      ? Object.entries(sec.gnews.topics).map(([t, category]) => ({ category, url: `https://gnews.io/api/v4/top-headlines?category=${t}&lang=en&country=in&max=10&apikey=${key}` }))
      : Object.entries(sec.gnews.queries).map(([category, q]) => ({ category, url: `https://gnews.io/api/v4/search?q=${encodeURIComponent(q)}&lang=en&country=in&max=10&apikey=${key}` }));
    for (const j of jobs) {
      try {
        const data = await gnewsGet(j.url, key);
        (data.articles || []).forEach((a) => rss.push({ title: stripHtml(a.title), url: a.url, summary: stripHtml([a.description, a.content].filter(Boolean).join(' ')).replace(/\[\d+ chars\]$/, '').trim(), published: a.publishedAt || null, category: j.category, source: (a.source && a.source.name) || 'GNews' }));
        console.log(`  gnews ok  ${j.category}: ${(data.articles || []).length}`);
      } catch (e) { console.warn(`  gnews FAIL ${j.category}: ${e.message}`); }
    }
  }

  let stories = rss;
  if (section === 'study') {
    stories = rss.map((c) => {
      if (c.category !== 'auto') return c;
      const k = classify(c, sec.keywords);
      return k ? Object.assign(c, { category: k }) : null;
    }).filter(Boolean);
  }
  return { stories, notices };
}

module.exports = { fetchSection, parseFeed, parseNotices, classify, get };
