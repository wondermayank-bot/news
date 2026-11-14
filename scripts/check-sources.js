'use strict';
// Tests every source in config/feeds.json and prints what it finds. Run: npm run check:sources
const { readJSON } = require('./lib/util');
const { get, parseFeed, parseNotices } = require('./lib/news');
(async () => {
  const cfg = readJSON('config/feeds.json');
  for (const sec of ['news', 'study']) {
    console.log(`\n== ${sec} ==`);
    for (const f of cfg[sec].feeds) {
      try {
        const body = await get(f.url);
        if (f.type === 'notice') { const l = parseNotices(body, f.url); console.log(`OK   ${f.name} [notice] ${l.length} links${l[0] ? ' | e.g. ' + l[0].title.slice(0, 60) : ''}`); }
        else { const i = parseFeed(body); console.log(`OK   ${f.name} [${f.category}] ${i.length} items${i[0] ? ' | e.g. ' + i[0].title.slice(0, 60) : ''}`); }
      } catch (e) { console.log(`FAIL ${f.name} [${f.type}] ${f.url} -> ${e.message}`); }
    }
  }
})();
