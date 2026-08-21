# PACT

Pluggable Agent Contract Transfer — Rockathon'26 PS2. See [PRD.md](./PRD.md) for the full spec.

## Quick start
```bash
npm install
node server/index.js        # daemon on :4300
npm run dev -w web           # UI on :5173 (proxies /api to :4300)
```

## Branches
| Branch | Owner | Scope |
|---|---|---|
| `main` | shared | scaffold, contracts, integration |
| `feat/core-pipeline` | — | kernel, agents, router, gates (PRD §21 A+B) |
| `feat/ui-theatre` | — | Run Theatre UI (PRD §21 C) |
| `feat/runner-connectors` | — | runner, connectors, demo fixtures (PRD §21 D) |

Each branch owns disjoint directories — see PRD §6 for the full layout. Push to your own
branch only; merge to `main` happens via PR at the checkpoints in PRD §22.
