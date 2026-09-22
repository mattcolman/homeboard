// Browser Run spike for the golf-handicap connector question.
//
// Proves three things against the real site:
//   1. A Worker-driven Chrome gets past golf.com.au's Cloudflare challenge.
//   2. A human can log in through Live View while automation waits.
//   3. The captured session (cookies + storage) authenticates a later,
//      fully headless visit well enough to read the handicap.
//
// Run locally:  npx wrangler dev --remote
// (remote matters — the point is Cloudflare's browser, not a local one)
//
// Drive it:
//   curl -X POST localhost:8787/open          -> sessionId + liveView.url + screenshot
//   open the liveView URL, log in yourself
//   curl -X POST 'localhost:8787/capture?sessionId=…' > .session.json
//   curl -X POST localhost:8787/verify --data @.session.json
//
// If SPIKE_KEY is set (.dev.vars), every request needs header x-spike-key.

import puppeteer from '@cloudflare/puppeteer';
import type { Browser, Page } from '@cloudflare/puppeteer';

type Env = {
  BROWSER: Fetcher;
  SPIKE_KEY?: string;
};

const HOME = 'https://golf.com.au/';
const DASHBOARD = 'https://golf.com.au/dashboard';
const KEEP_ALIVE_MS = 15 * 60_000;
const SETTLE_TIMEOUT_MS = 45_000;

type PageInfo = { title: string; url: string; challenge: boolean };

async function describe(page: Page): Promise<PageInfo> {
  const fallback = { title: '', url: page.url(), challenge: true };
  try {
    const state = await page.evaluate(() => {
      const title = document.title;
      const marker =
        title.toLowerCase().includes('just a moment') ||
        title.toLowerCase().includes('attention required') ||
        !!document.querySelector(
          '#challenge-error-text, #challenge-stage, .cf-challenge, [class*="cf-chl"]',
        );
      return { title, challenge: marker };
    });
    return { ...state, url: page.url() };
  } catch {
    // Mid-navigation or evaluating inside the challenge iframe: treat as not settled.
    return fallback;
  }
}

async function waitForSettle(page: Page, timeoutMs = SETTLE_TIMEOUT_MS) {
  const start = Date.now();
  let info = await describe(page);
  while (info.challenge && Date.now() - start < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    info = await describe(page);
  }
  return { ...info, waitedMs: Date.now() - start };
}

async function liveViewUrl(page: Page) {
  try {
    const client = await page.createCDPSession();
    // Not in puppeteer's protocol map; sent raw.
    const result = await (client.send as (...a: unknown[]) => Promise<unknown>)(
      'Cloudflare.getLiveView',
      { mode: 'tab' },
    );
    return result;
  } catch (error) {
    return { error: String(error) };
  }
}

async function open(env: Env) {
  const browser = await puppeteer.launch(env.BROWSER, {
    keep_alive: KEEP_ALIVE_MS,
  });
  try {
    const page = await browser.newPage();
    await page.goto(DASHBOARD, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });
    const settled = await waitForSettle(page);
    const sessionId = browser.sessionId();
    const liveView = settled.challenge ? null : await liveViewUrl(page);
    const screenshot = await page
      .screenshot({ encoding: 'base64' })
      .catch(() => null);
    return Response.json({
      sessionId,
      liveView,
      loginPage: new URL(settled.url).pathname.startsWith('/login'),
      ...settled,
      screenshot,
    });
  } finally {
    browser.disconnect(); // keep_alive holds the session for reconnect
  }
}

async function capture(env: Env, sessionId: string) {
  const browser = await puppeteer.connect(env.BROWSER, sessionId);
  try {
    const pages = await browser.pages();
    const page =
      pages.find((p) => p.url().includes('golf.com.au')) ?? pages[0];
    if (!page) throw new Error('No open pages in that session.');
    let cookies: unknown[] = [];
    try {
      const client = await page.createCDPSession();
      const all = (await client.send('Network.getAllCookies')) as {
        cookies: unknown[];
      };
      cookies = all.cookies;
    } catch {
      cookies = await page.cookies();
    }
    const read = (store: 'localStorage' | 'sessionStorage') =>
      page
        .evaluate(
          (name) =>
            Object.fromEntries(
              Object.entries(window[name]).map(([k, v]) => [k, String(v)]),
            ),
          store,
        )
        .catch(() => ({}));
    const localStorage = await read('localStorage');
    const sessionStorage = await read('sessionStorage');
    const info = await describe(page);
    return Response.json({
      ...info,
      loggedIn: !new URL(info.url).pathname.startsWith('/login'),
      storageState: { cookies, localStorage, sessionStorage },
    });
  } finally {
    browser.disconnect();
  }
}

type StoredCookie = {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  secure?: boolean;
  httpOnly?: boolean;
  expires?: number;
  sameSite?: string;
};

async function verify(request: Request, env: Env) {
  const body = (await request.json()) as {
    storageState?: {
      cookies?: StoredCookie[];
      localStorage?: Record<string, string>;
    };
  };
  const storage = body.storageState ?? {};
  const browser = await puppeteer.launch(env.BROWSER, {
    keep_alive: KEEP_ALIVE_MS,
  });
  try {
    const page = await browser.newPage();
    const cookies = (storage.cookies ?? [])
      .filter((c) => c.name && typeof c.value === 'string')
      .map((c) => ({
        name: c.name,
        value: c.value,
        domain: c.domain,
        path: c.path ?? '/',
        secure: c.secure,
        httpOnly: c.httpOnly,
        expires: c.expires && c.expires > 0 ? c.expires : undefined,
        sameSite: ['Strict', 'Lax', 'None'].includes(c.sameSite ?? '')
          ? (c.sameSite as 'Strict' | 'Lax' | 'None')
          : undefined,
      }));
    if (cookies.length) await page.setCookie(...cookies);
    const entries = storage.localStorage ?? {};
    if (Object.keys(entries).length)
      await page.evaluateOnNewDocument((items) => {
        try {
          for (const [key, value] of Object.entries(items))
            window.localStorage.setItem(key, value);
        } catch {
          /* cross-origin guard */
        }
      }, entries);
    await page.goto(DASHBOARD, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });
    const settled = await waitForSettle(page);
    const text = await page
      .evaluate(() => document.body?.innerText ?? '')
      .catch(() => '');
    const handicap =
      text.match(/ga\s*handicap[\s:–—-]{0,40}(\d+(?:\.\d+)?)/i)?.[1] ??
      text.match(/handicap[\s:–—-]{0,40}(\d+(?:\.\d+)?)/i)?.[1] ??
      null;
    const screenshot = await page
      .screenshot({ encoding: 'base64' })
      .catch(() => null);
    return Response.json({
      ...settled,
      loggedIn: !new URL(settled.url).pathname.startsWith('/login'),
      handicap,
      textSample: text.slice(0, 1500),
      screenshot,
    });
  } finally {
    browser.disconnect();
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (env.SPIKE_KEY && request.headers.get('x-spike-key') !== env.SPIKE_KEY)
      return Response.json({ error: 'Missing or wrong x-spike-key.' }, { status: 401 });
    const url = new URL(request.url);
    try {
      switch (`${request.method} ${url.pathname}`) {
        case 'GET /':
          return new Response(
            [
              'homeboard-browser-spike',
              '',
              'POST /open                     launch Chrome, load golf.com.au/dashboard, mint a Live View link',
              'POST /capture?sessionId=…     dump cookies + storage for that session',
              'POST /verify                  body {"storageState":…} -> fresh headless read of the dashboard',
              'GET  /sessions                list live Browser Run sessions',
              'GET  /probe                   load the homepage only (no session kept)',
            ].join('\n'),
            { headers: { 'content-type': 'text/plain' } },
          );
        case 'GET /sessions': {
          const sessions = await puppeteer.sessions(env.BROWSER);
          return Response.json({ sessions });
        }
        case 'GET /probe': {
          const browser = await puppeteer.launch(env.BROWSER);
          try {
            const page = await browser.newPage();
            await page.goto(HOME, {
              waitUntil: 'domcontentloaded',
              timeout: 30_000,
            });
            const settled = await waitForSettle(page, 30_000);
            return Response.json(settled);
          } finally {
            browser.disconnect();
          }
        }
        case 'POST /open':
          return await open(env);
        case 'POST /capture':
          return await capture(env, url.searchParams.get('sessionId') ?? '');
        case 'POST /verify':
          return await verify(request, env);
        default:
          return Response.json({ error: 'Unknown endpoint.' }, { status: 404 });
      }
    } catch (error) {
      return Response.json(
        { error: error instanceof Error ? error.message : String(error) },
        { status: 502 },
      );
    }
  },
};
