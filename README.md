# PACT

Pluggable Agent Contract Transfer — Rockathon'26 PS2. See [PRD.md](./PRD.md) for the full spec.

## Quick start
```bash
npm install
node server/index.js        # daemon on :4300 (or set PACT_PORT)
npm run dev -w web           # UI on :5173 (proxies /api to :4300; set PACT_WEB_PORT/PACT_PORT to run another instance alongside)
```
Or, for convenience: `npm run dev:server` / `npm run dev:web` from the repo root (same
two commands, just shorter). `npm run build` builds the web bundle.

## Tests
```bash
npm test
```
Runs every `server/**/*.selftest.mjs` file (`server/run-selftests.mjs`) as its own
process and reports a pass/fail summary — currently 16 files covering the agent
registry/DAG, router failover, gates, connectors, the runner, and more. Several of
these do real work (npm install a generated backend, boot it, hit it over HTTP), so
the full suite takes under a minute but isn't instant.

## Demo fixtures
```bash
node server/fixtures/run.mjs happy-path      # brief -> architect+backend -> live preview -> real HTTP calls -> contract tests
node server/fixtures/run.mjs vague-brief     # exercises the clarify-or-assume loop
node server/fixtures/run.mjs failover        # kills a live CLI adapter mid-run, proves loss-free router failover
node server/fixtures/run.mjs drift-rejection # deterministic: a scope-violating artifact must be rejected
```
Each fixture drives the real `orchestrator.js`/`kernel/chats.js` entry points — there is
no separate "demo mode" code path. `failover` and `happy-path` make real CLI calls and
take longer; `drift-rejection` is deterministic and fast.

## Branches
| Branch | Scope |
|---|---|
| `main` | integration — all tracks merge here |
| `feat/core-pipeline` | kernel, agents, router, gates |
| `feat/ui-theatre` | the workbench UI (sidebar, chat/project nav, viewers, editor, previews) |
| `feat/runner-connectors` | runner, stacks, connectors, demo fixtures |

Each branch owns disjoint directories — see PRD §6 for the full layout.
