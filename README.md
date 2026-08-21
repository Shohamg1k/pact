# PACT

**An AI operating system for software delivery.** PACT turns a single plain-language
brief into a coherent, connected package built by up to 7 specialist AI agents —
Product Manager, Solution Architect, UI/UX, Backend, Frontend, QA, and Documentation —
each agent's output becoming the real, verified input of the next. Built for
Rockathon'26 PS2 (see [PRD.md](./PRD.md) for the full spec).

The core guarantee: a downstream agent can't fake having used an upstream agent's work.
Backend's schema pins `contractHash = sha256(the Architect's exact artifact)` — a
byte-for-byte, checkable proof the handoff is real, not just prompted.

## What it actually does

- **Type one brief.** If it's underspecified, PACT asks one clarifying question (capped
  at 2 rounds) instead of guessing silently.
- **Pick any combination of agents** with a valid handoff — the dependency graph is
  enforced server-side, so an unsatisfiable request (e.g. QA before Backend has ever
  run) is rejected before any model call, not after.
- **The Architect's output is a real, interactive system**: an architecture diagram and
  a database schema diagram, both click-to-inspect with cross-highlighting — not a
  static image.
- **The Backend agent's code actually runs.** It's npm-installed, booted against a real
  (in-memory) database, and proven to answer real HTTP requests before the run is
  called done. A "Test with frontend" view gives you a working tester for every declared
  endpoint the moment Backend commits — no extra agent run required.
- **Every generated file is a real file** — viewable and editable in a Monaco editor,
  mirrored live into a real folder on your own filesystem if you link one.
- **Verification gates, not vibes.** Generated code is syntax-checked, checked for drift
  against the contract (a module that implements nothing it was contracted to is
  rejected outright), and its declared endpoints are exercised live with real HTTP
  assertions.
- **Real exports, gated behind your approval**: a GitHub PR against the generated code,
  a Postman collection + OpenAPI spec, a Miro board, a Slack summary. Nothing external
  happens until you explicitly approve it in the Inbox.

## Prerequisites

- **Node.js 18+**
- **The `claude` CLI**, installed and authenticated (`claude -p "hello"` should work
  from your terminal) — this is the model adapter PACT drives by default
- **`git`**, and **`gh`** (GitHub CLI, authenticated via `gh auth login`) if you want the
  GitHub export connector to work
- Optional, only if you want these specific exports to work live:
  - `MIRO_ACCESS_TOKEN` env var, for the Miro board connector
  - `SLACK_WEBHOOK_URL` env var, for the Slack summary connector

## Quick start

```bash
npm install
node server/index.js        # daemon on :4300 (or set PACT_PORT)
npm run dev -w web           # UI on :5173 (proxies /api to :4300)
```

Then open **http://localhost:5173**, type a brief (e.g. "Build a small inventory system
for my restaurant — track stock levels and supplier orders"), pick Solution Architect +
Backend from the agent picker, and hit Generate.

For convenience, the same two commands are also available as `npm run dev:server` /
`npm run dev:web` from the repo root. `npm run build` builds the production web bundle.

**Running more than one instance at once** (e.g. testing while a demo copy is up): set
`PACT_PORT` and `PACT_WEB_PORT` to different values for each pair —
`web/vite.config.js` reads both, so its dev-server proxy always targets the matching
daemon.

## How the pieces fit together

- `server/index.js` — the Express daemon; the only writer to `.pact/`, PACT's canonical
  file-based store (`.pact/chats/<id>/{chat.json, artifacts/<role>.json, jobs/…}`)
- `server/agents/` — the 7 agent implementations, all built on one shared repair-loop
  engine (`engine.js`), with the dependency DAG declared in `registry.js`
- `server/router.js` — model call routing with loss-free failover: if a rung fails
  mid-generation, the next rung gets the exact partial output plus instructions to
  continue rather than restart
- `server/runner.js` — boots a generated backend for real (installs dependencies,
  starts an in-memory database, proves a live HTTP round trip) and keeps a persistent
  preview running for the UI's API console / tester
- `server/gates/` — verification tiers: syntax, drift/conformance against the contract,
  and live contract-test execution
- `server/connectors/` — the four export integrations, each gated behind Inbox approval
  (`server/gate.js`)
- `web/src/shell/Workbench.jsx` — the 4-pane UI shell (chat/project sidebar,
  conversation, tabbed outputs, file rail), everything else in `web/src/tabs/` and
  `web/src/components/` are the per-role viewers

## Tests

```bash
npm test
```

Runs every `server/**/*.selftest.mjs` file (`server/run-selftests.mjs`) as its own
process and reports a pass/fail summary — 16 files covering the agent registry/DAG,
router failover, gates, connectors, the runner, and more. Several do real work (npm
install a generated backend, boot it, hit it over HTTP), so the full suite takes under
a minute but isn't instant.

## Demo fixtures

```bash
node server/fixtures/run.mjs happy-path      # brief -> architect+backend -> live preview -> real HTTP calls -> contract tests
node server/fixtures/run.mjs vague-brief     # exercises the clarify-or-assume loop
node server/fixtures/run.mjs failover        # kills a live CLI adapter mid-run, proves loss-free router failover
node server/fixtures/run.mjs drift-rejection # deterministic: a scope-violating artifact must be rejected
```

Each fixture drives the real `orchestrator.js` / `kernel/chats.js` entry points — there
is no separate "demo mode" code path. `happy-path` and `failover` make real CLI calls
and take several minutes; `drift-rejection` is deterministic and takes under a second.

## Known limitations (stated honestly, not hidden)

- **Java generation has no build tool available in this environment** — it's generated
  and syntax-checked, but can't be booted live here (no Maven/Gradle installed). Node
  (Express), Python (FastAPI), and Django are all fully runnable.
- **Skills, Plugins, and Customize are not implemented.** They're on the roadmap and
  named in Settings, but explicitly labelled "not built" rather than given a fake UI.
- **A single large brief can exceed one model call's time budget.** Very large scope in
  one shot (e.g. two full business domains plus a full accounting subsystem) can run
  into the CLI's 15-minute timeout on the Backend agent. Scoping a brief tightly (one
  clear vertical slice) generates far more reliably than a maximally ambitious one.
- **Failover has one real adapter configured by default.** The loss-free failover
  mechanism itself is proven via fault-injection tests against the real router code
  (`server/router.selftest.mjs`); exercising it against a second *live* model provider
  needs a second adapter's credentials (`agy` CLI or an `OPENROUTER_API_KEY`).
- **If this project lives inside a two-way-synced cloud folder (OneDrive, Dropbox,
  etc.), pause sync before running it.** `.pact/` is git-ignored (machine-specific
  runtime state), so a sync engine can interpret its absence on another synced device
  as a deletion and propagate that back — this has been observed to delete chat data
  live. Keeping the repo outside any synced folder avoids the class of bug entirely.
