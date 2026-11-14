'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const readJSON = (p, fallback) => {
  try { return JSON.parse(fs.readFileSync(path.isAbsolute(p) ? p : path.join(ROOT, p), 'utf8')); }
  catch (e) { if (fallback !== undefined) return fallback; throw e; }
};
const writeJSON = (p, data) => {
  const abs = path.isAbsolute(p) ? p : path.join(ROOT, p);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, JSON.stringify(data, null, 2) + '\n');
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const escHtml = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const escXml = escHtml;

const slugify = (s, max = 72) => {
  let t = String(s).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/&/g, ' and ').replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (t.length > max) t = t.slice(0, max).replace(/-[^-]*$/, '');
  return t || 'story';
};

const STOP = new Set('a an the and or of to in on for with at by from as is are was were be been it its this that these those has have had will would says say said after over into than new amid'.split(' '));
const tokens = (s) => String(s).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w));
const jaccard = (a, b) => {
  const A = new Set(tokens(a)), B = new Set(tokens(b));
  if (!A.size || !B.size) return 0;
  let i = 0; A.forEach((w) => { if (B.has(w)) i++; });
  return i / (A.size + B.size - i);
};

function safeChr(n) { try { return String.fromCodePoint(n); } catch (e) { return ''; } }
function decodeEntities(s) {
  return String(s)
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => safeChr(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => safeChr(parseInt(d, 10)))
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&rsquo;|&lsquo;/g, "'").replace(/&ldquo;|&rdquo;/g, '"')
    .replace(/&ndash;|&mdash;/g, '-').replace(/&amp;/g, '&');
}
const stripHtml = (s) => decodeEntities(String(s || '').replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

const cutWords = (s, max) => {
  s = String(s || '').trim();
  if (s.length <= max) return s;
  const c = s.slice(0, max - 1);
  return c.replace(/\s+\S*$/, '').replace(/[,;:\-\s]+$/, '') + '…';
};

function fmtDate(iso, tz, opts) {
  return new Intl.DateTimeFormat('en-IN', Object.assign({ timeZone: tz, day: 'numeric', month: 'long', year: 'numeric' }, opts || {})).format(new Date(iso));
}
function ymdInTz(iso, tz) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
}

module.exports = { ROOT, readJSON, writeJSON, sleep, escHtml, escXml, slugify, jaccard, stripHtml, decodeEntities, cutWords, fmtDate, ymdInTz };
