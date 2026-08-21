# PACT — Product Requirements Document

**A deterministic kernel between two specialist agents.** One plain-language brief in, a running MERN backend out — where every endpoint traces to a named feature, nothing is invented, nothing is silently dropped, and every guarantee is plain code.

| | |
|---|---|
| **Version** | 3.0 — build spec |
| **Status** | Approved for implementation |
| **Problem statement** | Rockathon'26 PS2 — AI Operating System Engineering |
| **Build window** | Grand Finale, Aug 22 2026 · 4 builders · ~8h |
| **Surface** | Local web app (Node daemon + React) + thin CLI |
| **Target repo** | `github.com/Shohamg1k/pact` (empty — clean build) |
| **Reference repo** | `github.com/Shohamg1k/agenticteam` (port proven modules — §20) |

**Priority key** — `P0` must exist to demo · `P1` build if on schedule · `P2` post-finale

> **THE ONE RULE:** every pipeline run activates **exactly two AI agents, strictly sequential** — Solution Architect → Backend Engineer. Everything else in this document is deterministic code and must never be described as an agent.

---

## Contents

**Part I — Product** · [1 Problem & thesis](#1-problem--thesis) · [2 Goals & principles](#2-goals-non-goals-principles) · [3 Users](#3-users--jobs)
**Part II — Architecture** · [4 System](#4-system-architecture) · [5 Stack](#5-tech-stack) · [6 Repo layout](#6-repository-layout) · [7 Data model](#7-data-model) · [8 Kernel contract](#8-the-kernel-contract) · [9 Adapter contract](#9-the-adapter-contract) · [10 State machines](#10-state-machines) · [11 API surface](#11-api-surface) · [12 Error taxonomy](#12-error-taxonomy)
**Part III — Features** · [13 Core pipeline](#13-core-pipeline) · [14 Model routing](#14-model-routing) · [15 Context engine](#15-context--cost-engine) · [16 Verification](#16-verification) · [17 UI shell](#17-ui-shell) · [18 Connectors](#18-connectors) · [19 CLI & security](#19-cli--security)
**Part IV — Delivery** · [20 Reference port](#20-reference-port) · [21 Workstreams](#21-workstreams) · [22 Hour-by-hour](#22-hour-by-hour-finale-plan) · [23 Acceptance criteria](#23-acceptance-criteria) · [24 Test plan](#24-test--verification-plan) · [25 Metrics](#25-success-metrics) · [26 Risks](#26-risks) · [27 Judge defence](#27-judge-defence) · [28 Open questions](#28-open-questions)

---
---

# Part I — Product

## 1. Problem & thesis

### The problem
Building software means passing work between specialists. Every handoff is a translation, and translations lose information **silently rather than loudly** — the loss surfaces days later as rework.

Agent tools reproduce this exact failure: they chain prompts, one model's prose becoming the next model's prose input, with nothing in between checking that the second agent honored the first. Coherence is hoped for, not enforced. Three consequences:

1. **Silent drift.** Agent 2 invents scope Agent 1 never specified, or quietly drops scope Agent 1 did specify. Nothing detects either.
2. **Unverifiable output.** The human is the first thing that runs the code.
3. **Cost opacity.** Context is dumped rather than assembled; tokens are spent before anyone decides the work is worth doing.

### The thesis
Treat the handoff the way an operating system treats processes.

The two agents **never talk to each other**. They read and write one typed, schema-validated artifact through a kernel that owns memory, validation, provenance, and interrupts.

> **The model does judgment. Deterministic code owns every guarantee.**

An LLM interprets an ambiguous brief and writes code — genuinely hard judgment work. A JSON-Schema validator, a syntax parser and a test runner decide whether the result is acceptable — work that must never be probabilistic.

### Decisions locked (from scoping)
| Area | Decision |
|---|---|
| Scope | Round 2 MVP — the finale checklist |
| Platform | Local web app; Node/Express daemon + React (Vite), all at localhost |
| Agent execution | **CLI adapters, registry-driven** — `claude` CLI, `agy` CLI headless; OpenRouter HTTP rung |
| Multi-model | **Ladder** — one model per agent per run; failover continues from worklog |
| Memory | Worklog + attempts · project memory across runs · semantic dedupe cache |
| Gates | Schema + completeness + coverage + orphan + syntax + conformance + **boot** |
| Generated app | Backend + seeded in-memory Mongo + **live preview console** |
| Database (generated app) | `mongodb-memory-server` — no install, no network |
| Connectors | GitHub PR · Miro board · Postman/OpenAPI · Slack |
| Demo | All four scenarios: happy path · vague brief · failover · drift rejection |
| Team | 4 builders split by layer |
| Codebase | JS + ESM, single repo, npm workspaces, zod, Vite |

---

## 2. Goals, non-goals, principles

### Goals
| # | Goal | Measured by |
|---|---|---|
| G1 | One plain-language brief produces a **running** backend, not a document. | Server boots and answers a real request, live |
| G2 | Agent 2's output is verified before any human reads it. | Verified-before-human rate = 100% (both tiers run) |
| G3 | No context loss when a model dies mid-run. | Failover context-loss incidents = 0 |
| G4 | Every generated file traces to a contract element, both directions. | Zero orphans, zero uncovered APIs at the gate |
| G5 | A judge can verify the two-agent claim from the artifacts alone. | Hash diff + pack grep, on stage |

### Non-goals
- **Not a general agent platform.** The pipeline is fixed (Architect → Backend); there is no planner, no task DAG, no classifier — a fixed pipeline is the compliance requirement.
- **Not a hosted service.** Everything runs on the demo laptop.
- **Not an IDE.** One screen, not a tab system.
- **No third agent.** Not for verification, not for routing, not for "just a helper".

### Design principles
These are decision rules. Where a requirement below looks surprising, one of these is why.

| # | Principle | Consequence |
|---|---|---|
| P1 | **Guarantees are deterministic.** | Gates are plain code. No model judges its own homework. (§8.2) |
| P2 | **The handoff is a typed artifact.** | Agents exchange schema-validated files, never chat transcripts. (§8.1) |
| P3 | **Files are truth.** | If a feature dies when you delete a JSON file, it is wrong. SQLite is a rebuildable index. (§7) |
| P4 | **Degrade, don't fail.** | Partial upstream output → partial downstream work **plus an explicit gap list**, never a silent hole. (§10) |
| P5 | **Bounded loops.** | Every repair/clarification has a hard cap, then proceeds on record. (§8.4) |
| P6 | **Cheap before expensive.** | Syntax verify before `npm install`; validation before the next model call. (§16) |
| P7 | **Nothing mutating without a gate.** | Connector writes pass one middleware, enforced server-side. (§19) |

### Non-negotiables (enforced, not aspirational)
1. `gates/`, `runner/`, `router/`, `connectors/`, `trace/` **import no model client**. Add a CI grep asserting it.
2. `adapters/` is the only module allowed to spawn a CLI or make an outbound model call.
3. The daemon is the only writer to `.pact/`.

---

## 3. Users & jobs

| User | Situation | Job | PACT delivers |
|---|---|---|---|
| **Consultancy lead** (primary) | Client sends a one-line brief; two weeks to design + build | Brief → design + running code, in sync | The whole pipeline |
| **Pre-CTO startup** | No architect on staff | A defensible system design they can hand to a contractor | Contract + trace matrix |
| **Delivery team** | Diagram and code disagree | Prove which parts drifted | Gate V2 + trace matrix |
| **The judge** | 20 decks seen, sceptical | Verify the two-agent claim in 60 seconds | Hash diff, pack grep, live 403 |

### Primary user story
> As a consultancy lead, when a client sends me a one-line brief, I want two connected agents to produce a system design and a working API where every endpoint traces back to a named feature and every business rule has a passing check — so I can quote the work with confidence instead of spending two weeks discovering that the design and the spec never agreed.

---
---

# Part II — Architecture

## 4. System architecture

```
   +-----------------+        +------------------+
   |  React shell    |        |  CLI (`pact`)    |     peer clients,
   |  (run theatre)  |        |                  |     identical authority
   +--------+--------+        +---------+--------+
            |    HTTP + SSE             |
            +-------------+-------------+
                          |
   =====================================================
   |               CORE DAEMON (Node/Express)          |
   |   +---------------------------------------+       |
   |   |  GATE MIDDLEWARE (connector writes)   |       |
   |   +-------------------+-------------------+       |
   |   |  KERNEL: artifact store · validator   |       |
   |   |          provenance · interrupts      |       |
   |   +-------------------+-------------------+       |
   |   | adapters | pack | gates | runner | trace |    |
   |   +---------------------------------------+       |
   =====================================================
        |            |           |            |
   .pact/ files   CLI agents   generated/   connectors
   (TRUTH)        (2 only)     app + Mongo  (gated)
```

### Data flow for one run
```
1. Brief text          -> POST /api/runs                         [deterministic]
2. Pack builder        -> agent1 pack (stable prefix first)      [deterministic]
3. AGENT 1 (Architect) -> architecture.json                      [MODEL #1]
4. Gate V1             -> schema + coverage + orphan + score     [DETERMINISTIC]
   |- fail -> repair prompt (max 2) -> re-validate
   |- score < 0.7 -> ONE clarifying question -> human answers
   `- pass -> spec files committed + hashed
5. Pack builder        -> agent2 pack = spec files VERBATIM      [deterministic]
6. AGENT 2 (Backend)   -> backend.json (files + implements[])    [MODEL #2]
7. Gate V2 tier 1      -> syntax parse (esbuild)                 [DETERMINISTIC]
8. Gate V2 tier 2      -> coverage · drift · conformance         [DETERMINISTIC]
9. Gate V2 tier 3      -> npm install · boot · contract tests    [DETERMINISTIC]
10. Trace + connectors -> trace.json, Miro, PR, Postman, Slack   [deterministic, gated]
```
**Steps 1, 2, 4, 5, 7, 8, 9, 10 contain no model calls. That is the guarantee.**

---

## 5. Tech stack

| Layer | Choice | Rationale |
|---|---|---|
| Language | **JavaScript + ESM** (no TS build step) | Hackathon speed; zero tsc friction under time pressure |
| Daemon | Node 20+, Express, **SSE** for run events | Route middleware is the gate boundary; SSE is trivial vs websockets |
| Schemas | **zod** (mirrors to JSON Schema) | One object is both the prompt schema and the validator |
| Syntax verify | **esbuild** `transform()` | Parses JS/JSON in-process, no install, no network |
| State | `.pact/` files (truth) + optional SQLite index (P2) | P3: files are truth |
| UI | React + Vite, hand-rolled CSS | One screen; no component library to fight |
| Generated app | Express + Mongoose + `mongodb-memory-server` | MERN by default; zero-install DB |
| Process control | `node:child_process` + timeout + kill | No orphaned children |
| Connectors | `gh` CLI · Miro REST · file write · Slack webhook | Deterministic exporters, MCP-shaped |

### Stack non-negotiables
1. The kernel validator imports **no model client** (CI-checked).
2. Adapters are the only outbound-model module.
3. Nothing writes to the user's real repo — the generated app lives inside `.pact/runs/<id>/generated/`.

---

## 6. Repository layout

```
pact/
├─ package.json                  # npm workspaces: ["server","web"]
├─ PRD.md                        # this file
├─ server/
│  ├─ index.js                   # express + SSE + gate middleware
│  ├─ orchestrator.js            # the run state machine (§10)
│  ├─ kernel/
│  │  ├─ store.js                # .pact/ read/write + sha256      (P3)
│  │  ├─ validator.js            # 3-pass deterministic validation (§8.2)
│  │  ├─ provenance.js           # element_path -> traced_from     (§8.5)
│  │  └─ interrupts.js           # bounded clarification           (§8.4)
│  ├─ adapters/
│  │  ├─ registry.js             # DECLARATIVE CLI config table    (§9)
│  │  ├─ spawn.js                # ONE shared spawn/probe/timeout
│  │  └─ openrouter.js           # HTTP rung
│  ├─ router.js                  # ladder · ledger · cooldown · failover
│  ├─ agents/{architect.js,backend.js}
│  ├─ prompts/{architect.md,backend.md}
│  ├─ schemas/{contract.js,backend.js}
│  ├─ gates/{v1.js,v2.js,verify.js,conformance.js,contracttests.js}
│  ├─ pack.js                    # budgeted, stable-first packs
│  ├─ memory.js                  # worklog · project memory · cache
│  ├─ runner.js                  # write tree · install · boot · probe · proxy
│  ├─ trace.js                   # trace matrix, both directions
│  └─ connectors/{github,miro,postman,slack}.js
├─ cli/pact.mjs                  # snapshot · answer · ack (thin HTTP client)
└─ web/src/
   ├─ App.jsx  RunTheatre.jsx  SpecViewer.jsx  CodeViewer.jsx
   ├─ TraceMatrix.jsx  PreviewConsole.jsx  CostStrip.jsx  Inbox.jsx
   └─ api.js
```

---

## 7. Data model

**Files are truth (P3).** SQLite, if built at all, is a rebuildable index for the run list.

```
.pact/
├─ project-memory.json                  # persists across runs
├─ cache/<sha256>.json                  # semantic dedupe cache
└─ runs/<runId>/
   ├─ run.json                          # status, phases, timings, models used
   ├─ requirement.md                    # the brief, VERBATIM
   ├─ architecture.json                 # ← THE HANDOFF (hashed)
   ├─ openapi.yaml                      # derived deterministically
   ├─ schema.mongo.json                 # derived deterministically
   ├─ decisions.md
   ├─ backend.json                      # file manifest + implements[]
   ├─ trace.json                        # matrix + reverse index
   ├─ provenance.json                   # element_path -> traced_from
   ├─ inbox.jsonl                       # decisions owed by the human
   ├─ worklog.jsonl                     # every step/attempt/error/model
   ├─ packs/{agent1,agent2}.txt         # EXACT bytes sent to each model
   ├─ raw/{agent1,agent2}-attempt-N.txt # raw model output
   └─ generated/                        # the runnable backend
      ├─ package.json server.js db.js seed.js
      ├─ models/*.js routes/*.js tests/contract.test.mjs
```

**Record shapes**

```js
// run.json
{ id, projectId, status, brief, createdAt,
  phases: [{ name:'agent1'|'gateV1'|'agent2'|'gateV2'|'run'|'connectors',
             status:'pending'|'running'|'passed'|'repairing'|'failed',
             adapter, model, attempts, startedAt, endedAt, error }],
  contractHash, gaps: [], assumptions: [] }

// worklog.jsonl (append-only)
{ ts, phase, adapter, model, event:'call'|'repair'|'failover'|'gate'|'boot', detail }

// inbox.jsonl — one queue for everything the human owes (§8.4, §19)
{ id, type:'clarification'|'connector_write'|'review', payload, status, round, tainted, createdAt }

// provenance.json
{ artifact:'backend', entries:[{ element_path:'/files/3', traced_from:'API-04' }] }
```

---

## 8. The kernel contract

The kernel is what makes this an operating system rather than a prompt chain. It owns four things.

### 8.1 Shared memory — the typed artifact
Agents never receive each other's prose. Agent 2 receives a validated JSON document (plus its deterministic derivatives). See §13.2 for the full zod schema; the shape:

```jsonc
{
  "meta":    { "schema": "arch-contract/v1", "id": "...", "completeness_score": 0.78 },
  "stack":   { "default": "MERN", "db": "mongodb", "api": "express" },
  "features":[{ "id": "F-01", "name": "Book a test", "priority": "must" }],
  "assumptions":[{ "id":"AS-02", "statement":"analyzers out of scope",
                   "confidence":0.6, "source":"brief-silence" }],
  "business_rules":["BR-01: report released only after payment"],
  "collections":[{ "id":"C-01", "name":"bookings", "fields":["slot_id unique","mode","status"] }],
  "apis":    [{ "id":"API-04", "feature_id":"F-03",        // ← provenance, REQUIRED
                "method":"GET", "path":"/reports/:id",
                "response":{"pdf_uri":""}, "errors":[403],
                "rules":["403 until paid_at set — BR-01"] }]
}
```

### 8.2 Validation — deterministic, no model
The validator runs **four passes, all plain code**:

| Pass | Check | Error code |
|---|---|---|
| 1. Schema | zod parse against the declared `schema` | `SCHEMA_INVALID` |
| 2. Coverage | every `features[].id` cited by ≥1 `apis[].feature_id` | `FEATURE_UNCOVERED` |
| 3. Orphans | every `apis[].feature_id` / rule reference resolves to a real element | `ORPHAN_ELEMENT` |
| 4. Completeness | `completeness_score ≥ 0.7` | `UNDERSPECIFIED` |

Pass 2 catches **silently dropped scope**. Pass 3 catches **silently invented scope**. These are the two failure modes from §1, now mechanical.

**On failure:** a targeted repair prompt quoting the exact validator error, capped at **2 retries**, then escalate the ladder rung; on exhaustion the artifact is committed with a `gaps[]` list and downstream proceeds on the valid subset (P4).

### 8.3 Syscalls — the only inter-agent surface
Agents cannot address each other. The orchestrator exposes three calls:

```js
read(kind, runId)        // -> latest VALIDATED artifact only. Never unvalidated.
write(kind, body)        // -> runs §8.2 before commit; returns ValidationResult
ask(question, context)   // -> Inbox ticket, bounded by §8.4
```
`read` **never returns an unvalidated artifact.** That single rule is what "Agent 2 only sees what survived validation" means in code.

### 8.4 Interrupts — bounded clarification
```
round 0 -> ask allowed -> human answers -> Agent 1 revises -> re-validate
round 1 -> ask allowed -> human answers -> Agent 1 revises -> re-validate
round 2 -> REFUSED. Run proceeds, records the assumption, marks unresolved
           elements BLOCKED_ON_UPSTREAM.
```
The cap lives on the Inbox row (`round`), not in model memory — it survives restarts and cannot be argued away by a model. In batch mode the run never blocks: it proceeds with every low-confidence assumption banner-flagged.

### 8.5 Provenance
Every generated file records the contract IDs it implements; the kernel inverts that into `provenance.json` so the trace is navigable **both directions**:
- forward: `feature F-03 → API-04 → routes/reports.js → contract test`
- reverse: `routes/reports.js → API-04 → F-03 → the client's words`
A file citing nothing is `ORPHAN_ELEMENT` and is rejected **by name**.

---

## 9. The adapter contract

```js
/** The ONLY module allowed to call a model. */
export interface Adapter {
  id, name, kind: 'cli'|'http', tier: number,
  available: boolean, cooldownUntil?: number,
  probe(): Promise<void>,                       // -> UI availability badge
  complete(prompt, ctx): Promise<string>,       // ctx = { runId, phase }
}
```

### Failover semantics — the critical rule
```js
async function completeWithLadder(prompt, ladder, ctx) {
  for (const a of ladder) {
    if (!a.available || onCooldown(a) || !hasQuota(a.id, a.limits)) continue;
    try { return await a.complete(prompt, ctx); }
    catch (e) {
      if (isUsageLimitError(e.message)) startCooldown(a, 15 * 60_000);
      appendWorklog(ctx.runId, { adapter: a.id, event: 'failover',
        detail: e.message, partial: e.partial });        // ← partial output captured
      continue;                                          // next rung gets pack + worklog
    }
  }
  throw new PactError('NO_CAPACITY', { ladder: ladder.map(a => a.id) });
}
```
The next rung receives the **same pack plus the worklog plus the partial output**, with the continuation instruction:
> *"Continue seamlessly from the furthest good state above — same goals, same structure, same conventions. Do NOT restart unless the partial work is unusable, and say so explicitly if you do."*

No truncation, no summarization, no restart. **This is the whole of loss-free failover and it must survive every refactor.**

### CLI-agent registry — config, not code
These configs are **live-verified against the real binaries** in the reference repo. Every flag below fixes a real bug. Do not "clean them up".

```js
export const CLAUDE_CFG = { bin:'claude', args:['-p','--output-format','text'], promptVia:'stdin' };

export const AGY_CFG = {
  bin:'agy',
  args:['-p'],
  promptVia:'argv',       // BUG 1: agy's -p needs the prompt as ITS argv value. With stdin it
                          //   swallowed the NEXT token (the permission flag) as "the prompt".
  shell:false,            // BUG 2: agy is a native Go exe; shell:true makes Node CONCATENATE argv
                          //   into one cmd.exe string — fine for a short prompt, corrupts a real
                          //   multi-KB prompt (quotes/backticks/newlines).
  permissionFlag:'--dangerously-skip-permissions',   // appended AFTER the prompt
  postPromptArgs:['--new-project'],  // BUG 3: without it agy replies "no active project workspace"
  emptyOutputError:'agy returned no output — check installed version against AGY_CFG',
};

export const OPENROUTER_CFG = { kind:'http', model:'anthropic/claude-sonnet-4', timeoutMs:120_000 };
```
Rules carried over: arg order is `[...args, prompt, ...postPromptArgs]` then permission flag last (nothing may sit between a value-taking flag and its value); `cwd` = the run's sandbox dir, created before spawn; on non-zero exit attach `err.partial = stdout`; `probe(bin, ['--version'])` on boot **and every 30s**; `launchCommandFor(id)` builds the displayed command from the **same config object** the spawn uses, so display cannot drift from behaviour.

---

## 10. State machines

### Run lifecycle
```
                     +-------------------------------------+
                     v          (repair, attempt < 2)       |
  created -> agent1 -> gateV1 -> gateV1_fail ---------------+
               |         |
               |         +-> underspecified -> awaiting_human -> agent1
               |         `-> passed
               v
            agent2 -> gateV2 -> tier1_fail (syntax)  --repair<2--+
               ^         |   -> drift_fail  ---------------------+
               |         |   -> boot_fail   ---------------------+
               +---------+   `-> passed -> running -> connectors -> done
               (failover: different model, same pack + worklog)
                                                     `-> done_partial (P4)
```

| Status | Meaning | Exit |
|---|---|---|
| `agent1` / `agent2` | A model call is in flight | Output produced or failover |
| `gateV1_fail` | Contract invalid | Repair ≤2 → escalate rung → `done_partial` |
| `underspecified` | score < 0.7, interactive mode | Human answers ONE question |
| `tier1_fail` | Generated code doesn't parse | Repair ≤2 (cheap — no install ran) |
| `drift_fail` | A file cites nothing / unknown ID | Repair naming the file |
| `boot_fail` | Server didn't start or probe failed | Repair with stderr + failing file |
| `running` | Generated app is live, preview enabled | Terminal (success) |
| `done_partial` | Valid subset built, gaps flagged | Terminal (P4 — never a silent hole) |

### Inbox item lifecycle
```
created(pending) --> approved --> action executes (e.g. connector write)
       |         `--> rejected --> action discarded, run continues
       `-- if tainted=1 (brief imported from a GitHub issue / web page):
             no executable descriptor is served until a human runs `pact ack <id>`
```

---

## 11. API surface

All routes are local (`127.0.0.1`). **(LOCKED)** = passes the gate middleware.

| Method | Route | Purpose | Pri |
|---|---|---|---|
| `POST` | `/api/runs` | Submit a brief — the single prompt box | P0 |
| `GET` | `/api/runs/:id` | Run state + phases + artifacts index | P0 |
| `GET` | `/api/runs/:id/stream` | **SSE**: phase transitions, repairs, failovers, token deltas | P0 |
| `GET` | `/api/runs/:id/artifact/:name` | Read a spec file (validated only unless `?raw=1`) | P0 |
| `GET` | `/api/runs/:id/trace` | Trace matrix + reverse index | P0 |
| `POST` | `/api/runs/:id/answer` (LOCKED) | Answer the ONE clarifying question | P0 |
| `POST` | `/api/preview/:id/request` | Proxy a real HTTP call to the generated app | P0 |
| `GET` | `/api/adapters` | Registry + availability + real launch command | P0 |
| `GET` | `/api/usage` | Per-provider ledger, cooldowns, reset times, savedTokens | P1 |
| `GET` | `/api/inbox?status=pending` | The decision queue | P1 |
| `POST` | `/api/inbox/:id/approve` (LOCKED) | Approve — refuses if `tainted=1` | P1 |
| `POST` | `/api/connectors/:name` (LOCKED) | Miro / GitHub / Postman / Slack write | P1 |
| `PATCH` | `/api/inbox/:id/ack` (LOCKED) | Human acknowledgement of tainted content | P2 |
| `GET` | `/api/health` | Daemon liveness | P0 |

### Gate middleware — the security boundary
```js
// server/gate.js — every mutating route passes through here, no client can bypass it
export function gate(req, res, next) {
  const action = classifyAction(req);            // mutating? external? which subject?
  if (!action.mutating) return next();
  if (action.external) {                         // connector writes always need approval
    const item = findInboxApproval(action);
    if (!item || item.status !== 'approved') return fail(res, 'GATE_REFUSED', action);
    if (item.tainted) return fail(res, 'TAINT_UNACKNOWLEDGED', item);
  }
  next();
}
```
A mutating route added without gate coverage must fail the CI grep.

---

## 12. Error taxonomy

Errors are **data, not strings**: `{ code, subject_id, detail, recoverable }`.

| Code | Meaning | Recovery |
|---|---|---|
| `SCHEMA_INVALID` | Artifact failed zod | Repair prompt with exact issue list, max 2 |
| `FEATURE_UNCOVERED` | A feature has no API citing it | Repair prompt naming the feature |
| `ORPHAN_ELEMENT` | Element/file cites nothing real | Repair prompt naming the element |
| `UNDERSPECIFIED` | completeness < 0.7 | ONE clarifying question, or flagged assumptions |
| `BLOCKED_ON_UPSTREAM` | Needed spec absent after 2 rounds | Build the valid subset, flag the remainder |
| `TIER1_PARSE_FAIL` | Generated code doesn't parse | Auto-repair with file:line, max 2 |
| `DRIFT_REJECTED` | File implements nothing in the contract | Reject by name; model must file a `gap` |
| `CONFORMANCE_MISMATCH` | Route path/method ≠ openapi.yaml | Repair with the diff |
| `BOOT_FAIL` | Server didn't start / probe failed | Repair with stderr + failing file |
| `CONTRACT_TEST_FAIL` | Generated contract tests red | Inbox review with test output |
| `NO_CAPACITY` | Every rung out of quota/cooldown | Surface reset times, queue the run |
| `GATE_REFUSED` | Mutating action lacked approval | Create Inbox item, await human |
| `TAINT_UNACKNOWLEDGED` | Action on untrusted content | Require `pact ack` after a human reads it |

---
---

# Part III — Features

## 13. Core pipeline

```
BRIEF        ->  AGENT 1      ->  GATE V1      ->  AGENT 2      ->  GATE V2       ->  RUNNING APP
one box,         Architect        4 passes         Backend          syntax/drift/     live preview,
no mode          [MODEL]          [DETERMIN.]      [MODEL]          conformance/boot  connectors
picker                                                              [DETERMINISTIC]
```

| ID | Feature | Requirement | Pri |
|---|---|---|---|
| CORE-1 | **Single brief input** | One textarea (≤4000 chars) + optional project name. No mode picker, no agent picker. Brief stored byte-identical as `requirement.md`. | P0 |
| CORE-2 | **Fixed two-agent pipeline** | Architect → Backend, always, in that order, exactly once each per run. No planner, no DAG — the fixed shape *is* the compliance guarantee. | P0 |
| CORE-3 | **Agent 1 writes real files** | Contract + deterministic derivatives (`openapi.yaml`, `schema.mongo.json`, `decisions.md`) written to `.pact/runs/<id>/` and hashed. | P0 |
| CORE-4 | **Agent 2 reads only those files** | Agent 2's pack contains the spec files verbatim and **never the brief**. Provable by hash equality + grep. | P0 |
| CORE-5 | **Bounded repair** | Every gate failure produces a targeted repair prompt quoting the exact error; max 2 attempts per gate, then ladder escalation. | P0 |
| CORE-6 | **Clarify-or-assume** | score < 0.7 → interactive: ONE highest-information question; batch: proceed with every assumption scored and banner-flagged. Max 2 rounds (§8.4). | P0 |
| CORE-7 | **Graceful partial output** | Incomplete contract → build the valid subset, mark the rest `BLOCKED_ON_UPSTREAM`, list gaps in the final package. Never a silent hole. | P0 |
| CORE-8 | **Stack from the contract** | MERN by default; a brief-named stack wins because Agent 1 writes it into `stack.default` — Agent 2 obeys data, not a hardcode. | P0 |
| CORE-9 | **Pair selector** | Menu of all seven PS2 agents; each valid pair is one config entry `{agent1, agent2, schema, gates}`. Selector changes WHICH two run, never HOW MANY. Architect→Backend wired; others schema-only. | P1 |
| CORE-10 | **Project memory** | `project-memory.json` (decisions, naming, stack preference) rides into every later run of the same project. | P1 |

---

## 14. Model routing

| ID | Feature | Requirement | Pri |
|---|---|---|---|
| ROUTE-1 | **Ladder across access classes** | CLI subscriptions (`claude`, `agy`) + HTTP BYOK (OpenRouter) as one ordered pool, configurable per agent. | P0 |
| ROUTE-2 | **Loss-free failover** | Failover carries the identical pack + worklog + partial output and continues. Never restarts, never truncates. | P0 |
| ROUTE-3 | **Declarative CLI registry** | A new CLI agent is one config object behind one shared spawn. Display command derived from the same object. | P0 |
| ROUTE-4 | **Quota ledger** | Per-adapter request/token ledger with sliding windows; `hasQuota()` consulted before each rung. | P1 |
| ROUTE-5 | **Cooldowns & reset visibility** | `isUsageLimitError()` → `startCooldown()`; ledger exposes reset time; router skips cooled rungs. | P1 |
| ROUTE-6 | **Availability badges** | `probe()` on boot and every 30s — installing a CLI mid-demo lights it up with no restart. | P1 |
| ROUTE-7 | **Yolo ⇄ Manual permissions** | Yolo default (runs are confined to the run sandbox, every file lands in review). Manual honestly labelled: a CLI that blocks on a prompt hangs until timeout — the UI says so. | P1 |
| ROUTE-8 | **Human model pin** | A pinned adapter always beats the ladder's choice: `pinned ?? laddered`. | P2 |

---

## 15. Context & cost engine

| ID | Feature | Requirement | Pri |
|---|---|---|---|
| CTX-1 | **Budgeted packs** | Per-section token budgets with policies `tail|head|middle|drop`; truncation is logged, never silent. `head` for worklogs (latest matters most). | P0 |
| CTX-2 | **Stable-first ordering** | role prompt → schema → few-shot → project memory (stable) then brief/spec → worklog → closing instruction (volatile), so the prefix is byte-identical across calls and provider caches hit. | P0 |
| CTX-3 | **Pack on disk** | `packs/agent1.txt` / `agent2.txt` contain the exact bytes sent — the judge-openable proof of the handoff. | P0 |
| CTX-4 | **Savings accounting** | `report.savedTokens` per section surfaced on the cost strip: raw vs packed vs cache-hit. | P1 |
| CTX-5 | **Semantic dedupe cache** | `sha256(section)` → cached derived artifact; identical sections are never re-derived. | P1 |
| CTX-6 | **Compression pass** | Over-budget blocks summarized by the cheapest available rung rather than hard-truncated. *(Note: this is a deterministic utility invoking a model — describe it as the context engine, never as an agent.)* | P2 |

---

## 16. Verification

Three tiers, **cheapest first** (P6) — a broken run fails in 200ms, not after a 60s install.

| ID | Feature | Requirement | Pri |
|---|---|---|---|
| VER-1 | **Tier 1 — syntax** | `esbuild.transform()` every generated `.js`; `JSON.parse` every `.json`. Returns file:line:col issues; `repairFeedback()` becomes the repair prompt. No install, no network. | P0 |
| VER-2 | **Tier 2 — structural** | Coverage (every API implemented, every collection modelled) · Drift (every file cites ≥1 real contract ID) · Conformance (extracted `router.<method>('<path>')` set diffed against `openapi.yaml`). | P0 |
| VER-3 | **Tier 3 — boot** | Write tree → `npm install` → start server → `GET /__health` → probe one declared endpoint. Non-boot → repair with stderr + failing file. | P0 |
| VER-4 | **Generated contract tests** | Tests generated **deterministically from `openapi.yaml`** (not by a model) and executed against the running server: each declared status code asserted, each business rule asserted. *The handoff is proven by running code, not asserted.* | P1 |
| VER-5 | **Trace matrix** | Pure function over contract + manifest → rows (contract item → model → route → test → OK/gap) plus the reverse index. Computed, never authored by a model. | P0 |
| VER-6 | **Determinism check** | Same brief run twice → schema-level diff of the two contracts, shown as a stability indicator. Low temperature + forced structure. | P2 |

---

## 17. UI shell

| ID | Feature | Requirement | Pri |
|---|---|---|---|
| UI-1 | **Run theatre** | One box; then a pipeline strip (Architect → Gate V1 → files → Backend → Gate V2 → running app) animating over SSE, with repair/failover/drift events as visible chips. | P0 |
| UI-2 | **Spec viewer** | The real `.pact/` files with the sha256 badge; a "diff against Agent 2's pack" button that proves byte-identity on stage. | P0 |
| UI-3 | **Code viewer** | Generated tree; each file shows its `implements:[...]` stamp. | P0 |
| UI-4 | **Trace matrix** | The table + gaps highlighted; click a row to jump to the file. | P0 |
| UI-5 | **API preview console** | Method + path + body → real response from the generated server. This is where the 403 lands live. | P0 |
| UI-6 | **Clarification prompt** | The ONE question appears inline; answering resumes the run. | P0 |
| UI-7 | **Cost / provider strip** | Active rung, per-provider calls, tokens, savedTokens, cooldown resets — makes failover visible when it fires. | P1 |
| UI-8 | **Inbox** | The single decision queue: clarifications, connector-write approvals, reviews. No second notification surface. | P1 |
| UI-9 | **Adapter settings** | Availability badges + the real launch command per adapter, derived from the registry. | P2 |

---

## 18. Connectors

Deterministic exporters — **no model calls**, every write behind a human approval (P7). A failed connector never fails the run; `.pact/` files remain canonical.

| ID | Connector | Mechanism | Output | Pri |
|---|---|---|---|---|
| CONN-1 | **Postman / OpenAPI** | file write | `openapi.yaml` + importable collection | P0 |
| CONN-2 | **GitHub PR** | `gh` CLI | branch + PR containing `generated/` | P0 |
| CONN-3 | **Miro board** | Miro REST | services, collections, labelled API arrows, auto-laid out from `architecture.json` | P1 |
| CONN-4 | **Slack** | webhook | run summary + trace stats + preview URL + cost | P2 |
| CONN-5 | **Notion** | REST | spec page with trace links | P2 |

---

## 19. CLI & security

| ID | Feature | Requirement | Pri |
|---|---|---|---|
| CLI-1 | **`pact snapshot`** | Bounded, action-oriented view of everything awaiting a decision — id, type, one-line summary, age — each with the exact command that resolves it. | P1 |
| CLI-2 | **`pact answer <id> "..."` / `pact approve <id>`** | Act on one item from the terminal; identical authority to the web client. | P1 |
| CLI-3 | **Tainted items carry no action** | A run whose brief was imported from a web page / GitHub issue is `tainted=1` at creation; its Inbox rows serialize **without** an executable descriptor until `pact ack <id>` is run by a human who read the content. | P2 |
| SEC-1 | **Route-layer gate** | Every mutating action passes one middleware regardless of client (web, CLI, curl). A new mutating route without gate coverage fails the CI grep. | P0 |
| SEC-2 | **Sandboxed generation** | CLI agents spawn with `cwd` = the run's own `generated/` dir; nothing writes to the user's real repo; timeouts kill the process tree. | P0 |
| SEC-3 | **Secrets** | API keys from `.env` / OS env only. Never written into `.pact/`, never into a pack, never displayed. | P0 |
| SEC-4 | **Untrusted-brief taint** | Briefs imported from external sources are marked tainted at creation, server-side — never left to a client that could skip the step. | P2 |

```bash
$ pact snapshot
  ID     TYPE            SUMMARY                                     AGE
  a3f2   clarification   Who approves report release? (round 1/2)    30s
  b81c   connector       Miro board write — 5 services, 4 APIs        1m
  c05d   review          Gate V2 passed: 4/4 routes, 0 drift          2m

$ pact answer a3f2 "Payment settles before release; no manual override."
$ pact approve b81c
```

---
---

# Part IV — Delivery

## 20. Reference port

The reference repo already solves the boring, dangerous parts. **Port these first (hour 0–2); do not reinvent.** Source is TypeScript — strip types, keep logic *and comments*.

| From `agenticteam/server/src/` | → PACT | Effort | Why |
|---|---|---|---|
| `adapters.ts` (`CliAgentConfig`, `spawnCliAgent`, `probeCliAgent`, `launchCommandFor`) | `adapters/registry.js` + `spawn.js` | ~1h | The whole CLI-agent story, 4 real bugs pre-fixed |
| `contextpack.ts` (whole file) | `pack.js` | ~15m | Budgets, stable prefix, `savedTokens` |
| `quota.ts` (whole file) | `router.js` (ledger half) | ~15m | RPM/RPD ledger + reset times |
| `adapters.ts` → `isUsageLimitError`, `startCooldown`, `onCooldown` | `router.js` (ladder half) | ~10m | Correct failover trigger |
| `orchestrator.ts` failover block (~L400, ~L618) | `router.js` `continueFrom()` | ~30m | The continuation prompt + partial capture |
| `verify.ts` (whole file) | `gates/verify.js` | ~20m | esbuild syntax gate + `repairFeedback()` |
| `devserver.ts` (install → bind → probe) | `runner.js` | ~30m | A boot check that isn't flaky |
| `store.ts` + `.agenticteam/` layout | `kernel/store.js` + `.pact/` | ~20m | File-first canonical state |

**Deliberately NOT ported** (breaks the two-agent story or burns the clock): `planner.ts` (task-DAG planning — PACT's pipeline is fixed by design), `agentbus.ts`, `teamsync.ts`, `delegation.ts`, `e2ecrypto.ts`, `pty.ts`, `mcp.ts`, `hub.ts`, the entire `web/src/shell` tab system.

**Concepts to steal (cheap, high judge-value):** file-first state (“if a feature dies when you delete a JSON file, it's wrong”) · 30s availability re-probe · `savedTokens` on the strip · honest labelling of anything not live-verified.

**Hour-0 setup (Builder A):**
```bash
git clone https://github.com/Shohamg1k/pact.git && cd pact
git clone --depth 1 https://github.com/Shohamg1k/agenticteam.git /tmp/ref   # read-only reference
npm init -y && npm pkg set workspaces[0]=server workspaces[1]=web
npm i -w server express zod esbuild mongodb-memory-server
npm i -w web react react-dom && npm i -w web -D vite @vitejs/plugin-react
```

---

## 21. Workstreams

**Integration contract (agree at hour 0):** the orchestrator emits SSE `{phase, status, detail}`; every module is a function of `(runCtx)` writing into `.pact/runs/<id>/`.

### Builder A — Agents & Router
A1 port spawn + registry + 30s probe · A2 OpenRouter rung · A3 ladder, ledger, cooldown, **failover with worklog continuation** · A4 `agents/architect.js`, `agents/backend.js`, JSON extraction/recovery · A5 `pack.js` budgets + stable ordering.
**Done when:** a brief yields a schema-valid contract, and killing the primary mid-run still completes.

### Builder B — Kernel, Gates, Trace
B1 zod schemas + `store.js` (write + sha256) · B2 `validator.js` 4 passes + repair loop + clarify-or-assume + `interrupts.js` round cap · B3 `gates/v2.js` (verify → coverage → drift → conformance) · B4 `trace.js` + `provenance.js` + `memory.js`.
**Done when:** invalid contract blocks Agent 2; an invented endpoint is rejected by name; trace matrix renders both directions.

### Builder C — UI (Run theatre)
C1 Vite shell, SSE client, `api.js` · C2 pipeline strip with live states + repair/drift/failover chips · C3 spec viewer (hash badge + pack-diff button) + code tree · C4 trace matrix + gaps · C5 preview console + cost strip · C6 clarification prompt + Inbox.
**Done when:** the run is watchable and the 403 can be fired live on stage.

### Builder D — Runner, Connectors, Demo
D1 `runner.js` (write tree, install, in-memory Mongo, boot, probe, proxy, kill) · D2 boot hook + `contracttests.js` generated from `openapi.yaml` · D3 connectors P0→P2 order · D4 the four demo fixtures + **a pre-recorded fallback video** · D5 pre-warm npm cache; verify `claude`/`agy` on PATH on the demo machine.
**Done when:** all four scenarios run end-to-end on the demo laptop, offline except model calls.

---

## 22. Hour-by-hour finale plan

| Hour | A (agents/router) | B (kernel/gates) | C (UI) | D (runner/connectors) | Checkpoint |
|---|---|---|---|---|---|
| 0:00–0:30 | Clone both repos, workspaces, SSE contract, `.pact/` layout | | | | **CP0: `/health` + hello SSE** |
| 0:30–2:00 | **Port** spawn+registry, probe loop; first CLI call returns text | **Port** contextpack + verify; zod schemas + store/hashing | Vite shell + static pipeline strip | **Port** devserver lifecycle; hardcoded tree → npm i → boots | **CP1 (2:00): a CLI call works; a hardcoded server boots** |
| 2:00–3:30 | `architect.js` + `pack.js` → real contract JSON | validator 4 passes + repair loop | SSE wired, nodes animate | in-memory Mongo + probe + proxy | **CP2 (3:30): brief → valid architecture.json on disk** |
| 3:30–5:00 | `backend.js` + ladder/failover | gate V2 tier1+coverage+drift | spec + code viewers | boot check wired into gate V2 | **CP3 (5:00): FULL HAPPY PATH — brief → running app** |
| 5:00–6:00 | failover polish (worklog continuation) | trace + provenance + conformance | trace matrix + preview console | OpenAPI + GitHub PR + contract tests | **CP4 (6:00): happy path + trace + PR + green tests** |
| 6:00–7:00 | clarify-or-assume wiring | drift + partial-output fixtures | clarification UI + cost strip + Inbox | Miro board | **CP5 (7:00): all 4 scenarios pass once** |
| 7:00–7:30 | freeze | freeze | freeze | Slack + record fallback video | **FREEZE** |
| 7:30–8:00 | rehearse ×2, assign speaking parts | | | | **Stage-ready** |

**Cut list, in order (top = cut first):** Slack → Miro → semantic cache → project memory → generated contract tests → conformance diffing → live drift scenario (show recorded) → GitHub PR.
**Never cut:** two agents · both gates · spec files on disk · boot check + preview console · loss-free failover.

---

## 23. Acceptance criteria

```gherkin
# CORE-2 — exactly two agents
Given any completed run
When worklog.jsonl is inspected
Then exactly two phases invoked a model adapter
And they are, in order, "agent1" and "agent2"

# CORE-4 — Agent 2 depends on Agent 1, physically
Given a completed run
When sha256(architecture.json) is compared to the contract embedded in packs/agent2.txt
Then they are byte-identical
And packs/agent2.txt contains no distinctive phrase from requirement.md

# CORE-6 — clarify-or-assume
Given the brief "Build an employee system."
When Agent 1 completes
Then completeness_score < 0.7
And exactly ONE clarifying question is raised
And the run blocks until it is answered (interactive mode)

# 8.4 — bounded clarification
Given a run that has already asked twice (round = 2)
When a third ask is attempted
Then the kernel refuses
And the run proceeds with a recorded assumption
And unresolved elements are marked BLOCKED_ON_UPSTREAM

# 8.2 pass 2 — dropped scope
Given a contract where feature F-05 is cited by no API
When the validator runs
Then FEATURE_UNCOVERED is raised naming F-05
And no model was invoked during validation

# VER-2 — invented scope (drift)
Given Agent 2 emits routes/loyalty.js with implements: []
When Gate V2 runs
Then DRIFT_REJECTED is raised naming routes/loyalty.js
And the repair prompt instructs it to file a gap instead of writing code

# VER-3 — boot check
Given a generated backend
When Gate V2 tier 3 runs
Then npm install completes
And the server answers GET /__health with 200
And one declared endpoint is probed successfully

# ROUTE-2 — loss-free failover
Given a run mid-Agent-2 with a full context pack
When the active adapter's process is killed
Then the next rung receives the identical pack plus the worklog and partial output
And no summarization or truncation occurred
And the run completes rather than restarting

# CORE-7 — graceful partial output
Given a contract with 6 APIs, 2 of them malformed
When Agent 2 runs
Then 4 APIs are implemented
And 2 are marked BLOCKED_ON_UPSTREAM
And the gap list appears in the final package

# SEC-1 — route-layer gate
Given a connector write is requested
When any client (web, CLI, raw curl) calls it without an approved Inbox item
Then GATE_REFUSED is returned
```

---

## 24. Test / verification plan

| # | Test | Method | Pass criteria |
|---|---|---|---|
| T1 | Contract validity | Lab brief ×3 | 3/3 schema-valid within ≤2 repairs |
| T2 | Handoff integrity | hash compare + UI diff button | byte-identical |
| T3 | Brief isolation | grep `packs/agent2.txt` for a rare word from the brief | zero hits |
| T4 | Coverage & orphans | `trace.json` | every API implemented; zero orphan files |
| T5 | Drift rejection | inject a file with `implements: []` | rejected, named in UI |
| T6 | Syntax tier | inject a truncated file | caught by tier 1 **before** any npm install |
| T7 | Boot check | full run | server boots, `/__health` 200 |
| T8 | Business rule live | preview console `GET /reports/1` unpaid | HTTP 403 `payment pending` |
| T9 | Contract tests | generated suite vs running server | red → green on stage |
| T10 | Vague brief | "Build an employee system." | exactly ONE question |
| T11 | Failover | kill the CLI mid-Agent-2 | completes; worklog shows 2 models, output continuous |
| T12 | Invalid contract | corrupt `architecture.json` mid-flight | Agent 2 never starts; clear error |
| T13 | Partial output | contract with 2 malformed APIs | valid subset built + gaps listed |
| T14 | Cold machine | fresh clone + `npm i` + run, wifi off except model calls | works |
| T15 | Rehearsal | full 4-scenario demo | under 8 minutes, twice in a row |

---

## 25. Success metrics

| Metric | Why it matters | Finale target |
|---|---|---|
| **Two-agent provability** | The compliance claim must be checkable, not asserted | Hash diff + grep pass on stage |
| **Verified-before-human** | Nothing reaches the judge unverified | 100% (all three tiers run) |
| **Handoff coherence** | Zero orphans, zero uncovered features | 100% at Gate V2 |
| **Failover context loss** | The signature robustness claim | 0 incidents |
| **Brief → running app** | The headline outcome | < 4 minutes for the lab brief |
| **Packed vs raw tokens** | Whether the context engine pays off | savedTokens shown, > 0 |
| **Demo reliability** | The only metric on the day | 2 clean rehearsals back-to-back |

---

## 26. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| **CLI missing / auth expired at venue** | High | Verify at hour 0; OpenRouter HTTP rung as fallback; availability badges visible in UI |
| **`npm install` slow/offline** | High | Pre-warm npm cache; pin a tiny dependency set (express, mongoose, mongodb-memory-server, cors) |
| **Model wraps JSON in prose** | Medium | Fenced-block + first-brace extraction, then bounded repair |
| **Generated code broken** | Medium | Tier 1 syntax catches it in 200ms; stderr + failing file fed back |
| **Non-determinism run to run** | Medium | Forced structure + low temperature; VER-6 schema diff to show stability |
| **Judge suspects >2 agents** | High | §27 rehearsed; `worklog.jsonl` and the folder split are the evidence |
| **Demo laptop chaos** | High | Pre-recorded fallback video (D4) |
| **Scope creep** | High | §22 cut list; connectors always go first |

---

## 27. Judge defence

**"How is this exactly two agents if you use many models?"**
Two agent *roles*, each executed once per run. The ladder chooses which engine runs a role; a failover is the same role continuing on a different engine with the same pack and worklog. Model count ≠ agent count — `worklog.jsonl` shows exactly two model-invoking phases per run.

**"Is Agent 2 genuinely dependent on Agent 1?"**
Physically. Agent 2's pack contains `architecture.json` verbatim and never the brief. On stage we diff the hashes and grep the pack for a word from the brief — zero hits. Gate V2 additionally rejects any file that cites nothing in the contract.

**"What if Agent 1 is wrong or incomplete?"**
Gate V1 runs four deterministic passes — schema, coverage, orphans, completeness. Below 0.7 we ask exactly one clarifying question or proceed with every assumption scored and flagged. Agent 2 never starts on an invalid contract; if the contract is only partly valid, we build the valid subset and mark the rest `BLOCKED_ON_UPSTREAM`.

**"How do you stop hallucinated endpoints?"**
Every generated file declares `implements: [...]`. Empty or unknown = rejected by name at Gate V2; the model must file a `gap` for a human instead of writing code.

**"Are the gates, router or connectors secretly agents?"**
No model calls in `gates/`, `runner/`, `router/`, `connectors/`, `trace/` — there is a CI grep asserting it, and you can open the folders.

**"Can you prove the output is real?"**
The server boots and answers live HTTP in the preview console, the generated contract tests go red→green against it, and the code lands in a GitHub PR you can open.

**"Why is this innovative?"**
The handoff is a validated, hashed, versioned artifact with bidirectional provenance — and drift is rejected by construction rather than reviewed away. Most pipelines pass prose and hope.

**"What's the measurable impact?"**
Design-to-implementation handoff compressed from days to minutes for an SMB-scale brief (our labelled estimate), with structural drift prevention and per-run cost visibility.

---

## 28. Open questions

| # | Question | Blocks | Leaning |
|---|---|---|---|
| Q1 | Interactive clarification on stage, or batch with flagged assumptions? | Demo script | **Interactive for scenario 2 only** — it's the most compelling 20 seconds |
| Q2 | Do generated contract tests run inside Gate V2 (blocking) or after (reporting)? | VER-4 | **After, reporting** — a red test is a great story, a blocked demo is not |
| Q3 | Which rung leads for Agent 2 — `claude` or `agy`? | ROUTE-1 | Bench both at hour 1 on the same contract; pick by boot-pass rate |
| Q4 | Ship the pair selector wired, or schema-only? | CORE-9 | **Schema-only** unless CP5 lands early — compliance risk isn't worth it |
| Q5 | SQLite index at all? | §7 | **No for the finale** — files + an in-memory list are enough |

---

*PACT · PRD v3.0 · August 2026 · Approved for implementation*
