## User-defined widgets

Homeboard shouldn't ship every widget natively — it should support an individual adding their own. Today widgets are generated and persisted, but the catalog of useful sources is fixed by what we've built. The goal is for a person to ask for something personal and have Homeboard build and keep it.

Example request:

> "Create a widget to track my golf handicap by logging into http://golf.org.au/"

This is a widget almost nobody else would want — which is exactly why it belongs to the person, not the product.

**Empirical check (Sep 2026):** the old public lookup is gone. `golf.org.au/handicap/` redirects to `golf.com.au/login`, and golf.com.au serves a Cloudflare managed challenge to non-browser clients. So this example needs auth behind bot protection — the hardest tier.

**Spike result (Sep 2026, `spike/browser/`):** built a Browser Run spike worker (`/open`, `/capture`, `/verify`, `/probe`) — the machinery works, but **golf.com.au hard-blocks headless Chrome regardless of origin**. Browser Run sessions (Cloudflare egress) get "Sorry, you have been blocked"; local headless Chrome (new mode, shell, and with `webdriver` stealth flags) gets the same. Only a **headed** real browser on a residential IP passed Cloudflare and reached the site's own login page. So Browser Run + Live View handoff is viable *architecture* for other protected sites, but dead for golf.com.au specifically — the user would just see the block page.

**API discovery (Sep 2026, `spike/browser/discover-api.mjs` + follow-ups):** golf.com.au is a **DotGolf** platform with a same-origin JSON API at `/api/`. Confirmed endpoints, extracted from the site's own service bundles and probed live in a headed session:

- `GET /api/Score/GetTargetMemberHandicapIndex?memberUID=<encrypted>` — likely the public "look up any golfer" handicap endpoint. It returned a 500 *decryption* error on a bogus param (not a 401), so it probably doesn't require login — but `memberUID` is an **encrypted opaque token**, obtainable only from a member search endpoint or an authenticated profile.
- `POST /api/Score/GetMemberHandicapIndex` — the logged-in member's own handicap (405 on GET).
- `GET /api/member/GetSelf` — 401 without auth cookies.
- `POST /api/auth/login` — JSON login.

But the transport reality is brutal: Cloudflare challenges every `/api/` request outside a brief post-navigation grace window in a real browser, `cf_clearance` is bound to TLS fingerprint (curl/fetch replay fails even from the same IP), and headless Chrome is hard-blocked outright. **So there is no server-side fetch path and no headless path to this API — only a real headed browser.**

**Handoff spike result (Sep 2026, `spike/browser/handoff-login.mjs`) — the home-agent path works end to end.** Headed Chrome with a dedicated persistent profile and `--enable-automation` removed (no banner, no automation flags) → golf.com.au → user logged in manually once → the dashboard's own API calls + in-page axios probes during the load grace window returned:

- `POST /api/Score/GetMemberHandicapIndex` → `{"HandicapIndexText":"17.8","LowHandicapIndexText":"18.2","AsAtText":"Today",...}`
- `GET /api/member/GetSelf` → member profile (name, home club)
- `GetHCDiffGraphDataWHSv2` + `GetMyScores` → full score/handicap history, enough for a trend chart

Re-launching with the same profile was already authenticated (GetSelf 200 on first load, no login). So the connector recipe is: persistent-profile headed Chrome on a home machine → navigate → call the site's own API in the grace window → push value to Homeboard. Missing piece on the Homeboard side: a shared-secret "push metric" ingest endpoint that writes `snapshot.data.content` — generically useful for any push connector.

That leaves two honest golf paths: (a) **a home-hosted headed-browser agent** — a small script on a home machine that opens a persistent-profile Chrome, lets the user log in once, reads the handicap via the site's own API client during the load window, and pushes the value to Homeboard; this is feasible today but requires a "push metric" ingest endpoint on the Homeboard side; (b) manual entry. The official GA app appears to be a webview wrapper (the site has a `/score-legends-for-mobile-app` page), so it likely rides the same API — its webview just solves the challenge natively.

**Built (Sep 2026):** the golf widget is live end-to-end. `POST /api/ingest` (`app/api/ingest/route.ts`) accepts pushes authenticated by `HOMEBOARD_INGEST_KEY`, writes `snapshot.data.content` on widgets bound to `{type:'ingest', source}`, and auto-provisions a composition card on first push. `applyIngest` in `app/lib/widgets/store.ts` handles merge/provision/validation; `binding.source` was added to the model. `spike/browser/golf-sync.mjs` is the producer: persistent-profile headed Chrome → `/dashboard` → captures `GetMemberHandicapIndex` + `GetMyScores` → pushes handicap value + recent rounds. Session persists across runs; re-login only needed if GA expires it (run `handoff-login.mjs` again).

**Scheduled (Sep 2026):** `spike/browser/install-golf-sync.sh` installs a per-user LaunchAgent (`ai.homeboard.golf-sync`) that runs the sync daily at 07:30 in the GUI session — headed Chrome needs a logged-in desktop, so this must be an always-on home machine, not a server. Output lands in `spike/browser/golf-sync.log`; `install-golf-sync.sh uninstall` removes it. Remaining for full production: point `INGEST_URL` at the deployed app and set `HOMEBOARD_OWNER` to the real user id (both read from env or `.env.local`), plus `HOMEBOARD_INGEST_KEY` on the deployed worker.

**WKWebView spike result (Sep 2026, `spike/webview/`):** a ~150-line Swift app (`main.swift`, built by `run.sh` with `swiftc` — no Xcode needed) opened a real `WKWebView` at golf.com.au and passed every check: Cloudflare let all navigations through (one managed challenge on `/login` self-resolved), interactive login worked, `GetSelf` returned 200 in page context, and **the session survived a cold relaunch** via the persistent `WKWebsiteDataStore` (no challenge on second run). This proves the "native shell" path: a thin shell hosting the web app could also run a hidden webview for connector syncs — the display itself becomes the headed browser on residential IP, removing the always-on-Mac requirement. Caveat: verified on macOS WKWebView; iPad is the same engine family but needs a device run before committing. (Detail: `GetMemberHandicapIndex` 500'd to a bare `fetch` — the site's client sends extra context; real connectors capture the site's own API responses like `golf-sync.mjs` does.) See `native-vs-web.md` for the shell-vs-rewrite decision this unlocked.

Working backwards from the card reframed the sequencing: a handicap widget only needs *something* that writes `snapshot.data.content`. A voice/manual "update this metric" action ships that widget immediately and is generically useful (pinned metrics, notes, ETAs). Connector automation is then an upgrade to a widget that already exists, not a blocker.

What this probably requires:

- **A widget authoring flow.** Ask for a widget, provide a source (URL, API, feed, credentials), get back a persistent widget that renders the data and refreshes it.
- **Per-user credential storage for arbitrary sites.** We already encrypt iCloud app-specific passwords (`CALENDAR_CREDENTIAL_KEY`, AES-GCM in `app/lib/calendar/icloud.ts`). Generalizing that to "store credentials for a site this widget needs" is the hard part — and raises questions about scraping vs. official APIs, session expiry, and sites that need interactive login or MFA.
- **Sandboxed rendering.** Custom visuals already run in an isolated frame; user-defined widgets likely extend that same sandbox with fetch/data access to the configured source.
- **Identity-aware widgets.** A golf handicap is one person's data on a shared household screen. Widgets may need an owner and visibility rules consistent with the vision's "respect who is asking and who can see the screen."

Open questions:

- Do user widgets fetch data server-side (Worker cron/queue, cached snapshots like the calendar) or client-side on view?
- What's the minimum viable version — a hand-authored widget config plus a connector, vs. AI authoring the connector itself from a URL?
- How do we handle sites without APIs (scraping, brittle selectors) vs. ones with real APIs?