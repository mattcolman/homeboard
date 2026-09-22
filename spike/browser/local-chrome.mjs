// Local counterpart to the worker spike: drive the installed Google Chrome
// from this machine's residential IP and see whether golf.com.au lets a real
// browser through. Answers "is the Cloudflare block IP-based?" without needing
// miniflare's local-browser machinery (which is broken on this macOS).
//
//   node local-chrome.mjs [url] [--headful]
//
// Prints { title, url, challenged } and writes shot.png.

import puppeteer from 'puppeteer-core';
import { writeFileSync } from 'node:fs';

const url = process.argv[2] ?? 'https://golf.com.au/dashboard';
const headful = process.argv.includes('--headful');

const browser = await puppeteer.launch({
  executablePath:
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  // 'shell' = legacy headless (easily detected). true = new headless mode,
  // nearly identical to headed Chrome. false = real window.
  headless: headful ? false : true,
  args: [
    '--no-first-run',
    '--disable-session-crashed-bubble',
    '--disable-blink-features=AutomationControlled',
    '--window-size=1280,800',
  ],
});
const page0 = (await browser.pages())[0];
await page0?.evaluateOnNewDocument(() => {
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
});
try {
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  const start = Date.now();
  let info;
  do {
    info = await page.evaluate(() => ({
      title: document.title,
      challenged:
        document.title.toLowerCase().includes('just a moment') ||
        document.title.toLowerCase().includes('attention required') ||
        !!document.querySelector(
          '#challenge-error-text, #challenge-stage, [class*="cf-chl"]',
        ),
    }));
    if (!info.challenged || Date.now() - start > 45_000) break;
    await new Promise((r) => setTimeout(r, 2000));
  } while (true);
  writeFileSync(
    'shot.png',
    await page.screenshot({ encoding: 'binary' }),
  );
  console.log(
    JSON.stringify({ ...info, url: page.url(), waitedMs: Date.now() - start }),
  );
} finally {
  await browser.close();
}
