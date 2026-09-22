# AGENTS.md

## Reference material

Past research, plans, and design explorations live as Lavish HTML artifacts in `.lavish/` (gitignored, local to this machine). Consult these before related work:

- `.lavish/competitor-analysis.html` — Competitor analysis of the family command center space (Skylight, DAKboard, myhomeboard.app, Kinboard, et al.). Key findings: Homeboard's differentiator is authenticated connectors (Browser Run + handoff); DAKboard is the feature benchmark; Kinboard is the closest architectural analog; the "HomeBoard" name is commercially taken by myhomeboard.app. Read this before any positioning, feature-prioritization, or connector work.
- `.lavish/homeboard-connections-proposal.html` — connections/connector design proposal
- `.lavish/homeboard-poc-plan.html`, `.lavish/homeboard-recipe-plan.html`, `.lavish/homeboard-widgets*.html` — earlier plans and widget explorations
- `.lavish/*.png` — screenshots of prior board states and design options

## Evals

`evals/` is a human-in-the-loop scenario suite (not CI): scripted conversations driven through the real OpenAI realtime session, with tool calls executed against the local dev backend and expectations checked by an LLM judge + board-state assertions. See `evals/README.md` for format. Key points:

- Run: `cd evals && npm install` once, then `node run.mjs <scenario>` (or `npm run eval -- <id>`) with the dev server up.
- Isolation: each run gets a fresh board owner via the dev-only `x-homeboard-eval-owner` header (`ownerFor` honors it only on localhost). Never run eval steps against the real `homeboard-local-development` owner — writes would land on the real board.
- `requires: [...]` gates steps on unbuilt capabilities (`tool:<name>` auto-resolves against `SESSION_CONFIG` in `app/api/realtime/session.ts`, which the app and evals share); unbuilt steps report `blocked`, not `fail`.
- Browser steps (`--with-browser`) reuse `spike/browser/chrome-profile`; `golf-login` auto-fills `GOLF_USERNAME`/`GOLF_PASSWORD` from `evals/.env`, then falls back to a human handoff.
