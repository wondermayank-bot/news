'use strict';
/**
 * 12-1-2026.js: daily news pipeline for news.thunderstudy.online
 *
 *   1. fetch headlines  (free RSS feeds, plus the GNews free API when GNEWS_API_KEY is set)
 *   2. pick the best new stories (fresh, not duplicates, spread across topics)
 *   3. write each one with OpenRouter (free models)  -> quick answer, key points, body, FAQ, keywords
 *   4. save to data/posts.json, add a Daily Briefing, rebuild the site (pages, sitemaps, RSS, llms.txt, OG images)
 *
 * Usage:  node scripts/12-1-2026.js            real run (needs OPENROUTER_API_KEY)
 *         node scripts/12-1-2026.js --dry      offline test with sample stories, no API calls
 *
 * Env:    OPENROUTER_API_KEY (required)   OPENROUTER_MODELS (optional, comma-separated)
 *         GNEWS_API_KEY (optional)        POSTS_PER_RUN (optional, default from config/site.json)
 *         DATA_FILE / OUT_DIR (optional, for testing)
 */
const fs = require('fs');
const crypto = require('crypto');
const { ROOT, readJSON, writeJSON, slugify, jaccard, ymdInTz, fmtDate, sleep } = require('./lib/util');
const { fetchCandidates } = require('./lib/news');
const { writeStory } = require('./lib/openrouter');
const { build } = require('./build');

const DRY = process.argv.includes('--dry');
const SITE = readJSON('config/site.json');
const FEEDS = readJSON('config/feeds.json');
const DATA_FILE = process.env.DATA_FILE || 'data/posts.json';
const PER_RUN = parseInt(process.env.POSTS_PER_RUN, 10) || SITE.postsPerRun;
const TZ = SITE.timezone;

const sample = () => [
  ['india', 'Sample Daily', 'Parliament committee reviews proposed changes to exam rules', 'A parliamentary committee met on Saturday to review proposed changes to national exam rules, with members asking for clearer timelines for results and a simpler process for students to file grievances.'],
  ['world', 'Sample Wire', 'Regional leaders agree on a joint plan for cleaner shipping routes', 'Leaders from several coastal countries agreed on a joint plan to cut emissions from shipping, including shared port rules and a timetable for reporting progress each year.'],
  ['business', 'Sample Business', 'Retail sales rise for a third month as festive demand lifts spending', 'Retail sales rose for a third straight month, led by clothing, electronics and food, as festive demand lifted household spending across major cities.'],
  ['technology', 'Sample Tech', 'New open-source tool helps small teams spot weak passwords before attackers do', 'Developers released an open-source tool that scans a company\'s accounts for weak or reused passwords and sends a short fix list to administrators.'],
  ['education', 'Sample Education', 'Board announces revised date sheet for upcoming class 12 practical exams', 'The board has published a revised date sheet for class 12 practical exams and asked schools to complete uploading marks by the new deadline.'],
  ['sports', 'Sample Sport', 'Hosts clinch a close series decider with a final-over finish', 'The hosts won a close series decider with a final-over finish on Saturday, after the visitors needed six runs from the last four balls.'],
].map(([category, source, title, summary], i) => ({ category, source, title, summary, url: `https://example.com/sample/${i}`, published: new Date(Date.now() - i * 3600e3).toISOString() }));

const fakeStory = (c) => ({
  title: c.title, description: (c.summary.slice(0, 150) + ' Read the quick summary and key facts.').slice(0, 158),
  quick: `${c.summary} This brief gives the key facts in plain English and links to the original report for the full details.`,
  points: [c.summary.split('. ')[0].slice(0, 120) + '.', 'The report names the people and institutions involved.', 'More details are expected as the story develops.'],
  body: [c.summary, 'This is placeholder text produced by dry-run mode so the layout can be tested without calling the AI.', 'In a real run, this section is written by an OpenRouter model from the publisher summary.'],
  faq: [{ q: 'What happened?', a: c.summary }, { q: 'Where can I read the original report?', a: `Open the source link on this page to read the original report from ${c.source}.` }],
  keywords: [c.category, 'news', 'daily briefing'], model: 'dry-run',
});

function recent(posts, days) { const t = Date.now() - days * 864e5; return posts.filter((p) => new Date(p.date).getTime() >= t); }

function choose(cands, existing) {
  const maxAge = (FEEDS.maxAgeHours || 36) * 3600e3, minLen = FEEDS.minSummaryChars || 60;
  const seen = recent(existing, 14).flatMap((p) => (p.source ? [{ url: p.source.url, title: p.source.title }] : []));
  const urlSeen = new Set(existing.map((p) => p.source && p.source.url).filter(Boolean));
  const pool = [];
  for (const c of cands.sort((a, b) => (b.published || '').localeCompare(a.published || ''))) {
    if (!SITE.categories.some((k) => k.slug === c.category && k.slug !== 'briefing')) continue;
    if (c.published && Date.now() - new Date(c.published).getTime() > maxAge) continue;
    if ((c.summary || '').length < minLen) continue;
    if (urlSeen.has(c.url)) continue;
    if (seen.some((s) => jaccard(s.title, c.title) >= 0.55)) continue;
    if (pool.some((s) => jaccard(s.title, c.title) >= 0.55)) continue;
    pool.push(c);
  }
  // round-robin across topics, starting topic rotates daily so every topic gets its turn
  const order = SITE.categories.filter((k) => k.slug !== 'briefing').map((k) => k.slug);
  const day = Math.floor(Date.now() / 864e5);
  const rot = order.map((_, i) => order[(i + day) % order.length]);
  const by = Object.fromEntries(rot.map((s) => [s, pool.filter((c) => c.category === s)]));
  const picked = [];
  while (picked.length < PER_RUN && rot.some((s) => by[s].length)) for (const s of rot) { if (picked.length >= PER_RUN) break; const n = by[s].shift(); if (n) picked.push(n); }
  return picked;
}

const uniqueSlug = (title, posts) => { let s = slugify(title), n = 2; const base = s; while (posts.some((p) => p.slug === s)) s = `${base}-${n++}`; return s; };
const words = (o) => [o.quick, ...o.points, ...o.body].join(' ').split(/\s+/).length;

function makeBriefing(posts, now) {
  const today = ymdInTz(now, TZ);
  const todays = posts.filter((p) => p.kind !== 'briefing' && ymdInTz(p.date, TZ) === today);
  if (todays.length < 2) return null;
  const label = fmtDate(now, TZ);
  const slug = `daily-briefing-${slugify(label)}`;
  const titles = todays.map((p) => p.title);
  const quick = `Today's ${todays.length} top stories on ThunderStudy News: ${titles.map((t) => t.replace(/[.\s]+$/, '')).join('; ')}.`;
  const rec = {
    id: 'briefing-' + today, slug, kind: 'briefing', category: 'briefing',
    title: `Daily Briefing: ${todays.length} stories to know on ${label}`,
    description: `Your ${label} news briefing: ${titles.slice(0, 3).join('; ')}.`.slice(0, 158).replace(/[;\s]+$/, '') + (titles.length > 3 ? '' : ''),
    quick: quick.length > 330 ? quick.slice(0, 327).replace(/\s+\S*$/, '') + '…' : quick,
    points: titles.slice(0, 5), body: [], items: todays.map((p) => ({ slug: p.slug, title: p.title, description: p.description, category: p.category })),
    faq: [
      { q: `What are the top news stories on ${label}?`, a: `The top stories on ${label} are: ${titles.join('; ')}.` },
      { q: 'When is the daily briefing published?', a: `The ThunderStudy News daily briefing is published every day at ${SITE.publishTime}.` },
    ],
    keywords: ['daily news briefing', 'today headlines', 'india news today', 'top stories'], date: now, updated: now, readMins: 2, model: 'compiled', source: null,
  };
  const i = posts.findIndex((p) => p.slug === slug);
  if (i >= 0) { rec.date = posts[i].date; posts[i] = rec; } else posts.push(rec);
  return rec;
}

(async () => {
  const posts = readJSON(DATA_FILE, []);
  const before = posts.length;
  console.log(`ThunderStudy News run ${DRY ? '(dry)' : ''} | existing posts: ${before} | target: ${PER_RUN}`);
  if (!DRY && !process.env.OPENROUTER_API_KEY) { console.error('OPENROUTER_API_KEY is missing. Add it as a GitHub repository secret.'); process.exit(1); }

  const cands = DRY ? sample() : await fetchCandidates(FEEDS);
  console.log(`  candidates: ${cands.length}`);
  const picks = choose(cands, posts);
  console.log(`  chosen: ${picks.length}`);

  const now = Date.now();
  const added = [];
  for (const [i, c] of picks.entries()) {
    console.log(`  writing [${c.category}] ${c.title}`);
    try {
      const out = DRY ? fakeStory(c) : await writeStory(c, { siteUrl: SITE.url });
      const date = new Date(now - i * 60000).toISOString();
      const rec = {
        id: crypto.createHash('sha1').update(c.url).digest('hex').slice(0, 10), slug: uniqueSlug(out.title, posts), kind: 'news', category: c.category,
        title: out.title, description: out.description, quick: out.quick, points: out.points, body: out.body, faq: out.faq, keywords: out.keywords,
        date, updated: date, readMins: Math.max(1, Math.ceil(words(out) / 200)), model: out.model,
        source: { name: c.source, url: c.url, title: c.title, published: c.published },
      };
      posts.push(rec); added.push(rec);
    } catch (e) { console.warn(`  skipped: ${e.message}`); }
    if (!DRY && i < picks.length - 1) await sleep(4000); // stay far under the 20 requests/minute free limit
  }

  if (added.length) makeBriefing(posts, new Date(now + 1000).toISOString());
  if (!added.length && !DRY) console.log('  nothing new to publish; rebuilding site only if data changed is not needed.');

  if (added.length || DRY) {
    posts.sort((a, b) => b.date.localeCompare(a.date));
    writeJSON(DATA_FILE, posts);
    const res = await build();
    const urls = added.map((p) => `${SITE.url}/news/${p.slug}/`).concat([`${SITE.url}/`, `${SITE.url}/sitemap.xml`, `${SITE.url}/news-sitemap.xml`]);
    writeJSON(process.env.LAST_RUN_FILE || 'data/last-run.json', { at: new Date().toISOString(), added: added.length, urls });
    console.log(`  published ${added.length} new stories (${res.count} total)`);
  }
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `new_posts=${added.length}\n`);
})().catch((e) => { console.error(e); process.exit(1); });
