# ThunderStudy News (news.thunderstudy.online)

Two sections, published automatically by GitHub Actions and hosted on Cloudflare Pages:

| Section | Time (IST) | Topics |
|---|---|---|
| **News** (`/`) | 6:00 AM | India, World, Business, Technology, Science, Sports + Daily Briefing |
| **Study News** (`/study/`) | 9:00 AM | CBSE, CUET, JEE, NEET, SSC, Banking, MP Exams and Jobs, More Exams + Study Briefing |

Each run: fetch sources -> pick new items -> write stories -> rebuild the static site (pages, sitemap, news sitemap, RSS, JSON feed,
llms.txt, share images) -> commit and push -> Cloudflare deploys -> post to Telegram. Failures and empty runs message the admin.

## One-time setup

1. **GitHub**: create a repo and push this folder.
2. **Secrets** (Settings > Secrets and variables > Actions > Secrets):
   - `OPENROUTER_API_KEY` (required)
   - `TELEGRAM_BOT_TOKEN`, `TELEGRAM_ADMIN_ID`, `TELEGRAM_CHANNEL_ID` (Telegram, see below)
   - `TELEGRAM_STUDY_CHANNEL_ID` (the Study News channel. Study News posts ONLY here, never to the news channel)
   - `GNEWS_API_KEY` (optional extra source), `INDEXNOW_KEY` (optional, any random 8-64 character string)
3. **Variable** (optional): `OPENROUTER_MODELS`, comma-separated model ids tried in order. Default `openrouter/free`.
4. **Cloudflare Pages**: Connect to Git > this repo. Framework preset: None. Build command: empty. Output directory: `public`.
   Custom domain: `news.thunderstudy.online`.
5. **Search Console / Bing Webmaster**: submit `https://news.thunderstudy.online/sitemap.xml` and `news-sitemap.xml`.
6. **Test sources**: `npm install && npm run check:sources` shows which feeds and official pages work. Edit `config/feeds.json`.
7. **Run once**: Actions > "Daily news (6 AM) and study news (9 AM)" > Run workflow (choose `news`, then `study`).

### Telegram
- Create the bot with @BotFather and copy the token into `TELEGRAM_BOT_TOKEN`.
- Admin: open the bot in Telegram and press **Start** (otherwise it cannot message you). Put your numeric user id in `TELEGRAM_ADMIN_ID`
  (get it from @userinfobot).
- News channel: add the bot as an **administrator** with "Post messages". Put its id (looks like `-1001234567890`) in `TELEGRAM_CHANNEL_ID`. Only the 6 AM News digest goes here.
- Study channel: do the same and put its id in `TELEGRAM_STUDY_CHANNEL_ID`. Only the 9 AM Study News digest goes here. If this secret is missing, nothing is posted and the admin gets a message.

## Official notices (Study News)
Pages like CBSE, NTA, UGC, SSC, IBPS and MPESB are watched for **new** links. The first run only records what is already there
(`data/seen-notices.json`), so old notices are never posted as new. From the next run, each new notice becomes a short factual post
that points to the official link. Notices are not rewritten. Some official sites load their lists with JavaScript or block
automated requests; `npm run check:sources` shows which ones return links.

## Files
| Path | Purpose |
|---|---|
| `scripts/12-1-2026.js` | The pipeline (`--section=news` or `--section=study`, `--dry` for an offline test) |
| `scripts/lib/openrouter.js`, `scripts/lib/news.js` | OpenRouter client; RSS, notice-page and GNews readers |
| `scripts/build.js` | Renders pages, sitemaps, feeds, llms.txt, robots.txt, share images |
| `scripts/telegram.js` | Channel digest, failure alert, empty-run alert |
| `templates/` | Page templates; `templates/pages/` holds About, Contact, Privacy, Terms, Disclaimer, Corrections |
| `config/site.json`, `config/feeds.json` | Site settings, topics, owner/editor, email, sources |
| `assets-src/` | CSS (clay kit + news), JS, logo source. `static/`: favicon, share image, headers |

## Commands
`npm run news:dry` and `npm run study:dry` (offline tests to /tmp), `npm run build`, `npm run news`, `npm run study`, `npm run check:sources`.

## Notes
- OpenRouter free limit: 20 requests/minute, 50/day. News uses about 5 per run and Study News about 3 (notices need none).
- GitHub cron can start a few minutes late. Posts carry the real run time.
- The legal pages are standard templates. Have them reviewed if you add ads, analytics or collect any user data.
