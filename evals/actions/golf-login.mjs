// Ensures an authenticated golf.com.au session in the shared headed-Chrome
// profile. Order of attempts: existing session -> credential auto-fill -> human
// handoff (the same manual login the spike used). Headed + persistent profile +
// no automation flags is required: golf.com.au hard-blocks headless Chrome.
import puppeteer from 'puppeteer-core';
import { env } from '../lib/env.mjs';

const CHROME = env(
  'GOLF_CHROME',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
);
const PROFILE = env(
  'GOLF_CHROME_PROFILE',
  new URL('../../spike/browser/chrome-profile', import.meta.url).pathname,
);
const HUMAN_TIMEOUT_MS = 10 * 60 * 1000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function installProbes(page) {
  // Same trick as the spike: query the site's own API with its own axios during
  // each navigation's post-load grace window.
  return page.evaluateOnNewDocument(() => {
    window.__probes = {};
    const interval = setInterval(async () => {
      if (typeof axios === 'undefined') return;
      clearInterval(interval);
      try {
        const res = await axios.get('/api/member/GetSelf', {
          headers: { datatype: 'json', contenttype: 'application/json' },
        });
        window.__probes.GetSelf = `OK ${res.status}`;
      } catch (error) {
        window.__probes.GetSelf = error.response
          ? `HTTP ${error.response.status}`
          : `ERR ${error.message}`;
      }
    }, 150);
  });
}

async function authed(page) {
  const probes = await page.evaluate(() => window.__probes).catch(() => ({}));
  if (typeof probes?.GetSelf === 'string' && probes.GetSelf.startsWith('OK 200'))
    return true;
  if (page.url().includes('/dashboard')) return true;
  // Last resort: a direct in-page fetch during the grace window.
  return page
    .evaluate(() =>
      fetch('/api/member/GetSelf', {
        headers: { datatype: 'json' },
      })
        .then((r) => r.status === 200)
        .catch(() => false),
    )
    .catch(() => false);
}

async function waitForAuth(page, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await authed(page)) return true;
    await sleep(3000);
  }
  return false;
}

async function tryAutoLogin(page, username, password, log) {
  log('golf-login: attempting credential auto-fill');
  await page
    .goto('https://golf.com.au/login', {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    })
    .catch(() => {});
  await sleep(4000); // let any challenge interstitial settle
  const passwordInput = await page.$('input[type="password"]');
  if (!passwordInput) return false;
  const userInput = await page.$(
    'input[type="email"], input[name*="mail" i], input[name*="user" i], input[name*="member" i], input[type="text"]',
  );
  if (!userInput) return false;
  await userInput.click({ clickCount: 3 }).catch(() => {});
  await userInput.type(username, { delay: 25 });
  await passwordInput.click({ clickCount: 3 }).catch(() => {});
  await passwordInput.type(password, { delay: 25 });
  const submitted = await page
    .evaluate(() => {
      const button = [...document.querySelectorAll('button')].find((b) =>
        /log ?in|sign ?in/i.test(b.textContent ?? ''),
      );
      if (button) {
        button.click();
        return true;
      }
      return false;
    })
    .catch(() => false);
  if (!submitted) await page.keyboard.press('Enter');
  return waitForAuth(page, 45_000);
}

export async function ensureGolfLogin({ askHuman, log = () => {} }) {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: false,
    userDataDir: PROFILE,
    ignoreDefaultArgs: ['--enable-automation'],
    args: [
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-blink-features=AutomationControlled',
    ],
    defaultViewport: null,
  });
  try {
    const page = (await browser.pages())[0] ?? (await browser.newPage());
    await installProbes(page);
    await page
      .goto('https://golf.com.au/', {
        waitUntil: 'domcontentloaded',
        timeout: 60_000,
      })
      .catch(() => {});
    if (await waitForAuth(page, 15_000))
      return { authenticated: true, method: 'existing session' };

    const username = env('GOLF_USERNAME');
    const password = env('GOLF_PASSWORD');
    if (username && password) {
      try {
        if (await tryAutoLogin(page, username, password, log))
          return { authenticated: true, method: 'credential auto-fill' };
      } catch (error) {
        log(`golf-login: auto-fill failed (${error.message})`);
      }
    } else {
      log('golf-login: no GOLF_USERNAME/GOLF_PASSWORD — skipping auto-fill');
    }

    if (!askHuman) return { authenticated: false, method: 'none' };
    const answer = await askHuman(
      'golf.com.au login needed. A headed Chrome window is open — log in there, then press Enter here. Type f to fail the step.',
    );
    if (answer !== 'done') return { authenticated: false, method: 'manual' };
    return {
      authenticated: await waitForAuth(page, HUMAN_TIMEOUT_MS),
      method: 'manual',
    };
  } finally {
    await browser.close().catch(() => {});
  }
}
