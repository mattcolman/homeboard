# Native vs web — the client strategy question

Prompted by the connector work: a native app can embed a real, controllable browser (WKWebView / Android WebView) — which is what bot-protected connectors need — while a web app cannot. Does that justify going native, or even a full rewrite?

## What's verified vs assumed

**Verified (24 Sep 2026, `spike/webview/`):** a ~150-line Swift `WKWebView` app passed golf.com.au's Cloudflare protection, accepted an interactive login, called the site's own API in page context (`GetSelf` → 200), and kept the session across a cold relaunch via the persistent `WKWebsiteDataStore`. So an embedded webview is a working headed-browser-on-residential-IP — the thing headless Chrome and Browser Run can't be.

**Assumed:** iPad WKWebView behaves the same (same engine family; needs a device run). Android WebView likely passes similarly (real Chromium; unverified).

## The case for web as the base

- Zero install, any screen can be a display, instant Cloudflare deploys.
- The whole codebase is already web, and — decisive point — **Homeboard's content is web content by design**. `module` widgets and `page` artifacts are generated HTML/CSS/JS rendered in sandboxed iframes. A "fully native" app would still embed webviews to render them.

## What native actually buys

None of it is UI polish. Three capability gaps:

1. **A controllable real browser on residential IP** — the connector webview: visible for login, hidden for sync, sharing one data store. Verified on macOS.
2. **Mic/audio reliability** — `AVAudioSession` vs Safari's flaky audio; voice is the front door and is flagged a launch blocker.
3. **Kiosk behaviour** — keep-awake, auto-relaunch, survive reboots.

## Why not a full rewrite (Swift + Kotlin)

- The rewrite only affects the client; the backend (generation, connectors, ingest, realtime session) is identical either way.
- The cost isn't the first build — it's **permanent parity**. Every new widget kind, renderer change, or artifact feature must ship on web + iOS + Android forever. The fastest-moving parts of the codebase are exactly the ones that would be triplicated.
- A native app can't escape webviews anyway — generated content needs them — so "native" converges back toward "shell hosting web content" the moment you look closely.

## Recommendation: thin shells, one codebase

Keep the web app canonical. Add a thin native shell per platform (Capacitor wraps once for both iOS and Android, or two hand-rolled webview containers of a few hundred lines each). The shell only bridges stable capabilities:

- connector webview (login + hidden sync),
- audio session / mic config,
- keep-awake / kiosk.

Shells rarely change because they bridge capabilities, not features — new widget kinds ship via web deploy with no app update. Households on a plain browser still work; connectors degrade to the home-agent path (`spike/browser/` model — an always-on headed Chrome on a home Mac pushing to `/api/ingest`).

## Sequencing

1. Verify on iPad WKWebView and Android WebView before committing to either shell.
2. If they pass: build the iPad shell first (display target), Android when a device demands it.
3. Keep the home agent as the fallback for pure-browser households regardless.

## Decision

Open — tracked alongside the connector design in `.lavish/connector-widgets.html` (question 1: "Does Homeboard get a thin native shell?").
