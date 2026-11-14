# ThunderStudy News (news.thunderstudy.online)

Automated daily news blog. Every day at 6 PM IST a GitHub Action fetches headlines, writes short briefs with the
OpenRouter free models, rebuilds the static site (pages, sitemap, RSS, llms.txt, social images) and pushes to GitHub.
Cloudflare Pages deploys the `public/` folder on every push.

## One-time setup

1. **GitHub**: create a repo, push this folder.
2. **Secrets** (Settings > Secrets and variables > Actions > Secrets):
   - `OPENROUTER_API_KEY` (required): https://openrouter.ai/keys
   - `GNEWS_API_KEY` (optional): https://gnews.io, adds the GNews free API on top of the RSS feeds
   - `INDEXNOW_KEY` (optional): any random 8-64 character string, pings Bing/Yandex after each deploy
3. **Variable** (optional, Variables tab): `OPENROUTER_MODELS` = comma-separated free model ids tried in order.
   Default is `openrouter/free` (OpenRouter picks an available free model). Free ids rotate, so keep it short.
4. **Cloudflare Pages**: Create project > Connect to Git > this repo.
   Framework preset: None. Build command: *(empty)*. Build output directory: `public`.
   Then Custom domains > `news.thunderstudy.online`.
5. **Search Console / Bing Webmaster**: add the site, submit `https://news.thunderstudy.online/sitemap.xml`
   (and `news-sitemap.xml`).
6. **Run once**: Actions > "Daily news (6 PM IST)" > Run workflow.

## Files

| Path | What it does |
|---|---|
| `scripts/12-1-2026.js` | The pipeline: fetch news, pick stories, write with OpenRouter, save, rebuild |
| `scripts/lib/openrouter.js` | OpenRouter client, prompt, JSON parsing and validation |
| `scripts/lib/news.js` | RSS reader and optional GNews API |
| `scripts/build.js` | Renders all pages, sitemaps, RSS, JSON feed, llms.txt, robots.txt, OG images |
| `templates/` | HTML templates (post, home, list, about...) plus the kit header and footer |
| `assets-src/` | `kit.css` (from design_1-8.html), `news.css`, `app.js` |
| `static/` | favicon.svg, `_headers`, `_redirects` copied into `public/` |
| `config/site.json` | Name, URL, topics, posts per day |
| `config/feeds.json` | RSS feeds (edit freely) |
| `data/posts.json` | All published stories (the site is rebuilt from this) |
| `.github/workflows/daily-news.yml` | Schedule: `30 12 * * *` UTC = 6:00 PM IST |

## Commands

```bash
npm install
npm run news:dry   # offline test with sample stories, writes to /tmp
npm run build      # rebuild public/ from data/posts.json (after template or CSS edits)
npm run news       # real run (needs OPENROUTER_API_KEY in your shell)
npm run preview    # serve public/ on http://localhost:8080
```

## Notes

- OpenRouter free models: 20 requests/minute, 50/day (1,000/day after buying $10 credits once). A run uses about 5.
- GitHub cron can start a few minutes late. Posts are stamped with the actual run time.
- `static/favicon.svg` is your seagull image. `logo-512.png` and `apple-touch-icon.png` are generated from it. `static/og-image.png` is the default share image; each story also gets its own generated card.
- Stories are labelled AI-assisted and link to the source. Skim the first few days of output before trusting it fully.
