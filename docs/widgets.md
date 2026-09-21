# Homeboard widgets

## What ships

The board is a responsive 12/8/4-column grid with 16px gaps. At 1024 × 768, its usable 960px width gives 309px standard cards. Six 88px rows and five gaps fill 608px; taller displays can grow rows to 112px. Larger boards scroll. Sizes are 4 × 3 standard, 6 × 3 wide, 4 × 6 tall and 8 × 6 large. The 4 × 2 size is reserved for single-metric compositions.

Voice and typed requests create widgets. Opening the same normalised request reuses its saved instance; expired data refreshes before reuse. Keep, unpin, move, resize, refine, refresh, remove and undo operate on the existing instance. Focus temporarily uses an 8/4 split with recipe-library or shopping companions and does not replace the saved board layout. Standard cards expose a full-view action when content exceeds their space.

Recipes keep stable step IDs derived from instruction content. Saved favourites populate the library, and shopping items and checks persist. The calendar card reads a cached, owner-scoped snapshot from a read-only iCloud CalDAV connection. The shopping list syncs both ways with a chosen iCloud reminder list (VTODO collections on the same connection): local adds, checks and clears push to iCloud, and changes made in Reminders pull down on board load when the sync is stale. Spending remains an example.

## Storage and concurrency

- `widget_definitions`: immutable, versioned presentation, scoped to its owner and content hash.
- `widget_instances`: owner, binding, normalised request, progress, preferred size, revision and one reversible change.
- `widget_snapshots`: source-labelled data with freshness and expiry times.
- `widget_placements`: separate saved positions at all three breakpoints.
- `widget_mutations`: idempotency receipts for successful changes.
- `calendar_connections`: encrypted iCloud credential, discovered calendars and reminder lists, the selected shopping list, and sync health for one owner.
- `calendar_events`: the bounded upcoming-event cache rendered by the calendar widget.

Every widget read is scoped to the authenticated Sites identity. Mutations also check the request origin and expected revision. A conditional update and D1 batch gate snapshot and placement changes together. Conflicts reload the current board instead of silently overwriting another screen. Undo restores presentation and layout while retaining current progress. Adding or resizing a widget leaves neighbours' saved slots intact.

The existing recipe schema is preserved. Widget storage is introduced by `drizzle/0001_nasty_mystique.sql`; iCloud connection and event storage are added by `drizzle/0002_volatile_demogoblin.sql`. Recipe favourites retain the existing household-wide store; the current publication is owner-private.

The iCloud app-specific password is encrypted with AES-GCM before storage and is never returned to the browser. Homeboard accepts only Apple CalDAV addresses, discovers event calendars and reminder lists, and reads a rolling 45-day window. The connection UI lets the owner choose calendars, pick a shopping reminder list, sync immediately, or revoke Homeboard's stored credential. Repeating and all-day events are expanded into the cache; failed refreshes preserve the last successful snapshot and show its health.

Shopping sync keeps the widget's snapshot items as the local store, each carrying its CalDAV `uid`, `href`, `etag` and last-seen remote state. Sync pushes new items as VTODOs (`PUT`, `If-None-Match: *`), updates checks by editing the fetched resource (`GET`, `PUT` with `If-Match`), and deletes cleared items (`DELETE`). Remote additions, completions and deletions reconcile down; when both sides changed an item, iCloud wins. Per-item push failures stay unsynced and retry on the next sync; a failed remote delete keeps the item checked for retry.

## Rendering and generation

Trusted React blocks cover text, metrics, charts, lists, steps, comparisons, checklists and columns. Generation uses a strict JSON schema, validates bounds, and separates data values from presentation. A refresh preserves the existing renderer and hierarchy; explicit refinement creates a new definition. Public web sources are recorded when used. Provider failures leave the saved widget intact.

Bespoke visuals run only while focused and visible, in an opaque-origin iframe with a restrictive CSP. They have no host DOM, cookies, storage, network or account credentials. A bounded state bridge accepts only primitive values from the correct frame and nonce. The board and offline view use the readable composition fallback. Failed startup also shows this fallback.

The iframe is a capability boundary, not a CPU quota: JavaScript cannot be given a hard execution budget this way. Keep generated modules small and synchronous, and assess worst-case performance on the target iPad before expanding their capabilities.

## Device cache

Offline permission is explicit per widget. IndexedDB retains only approved copies for 24 hours, partitioned by authenticated owner. Sign-out clears this cache. A service worker caches the app shell and assets, never API responses. Custom code is replaced with its readable fallback in the device copy. Offline cooking progress reconciles against the revision it started from; conflicting server progress wins. Other offline changes require reconnection.

## Verification

Run from the site directory:

```sh
npx tsc --noEmit
node --test tests/widgets.test.mjs tests/calendar.test.mjs tests/widgets-integration.mjs
```

The route tests execute the actual widget handlers against SQLite with a small D1 adapter and the real migrations. They cover persisted state, retries, conflicting revisions, owner/origin isolation, recipe favourites, cooking progress, undo, size constraints and shopping deduplication. Pure tests exercise packing and untrusted generation validation. A real model request has also generated an interactive widget and a repeat request reused its saved ID.

Production builds use the Sites build helper. Target-device Safari, microphone interaction and a complete offline reload still need hands-on verification. The original screen remains accessible with `?legacy=1` for comparison.

## Deliberate limits

Additional household connectors, cross-instance generation locks, semantic matching of differently worded requests, background refresh jobs and model-generated repair retries are not implemented. iCloud refresh runs when the cached calendar is opened after 15 minutes or the owner requests it; there is no independent background poller. A board currently allows 30 active widgets. There is one level of presentation undo. These limits keep the first release understandable while the persistence and rendering contracts settle.
