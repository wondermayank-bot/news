'use strict';
// Optional: tells Bing/Yandex (IndexNow) about the new URLs. Needs the INDEXNOW_KEY secret.
const { readJSON } = require('./lib/util');
(async () => {
  const key = process.env.INDEXNOW_KEY;
  if (!key) return console.log('INDEXNOW_KEY not set; skipping.');
  const site = readJSON('config/site.json');
  const last = readJSON('data/last-run.json', { urls: [] });
  if (!last.urls.length) return console.log('No URLs to submit.');
  const host = new URL(site.url).host;
  const res = await fetch('https://api.indexnow.org/indexnow', {
    method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ host, key, keyLocation: `${site.url}/${key}.txt`, urlList: last.urls }),
  });
  console.log('IndexNow status:', res.status);
})().catch((e) => { console.warn('IndexNow failed:', e.message); });
