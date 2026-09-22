# Roadmap

Ideas we'd like to pursue, roughly in the order they might be tackled. Nothing here is committed; this file is a parking lot for good intentions.

## Ops
[x] Is our test suite sufficient to ensure the CI loop is helping Devin to get work done effectively? Do not write a bunch of slop tests, just make sure we have a few concise tests running that give us confidence in our changes — `npm run check` runs typecheck + the node:test suite (23 tests covering layout packing, generated-widget validation, calendar/weather/shopping/ingest, family members and chores).

## Design
[~] I'm not happy with the plain white widgets - look at apple widgets as inspiration, they are colourful (consistent with gradients and restricted on what colours they can use). I also suggest to include a big icon at the top right of each widget. e.g. for the golf widget, a big beautiful golf ball icon in the top right + a nice green gradient background colour. — Mockup in `.lavish/widget-redesign.html`, under review; implementation follows approval.
[x] Main navigation - a top bar or a sidebar to always get to calendar view, photo slideshow, or dashboard view. — `SiteNav` tabs (Board / Calendar / Photos) in the board header and each view.

## Native features
[x] Add ability to enter in all family member names + an avatar for each - today this can affect the calendar view when grouping by user - in future this could mean only family members should be able to talk to homeboard — `/family` page manages name + emoji avatar + colour + linked calendars; agenda rows and the People view use them.
[x] Chores widget - utilisng the family member names (users) feature above — Chores widget with per-row assignee chips, touch add row, "start a new round" reset, and a voice `add_chore` tool.
[x] User defined widgets - mostly done - see USER_DEFINED_WIDGETS.md - it's still listed as a spike — `/api/ingest` + golf connector are live; `install-golf-sync.sh` schedules the sync daily via launchd. Remaining: point `INGEST_URL`/`HOMEBOARD_OWNER` at the deployed app.

## Calendar improvements
[x] Full screen view should show a full screen calendar with no other widgets — `/calendar` is a dedicated full-screen surface.
[x] Support a weekly and monthly view — Week and Month tabs on `/calendar`.
[x] Show a user centric view where we can see each family member's commitments in their own column — People tab on `/calendar`.

## Integrations
[] Google calendar integration — needs OAuth credentials (Google Cloud project + client id/secret)
[] Todoist integration — needs a Todoist API token or OAuth app
[] Apple photos integration — skipped for now; note competitor DAKboard claims an Apple Photos integration
[] Google photos integration — needs OAuth credentials; feeds the `/photos` slideshow
