'use strict';
/**
 * Telegram messages for the daily run.
 *   node scripts/telegram.js digest   post today's stories to the channel (News 6 AM, Study News 9 AM)
 *   node scripts/telegram.js fail     tell the admin the run failed (with a link to the GitHub run)
 *   node scripts/telegram.js empty    tell the admin nothing new was found
 * Secrets: TELEGRAM_BOT_TOKEN, TELEGRAM_ADMIN_ID, TELEGRAM_CHANNEL_ID, optional TELEGRAM_STUDY_CHANNEL_ID
 */
const { readJSON } = require('./lib/util');

const TOKEN = process.env.TELEGRAM_BOT_TOKEN, ADMIN = process.env.TELEGRAM_ADMIN_ID;
const SECTION = process.env.SECTION || 'news';
const h = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

async function send(chat, text, extra) {
  if (!TOKEN || !chat) { console.log('Telegram secrets missing for this message; skipping.'); return false; }
  try {
    const res = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(20000),
      body: JSON.stringify(Object.assign({ chat_id: chat, text, parse_mode: 'HTML' }, extra || {})),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) { console.warn(`Telegram error ${res.status}: ${data.description || 'unknown'}`); return false; }
    return true;
  } catch (e) { console.warn('Telegram request failed:', String(e.message).split(TOKEN).join('***')); return false; }
}

const runUrl = () => process.env.GITHUB_RUN_ID ? `${process.env.GITHUB_SERVER_URL || 'https://github.com'}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}` : '(local run)';

(async () => {
  const mode = process.argv[2];
  if (mode === 'fail') {
    await send(ADMIN, `<b>ThunderStudy News: run failed</b>\nSection: ${h(SECTION)}\nStep: ${h(process.env.FAILED_STEP || 'unknown')}\nTime: ${h(new Date().toISOString())}\n<a href="${h(runUrl())}">Open the run log</a>`);
  } else if (mode === 'empty') {
    await send(ADMIN, `<b>ThunderStudy News: nothing new</b>\nSection: ${h(SECTION)}\nThe run finished but found no new stories to publish. The news sources may be down or unchanged.\n<a href="${h(runUrl())}">Open the run log</a>`);
  } else if (mode === 'digest') {
    const last = readJSON('data/last-run.json', null);
    if (!last || !last.items || !last.items.length) return console.log('No items to post.');
    const study = last.section === 'study';
    // News goes only to TELEGRAM_CHANNEL_ID. Study News goes only to TELEGRAM_STUDY_CHANNEL_ID (never to the news channel).
    const chat = study ? process.env.TELEGRAM_STUDY_CHANNEL_ID : process.env.TELEGRAM_CHANNEL_ID;
    if (!chat) {
      console.log(`${study ? 'TELEGRAM_STUDY_CHANNEL_ID' : 'TELEGRAM_CHANNEL_ID'} is not set; skipping the channel post.`);
      return send(ADMIN, `<b>ThunderStudy News: channel post skipped</b>\nSection: ${h(last.section)}\nThe stories were published on the site, but the secret ${study ? 'TELEGRAM_STUDY_CHANNEL_ID' : 'TELEGRAM_CHANNEL_ID'} is not set, so nothing was posted to Telegram.`);
    }
    const head = `<b>ThunderStudy ${study ? 'Study News' : 'News'}</b>${study ? ' | Exams, results and jobs' : ' | Morning headlines'}\n${h(new Date(last.at).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'long', year: 'numeric' }))}\n`;
    const foot = `\n${last.briefingUrl ? `<a href="${h(last.briefingUrl)}">Read the full ${study ? 'study ' : ''}briefing</a>\n` : ''}<a href="${h(last.sectionUrl)}">${study ? 'More Study News' : 'More news'}</a>${study ? '\nAlways confirm dates on the official website.' : ''}`;
    let body = '', n = 0;
    for (const it of last.items) {
      const line = `\n\u2022 <a href="${h(it.url)}">${h(it.title)}</a>${it.category ? ` (${h(it.category)})` : ''}`;
      if ((head + body + line + foot).length > 3900) break;
      body += line; n++;
    }
    const ok = await send(chat, head + body + '\n' + foot, last.briefingUrl || last.sectionUrl ? { link_preview_options: { url: last.briefingUrl || last.sectionUrl, prefer_large_media: true } } : {});
    console.log(ok ? `Posted ${n} items to Telegram.` : 'Channel post failed.');
    if (!ok) await send(ADMIN, `<b>ThunderStudy News: channel post failed</b>\nSection: ${h(last.section)}\nThe stories were published on the site, but the Telegram channel post failed. Check that the bot is an admin of the channel and that TELEGRAM_CHANNEL_ID is correct.\n<a href="${h(runUrl())}">Open the run log</a>`);
  } else console.log('Usage: node scripts/telegram.js digest|fail|empty');
})();
