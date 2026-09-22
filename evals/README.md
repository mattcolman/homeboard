# Homeboard scenario evals

Human-in-the-loop end-to-end scenarios for Homeboard. Each scenario is a
scripted conversation (plus real-world actions) with expectations — part test
suite, part spec for features that don't exist yet.

This is **not** a CI suite: scenarios need a running dev server, a live OpenAI
realtime session, and occasionally a human at the keyboard (logins, CAPTCHAs).
Run it deliberately, not on a schedule.

## How it works

```
scenario (.mjs) ──► run.mjs ──► RealtimeSession ──► OpenAI realtime API
                     │            (text turns, real SESSION_CONFIG,
                     │             real tool decisions)
                     │
                     ├─► ToolExecutor ──► local dev server (/api/widgets,
                     │     mirrors the      /api/recipes — as the browser
                     │     client in        client would)
                     │     page.tsx
                     ├─► actions (browser login, ingest pushes, shell)
                     ├─► judge (LLM rubric grading for soft expectations)
                     └─► human steps (readline prompt, Enter/f/s)
```

Every run uses a fresh board owner (`eval-<scenario>-<ts>` via the dev-only
`x-homeboard-eval-owner` header that `ownerFor()` honors on localhost), so
scenarios never touch your real board. The eval imports the app's real
`SESSION_CONFIG` — when a tool like `connect_source` or `read_widget` ships,
steps gated on `tool:<name>` unblock themselves.

## Running

```sh
cd evals && npm install
cp .env.example .env       # fill in keys (or rely on repo .env.local)
npm run dev                # in the repo root — the app under test
node evals/run.mjs shopping-add
node evals/run.mjs golf-handicap-known
node evals/run.mjs golf-handicap-connect --with-browser
node evals/run.mjs all     # or: npm run eval -- <id> from the repo root
```

Flags: `--owner <id>` pin the eval board · `--with-browser` allow headed
Chrome steps · `--verbose` tool-call/session logging · `--non-interactive`
skip human prompts (human steps report `skipped`).

## Result statuses

| status    | meaning                                                        |
| --------- | -------------------------------------------------------------- |
| `pass`    | expectation met                                                |
| `fail`    | expectation unmet — real regression signal                     |
| `blocked` | needs an unbuilt capability (named in output) — spec, not fail |
| `skipped` | operator or `--non-interactive` skipped it                     |
| `note`    | narrative marker in the transcript                             |

Exit code is 1 only on `fail`. Full transcripts (every realtime event, tool
I/O, judge reasons, facts) land in `evals/results/`.

## Scenario format

`scenarios/*.mjs` default-exports `{ id, title, description, browser?, steps }`.
Steps run in order:

```js
{ say: 'Hey Homeboard, what’s my golf handicap?' }   // text turn into the session
{ expect: [ /* assertions on the last reply */ ] }
{ expect_state: [ /* assertions on the board */ ] }
{ action: 'golf-sync' }                               // named action, may set facts
{ human: 'Log in to golf.com.au in the open window' } // operator handoff
{ run: 'shell command' }                              // escape hatch
{ note: 'commentary for the transcript' }
```

`{ requires: [...] }` on a step or assertion marks it blocked when the
capability is missing (`tool:<name>` auto-resolves against SESSION_CONFIG;
other keys live in `capabilities.mjs`).

### Turn assertions (`expect`)

- `{ judge: '<rubric>' }` — LLM judge grades reply + tool calls strictly
- `{ tool_called: 'name' }` or `{ name, args: {…} }`
- `{ no_tool_call: true }`
- `{ reply_includes: 'text' }`, `{ reply_matches: /re/ }`,
  `{ reply_not_matches: /re/ }`, `{ reply_max_words: 12 }`

### Board assertions (`expect_state`)

- `{ title|kind|id: '…', exists: bool, binding_source: 'golf',
   snapshot_includes: 'text'|/re/, snapshot_not_includes: 'text'|/re/ }`

`${facts.x}` and `${env.KEY}` interpolate into strings (facts are set by
actions, e.g. the real handicap captured by `golf-sync`).

## The login step is automated — mostly

`golf-login` reuses the spike's persistent-profile headed Chrome. If the
session is alive it returns immediately; otherwise it auto-fills
`GOLF_USERNAME`/`GOLF_PASSWORD` from `evals/.env`, and only falls back to a
human handoff on CAPTCHA/MFA/unknown forms. Credentials stay local and
gitignored.

## Adding a scenario

Copy an existing file. Rules of thumb: assert behaviour, not phrasing;
`judge` for fuzzy expectations, state assertions for facts; gate anything
unbuilt with `requires` so the eval stays honest and self-unblocking.
