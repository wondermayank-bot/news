'use strict';
/**
 * 12-1-2026.js: daily pipeline for news.thunderstudy.online
 *
 *   node scripts/12-1-2026.js --section=news    6:00 AM IST   India, world, business, tech, science, sports
 *   node scripts/12-1-2026.js --section=study   9:00 AM IST   CBSE, CUET, JEE, NEET, SSC, banking, MP and more
 *   add --dry for an offline test with sample stories (no network, no OpenRouter calls)
 *
 * Steps: fetch sources -> pick new stories -> write each with OpenRouter (official notices are posted as short
 * factual notices, no rewriting) -> save data/posts.json -> add the section briefing -> rebuild the site.
 *
 * Env: OPENROUTER_API_KEY (required)  OPENROUTER_MODELS (optional)  GNEWS_API_KEY (optional)
 *      POSTS_PER_RUN (optional)  SECTION (alternative to --section)  DATA_FILE / OUT_DIR / LAST_RUN_FILE / SEEN_FILE (testing)
 */
const fs = require('fs');
const crypto = require('crypto');
const { readJSON, writeJSON, slugify, jaccard, ymdInTz, fmtDate, cutWords, sleep } = require('./lib/util');
const { fetchSection } = require('./lib/news');
const { writeStory } = require('./lib/openrouter');
const { build } = require('./build');

const DRY = process.argv.includes('--dry');
const arg = process.argv.find((a) => a.startsWith('--section='));
const SECTION = (arg ? arg.split('=')[1] : process.env.SECTION || 'news').trim();
const SITE = readJSON('config/site.json');
const FEEDS = readJSON('config/feeds.json');
if (!SITE.sections[SECTION]) { console.error('Unknown section: ' + SECTION); process.exit(1); }
const DATA_FILE = process.env.DATA_FILE || 'data/posts.json';
const SEEN_FILE = process.env.SEEN_FILE || 'data/seen-notices.json';
const PER_RUN = parseInt(process.env.POSTS_PER_RUN, 10) || SITE.sections[SECTION].perRun;
const TZ = SITE.timezone;
const CATS = SITE.categories.filter((c) => c.section === SECTION && !c.briefing).map((c) => c.slug);
const BRIEF = SITE.categories.find((c) => c.section === SECTION && c.briefing);
const catOf = (slug) => SITE.categories.find((c) => c.slug === slug);

/* ---------- dry-run samples ---------- */
const sampleStories = () => (SECTION === 'news' ? [
  ['india', 'Sample Daily', 'Parliament committee reviews proposed changes to civic body rules', 'A parliamentary committee met on Saturday to review proposed changes to civic body rules, with members asking for clearer timelines and a simpler process for citizens to file complaints.'],
  ['world', 'Sample Wire', 'Regional leaders agree on a joint plan for cleaner shipping routes', 'Leaders from several coastal countries agreed on a joint plan to cut emissions from shipping, including shared port rules and a timetable for reporting progress each year.'],
  ['business', 'Sample Business', 'Retail sales rise for a third month as festive demand lifts spending', 'Retail sales rose for a third straight month, led by clothing, electronics and food, as festive demand lifted household spending across major cities.'],
  ['technology', 'Sample Tech', 'New open-source tool helps small teams spot weak passwords early', 'Developers released an open-source tool that scans a company account list for weak or reused passwords and sends a short fix list to administrators.'],
  ['sports', 'Sample Sport', 'Hosts clinch a close series decider with a final-over finish', 'The hosts won a close series decider with a final-over finish on Saturday, after the visitors needed six runs from the last four balls.'],
] : [
  ['neet', 'Sample Education', 'Counselling schedule announced for medical admissions this year', 'The counselling authority announced the schedule for medical admissions, with registration opening next week and the first round of seat allotment due later this month.'],
  ['ssc', 'Sample Education', 'Commission releases answer key for combined graduate level tier one', 'The commission released the provisional answer key for the combined graduate level tier one exam and opened a window for candidates to raise objections for a fee.'],
]).map(([category, source, title, summary], i) => ({ category, source, title, summary, url: `https://example.com/${SECTION}/${i}`, published: new Date(Date.now() - i * 3600e3).toISOString() }));
const sampleNotices = () => SECTION !== 'study' ? [] : [
  { category: 'cbse', source: 'CBSE', title: 'Date sheet for supplementary examination 2026 released', url: 'https://example.com/notice/cbse-1' },
  { category: 'cuet', source: 'CUET (NTA)', title: 'Public notice: correction window for CUET UG application forms', url: 'https://example.com/notice/cuet-1' },
  { category: 'mp', source: 'MPESB', title: 'Advertisement for recruitment of various posts is published', url: 'https://example.com/notice/mp-1' },
].map((n) => Object.assign(n, { notice: true, summary: '', published: null }));

const fakeStory = (c) => ({
  title: c.title, description: (c.summary.slice(0, 140) + ' Read the quick summary and key facts.').slice(0, 158),
  quick: `${c.summary} This brief gives the key facts in plain English and links to the original report for the full details.`,
  points: [c.summary.split('. ')[0].slice(0, 120) + '.', 'The report names the people and institutions involved.', 'More details are expected as the story develops.'],
  body: [c.summary, 'This is placeholder text produced by dry-run mode so the layout can be tested offline.', 'In a real run this section is written from the publisher summary.'],
  faq: [{ q: 'What happened?', a: c.summary }, { q: 'Where can I read the original report?', a: `Open the source link on this page to read the original report from ${c.source}.` }],
  keywords: [c.category, 'news', 'daily briefing'], model: 'dry-run',
});

/* ---------- official notices: factual posts, no rewriting ---------- */
function noticeStory(c) {
  const org = c.source.replace(/\s*\(.*?\)\s*$/, ''), t = c.title.replace(/[.\s]+$/, '');
  const cat = catOf(c.category);
  return {
    title: cutWords(t.toLowerCase().startsWith(org.toLowerCase()) ? t : `${org}: ${t}`, 78),
    description: cutWords(`${org} has published a new notice: ${t}. Check the official notice for dates, eligibility and how to apply.`, 158),
    quick: `${org} has posted a new official notice titled "${t}". This page links to the official source so you can read the full details.`,
    points: [`Issued by: ${org}`, `Notice title: ${t}`, 'Always confirm dates, eligibility and fees on the official website.'],
    body: [`${org} has published a new update on its official website: "${t}".`, `Candidates should open the official notice for complete details such as dates, eligibility and the application process. Exam and recruitment details can change, so check the official website regularly.`],
    faq: [
      { q: `Where can I read the official ${org} notice?`, a: `Use the official source link on this page to open the notice on the ${org} website.` },
      { q: `Who should check this ${org} notice?`, a: `Students and candidates following ${org} exams or recruitment should read the notice, because it may affect dates, applications or results.` },
    ],
    keywords: [cat ? cat.name.toLowerCase() : 'exam', org.toLowerCase(), 'official notice', 'exam update'], model: 'official-notice',
  };
}

/* ---------- selection ---------- */
function filterStories(cands, existing) {
  const maxAge = (FEEDS.maxAgeHours || 36) * 3600e3, minLen = FEEDS.minSummaryChars || 60;
  const seen = existing.filter((p) => p.source && Date.now() - new Date(p.date).getTime() < 14 * 864e5).map((p) => ({ url: p.source.url, title: p.source.title }));
  const urlSeen = new Set(existing.map((p) => p.source && p.source.url).filter(Boolean));
  const pool = [];
  for (const c of cands.sort((a, b) => (b.published || '').localeCompare(a.published || ''))) {
    if (!CATS.includes(c.category)) continue;
    if (c.published && Date.now() - new Date(c.published).getTime() > maxAge) continue;
    if ((c.summary || '').length < minLen) continue;
    if (urlSeen.has(c.url)) continue;
    if (seen.some((s) => jaccard(s.title, c.title) >= 0.55)) continue;
    if (pool.some((s) => jaccard(s.title, c.title) >= 0.55)) continue;
    pool.push(c);
  }
  return pool;
}
const roundRobin = (items, key, order, limit) => {
  const by = Object.fromEntries(order.map((k) => [k, items.filter((c) => c[key] === k)]));
  const out = [];
  while (out.length < limit && order.some((k) => by[k].length)) for (const k of order) { if (out.length >= limit) break; const n = by[k].shift(); if (n) out.push(n); }
  return out;
};
const rotate = (arr) => { const d = Math.floor(Date.now() / 864e5); return arr.map((_, i) => arr[(i + d) % arr.length]); };

// New links on official pages. First time a page is seen it is only recorded (baseline), so old notices are never posted as new.
function collectNotices(noticeSources, seenStore, existing) {
  const cands = [], baseline = [];
  const urlSeen = new Set(existing.map((p) => p.source && p.source.url).filter(Boolean));
  for (const s of noticeSources) {
    const links = s.links.slice(0, 40), known = new Set(seenStore[s.source] || []);
    if (!seenStore[s.source]) { baseline.push({ source: s.source, urls: links.map((l) => l.url) }); continue; }
    links.filter((l) => !known.has(l.url) && !urlSeen.has(l.url)).slice(0, FEEDS.noticeMaxPerSource || 4)
      .forEach((l) => cands.push({ notice: true, category: s.category, source: s.source, title: l.title, url: l.url, summary: '', published: null }));
  }
  return { cands, baseline };
}

const uniqueSlug = (title, posts) => { const base = slugify(title); let s = base, n = 2; while (posts.some((p) => p.slug === s)) s = `${base}-${n++}`; return s; };
const wordCount = (o) => [o.quick, ...o.points, ...o.body].join(' ').split(/\s+/).length;

function makeBriefing(posts, nowIso) {
  if (!BRIEF) return null;
  const today = ymdInTz(nowIso, TZ);
  const todays = posts.filter((p) => !p.kind || p.kind !== 'briefing').filter((p) => (catOf(p.category) || {}).section === SECTION && ymdInTz(p.date, TZ) === today);
  if (todays.length < 2) return null;
  const label = fmtDate(nowIso, TZ), study = SECTION === 'study';
  const slug = `${study ? 'study' : 'daily'}-briefing-${slugify(label)}`;
  const titles = todays.map((p) => p.title);
  const quick = `${study ? 'Exam and job updates' : 'Top stories'} on ${label}: ${titles.map((t) => t.replace(/[.\s]+$/, '')).join('; ')}.`;
  const rec = {
    id: `briefing-${SECTION}-${today}`, slug, kind: 'briefing', category: BRIEF.slug,
    title: study ? `Study Briefing: ${todays.length} exam and job updates for ${label}` : `Daily Briefing: ${todays.length} stories to know on ${label}`,
    description: cutWords(`Your ${label} ${study ? 'study' : 'news'} briefing: ${titles.slice(0, 3).join('; ')}.`, 158),
    quick: cutWords(quick, 330), points: titles.slice(0, 5), body: [],
    items: todays.map((p) => ({ slug: p.slug, title: p.title, description: p.description, category: p.category })),
    faq: [
      { q: `What are the ${study ? 'top exam and job updates' : 'top news stories'} on ${label}?`, a: `${study ? 'The top exam and job updates' : 'The top stories'} on ${label} are: ${titles.join('; ')}.` },
      { q: `When is the ${study ? 'study' : 'daily'} briefing published?`, a: `The ThunderStudy News ${study ? 'study' : 'daily'} briefing is published every morning at ${SITE.sections[SECTION].time}.` },
    ],
    keywords: study ? ['study news', 'exam updates today', 'govt exam notices', 'study briefing'] : ['daily news briefing', 'today headlines', 'india news today', 'top stories'],
    date: nowIso, updated: nowIso, readMins: 2, model: 'compiled', source: null,
  };
  const i = posts.findIndex((p) => p.slug === slug);
  if (i >= 0) { rec.date = posts[i].date; posts[i] = rec; } else posts.push(rec);
  return rec;
}

const finish = (n) => { if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `new_posts=${n}\nsection=${SECTION}\n`); };

(async () => {
  const posts = readJSON(DATA_FILE, []);
  console.log(`ThunderStudy News | section: ${SECTION}${DRY ? ' (dry)' : ''} | existing posts: ${posts.length} | target: ${PER_RUN}`);
  if (!DRY && !process.env.OPENROUTER_API_KEY) { console.error('OPENROUTER_API_KEY is missing. Add it as a GitHub repository secret.'); finish(0); process.exit(1); }

  let stories, noticeSources = [];
  if (DRY) stories = sampleStories(); else ({ stories, notices: noticeSources } = await fetchSection(FEEDS, SECTION));
  const seenStore = readJSON(SEEN_FILE, {});
  const nt = DRY ? { cands: sampleNotices(), baseline: [] } : collectNotices(noticeSources, seenStore, posts);

  const pool = filterStories(stories, posts);
  const order = rotate(CATS);
  const nNotice = Math.min(nt.cands.length, Math.ceil(PER_RUN / 2));
  const noticePicks = roundRobin(nt.cands, 'category', order, nNotice);
  const storyPicks = roundRobin(pool, 'category', order, PER_RUN - noticePicks.length);
  const picks = noticePicks.concat(storyPicks);
  console.log(`  stories: ${pool.length} usable | new official notices: ${nt.cands.length} | chosen: ${picks.length}`);

  const now = Date.now(), added = [];
  for (const [i, c] of picks.entries()) {
    console.log(`  writing [${c.category}] ${c.notice ? '(notice) ' : ''}${c.title}`);
    try {
      const out = c.notice ? noticeStory(c) : DRY ? fakeStory(c) : await writeStory(c, { siteUrl: SITE.url });
      const date = new Date(now - i * 60000).toISOString();
      posts.push({
        id: crypto.createHash('sha1').update(c.url).digest('hex').slice(0, 10), slug: uniqueSlug(out.title, posts), kind: c.notice ? 'notice' : 'news', category: c.category,
        title: out.title, description: out.description, quick: out.quick, points: out.points, body: out.body, faq: out.faq, keywords: out.keywords,
        date, updated: date, readMins: Math.max(1, Math.ceil(wordCount(out) / 200)), model: out.model,
        source: { name: c.source, url: c.url, title: c.title, published: c.published, official: !!c.notice },
      });
      added.push(posts[posts.length - 1]);
    } catch (e) { console.warn(`  skipped: ${e.message}`); }
    if (!DRY && !c.notice && i < picks.length - 1) await sleep(4000); // far below the 20 requests/minute free limit
  }

  if (!DRY) { // remember notice links; unpicked new ones stay unseen so they come back next run
    const pickedUrls = new Set(added.map((p) => p.source.url));
    nt.baseline.forEach((b) => { seenStore[b.source] = b.urls; });
    noticeSources.forEach((s) => { if (!seenStore[s.source]) return; const keep = new Set(seenStore[s.source]); s.links.slice(0, 40).forEach((l) => { if (pickedUrls.has(l.url) || !nt.cands.some((c) => c.url === l.url)) keep.add(l.url); }); seenStore[s.source] = [...keep].slice(-300); });
    writeJSON(SEEN_FILE, seenStore);
  }

  let briefing = null;
  if (added.length) briefing = makeBriefing(posts, new Date(now + 1000).toISOString());
  if (added.length || DRY) {
    posts.sort((a, b) => b.date.localeCompare(a.date));
    writeJSON(DATA_FILE, posts);
    const res = await build();
    const site = SITE.url, secPath = SECTION === 'study' ? '/study/' : '/';
    const urlOf = (p) => `${site}/${(catOf(p.category) || {}).section === 'study' ? 'study' : 'news'}/${p.slug}/`;
    writeJSON(process.env.LAST_RUN_FILE || 'data/last-run.json', {
      at: new Date().toISOString(), section: SECTION, sectionName: SITE.sections[SECTION].name, time: SITE.sections[SECTION].time, added: added.length,
      sectionUrl: site + secPath, briefingUrl: briefing ? urlOf(briefing) : null,
      items: added.map((p) => ({ title: p.title, url: urlOf(p), category: (catOf(p.category) || {}).name, official: p.kind === 'notice' })),
      urls: added.map(urlOf).concat([site + '/', site + '/study/', site + '/sitemap.xml', site + '/news-sitemap.xml']),
    });
    console.log(`  published ${added.length} new items (${res.count} total)`);
  }
  finish(added.length);
  if (picks.length && !added.length) { console.error('  every chosen story failed to write: treating this run as a failure'); process.exit(1); }
  if (!picks.length) console.log('  nothing new to publish this time');
})().catch((e) => { console.error(e); try { finish(0); } catch (x) { /* ignore */ } process.exit(1); });
