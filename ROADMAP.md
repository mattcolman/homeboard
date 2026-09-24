# Roadmap

Ideas we'd like to pursue, roughly in the order they might be tackled. Nothing here is committed; this file is a parking lot for good intentions.

## Ops
[x] Is our test suite sufficient to ensure the CI loop is helping Devin to get work done effectively? Do not write a bunch of slop tests, just make sure we have a few concise tests running that give us confidence in our changes — `npm run check` runs typecheck + the node:test suite (29 tests covering layout packing, generated-widget validation, calendar/weather/shopping/ingest, family members, chores and artifacts).

## Design
[x] I'm not happy with the plain white widgets - look at apple widgets as inspiration, they are colourful (consistent with gradients and restricted on what colours they can use). I also suggest to include a big icon at the top right of each widget. e.g. for the golf widget, a big beautiful golf ball icon in the top right + a nice green gradient background colour. — Done: fixed gradient palette (`TONES` in `model.ts` — indigo/sky/green/terracotta/emerald/amber/violet + light `cream`), white text on coloured cards, and a white circular icon badge straddling each card's top-right corner. Mockup: `.lavish/widget-redesign.html` (direction A approved).
[x] Main navigation - a top bar or a sidebar to always get to calendar view, photo slideshow, or dashboard view. — `SiteNav` tabs (Board / Calendar / Photos) in the board header and each view.

## Native features
[x] Add ability to enter in all family member names + an avatar for each - today this can affect the calendar view when grouping by user - in future this could mean only family members should be able to talk to homeboard — `/family` page manages name + emoji avatar + colour + linked calendars; agenda rows and the People view use them.
[x] Chores widget - utilisng the family member names (users) feature above — Chores widget with per-row assignee chips, touch add row, "start a new round" reset, and a voice `add_chore` tool.
[x] User defined widgets - mostly done - see USER_DEFINED_WIDGETS.md - it's still listed as a spike — `/api/ingest` + golf connector are live; `install-golf-sync.sh` schedules the sync daily via launchd. Remaining: point `INGEST_URL`/`HOMEBOARD_OWNER` at the deployed app.

## Generative output (vision work)
[x] Output decision layer — route each request to the right output mode: spoken answer, generated visual, or board widget. This is where the "never a wall of text" rule lives. Needs heuristics for which mode fits (quick fact → voice; structured/persistent data → visual; worth keeping → widget) plus a graceful fallback when generation fails. — The realtime instructions (`SESSION_CONFIG`) carry the three-way rule: speech for quick facts, `show_visual` for anything structured, `create_widget` for things worth keeping on the board. `show_visual` never errors to the model; a failed generation returns `fallback: true` so it answers briefly in speech. The typed request dialog mirrors this with "Show me" vs "Add to board". Eval scenario: `evals/scenarios/output-modes.mjs` (not yet run against a live session).
[x] Artifacts — generated HTML answers rendered in the existing isolated frame and saved as "artifacts" (distinct from board widgets): storage model, reopen/refine, expiry. CustomWidget/generation already cover generation + sandboxed rendering; the new work is the ephemeral-artifact concept and lifecycle. — `artifacts` table (`app/lib/artifacts.ts`, `/api/artifacts`) with a 24h TTL, full-screen `ArtifactView`, a "Recent answers" strip to reopen, refine via instruction, and explicit Save which lifts the TTL into the `/artifacts` gallery. Artifact→widget promotion was removed (see below).
[x] Visual-first artifacts — artifacts are free-form full-screen pages (`kind: 'page'`, `generatePage`) that lead with web photographs and SVG diagrams and cap text; web images allowed via `img-src https:` in the artifact sandbox. Eval: `evals/scenarios/plant-growth.mjs`.
[] Re-think artifact → widget promotion — removed because "keep this" on a visual ambiguously regenerated a board widget (Save now means "keep the visual forever" in `/artifacts`). The useful version: a visual answer like "countdown to my birthday" could become a real custom widget — but that means generating UI *plus* a data source pulled on a schedule, which is the actual difference between a widget and a (static) artifact. Design needed before re-adding.
[x] Artifact + widget freshness — stale data on a shared screen erodes trust. Every artifact/widget should show when its data was last updated, and persisted widgets need a refresh/re-sync story. — `Freshness` footer on every card and artifact ("Updated 5 min ago", ticking each minute); when a snapshot passes `staleAt` it becomes a tap-to-refresh "Update due" control; expired cards say when they were last updated. Built-in bindings (calendar, shopping, weather) still re-sync on board load; generated widgets refresh on tap or by voice.
[] Voice reliability on the target iPad — vision.md flags mic interaction and Safari behaviour as unverified. If voice is the front door this is a launch blocker: push-to-talk reliability, latency, interruption handling, kitchen noise.

## Browser connectors (in-app browser)
[] Complete the browser connector work — `spike/browser/` has `handoff-login.mjs`, `golf-sync.mjs`, `discover-api.mjs`; the golf connector already syncs via `/api/ingest` on a launchd schedule. Remaining to make this general: in-app handoff UX (hosted browser login link → user completes auth → return), encrypted `storageState` persistence alongside existing credentials, session-expiry detection with a re-handoff prompt, and a generic connector shape so new sites aren't one-off scripts.
[] Access rules for auth-backed data — once connectors work, anyone in earshot can ask for data behind the household's logins. Decide which family members can request/view which connectors' data on a shared screen (vision already commits to "access to private household context should respect who is asking").

## Calendar improvements
[x] Full screen view should show a full screen calendar with no other widgets — `/calendar` is a dedicated full-screen surface.
[x] Support a weekly and monthly view — Week and Month tabs on `/calendar`.
[x] Show a user centric view where we can see each family member's commitments in their own column — People tab on `/calendar`.

## Integrations (paused)
Progress notes from the Sep 2026 roadmap pass — paused pending credentials; nothing here is blocked in code.

[] Google calendar integration — paused. Needs OAuth: a Google Cloud project with Calendar API enabled + OAuth client id/secret. The existing iCloud path (`app/lib/calendar/icloud.ts`) shows the shape: encrypted credential storage, per-calendar selection, sync into `calendar_events`, read-only. A Google source would reuse the events table + `/calendar` views as-is; the new work is an OAuth flow, token refresh, and a sync adapter. Member calendarIds already key on calendar id so Google calendars slot into the People view unchanged.
[] Todoist integration — paused. Needs a Todoist API token (simplest) or OAuth app. Design decision deferred: is Todoist a task/chores source, or does it feed the Shopping list? The chores widget already has assignee/member structure if Todoist tasks map to members.
[] Apple photos integration — skipped for now; note competitor DAKboard claims an Apple Photos integration.
[] Google photos integration — paused. Needs Google OAuth (Photos Library API) — shares the Google auth work above. The `/photos` page is a ready shell awaiting a photo source.
