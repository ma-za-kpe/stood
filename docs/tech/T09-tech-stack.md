# T09: Tech stack

**Rule ([NFR-15](T01-requirements.md#non-functional-requirements)):** apart from the hackathon partners, every component is **open source** or **free tier with a documented free fallback**. Prices and limits were checked on 2026-10-03. Re-check before relying on them.

## Language and runtime

| Choice | Licence / cost | Why | Alternatives considered |
|---|---|---|---|
| **TypeScript** (strict) | Apache-2.0 | Matches the PayPal Server SDK (APIMatic TS), AG Studio / Bryntum React, and [EyeOnSite](https://github.com/ma-za-kpe/eyeonsite)'s Cloud Functions (TS) | Kotlin ([EyeOnSite](https://github.com/ma-za-kpe/eyeonsite)'s app language: great, but the web dashboards and SDK ecosystem favour TS) |
| **Node.js 24 LTS** | MIT | Render native, current LTS | Bun (fine, but less proven on Render) |
| **pnpm workspaces + Turborepo** | MIT | Monorepo: `api`, `web`, `evidence-agent`, `contracts`, `sdk` | Nx (heavier) |

## Backend (`stood-api`)

| Concern | Choice | Licence |
|---|---|---|
| HTTP framework | **Hono** + `@hono/zod-openapi` | MIT |
| Validation / schemas | **Zod** (one schema → validation + OpenAPI + SDK) | MIT |
| DB access / migrations | **Drizzle ORM + Drizzle Kit** | Apache-2.0 |
| Database | **PostgreSQL** (hosted on Neon free) | PostgreSQL licence |
| Durable jobs / timers | **Render Workflows** (partner, beta free tier); fallback **pg-boss** | — / MIT |
| PayPal | **PayPal Server SDK (TypeScript, APIMatic-generated)** | Apache-2.0 |
| Object storage client | **@aws-sdk/client-s3** against R2 | Apache-2.0 |
| Images | **sharp** (thumbnails, pHash input) | Apache-2.0 |
| Geo | Own haversine (tested) + **h3-js** for coarse cells | MIT / Apache-2.0 |
| Auth (reviewer) | **Better Auth** with GitHub OAuth | MIT |
| Signed links | **jose** (JWT) | MIT |
| PDF (dispute packet) | **pdf-lib** | MIT |
| Logging | **pino** | MIT |
| Telemetry | **OpenTelemetry JS** | Apache-2.0 |

## Evidence agent

| Concern | Choice | Licence / cost |
|---|---|---|
| Runtime | **Astropods** (partner; Hobby $10 free credit) → fallback: a Render free web service | — |
| Vision model | **Llama 3.2 11B Vision Instruct** (open weights) on **Cloudflare Workers AI** | Free tier: 10k neurons/day |
| Model client | OpenAI-compatible HTTP client behind a `VisionModel` port | — |
| Product data | **Channel3** API / MCP (partner; free tier without a key) | — |
| Near-duplicate index | **Elastic** (partner credits / 14-day trial) → fallback **pgvector** on Neon | Elastic AGPL / free trial · pgvector PostgreSQL licence |

## Frontend (`stood-web`)

| Concern | Choice | Licence |
|---|---|---|
| Framework / build | **React 19 + Vite** | MIT |
| Routing / data | **TanStack Router + TanStack Query** | MIT |
| Styling | CSS custom properties from [S15 tokens](../stood/S15-design-system.md) (no CSS framework needed) | — |
| Fonts | Bricolage Grotesque, Geist, Geist Mono (self-hosted woff2) | OFL |
| Icons | **Lucide** | ISC |
| Reviewer file | **AG Studio / AG Grid** (partner, trial or hackathon licence) | Commercial (keys from env) |
| Stage timeline | **Bryntum Gantt** (partner, trial) | Commercial (keys from env) |
| Static map | **MapLibre GL** + **OpenFreeMap** tiles (no key) | BSD / free |

## Quality and tooling

| Concern | Choice | Licence |
|---|---|---|
| Format + lint | **Biome** | MIT |
| Types | `tsc --strict` | Apache-2.0 |
| Architecture rules | **dependency-cruiser** (money boundary, layer rules) | MIT |
| Unit / integration tests | **Vitest** | MIT |
| Property-based tests | **fast-check** | MIT |
| HTTP mocking | **MSW** | MIT |
| DB tests | **Testcontainers** (Postgres) | MIT |
| E2E | **Playwright** (local); **Kernel** browsers (cloud, demo replay) | Apache-2.0 / partner |
| Mutation testing | **StrykerJS** | Apache-2.0 |
| Secrets scan | **gitleaks** | MIT |
| Links | **lychee** | Apache-2.0 / MIT |
| Hooks | **pre-commit** | MIT |
| Releases | **release-please** | Apache-2.0 |
| API docs / SDK / MCP | **APIMatic** (partner) | — |
| API workspace / monitors | **Postman** (partner, free plan) | — |

## Hosting and services

| Service | Plan | Limits that matter | Fallback |
|---|---|---|---|
| **Render**: `stood-api` web service | Free | Spins down after 15 min idle (cold start ~1 min). 750 instance-hours / workspace / month | Postman monitor and GitHub Actions cron keep it warm. Paid Starter only with partner credits |
| **Render**: `stood-web` static site | Free | Unlimited static sites | — |
| **Render Workflows** | Beta free tier (512 MB, 20 concurrent runs) | Beta, so it may change | pg-boss in `stood-api` |
| **Neon** Postgres | Free | 1 GB / project, 100 CU-hours / month, scales to zero (≈ 1s resume) | Supabase free, or self-hosted Postgres |
| **Cloudflare R2** | Free | 10 GB, 1M writes, 10M reads / month, zero egress | Backblaze B2 free 10 GB |
| **Cloudflare Workers AI** | Free | 10k neurons/day shared across models | A paid model behind the same port for judging days (ADR needed) |
| **GitHub Actions** | Free for public repos | — | — |
| **Grafana Cloud** | Free | Logs, metrics and traces quotas | Render logs + Sentry free |
| **Sentry** | Developer (free) | 5k errors / month | — |
| **Email (fallback notifier)** | Resend free | 3k emails / month, 100 / day | Brevo free |
| **Zapier** | Free plan: 100 tasks, **no webhooks** | Webhook trigger needs Pro | Use hackathon credits if provided. Otherwise the notifications worker calls the **Zapier MCP** actions, or the email fallback ([T10](T10-deployment.md)) |
| **Kernel** | Developer: $5/month credits, ~$0.06 per headless hour | Plenty for demo replays and CI | Local Playwright |
| **Astropods** | Hobby: $10 free credit | Usage-based | Render free web service |
| **Channel3** | Free tier without a key | Rate limits; locales exclude Ghana / Nigeria / Kenya | Skip C9 (fixtures) |
| **PayPal** | Sandbox | — | — |

Commercial components (AG Studio, Bryntum) are **never vendored**. They're installed from their registries with keys from env, as stated in the README.
