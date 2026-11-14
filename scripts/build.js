'use strict';
// Renders the whole static site from data/posts.json + templates/ into public/.
// Run alone with `npm run build`, or automatically by scripts/12-1-2026.js after new posts are written.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { ROOT, readJSON, escHtml: E, escXml: X, fmtDate, ymdInTz, cutWords } = require('./lib/util');

let sharp = null;
try { sharp = require('sharp'); } catch (e) { /* OG images are skipped without sharp */ }

// Light-mode tint pairs from the clay kit, used only for the generated social images.
const TINTS = {
  purple: ['#D9CCFF', '#3E2A9E'], blue: ['#C7DDFF', '#1F4FA3'], green: ['#C6F0D3', '#1B6B3A'], yellow: ['#FFF0A8', '#7A5C00'],
  pink: ['#FFCFE6', '#9E2A68'], orange: ['#FFD9B8', '#A34A0B'], teal: ['#BDF0EA', '#0F6A63'], lime: ['#E0F5A8', '#4D6B0A'], cyan: ['#BDEBFF', '#0B6180'],
};
const ROBOTS = 'index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1';
const MIN = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/[ \t]+\n/g, '\n').replace(/\n\s*\n+/g, '\n').replace(/^\s+/gm, '');
const hash = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 8);

async function build(opts = {}) {
  const SITE = readJSON('config/site.json');
  const dataFile = opts.dataFile || process.env.DATA_FILE || 'data/posts.json';
  const OUT = path.resolve(opts.outDir || process.env.OUT_DIR || path.join(ROOT, 'public'));
  const TZ = SITE.timezone;
  const posts = readJSON(dataFile, []).sort((a, b) => b.date.localeCompare(a.date));
  const cats = SITE.categories;
  const cat = (slug) => cats.find((c) => c.slug === slug) || cats[0];
  const secOf = (p) => cat(p.category).section || 'news';
  const catsOf = (sec) => cats.filter((c) => c.section === sec);
  const SEC = SITE.sections;
  const abs = (p) => SITE.url + p;
  const postUrl = (p) => `/${secOf(p) === 'study' ? 'study' : 'news'}/${p.slug}/`;
  const catUrl = (slug) => `/category/${slug}/`;
  const missing = new Set();

  /* ---------- helpers ---------- */
  const T = (name) => fs.readFileSync(path.join(ROOT, 'templates', name), 'utf8');
  const ic = (n, cls) => `<svg class="ic${cls ? ' ' + cls : ''}" aria-hidden="true" focusable="false"><use href="#ic-${n}"></use></svg>`;
  const ICV = { icHome: ic('home'), icSearch: ic('search'), icArchive: ic('archive'), icContact: ic('contact'), icArrow: ic('arrow'), icClock: ic('clock'), icPaper: ic('paper'), icGlobe: ic('globe'), icLink: ic('link'), icSpark: ic('spark'), icShield: ic('shield'), icRss: ic('rss'), icBolt: ic('bolt'), icInfo: ic('info'), icCap: ic('cap') };
  const fill = (tpl, vars) => tpl.replace(/\{\{(\w+)\}\}/g, (m, k) => {
    const v = vars[k] !== undefined ? vars[k] : ICV[k];
    if (v === undefined) { missing.add(k); return ''; }
    return v;
  });
  const write = (rel, content) => {
    const f = path.join(OUT, rel);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, content);
  };
  const dLong = (iso) => fmtDate(iso, TZ);
  const dShort = (iso) => fmtDate(iso, TZ, { day: 'numeric', month: 'short' });
  const tIst = (iso) => new Intl.DateTimeFormat('en-IN', { timeZone: TZ, hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(iso)) + ' IST';
  const tintVars = (c) => `--c:var(--${c.tint});--k:var(--${c.tint}-ink)`;
  const jsonLd = (graph) => JSON.stringify({ '@context': 'https://schema.org', '@graph': graph }).replace(/</g, '\\u003c');
  const ogImg = (p) => abs(p && p.slug ? `/og/${p.slug}.png` : '/og-image.png');

  const org = () => ({
    '@type': 'NewsMediaOrganization', '@id': abs('/#org'), name: SITE.name, url: abs('/'), description: SITE.description,
    logo: { '@type': 'ImageObject', url: abs('/logo-512.png'), width: 512, height: 512 }, sameAs: SITE.sameAs,
    publishingPrinciples: abs('/about/#policy'), ethicsPolicy: abs('/about/#policy'), correctionsPolicy: abs('/corrections/'), actionableFeedbackPolicy: abs('/corrections/'),
    email: SITE.email, founder: { '@type': 'Person', name: SITE.owner.name, url: SITE.owner.url },
    contactPoint: { '@type': 'ContactPoint', contactType: 'customer support', email: SITE.email, url: abs('/contact/'), availableLanguage: ['English', 'Hindi'] },
  });
  const website = () => ({
    '@type': 'WebSite', '@id': abs('/#website'), url: abs('/'), name: SITE.name, description: SITE.description, inLanguage: SITE.lang, publisher: { '@id': abs('/#org') },
    potentialAction: { '@type': 'SearchAction', target: { '@type': 'EntryPoint', urlTemplate: abs('/search/?q={search_term_string}') }, 'query-input': 'required name=search_term_string' },
  });
  const crumbs = (items) => ({ '@type': 'BreadcrumbList', itemListElement: items.map((it, i) => ({ '@type': 'ListItem', position: i + 1, name: it[0], item: abs(it[1]) })) });
  const itemList = (list) => ({ '@type': 'ItemList', itemListOrder: 'https://schema.org/ItemListOrderDescending', numberOfItems: list.length, itemListElement: list.map((p, i) => ({ '@type': 'ListItem', position: i + 1, url: abs(postUrl(p)), name: p.title })) });
  const faqLd = (faq) => ({ '@type': 'FAQPage', mainEntity: faq.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })) });

  /* ---------- shared chrome ---------- */
  const css = MIN(fs.readFileSync(path.join(ROOT, 'assets-src/kit.css'), 'utf8') + '\n' + fs.readFileSync(path.join(ROOT, 'assets-src/news.css'), 'utf8'));
  const js = fs.readFileSync(path.join(ROOT, 'assets-src/app.js'), 'utf8');
  const cssV = hash(css), jsV = hash(js);
  const menuCats = ['news', 'study'].map((k) => `<p class="mm-label">${E(SEC[k].name)}</p>` + catsOf(k).map((c) => `<a href="${catUrl(c.slug)}">${E(c.name)}</a>`).join('\n')).join('\n') + '\n<a href="/archive/">Archive</a>';
  const header = fill(T('partials/header.html'), { siteName: E(SITE.name), contactUrl: E(SITE.contactUrl), menuCats });
  const footer = T('partials/footer.html');
  const icons = T('partials/icons.html');
  const catChips = (active, sec) => catsOf(sec || 'news').map((c) => `<a class="chip${active === c.slug ? ' active' : ''}"${active === c.slug ? ' aria-current="page"' : ''} href="${catUrl(c.slug)}">${ic(c.icon)}${E(c.name)}</a>`).join('')
    + `<a class="chip" href="/archive/">${ic('archive')}Archive</a>`;
  const secChips = () => `<a class="chip" href="/">${ic('home')}News</a><a class="chip" href="/study/">${ic('cap')}Study News</a><a class="chip active" aria-current="page" href="/archive/">${ic('archive')}Archive</a>`;

  function page(o) {
    const canonical = abs(o.path);
    const title = o.title;
    return fill(T('layout.html'), {
      lang: SITE.lang, locale: SITE.locale, siteName: E(SITE.name), twitter: E(SITE.twitter), cssV, jsV,
      title: E(title), description: E(o.description), canonical: E(canonical), robots: o.robots || ROBOTS,
      ogType: o.ogType || 'website', ogTitle: E(o.ogTitle || title), ogImage: E(o.ogImage || ogImg()), ogAlt: E(o.ogAlt || SITE.name),
      headExtra: o.headExtra || '', jsonld: jsonLd(o.graph), bodyClass: o.bodyClass || '',
      icons, header, footer, content: o.content,
    });
  }

  /* ---------- cards ---------- */
  const card = (p, reveal = true) => {
    const c = cat(p.category);
    return `<a class="ncard${reveal ? ' reveal' : ''}" href="${postUrl(p)}"><div class="ncard-top" style="${tintVars(c)}">${ic(c.icon, 'big')}<span class="tag">${E(c.name)}</span></div><div class="ncard-body"><h3>${E(p.title)}</h3><p>${E(p.description)}</p><div class="meta"><time datetime="${p.date}">${dLong(p.date)}</time><span class="dot"></span><span>${p.readMins} min read</span></div></div></a>`;
  };
  const featureCard = (p) => {
    const c = cat(p.category);
    return `<a class="fcard reveal" href="${postUrl(p)}"><div class="fcard-top" style="${tintVars(c)}">${ic(c.icon, 'big')}<span class="tag">${E(c.name)}</span></div><div class="fcard-body"><h3>${E(p.title)}</h3><p>${E(p.quick || p.description)}</p><div class="meta"><time datetime="${p.date}">${dLong(p.date)}, ${tIst(p.date)}</time><span class="dot"></span><span>${p.readMins} min read</span></div></div></a>`;
  };
  const sideCard = (p) => {
    const c = cat(p.category);
    return `<a class="scard reveal" href="${postUrl(p)}" style="${tintVars(c)}"><span class="scard-ic">${ic(c.icon)}</span><span><h3>${E(p.title)}</h3><small>${E(c.name)} &middot; ${dShort(p.date)}</small></span></a>`;
  };
  const faqHtml = (faq) => faq.map((f) => `<details class="faq-item"><summary>${E(f.q)}<span class="faq-chev">${ic('chev')}</span></summary><p>${E(f.a)}</p></details>`).join('\n');

  /* ---------- pagination ---------- */
  const pages = (items, per, base) => {
    const n = Math.max(1, Math.ceil(items.length / per));
    return Array.from({ length: n }, (_, i) => ({ n: i + 1, total: n, items: items.slice(i * per, (i + 1) * per), url: i === 0 ? base : `${base}page/${i + 1}/` }));
  };
  const pagerHtml = (pg, base) => {
    if (pg.total < 2) return '';
    const u = (n) => (n === 1 ? base : `${base}page/${n}/`);
    const nums = [];
    for (let i = 1; i <= pg.total; i++) if (i === 1 || i === pg.total || Math.abs(i - pg.n) <= 1) nums.push(i); else if (nums[nums.length - 1] !== '…') nums.push('…');
    return `<nav class="pager" aria-label="Pagination">${pg.n > 1 ? `<a href="${u(pg.n - 1)}" rel="prev" aria-label="Previous page">Prev</a>` : ''}${nums.map((i) => (i === '…' ? '<span>…</span>' : i === pg.n ? `<span aria-current="page">${i}</span>` : `<a href="${u(i)}">${i}</a>`)).join('')}${pg.n < pg.total ? `<a href="${u(pg.n + 1)}" rel="next" aria-label="Next page">Next</a>` : ''}</nav>`;
  };
  const prevNext = (pg, base) => {
    const u = (n) => abs(n === 1 ? base : `${base}page/${n}/`);
    return (pg.n > 1 ? `<link rel="prev" href="${u(pg.n - 1)}">` : '') + (pg.n < pg.total ? `<link rel="next" href="${u(pg.n + 1)}">` : '');
  };

  /* ---------- clean old output (keeps og/ cache) ---------- */
  ['news', 'study', 'category', 'archive', 'about', 'contact', 'privacy', 'terms', 'disclaimer', 'corrections', 'search', 'assets'].forEach((d) => fs.rmSync(path.join(OUT, d), { recursive: true, force: true }));
  fs.mkdirSync(OUT, { recursive: true });
  const staticDir = path.join(ROOT, 'static');
  if (fs.existsSync(staticDir)) fs.readdirSync(staticDir).forEach((f) => fs.copyFileSync(path.join(staticDir, f), path.join(OUT, f)));
  write('assets/style.css', css);
  write('assets/app.js', js);

  /* ---------- home (News) and Study News ---------- */
  const news = posts.filter((p) => p.kind !== 'briefing');
  const newsPosts = posts.filter((p) => secOf(p) === 'news'), studyPosts = posts.filter((p) => secOf(p) === 'study');
  const latestIso = posts.length ? posts[0].date : new Date().toISOString();
  const urls = []; // {loc, lastmod, changefreq, priority, image}
  const homeFaq = [
    { q: 'What is ThunderStudy News?', a: `ThunderStudy News is a free daily news site for students and curious readers in India. It has two sections: News, with headlines from India and the world, and Study News, with updates on CBSE, CUET, JEE, NEET, SSC, banking and MP exams and jobs.` },
    { q: 'When are new stories published?', a: `News is published every morning at ${SEC.news.time} and Study News at ${SEC.study.time}. Follow our Telegram channel or the RSS feed to get each update as it arrives.` },
    { q: 'Where does the news come from?', a: 'Stories are based on official websites and trusted publishers such as The Hindu, BBC News, The Indian Express and government sites. The source is named and linked on every story.' },
    { q: 'How do I report a mistake or ask for a removal?', a: `Email ${SITE.email} or use the contact page, and include the link to the story. We check every report and correct or remove the story if needed. See our corrections policy for details.` },
    { q: 'Is ThunderStudy News free?', a: 'Yes. Reading ThunderStudy News is free and there is no sign-up.' },
  ];
  const studyFaq = [
    { q: 'What is Study News?', a: 'Study News is the exam and jobs section of ThunderStudy News. It covers CBSE, CUET, JEE, NEET, SSC, banking and Madhya Pradesh exams, results, admit cards and recruitment, with links to the official notices.' },
    { q: 'Which official websites do you follow?', a: 'We follow official sites such as CBSE, NTA, UGC, PIB, SSC, IBPS, RBI, MPESB and MPPSC, along with trusted education news publishers. Each story links to its source.' },
    { q: 'Should I rely on Study News for exam dates and deadlines?', a: 'Use Study News as a quick alert, then always confirm dates, eligibility, fees and deadlines on the official website before you apply. Exam details can change at short notice.' },
    { q: 'When is Study News published?', a: `Study News is published every morning at ${SEC.study.time}, and the Study Briefing page collects the day's updates in one place.` },
  ];
  const officialStrip = `<section class="sec sec-alt" id="official" aria-labelledby="h-official"><div class="wrap"><div class="sec-head"><span class="sec-kicker">Official websites</span><h2 id="h-official">Go straight to the <span class="accent">source</span></h2><p>Always confirm dates, eligibility and fees on the official website. These links open the official sites.</p></div><div class="chip-row official">${SITE.officialSites.map((o) => `<a class="chip" href="${E(o.url)}" target="_blank" rel="noopener noreferrer">${ic('link')}${E(o.name)}</a>`).join('')}</div></div></section>`;
  const studyTeaser = () => `<section class="sec sec-alt" id="study-teaser" aria-labelledby="h-st"><div class="wrap"><div class="sec-head"><span class="sec-kicker">Study News</span><h2 id="h-st">Exams, results and jobs, <span class="accent">from official sources</span></h2><p>CBSE, CUET, JEE, NEET, SSC, banking and MP updates every morning at ${E(SEC.study.time)}.</p></div>${studyPosts.length ? `<div class="grid-3 news-grid">${studyPosts.slice(0, 3).map((p) => card(p)).join('')}</div>` : ''}<div class="center-row"><a class="btn btn-primary" href="/study/">${ic('cap')}Open Study News</a></div></div></section>`;

  function sectionPage(sec) {
    const S = SEC[sec], study = sec === 'study', list = study ? studyPosts : newsPosts, nb = list.filter((p) => p.kind !== 'briefing');
    const briefing = list.find((p) => p.kind === 'briefing');
    const top = nb[0], side = nb.slice(1, 5), used = new Set([top, ...side].filter(Boolean));
    const latest = list.filter((p) => !used.has(p)).slice(0, 12);
    const topics = catsOf(sec).map((c) => { const n = list.filter((p) => p.category === c.slug).length; return `<a class="topic reveal" href="${catUrl(c.slug)}" style="${tintVars(c)}"><span class="topic-ic">${ic(c.icon)}</span><b>${E(c.name)}</b><span>${n} ${n === 1 ? 'story' : 'stories'}</span></a>`; }).join('');
    const empty = `<div class="card"><h3>The first stories arrive at ${E(S.time)}</h3><p>Check back soon, or follow us on Telegram.</p></div>`;
    const path = S.path, ttl = study ? 'Study News: CBSE, CUET, JEE, NEET, SSC, Banking and MP Exam Updates' : `${SITE.name}: Daily News Briefing for India, World, Business and Tech`;
    const desc = study ? 'Study News for students: CBSE, CUET, JEE, NEET, SSC, banking and MP exam updates, results, admit cards and jobs, with links to the official notices.' : cutWords(SITE.description, 158);
    const html = fill(T('home.html'), {
      badge: study ? `Study updates every morning at ${S.time}` : `Fresh news every morning at ${S.time}`,
      h1: study ? 'Exam and job updates, <span class="accent">straight from the source</span>' : 'News you can actually <span class="accent">understand</span>',
      sub: study ? 'CBSE, CUET, JEE, NEET, SSC, banking and MP updates in plain English, with a link to the official notice on every story.' : `${E(SITE.tagline)} Every story is short, neutral and links to the original reporting.`,
      updated: `${dLong(latestIso)}, ${tIst(latestIso)}`, count: list.length, catCount: catsOf(sec).filter((c) => !c.briefing).length,
      briefingUrl: briefing ? postUrl(briefing) : '/archive/', briefingLabel: briefing ? (study ? 'Read the latest study briefing' : 'Read the latest briefing') : 'Browse all stories',
      topHead: study ? 'Latest exam updates' : 'Today&rsquo;s headlines', topSub: 'The newest stories first, each with a quick answer you can read in ten seconds.',
      topicsKick: study ? 'Exams and jobs' : 'Browse by topic', topicsHead: study ? 'Pick your <span class="accent">exam</span>' : 'Pick what you <span class="accent">care about</span>',
      feature: top ? featureCard(top) : empty, sideList: side.map(sideCard).join(''), topics, latest: latest.map((p) => card(p)).join(''),
      extra: study ? officialStrip : studyTeaser(), faq: faqHtml(study ? studyFaq : homeFaq), time: E(S.time),
      otherLabel: study ? 'News' : 'Study News', otherUrl: study ? '/' : '/study/',
    });
    write(study ? 'study/index.html' : 'index.html', page({
      title: ttl, description: desc, path, bodyClass: 'home',
      graph: [org(), website(), { '@type': 'CollectionPage', '@id': abs(path) + '#home', url: abs(path), name: study ? 'Study News' : SITE.name, isPartOf: { '@id': abs('/#website') }, about: { '@id': abs('/#org') }, inLanguage: SITE.lang, dateModified: latestIso, mainEntity: itemList(list.slice(0, 12)) }, faqLd(study ? studyFaq : homeFaq), ...(study ? [crumbs([['Home', '/'], ['Study News', '/study/']])] : [])],
      content: html,
    }));
    urls.push({ loc: path, lastmod: list.length ? list[0].date : latestIso, changefreq: 'hourly', priority: study ? '0.9' : '1.0' });
  }
  sectionPage('news');
  sectionPage('study');

  /* ---------- category pages ---------- */
  for (const c of cats) {
    const list = posts.filter((p) => p.category === c.slug);
    const base = catUrl(c.slug);
    pages(list, SITE.perPage, base).forEach((pg) => {
      const body = pg.items.length ? `<div class="grid-3 news-grid">${pg.items.map((p) => card(p)).join('')}</div>` : `<div class="card"><h3>No ${E(c.name)} stories yet</h3><p>New stories are published every day at ${E(SITE.publishTime)}.</p></div>`;
      const ttl = `${c.name} News${pg.n > 1 ? `, Page ${pg.n}` : ''}: Latest Stories`;
      write(pg.url.slice(1) + 'index.html', page({
        title: `${ttl} | ${SITE.short}`, description: cutWords(c.desc, 158), path: pg.url, headExtra: prevNext(pg, base), robots: list.length ? ROBOTS : 'noindex, follow',
        graph: [org(), website(), { '@type': 'CollectionPage', '@id': abs(pg.url) + '#page', url: abs(pg.url), name: `${c.name} News`, description: c.desc, isPartOf: { '@id': abs('/#website') }, inLanguage: SITE.lang, mainEntity: itemList(pg.items) }, crumbs([['Home', '/'], ...(c.section === 'study' ? [['Study News', '/study/']] : []), [c.name, base]])],
        content: fill(T('list.html'), { kicker: `${list.length} ${list.length === 1 ? 'story' : 'stories'}`, h1: `${E(c.name)} <span class="accent">news</span>`, lead: E(c.desc), chips: catChips(c.slug, c.section), body, pager: pagerHtml(pg, base) }),
      }));
      if (pg.n === 1 && list.length) urls.push({ loc: base, lastmod: list[0].date, changefreq: 'daily', priority: '0.8' });
    });
  }

  /* ---------- archive ---------- */
  pages(posts, 60, '/archive/').forEach((pg) => {
    const byMonth = new Map();
    pg.items.forEach((p) => { const k = fmtDate(p.date, TZ, { day: undefined, month: 'long', year: 'numeric' }); if (!byMonth.has(k)) byMonth.set(k, []); byMonth.get(k).push(p); });
    const body = [...byMonth].map(([m, l]) => `<section class="arch-month"><h2>${E(m)}</h2><div class="arch-list">${l.map((p) => { const c = cat(p.category); return `<a class="arch-item" href="${postUrl(p)}"><time datetime="${p.date}">${dShort(p.date)}</time><b>${E(p.title)}</b><span class="tag" style="${tintVars(c)}">${E(c.name)}</span></a>`; }).join('')}</div></section>`).join('') || '<div class="card"><h3>No stories yet</h3></div>';
    write(pg.url.slice(1) + 'index.html', page({
      title: `News Archive${pg.n > 1 ? `, Page ${pg.n}` : ''}: Every Story | ${SITE.short}`, description: 'Browse every ThunderStudy News story by date, from the latest daily briefing back to the first story.', path: pg.url, headExtra: prevNext(pg, '/archive/'),
      graph: [org(), website(), { '@type': 'CollectionPage', url: abs(pg.url), name: 'News archive', isPartOf: { '@id': abs('/#website') }, inLanguage: SITE.lang }, crumbs([['Home', '/'], ['Archive', '/archive/']])],
      content: fill(T('list.html'), { kicker: `${posts.length} stories`, h1: 'News <span class="accent">archive</span>', lead: 'Every story we have published, news and study updates, newest first.', chips: secChips(), body, pager: pagerHtml(pg, '/archive/') }),
    }));
  });
  urls.push({ loc: '/archive/', lastmod: latestIso, changefreq: 'daily', priority: '0.6' });

  /* ---------- static pages: about, contact, privacy, terms, disclaimer, corrections ---------- */
  const PAGES = [
    { slug: 'about', ld: 'AboutPage', freq: 'monthly', pr: '0.5', title: `About ${SITE.name}: Who We Are and How We Work`, desc: 'About ThunderStudy News: a daily news and study-news site run by Wondermayank, with an open editorial policy, named editor and clear corrections process.', badge: 'About', h1: 'About <span class="accent">ThunderStudy News</span>', lead: 'A daily news and study-news site for students and curious readers in India.' },
    { slug: 'contact', ld: 'ContactPage', freq: 'yearly', pr: '0.4', title: `Contact ${SITE.name}: Email, Corrections and Press`, desc: `Contact ThunderStudy News by email at ${SITE.email} for corrections, removal requests, tips and partnerships.`, badge: 'Contact', h1: 'Contact <span class="accent">us</span>', lead: 'Corrections, removal requests, tips and partnerships. We read every message.' },
    { slug: 'privacy', ld: 'WebPage', freq: 'yearly', pr: '0.3', title: `Privacy Policy | ${SITE.short}`, desc: 'Privacy Policy for ThunderStudy News: what information the site and its hosting collect, how it is used, cookies, third-party links and your choices.', badge: 'Legal', h1: 'Privacy <span class="accent">Policy</span>', lead: `Last updated ${SITE.legalUpdated}.` },
    { slug: 'terms', ld: 'WebPage', freq: 'yearly', pr: '0.3', title: `Terms of Use | ${SITE.short}`, desc: 'Terms of Use for ThunderStudy News: how you may use the site and its content, links to third-party sources, ownership and limits of liability.', badge: 'Legal', h1: 'Terms of <span class="accent">Use</span>', lead: `Last updated ${SITE.legalUpdated}.` },
    { slug: 'disclaimer', ld: 'WebPage', freq: 'yearly', pr: '0.3', title: `Disclaimer | ${SITE.short}`, desc: 'Disclaimer for ThunderStudy News: stories are summaries for general information, not official notices. Always confirm exam dates and deadlines on the official website.', badge: 'Legal', h1: '<span class="accent">Disclaimer</span>', lead: `Last updated ${SITE.legalUpdated}.` },
    { slug: 'corrections', ld: 'WebPage', freq: 'monthly', pr: '0.4', title: `Corrections Policy | ${SITE.short}`, desc: 'How ThunderStudy News handles corrections and removal requests: how to report an error, what we do and how fast we respond.', badge: 'Corrections', h1: 'Corrections <span class="accent">policy</span>', lead: 'If we get something wrong, we want to know and fix it quickly.' },
  ];
  const pageVars = { siteName: E(SITE.name), siteUrl: E(SITE.url), email: E(SITE.email), ownerName: E(SITE.owner.name), ownerUrl: E(SITE.owner.url), ownerRole: E(SITE.owner.role), legalDate: E(SITE.legalUpdated), newsTime: E(SEC.news.time), studyTime: E(SEC.study.time) };
  for (const pg of PAGES) {
    write(`${pg.slug}/index.html`, page({
      title: pg.title, description: pg.desc, path: `/${pg.slug}/`,
      graph: [org(), website(), { '@type': pg.ld, url: abs(`/${pg.slug}/`), name: pg.title, isPartOf: { '@id': abs('/#website') }, about: { '@id': abs('/#org') }, inLanguage: SITE.lang }, crumbs([['Home', '/'], [pg.slug[0].toUpperCase() + pg.slug.slice(1), `/${pg.slug}/`]])],
      content: fill(T('page.html'), { badge: pg.badge, h1: pg.h1, lead: pg.lead, body: fill(T(`pages/${pg.slug}.html`), pageVars) }),
    }));
    urls.push({ loc: `/${pg.slug}/`, lastmod: latestIso, changefreq: pg.freq, priority: pg.pr });
  }
  write('search/index.html', page({ title: `Search the News | ${SITE.short}`, description: 'Search every ThunderStudy News story by keyword.', path: '/search/', robots: 'noindex, follow', graph: [org(), website()], content: fill(T('search.html'), { count: posts.length }) }));
  write('404.html', page({ title: `Page not found | ${SITE.short}`, description: 'This page could not be found.', path: '/404.html', robots: 'noindex, nofollow', graph: [org()], content: fill(T('404.html'), { latest: posts.slice(0, 3).map((p) => card(p, false)).join('') }) }));

  /* ---------- posts ---------- */
  const shareLinks = (p) => {
    const u = abs(postUrl(p)), enc = encodeURIComponent;
    return `<a href="https://wa.me/?text=${enc(p.title + ' ' + u)}" target="_blank" rel="noopener noreferrer" aria-label="Share on WhatsApp" title="WhatsApp">${ic('chat')}</a>`
      + `<a href="https://x.com/intent/post?text=${enc(p.title)}&amp;url=${enc(u)}" target="_blank" rel="noopener noreferrer" aria-label="Share on X" title="X"><svg aria-hidden="true"><use href="#i-x"></use></svg></a>`
      + `<a href="https://t.me/share/url?url=${enc(u)}&amp;text=${enc(p.title)}" target="_blank" rel="noopener noreferrer" aria-label="Share on Telegram" title="Telegram"><svg aria-hidden="true"><use href="#i-telegram"></use></svg></a>`
      + `<button type="button" data-copy="${E(u)}" aria-label="Copy link" title="Copy link">${ic('link')}</button>`
      + `<button type="button" data-native-share aria-label="More sharing options" title="More">${ic('arrow')}</button>`;
  };
  for (const p of posts) {
    const c = cat(p.category), url = abs(postUrl(p)), isBrief = p.kind === 'briefing';
    const body = isBrief
      ? `<div class="brief-list">${(p.items || []).map((it) => { const ic2 = cat(it.category); return `<a class="brief" href="${postUrl(it)}"><span class="tag" style="${tintVars(ic2)}">${ic(ic2.icon)}${E(ic2.name)}</span><h3>${E(it.title)}</h3><p>${E(it.description)}</p></a>`; }).join('')}</div>`
      : p.body.map((t) => `<p>${E(t)}</p>`).join('\n');
    const official = !!(p.source && p.source.official), study = secOf(p) === 'study';
    const srcBox = p.source ? `<aside class="srcbox"><span class="ico">${ic(official ? 'shield' : 'link')}</span><div><small>${official ? 'Official source' : 'Original report'}</small><a class="src" href="${E(p.source.url)}" rel="noopener" target="_blank">${E(p.source.title)}</a><p>Source: ${E(p.source.name)}. ${official ? 'This page points you to the official notice. Open it for the full details.' : 'This page is a short summary. Read the original report for full details.'}</p></div></aside>` : '';
    const related = [...news.filter((x) => x !== p && x.category === p.category), ...news.filter((x) => x !== p && x.category !== p.category && secOf(x) === secOf(p))].slice(0, 3);
    const confirm = study ? 'Always confirm dates, eligibility, fees and deadlines on the official website before you apply or act. ' : '';
    const disclosure = isBrief
      ? 'Open each story for its quick answer and source link.'
      : `${confirm}${official ? 'ThunderStudy News is not the issuing authority. ' : `This is a short summary of a report from ${E(p.source ? p.source.name : 'the publisher')}. Read the original report for the full story. `}Spotted an error? <a class="text-link" href="/corrections/">Report a correction</a>.`;
    const srcTag = `<span class="dot" aria-hidden="true"></span><span class="src-tag">${ic(official ? 'shield' : 'link')}${isBrief ? (study ? 'Study briefing' : 'Daily briefing') : official ? 'Official notice' : 'Source: ' + E(p.source ? p.source.name : '')}</span>`;
    const byline = `<span class="dot" aria-hidden="true"></span><span>Editor: <a class="text-link" href="/about/#editor">${E(SITE.owner.name)}</a></span>`;
    const secCrumb = study ? '<li><a href="/study/">Study News</a></li>' : '';
    const words = [p.quick, ...(p.points || []), ...(p.body || [])].join(' ').split(/\s+/).length;
    const headExtra = `<meta property="article:published_time" content="${p.date}"><meta property="article:modified_time" content="${p.updated || p.date}"><meta property="article:section" content="${E(c.name)}">${(p.keywords || []).map((k) => `<meta property="article:tag" content="${E(k)}">`).join('')}<meta name="keywords" content="${E((p.keywords || []).join(', '))}"><meta name="news_keywords" content="${E((p.keywords || []).join(', '))}">`;
    const article = {
      '@type': 'NewsArticle', '@id': url + '#article', mainEntityOfPage: { '@type': 'WebPage', '@id': url }, url, headline: cutWords(p.title, 110), description: p.description, inLanguage: SITE.lang,
      datePublished: p.date, dateModified: p.updated || p.date, image: [ogImg(p)], articleSection: c.name, keywords: (p.keywords || []).join(', '), wordCount: words,
      author: { '@type': 'Organization', name: `${SITE.name} Desk`, url: abs('/about/') }, editor: { '@type': 'Person', name: SITE.owner.name, url: SITE.owner.url }, publisher: { '@id': abs('/#org') }, isPartOf: { '@id': abs('/#website') },
      speakable: { '@type': 'SpeakableSpecification', cssSelector: ['.post-h1', '.quick p'] },
    };
    if (p.source) article.isBasedOn = { '@type': 'CreativeWork', name: p.source.title, url: p.source.url, publisher: { '@type': 'Organization', name: p.source.name } };
    const graph = [org(), website(), article, crumbs([['Home', '/'], ...(study ? [['Study News', '/study/']] : []), [c.name, catUrl(c.slug)], [p.title, postUrl(p)]])];
    if (p.faq && p.faq.length) graph.push(faqLd(p.faq));
    write(`${postUrl(p).slice(1)}index.html`, page({
      title: `${cutWords(p.title, 70)} | ${SITE.short}`, ogTitle: p.title, description: p.description, path: postUrl(p), ogType: 'article', ogImage: ogImg(p), ogAlt: p.title, headExtra, graph, bodyClass: 'is-post',
      content: fill(T('post.html'), {
        catUrl: catUrl(c.slug), catName: E(c.name), catIcon: ic(c.icon), tint: c.tint, secCrumb, byline, crumbTitle: E(cutWords(p.title, 60)), title: E(p.title),
        dateIso: p.date, dateLong: dLong(p.date), timeIst: tIst(p.date), readMins: p.readMins,
        srcTag,
        quick: E(p.quick), points: (p.points || []).map((x) => `<li>${E(x)}</li>`).join(''), body, srcBox, faq: faqHtml(p.faq || []),
        share: shareLinks(p), disclosure, related: related.map((x) => card(x, false)).join(''),
      }),
    }));
    urls.push({ loc: postUrl(p), lastmod: p.updated || p.date, changefreq: 'never', priority: isBrief ? '0.6' : '0.7', image: ogImg(p), title: p.title });
  }

  /* ---------- machine-readable files ---------- */
  const lm = (iso) => new Date(iso).toISOString();
  write('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">\n${urls.map((u) => `  <url><loc>${X(abs(u.loc))}</loc><lastmod>${lm(u.lastmod)}</lastmod><changefreq>${u.changefreq}</changefreq><priority>${u.priority}</priority>${u.image ? `<image:image><image:loc>${X(u.image)}</image:loc><image:title>${X(u.title)}</image:title></image:image>` : ''}</url>`).join('\n')}\n</urlset>\n`);

  const cutoff = Date.now() - 48 * 3600 * 1000;
  const recent = posts.filter((p) => new Date(p.date).getTime() >= cutoff).slice(0, 1000);
  write('news-sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">\n${recent.map((p) => `  <url><loc>${X(abs(postUrl(p)))}</loc><news:news><news:publication><news:name>${X(SITE.name)}</news:name><news:language>en</news:language></news:publication><news:publication_date>${lm(p.date)}</news:publication_date><news:title>${X(p.title)}</news:title></news:news></url>`).join('\n')}\n</urlset>\n`);

  const rssItems = posts.slice(0, 40).map((p) => {
    const html = `<p>${E(p.quick)}</p><ul>${(p.points || []).map((x) => `<li>${E(x)}</li>`).join('')}</ul>${p.source ? `<p>Source: <a href="${E(p.source.url)}">${E(p.source.name)}</a></p>` : ''}`;
    return `    <item><title>${X(p.title)}</title><link>${X(abs(postUrl(p)))}</link><guid isPermaLink="true">${X(abs(postUrl(p)))}</guid><pubDate>${new Date(p.date).toUTCString()}</pubDate><category>${X(cat(p.category).name)}</category><description>${X(p.description)}</description><content:encoded><![CDATA[${html}]]></content:encoded></item>`;
  }).join('\n');
  write('rss.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:content="http://purl.org/rss/1.0/modules/content/">\n  <channel>\n    <title>${X(SITE.name)}</title>\n    <link>${abs('/')}</link>\n    <description>${X(SITE.description)}</description>\n    <language>${SITE.lang}</language>\n    <lastBuildDate>${new Date(latestIso).toUTCString()}</lastBuildDate>\n    <atom:link href="${abs('/rss.xml')}" rel="self" type="application/rss+xml"/>\n${rssItems}\n  </channel>\n</rss>\n`);

  write('feed.json', JSON.stringify({
    version: 'https://jsonfeed.org/version/1.1', title: SITE.name, home_page_url: abs('/'), feed_url: abs('/feed.json'), description: SITE.description, language: SITE.lang, icon: abs('/logo-512.png'), favicon: abs('/favicon.svg'),
    items: posts.slice(0, 40).map((p) => ({ id: abs(postUrl(p)), url: abs(postUrl(p)), title: p.title, summary: p.description, content_text: [p.quick, ...(p.points || []).map((x) => '- ' + x)].join('\n'), date_published: p.date, date_modified: p.updated || p.date, tags: [cat(p.category).name, ...(p.keywords || [])], image: ogImg(p), external_url: p.source ? p.source.url : undefined })),
  }, null, 2) + '\n');

  write('search.json', JSON.stringify(posts.slice(0, 1500).map((p) => ({ t: p.title, d: p.description, c: cat(p.category).name, tn: cat(p.category).tint, u: postUrl(p), dt: p.date, ds: dLong(p.date), k: (p.keywords || []).join(' ') }))));

  write('robots.txt', ['User-agent: *', 'Allow: /', 'Disallow: /search/', '',
    ...['Googlebot', 'Bingbot', 'GPTBot', 'OAI-SearchBot', 'ChatGPT-User', 'ClaudeBot', 'Claude-SearchBot', 'Claude-User', 'PerplexityBot', 'Perplexity-User', 'Google-Extended', 'Applebot-Extended'].flatMap((b) => [`User-agent: ${b}`, 'Allow: /', '']),
    `Sitemap: ${abs('/sitemap.xml')}`, `Sitemap: ${abs('/news-sitemap.xml')}`, ''].join('\n'));

  const topCats = cats.map((c) => `- [${c.name}](${abs(catUrl(c.slug))}): ${c.desc}`).join('\n');
  write('llms.txt', `# ${SITE.name}\n\n> ${SITE.description}\n\nSite: ${abs('/')}\nLanguage: English (India)\nPublisher: ThunderStudy News, run by ${SITE.owner.name} (${SITE.owner.role})\nContact: ${SITE.email}\nUpdated: News every morning at ${SEC.news.time}; Study News every morning at ${SEC.study.time}\n\n## How to use this site\n\n- Each story page opens with a "Quick answer", then key points, a short explanation, an FAQ and a link to the original or official source.\n- Stories are short summaries of official notices and published reports. Cite the linked source for facts and confirm exam dates on the official website.\n- Please link to the story page when you cite it.\n\n## Sections\n\n- [News](${abs('/')}): India, world, business, technology, science and sports\n- [Study News](${abs('/study/')}): CBSE, CUET, JEE, NEET, SSC, banking and MP exams and jobs\n\n## Key pages\n\n- [About](${abs('/about/')}) | [Contact](${abs('/contact/')}) | [Corrections](${abs('/corrections/')}) | [Privacy](${abs('/privacy/')}) | [Terms](${abs('/terms/')}) | [Disclaimer](${abs('/disclaimer/')})\n- [Archive](${abs('/archive/')}) | [RSS feed](${abs('/rss.xml')}) | [JSON feed](${abs('/feed.json')}) | [Sitemap](${abs('/sitemap.xml')}) | [News sitemap](${abs('/news-sitemap.xml')}) | [Full text index](${abs('/llms-full.txt')})\n\n## Topics\n\n${topCats}\n\n## Latest stories\n\n${posts.slice(0, 40).map((p) => `- [${p.title}](${abs(postUrl(p))}): ${p.description} (${ymdInTz(p.date, TZ)})`).join('\\n')}\n`);
  write('llms-full.txt', `# ${SITE.name}: recent stories (full text index)\n\n${posts.slice(0, 60).map((p) => `## ${p.title}\nURL: ${abs(postUrl(p))}\nPublished: ${p.date}\nTopic: ${cat(p.category).name}\nQuick answer: ${p.quick}\nKey points:\n${(p.points || []).map((x) => '- ' + x).join('\n')}\n${p.source ? `Original source: ${p.source.name} - ${p.source.url}\n` : ''}`).join('\n')}`);

  if (process.env.INDEXNOW_KEY) write(`${process.env.INDEXNOW_KEY}.txt`, process.env.INDEXNOW_KEY);

  /* ---------- images (needs sharp) ---------- */
  if (sharp) {
    const wrap = (s, n, max) => { const out = []; let line = ''; for (const w of String(s).split(/\s+/)) { if ((line + ' ' + w).trim().length > n && line) { out.push(line); line = w; } else line = (line + ' ' + w).trim(); } if (line) out.push(line); if (out.length > max) { out.length = max; out[max - 1] = out[max - 1].replace(/\s*\S*$/, '') + '…'; } return out; };
    const ogSvg = (title, c) => {
      const [bg, ink] = TINTS[c.tint] || TINTS.blue;
      const lines = wrap(title, 25, 4);
      return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630"><rect width="1200" height="630" fill="#EEF3FF"/><circle cx="1090" cy="80" r="190" fill="${bg}" opacity=".7"/><circle cx="90" cy="600" r="150" fill="#DCE8FF"/><rect x="60" y="60" width="1080" height="510" rx="44" fill="#F8FAFF"/><rect x="108" y="104" width="${40 + c.name.length * 17}" height="48" rx="24" fill="${bg}"/><text x="${108 + (40 + c.name.length * 17) / 2}" y="137" font-family="Inter, DejaVu Sans, Arial, sans-serif" font-size="22" font-weight="700" text-anchor="middle" fill="${ink}">${E(c.name.toUpperCase())}</text>${lines.map((l, i) => `<text x="108" y="${236 + i * 78}" font-family="Inter, DejaVu Sans, Arial, sans-serif" font-size="62" font-weight="700" fill="#26324A">${E(l)}</text>`).join('')}<clipPath id="lg"><rect x="108" y="480" width="56" height="56" rx="16"/></clipPath><image x="108" y="480" width="56" height="56" clip-path="url(#lg)" preserveAspectRatio="xMidYMid slice" href="${LOGO_URI}"/><text x="182" y="518" font-family="Inter, DejaVu Sans, Arial, sans-serif" font-size="30" font-weight="700" fill="#26324A">${E(SITE.name)}</text><text x="1092" y="518" font-family="Inter, DejaVu Sans, Arial, sans-serif" font-size="24" text-anchor="end" fill="#6B6485">${E(SITE.url.replace('https://', ''))}</text></svg>`;
    };
    const LOGO_URI = 'data:image/jpeg;base64,' + fs.readFileSync(path.join(ROOT, 'assets-src/logo.jpg')).toString('base64');
    const png = async (svg, rel, w) => { const f = path.join(OUT, rel); if (fs.existsSync(f)) return; fs.mkdirSync(path.dirname(f), { recursive: true }); await sharp(Buffer.from(svg)).resize(w).png().toFile(f); };
    try {
      const src = path.join(ROOT, 'assets-src/logo.jpg');
      const round = (w) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${w}"><rect width="${w}" height="${w}" rx="${Math.round(w * 0.23)}"/></svg>`);
      const lf = path.join(OUT, 'logo-512.png');
      if (!fs.existsSync(lf)) await sharp(src).resize(512, 512).composite([{ input: round(512), blend: 'dest-in' }]).png().toFile(lf);
      const af = path.join(OUT, 'apple-touch-icon.png');
      if (!fs.existsSync(af)) await sharp(src).resize(180, 180).png().toFile(af);
      for (const p of posts) await png(ogSvg(p.title, cat(p.category)), `og/${p.slug}.png`, 1200);
    } catch (e) { console.warn('  image generation skipped:', e.message); }
  } else console.warn('  sharp not installed: skipping OG/logo images');

  if (missing.size) console.warn('  template keys without a value:', [...missing].join(', '));
  console.log(`  built ${posts.length} posts, ${urls.length} sitemap URLs -> ${OUT}`);
  return { urls: urls.map((u) => abs(u.loc)), count: posts.length };
}

module.exports = { build };
if (require.main === module) build().catch((e) => { console.error(e); process.exit(1); });
