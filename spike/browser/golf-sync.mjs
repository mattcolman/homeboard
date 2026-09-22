// Golf handicap sync: persistent-profile headed Chrome (session persists from
// handoff-login.mjs) -> golf.com.au/dashboard -> capture the site's own API
// responses -> push to Homeboard POST /api/ingest.
// Run: node golf-sync.mjs
import puppeteer from 'puppeteer-core';
import { readFileSync } from 'node:fs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PROFILE = new URL('./chrome-profile', import.meta.url).pathname;
const INGEST_URL = process.env.INGEST_URL ?? 'http://localhost:3000/api/ingest';
const OWNER = process.env.HOMEBOARD_OWNER ?? 'homeboard-local-development';
const WAIT_MS = 30_000;

const envLocal = readFileSync(new URL('../../.env.local', import.meta.url), 'utf8');
const KEY =
  process.env.HOMEBOARD_INGEST_KEY ??
  envLocal.match(/^HOMEBOARD_INGEST_KEY=(.+)$/m)?.[1]?.trim();
if (!KEY) {
  console.error('No HOMEBOARD_INGEST_KEY (env or .env.local)');
  process.exit(1);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: false,
  userDataDir: PROFILE,
  ignoreDefaultArgs: ['--enable-automation'],
  args: ['--no-first-run', '--no-default-browser-check', '--disable-blink-features=AutomationControlled'],
  defaultViewport: null,
});

const page = (await browser.pages())[0] ?? (await browser.newPage());
const api = {};
let denied = false;
const done = new Promise((resolve) => {
  const timer = setTimeout(resolve, WAIT_MS);
  page.on('response', async (res) => {
    const url = res.url();
    if (!url.includes('golf.com.au/api/')) return;
    const short = url.split('golf.com.au')[1];
    try {
      if (/GetSelf/i.test(short) && res.status() === 401) denied = true;
      if (/GetMemberHandicapIndex|GetMyScores|GetSelf/i.test(short) && res.status() === 200) {
        api[short.split('?')[0].replace('/api/', '')] = await res.json();
        if (api['Score/GetMemberHandicapIndex']) {
          clearTimeout(timer);
          resolve();
        }
      }
    } catch {}
  });
});

console.log('SYNC -> golf.com.au/dashboard');
await page.goto('https://golf.com.au/dashboard', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch((e) => console.log('goto:', e.message));
await done;
await sleep(1500); // let trailing score/graph calls land
await browser.close();

if (denied || !api['Score/GetMemberHandicapIndex']) {
  console.error(denied ? 'SESSION_EXPIRED — run handoff-login.mjs to log in again' : 'NO_HANDICAP_RESPONSE');
  process.exit(1);
}

const hc = api['Score/GetMemberHandicapIndex'];
const parseAuDate = (s) => {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s ?? '');
  return m ? new Date(+m[3], +m[2] - 1, +m[1]) : null;
};
const scores = (api['Score/GetMyScores']?.Scores ?? []).slice(0, 5).map((s) => {
  const d = parseAuDate(s.PlayDate);
  const when = d
    ? d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })
    : s.PlayDate ?? '';
  const course = String(s.CourseName ?? '').replace(/\s*(GC|Golf Club|G\.C\.)$/i, '').trim();
  return {
    label: `${when} · ${course}`,
    value: String(s.AdjustedGross ?? ''),
  };
});
const payload = {
  owner: OWNER,
  source: 'golf',
  title: 'Golf handicap',
  nodes: [
    { id: 'handicap', type: 'metric' },
    { id: 'rounds', type: 'list' },
  ],
  content: {
    handicap: {
      label: 'Handicap index',
      value: hc.HandicapIndexText ?? '',
      text: `Low ${hc.LowHandicapIndexText ?? '—'} · ${hc.AsAtText ?? ''}`.trim(),
    },
    rounds: { items: scores },
  },
  staleHours: 48,
};

const res = await fetch(INGEST_URL, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-ingest-key': KEY },
  body: JSON.stringify(payload),
});
const body = await res.text();
console.log('INGEST', res.status, body.slice(0, 300));
if (!res.ok) process.exit(1);
console.log(`SYNCED handicap=${hc.HandicapIndexText} rounds=${scores.length}`);
