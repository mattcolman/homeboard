// Handoff-login spike: headed Chrome drives to golf.com.au, user logs in
// manually in the real window, then we extract handicap via the site's own
// API during the post-navigation grace window.
// Run: node handoff-login.mjs
import puppeteer from 'puppeteer-core';
import { writeFileSync } from 'node:fs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PROFILE = new URL('./chrome-profile', import.meta.url).pathname;
const LOGIN_TIMEOUT_MS = 10 * 60 * 1000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stamp = (t0) => `+${((Date.now() - t0) / 1000).toFixed(0)}s`;

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: false,
  userDataDir: PROFILE, // persistent profile -> session survives across runs
  // Drop --enable-automation: kills the "automated test software" banner and
  // the automation signals (Google sign-in et al. refuse flagged browsers).
  ignoreDefaultArgs: ['--enable-automation'],
  args: ['--no-first-run', '--no-default-browser-check', '--disable-blink-features=AutomationControlled'],
  defaultViewport: null,
});

const page = (await browser.pages())[0] ?? (await browser.newPage());
const t0 = Date.now();

// Log every same-origin /api/ response; dump bodies for interesting ones.
const apiLog = [];
page.on('response', async (res) => {
  const url = res.url();
  if (!url.includes('golf.com.au/api/')) return;
  const short = url.split('golf.com.au')[1];
  const entry = { t: stamp(t0), status: res.status(), method: res.request().method(), url: short };
  apiLog.push(entry);
  let line = `${entry.t} ${entry.status} ${entry.method} ${short}`;
  try {
    if (res.status() === 200 && /member|score|handicap|auth|finder/i.test(short)) {
      const body = await res.text();
      entry.body = body.slice(0, 2000);
      line += `\n    BODY ${body.slice(0, 400).replace(/\s+/g, ' ')}`;
    }
  } catch {}
  console.log('API', line);
});

console.log('LAUNCHING -> golf.com.au');
await page.goto('https://golf.com.au/', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch((e) => console.log('goto:', e.message));
console.log('WINDOW_OPEN — waiting for user to log in manually');

// Pre-install probes that fire during each navigation's grace window: they
// wait for axios, then query the self/handicap endpoints and stash results.
await page.evaluateOnNewDocument(() => {
  window.__probes = {};
  const iv = setInterval(async () => {
    if (typeof axios === 'undefined') return;
    clearInterval(iv);
    const probe = async (name, fn) => {
      try {
        const r = await fn();
        window.__probes[name] = `OK ${r.status} ${JSON.stringify(r.data).slice(0, 800)}`;
      } catch (e) {
        window.__probes[name] = e.response
          ? `HTTP ${e.response.status} ${JSON.stringify(e.response.data).slice(0, 300)}`
          : `ERR ${e.message}`;
      }
    };
    const h = { headers: { datatype: 'json', contenttype: 'application/json' } };
    await probe('GetSelf', () => axios.get('/api/member/GetSelf', h));
    await probe('GetMemberHandicapIndex', () => axios.post('/api/Score/GetMemberHandicapIndex', {}, h));
  }, 150);
});

// Poll for login: dashboard URL or an auth-ish cookie appearing.
const initialCookies = new Set((await page.cookies('https://golf.com.au')).map((c) => c.name));
let loggedIn = false;
while (Date.now() - t0 < LOGIN_TIMEOUT_MS) {
  await sleep(3000);
  const url = page.url();
  const cookies = await page.cookies('https://golf.com.au').catch(() => []);
  const newAuthCookies = cookies
    .filter((c) => !initialCookies.has(c.name))
    .map((c) => c.name);
  const probes = await page.evaluate(() => window.__probes).catch(() => ({}));
  console.log(`POLL url=${url.slice(0, 80)} newCookies=[${newAuthCookies}] probes=${Object.keys(probes || {})}`);
  const alreadyAuthed = typeof probes?.GetSelf === 'string' && probes.GetSelf.startsWith('OK 200');
  if (alreadyAuthed || url.includes('/dashboard') || url.includes('/my-handicap') || newAuthCookies.some((n) => /auth|aspx|aspnet|member|token|dotgolf/i.test(n))) {
    loggedIn = true;
    break;
  }
}

if (!loggedIn) {
  console.log('TIMEOUT — no login detected');
  await browser.close();
  process.exit(1);
}

console.log('LOGIN_DETECTED — reloading to capture API data in grace window');
await page.goto('https://golf.com.au/dashboard', { waitUntil: 'networkidle2', timeout: 60000 }).catch(() => {});
await sleep(6000);

const probes = await page.evaluate(() => window.__probes).catch(() => ({}));
const storage = await page.evaluate(() => ({ localStorage: { ...localStorage }, sessionStorage: { ...sessionStorage } })).catch(() => ({}));
const cookies = await page.cookies('https://golf.com.au');
const snapshot = {
  capturedAt: new Date().toISOString(),
  url: page.url(),
  probes,
  apiLog,
  cookies: cookies.map(({ name, value, domain, expires }) => ({ name, value, domain, expires })),
  storage,
  domText: await page.evaluate(() => document.body.innerText.slice(0, 3000)).catch(() => ''),
};
writeFileSync(new URL('./login-capture.json', import.meta.url), JSON.stringify(snapshot, null, 2));
console.log('PROBES:', JSON.stringify(probes, null, 1));
console.log('WROTE login-capture.json');
await browser.close();
