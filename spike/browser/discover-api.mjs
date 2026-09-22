// Discovery pass: load golf.com.au in headed Chrome (which passes their
// Cloudflare config) and inventory what the web app actually talks to —
// script bundles, XHR/fetch hosts, auth endpoints. Then fetch each JS bundle
// inside the page and grep it for API/auth hints.
//
//   node discover-api.mjs
//
// A real Chrome window opens briefly on this machine.

import puppeteer from 'puppeteer-core';
import { writeFileSync } from 'node:fs';

const browser = await puppeteer.launch({
  executablePath:
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: false,
  args: ['--no-first-run', '--disable-session-crashed-bubble'],
});

const seenRequests = new Set();

try {
  const page = await browser.newPage();
  page.on('request', (req) => seenRequests.add(req.url()));

  await page.goto('https://golf.com.au/', {
    waitUntil: 'networkidle2',
    timeout: 60_000,
  });
  // Let the SPA settle and emit its initial API calls.
  await new Promise((r) => setTimeout(r, 8000));

  const pageInfo = await page.evaluate(() => ({
    title: document.title,
    url: location.href,
    scripts: [...document.scripts].map((s) => s.src).filter(Boolean),
    hints: Object.fromEntries(
      Object.entries(window).filter(([k]) =>
        /api|config|env|auth/i.test(k),
      ),
    ),
  }));

  // Fetch every same-origin-ish JS bundle inside the page and grep for hosts.
  const bundles = [
    ...new Set(
      [...seenRequests].filter(
        (u) => /\.(js|mjs)($|\?)/.test(u) && !u.includes('live.browser'),
      ),
    ),
  ];
  const findings = [];
  for (const bundle of bundles.slice(0, 30)) {
    const found = await page
      .evaluate(async (src) => {
        try {
          const text = await (await fetch(src)).text();
          const hits = new Set();
          for (const m of text.matchAll(
            /https:\/\/[a-z0-9.-]+\.[a-z]{2,}(?:\/[\w./-]*)?/gi,
          ))
            hits.add(m[0]);
          for (const m of text.matchAll(
            /["'`]((?:\/v?\d+)?\/(?:api|auth|oauth|token|golfer|handicap)[\w./-]*)["'`]/gi,
          ))
            hits.add(m[1]);
          for (const m of text.matchAll(
            /(auth0|cognito|b2clogin|identityserver|oidc|oauth2|okta|firebase)/gi,
          ))
            hits.add(`provider:${m[1].toLowerCase()}`);
          return [...hits];
        } catch (e) {
          return [`fetch-failed: ${e}`];
        }
      }, bundle)
      .catch((e) => [`evaluate-failed: ${e}`]);
    if (found.length) findings.push({ bundle, found });
  }

  writeFileSync('shot.png', await page.screenshot());
  writeFileSync(
    'discovery.json',
    JSON.stringify({ pageInfo, requests: [...seenRequests], findings }, null, 2),
  );
  console.log(JSON.stringify({ pageInfo, requestCount: seenRequests.size, findings }, null, 2));
} finally {
  await browser.close();
}
