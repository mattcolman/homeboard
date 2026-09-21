# Roadmap

Ideas we'd like to pursue, roughly in the order they might be tackled. Nothing here is committed; this file is a parking lot for good intentions.

## User-defined widgets

Homeboard shouldn't ship every widget natively — it should support an individual adding their own. Today widgets are generated and persisted, but the catalog of useful sources is fixed by what we've built. The goal is for a person to ask for something personal and have Homeboard build and keep it.

Example request:

> "Create a widget to track my golf handicap by logging into http://golf.org.au/"

This is a widget almost nobody else would want — which is exactly why it belongs to the person, not the product.

**Empirical check (Sep 2026):** the old public lookup is gone. `golf.org.au/handicap/` redirects to `golf.com.au/login`, and golf.com.au serves a Cloudflare managed challenge to non-browser clients. So this example needs auth behind bot protection — the hardest tier.

**Leading path — real browser with human handoff:** Cloudflare Browser Run (formerly Browser Rendering) provides headless Chrome driven from a Worker via Playwright/CDP, plus **Live View** — a hosted URL that streams the session and lets a human interact — and a `Cloudflare.handoff` CDP flow that pauses automation until the human finishes. That maps exactly onto "stop on the login page and wait for the user": the connector opens golf.com.au, hands off a Live View link for the one-time login (MFA/challenges work because it's a real browser), then captures `storageState()`, encrypts it with the existing AES-GCM credential machinery, and replays it in later headless syncs. Re-login only on session expiry — the connection `status`/`last_error` pattern covers surfacing that. Cost is negligible for household sync volumes. Remaining unknowns: golf.com.au session lifetime, whether Live View can be embedded vs. opened in a tab, ToS posture for automated personal-account access. The first spike is small and decisive: launch a session, confirm the challenge passes, hand off a login, verify storage-state reuse in a later session.

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
