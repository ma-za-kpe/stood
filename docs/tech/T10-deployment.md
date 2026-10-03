# T10: Deployment: where and how

**Target cost: $0/month** on free tiers plus partner credits ([NFR-07](T01-requirements.md#non-functional-requirements)). Region: **Frankfurt (EU Central)**, the closest Render region to both London (payers) and Accra / Lagos (inspectors and platform), and close to [EyeOnSite](https://github.com/ma-za-kpe/eyeonsite)'s `africa-south1` Firebase.

## Topology

```mermaid
flowchart LR
  subgraph GH[GitHub ma-za-kpe/stood]
    CI[Actions: CI · release-please · cron tick]
  end
  subgraph Render[Render · Frankfurt]
    API[stood-api · web service · free]
    WEB[stood-web · static site · free]
    WF[stood-workflows · Workflows beta · free]
  end
  NEON[(Neon Postgres · free · eu-central)]
  R2[(Cloudflare R2 · free)]
  WAI[Workers AI · free]
  ASTRO[Astropods · evidence-agent]
  ELX[(Elastic · credits) / pgvector]
  PP[(PayPal sandbox)]
  PM[Postman monitor · 15 min]
  EOS[EyeOnSite Cloud Functions · africa-south1]

  CI -->|deploy hook on release / main| API & WEB & WF
  CI -->|"*/10 cron: POST /internal/tick"| API
  PM -->|"GET /health (keeps warm)"| API
  API --- NEON & R2 & PP
  WF --- API
  API --> ASTRO --> WAI & ELX
  EOS <-->|SDK + webhooks| API
```

## Environments

| Env | Where | Data | PayPal | Purpose |
|---|---|---|---|---|
| `local` | Docker Compose (Postgres, MinIO for S3, MailHog) | Fixtures only | Sandbox (dev app) or recorded | Development, TDD |
| `ci` | GitHub Actions + Testcontainers | Ephemeral | Recorded / replayed. Nightly live sandbox | Gates |
| `demo` | Render + Neon + R2 (as above) | Synthetic and consented demo data | Sandbox (demo app) | Hackathon judging. **The only hosted environment** |

There's no production environment during the hackathon. Going live would need a separate ADR (live PayPal app review, licensing, data protection).

## Services on Render (Blueprint `render.yaml`)

| Service | Type | Plan | Build | Start | Health |
|---|---|---|---|---|---|
| `stood-api` | Web service (Node 24) | Free | `pnpm i --frozen-lockfile && pnpm -F api build` | `node dist/server.js` (runs migrations first) | `GET /health` (DB + R2 + PayPal token check) |
| `stood-web` | Static site | Free | `pnpm -F web build` | — (served from `dist`) | — |
| `stood-workflows` | Workflows (beta) | Free | `pnpm -F workflows build` | Render registers tasks from the repo | Task run status |

Infrastructure as code: `render.yaml` (a Blueprint) is committed. Every service and env var name is declared, with `sync: false` on secrets.

## Other services

| Service | Setup |
|---|---|
| **Neon** | One project `stood-demo` (eu-central-1). Branch `main`, plus an ephemeral branch per PR (optional). Pooled connection string in Render env |
| **R2** | Bucket `stood-evidence` (private), lifecycle rule: delete `pkg/*` after 180 days. API token scoped to that bucket. Separate read-only token for the evidence agent |
| **Workers AI** | Account API token scoped to Workers AI only. Lives with the evidence agent, never in `stood-api` |
| **Astropods** | `evidence-agent/astropods.yml`, deployed with the Astro CLI from CI on release tags |
| **Elastic** | Serverless project (trial / credits), API key scoped to the `evidence-*` index. After the trial, switch `EVIDENCE_INDEX=pgvector` (data re-indexed by a script) |
| **Postman** | Public workspace + monitor (every 15 min, `GET /health` + `POST /demo/scenarios/good` once a day) |
| **Kernel** | API key in `stood-api` (demo mode only) for `/demo/approve`, and in CI for E2E |

## Free-tier risks and mitigations

| Risk | Mitigation |
|---|---|
| Render web service sleeps after 15 min → the first judge request takes ~1 min | Postman monitor every 15 min + GitHub Actions cron every 10 min (`/internal/tick`, which also runs hold timers). The UI shows "Waking the demo…" honestly |
| 750 free instance-hours per workspace (one always-warm service ≈ 744 h) | Only `stood-api` is a web service. The web app is a static site. The evidence agent is on Astropods |
| PayPal webhooks hit a sleeping service | PayPal retries delivery. The tick poller reconciles open authorisations |
| Render free Postgres expires after 30 days | **We don't use it.** Neon free doesn't expire |
| Workers AI daily quota exhausted during judging | Rules-first pipeline (the model is skipped when a rule already refuses). A per-day budget guard. If exhausted, the decision is **WAIT**, never release. Optional paid model for judging days (ADR) |
| Elastic trial ends before 21 Dec | pgvector fallback adapter, a re-index script, and a config switch |
| Zapier free plan has no webhooks | Hackathon credits if offered. Otherwise the notifier uses the Zapier MCP actions or email (Resend free) |
| Partner trial watermarks (AG Studio / Bryntum) | Acceptable for the demo. Mention them in the README |

## Secrets and config

- Stored **only** in Render env groups (`stood-demo-secrets`), the Astropods project secrets, and GitHub Actions secrets (CI: sandbox and recorded only).
- `.env.example` lists names only. Config is validated at boot with Zod, and **the API refuses to start if the PayPal base URL isn't sandbox** while `APP_ENV != live` (and `live` doesn't exist yet).
- Key rotation: PayPal app secret, HMAC secrets and the receipt signing key are rotated before the submission tag. Old ones are revoked.

## CI/CD pipeline

```
PR:      pre-commit hooks → biome → tsc --strict → dependency-cruiser (money boundary)
         → vitest (unit + application) → contract tests (recorded PayPal) → coverage gates
         → build api/web/workflows → OpenAPI diff check
main:    same + Playwright E2E against an ephemeral local stack
         → release-please updates the release PR
release: tag vX.Y.Z → deploy hooks (Render: api, web, workflows) → Astropods deploy
         → smoke test (/health, demo scenario "good") → GitHub Release notes
nightly: live PayPal sandbox contract tests · Stryker on decision/ · reconciliation dry run
```

- Deploys are triggered by **release tags** (Render deploy hooks called from Actions), not every push. `main` can move ahead of `demo`.
- **Rollback:** redeploy the previous release from Render's deploy history (one click), or re-run the deploy job with the previous tag. Migrations are forward-only and backward-compatible for one release (expand → migrate → contract).

## Domains

`stood-api.onrender.com` and `stood-web.onrender.com` (free subdomains). A custom domain is optional and is the only possible cost (≈ $10/year). Decide after the trademark check.
