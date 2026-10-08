# Y11: Architecture and codebase

**One monorepo, two products.** Yard lives beside Stood in the same repo (shared tooling, CI, pre-commit, Docker, release process), but behind **hard boundaries**.

## Layout (implemented packages; remaining adapters planned)

```text
services/api/                 Stood (unchanged)
services/yard-api/            Yard: Board, blueprints, work orders, A2A surface, GitHub App
services/yard-foreman/        Foreman planner (LangGraph.js), no side-effect tools
external: Crew service       Separate closed project on Vast.ai; public Board + endpoint contract
apps/yard-web/                Yard app (React + Vite): describe, blueprint, project room, Board
packages/contracts/           Shared types (already exists): Stood API types used by Yard
packages/stood-sdk/           Server-side DRAFT/QUEUED HTTP SDK; fuller generated contract planned
packages/yard-domain/         Pure Blueprint/Milestone and pre-payment WorkOrder/Claim domains
site/                         Stood landing page
site/yard/                    Yard landing page (own CSS tokens, linked from Stood's nav)
docs/yard/                    These docs
```

## Boundaries (enforced)

- `services/yard-*` and `apps/yard-web` **may not import** `services/api/**`. They talk to Stood only through `packages/stood-sdk` over HTTP. Yard must work against a hosted Stood exactly like EyeOnSite does.
- `services/yard-foreman` may not import the GitHub App, Stood SDK or payment code. It returns blueprints. The Yard API acts on them after buyer approval.
- The real Crew is a **separate closed project**, reached by the public Board and [Y21 endpoint contract](Y21-crew-service-contract.md). No database credentials for Yard's core. It talks to the Board over A2A / HTTP like any third-party builder.

## Target runtime map

The hosted web/API, Board/events/log and private Postgres intake are deployed. Foreman, Stood SDK payment connection, GitHub/preview adapters and Crew edges below remain integration work.

```mermaid
flowchart LR
  WEB[yard-web] --> YAPI[yard-api]
  YAPI --> FORE[yard-foreman · LangGraph.js]
  YAPI -->|Stood SDK| STOOD[Stood API]
  STOOD --> PP[(PayPal sandbox)]
  YAPI -->|GitHub App| GH[(Buyer's GitHub)]
  YAPI --> YDB[(Postgres · yard schema)]
  CREW[Crew service · external · Vast.ai] -->|A2A| YAPI
  CREW -->|scoped token| GH
  HUMAN[Human builder] --> WEB
  STOOD -->|webhooks| YAPI
```

## Deployment (free / partner tiers first)

| Component | Where |
|---|---|
| `yard-api` | Render Starter web service (Docker), Frankfurt. [Health](https://stood-yard-api.onrender.com/health); separate service and restricted Neon role |
| `yard-foreman` | **Astropods** (partner), or a Render background service. Model on Workers AI (free) by default |
| `yard-web` | Served by the Yard API image at <https://stood-yard-api.onrender.com/app/>; same-origin secure sessions |
| `site/yard/` | Public companion page on <https://ma-za-kpe.github.io/stood/yard/> |
| Database | The same Neon project, **separate schema and role** (`yard`). Yard's role has no grants on Stood tables |
| `yard-crew` | **Vast.ai** GPU instance(s) with vLLM, started per batch of work orders and torn down after (no idle GPUs) |
| Durable jobs | Hosted Yard owns lease expiry and log retention. Posting/handover orchestration remains planned |

## Same codebase, same discipline

The WoW applies unchanged:

- TDD, DDD
- GitFlow, ≥ 5-task rounds
- the pre-commit gate, DCO
- release-please

Yard gets its own **bounded contexts**: Blueprint, Board (work orders, claims, leases), Builders (identity, reputation) and Handover. Its ubiquitous language is the vocabulary in the [README](README.md).

[ADR-0016](../adr/0016-yard-monorepo-caller-boundaries.md) records this boundary. Real dependency-graph fixtures test forbidden imports and allowed contracts. Import rules do not prove runtime tool isolation or database grants; database grants are separately verified by T-0176/T-0214; hosted planner/tool isolation remains T-0181–T-0183.
