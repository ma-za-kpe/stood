# T15: Docker and local development

**Ground rule ([TASKS.md](../../TASKS.md#ground-rules)): work inside Docker only.** Code, tests, builds, migrations and scripts run in containers. The host needs only **git, pre-commit and Docker** (Docker Desktop, OrbStack or Colima, all free for this use). Nothing depends on a developer's laptop setup.

## Why

- **Reproducible:** the same Node, pnpm and Postgres versions locally, in CI and on Render.
- **Safe:** tests use throwaway databases and fake S3. No real credentials get mounted.
- **Fast onboarding:** `git clone && docker compose up` is the whole setup for contributors.

## Images

| Image | Base (pinned by digest in the Dockerfile) | Used for |
|---|---|---|
| `stood-dev` | `node:24-bookworm-slim` + pnpm (corepack) | `docker compose run --rm app …`: install, test, lint, build |
| `stood-api` (prod) | Multi-stage: build on `node:24-bookworm-slim`, run on `gcr.io/distroless/nodejs24-debian12` (non-root) | Render web service (Docker runtime) |
| `stood-evidence-agent` | Same pattern | Render fallback when not on Astropods |

Dockerfile rules:

- Multi-stage. Lockfile-only `pnpm install --frozen-lockfile`. Non-root user. `HEALTHCHECK` on `/health`.
- No secrets in layers. Build args never carry keys.
- **hadolint** is added to pre-commit when the Dockerfile lands. Images are scanned with **Trivy** (open source) in CI.

## Compose stack (`compose.yaml`)

| Service | Image | Port | Stands in for |
|---|---|---|---|
| `app` | `stood-dev` | — | Tooling container (`run --rm`) |
| `api` | `stood-dev` running `pnpm -F api dev` | 3000 | `stood-api` on Render |
| `web` | `stood-dev` running `pnpm -F web dev` | 5173 | `stood-web` static site |
| `db` | `postgres:17` (+ pgvector) | 5432 | Neon |
| `s3` | SeaweedFS 4.17 (digest-pinned; [ADR-0008](../adr/0008-local-s3-substitute.md)) | 9000 → 8333 | Cloudflare R2 |
| `mail` | `axllent/mailpit` | 8025 | Email notifier |
| `site` | `node:24-bookworm-slim` running `node tools/site/build.mjs` + a static server | 8080 | GitHub Pages landing page |

PayPal stays the **real sandbox** (or recorded responses). Workers AI and Channel3 are called for real in `dev`, or replaced by fakes behind their ports in tests.

## Everyday commands

```console
docker compose up -d db s3 mail              # backing services
docker compose run --rm app pnpm install
docker compose run --rm app pnpm test        # unit + application tests
docker compose run --rm app pnpm test:contract
docker compose run --rm app pnpm db:migrate
docker compose up api web                    # run the product
docker compose run --rm site                 # build + serve the landing page
```

A thin wrapper `scripts/dev` (`./scripts/dev test`, `./scripts/dev lint`) maps to these commands.

`./scripts/dev validate` runs the complete gate, including real Postgres migrations/constraint tests. `./scripts/dev test:db` runs just that suite, starting `db` first. The tests create/drop only a randomly named database on the fixed Compose service and leave the normal development database intact. `pnpm db:generate` and `pnpm db:migrate` now exist; run them inside the tooling container. Other draft commands above remain planned.

## CI and deploy

- CI runs the same development image and pinned Compose Postgres as local validation. The operation-schema integration tests do not require Testcontainers or a Docker socket inside the tooling container ([ADR-0010](../adr/0010-durable-payment-operation-ledger.md)).
- Render deploys **`stood-api` from its Dockerfile** (Render supports Docker on the free web-service plan), built from the release tag. That means the same image locally, in CI and in the demo.
- The landing page is built in CI by the Pages workflow (`tools/site/build.mjs`). Locally, `docker compose run --rm site` reproduces it.

## Environments mapping

| Concern | Local (Docker) | CI | Demo (Render) |
|---|---|---|---|
| Postgres | `db` container | Same pinned Compose `db` | Neon |
| Object storage | MinIO | MinIO container | R2 |
| Email | Mailpit | — | Resend free |
| PayPal | Sandbox / recorded | Recorded (live nightly) | Sandbox |
| Vision model | Workers AI or a fake | Fake | Workers AI |

Status: **initial stack implemented**. Run `docker compose build app`, then `./scripts/dev install` and `./scripts/dev validate`. Postgres, local S3 and Mailpit start with `./scripts/dev up`. The API starts with `docker compose up -d api` on port 3000. It serves liveness and explicitly synthetic decision fixtures; no payments execute. Product web, workflows and storage adapters are still queued.

`docker build --target api -t stood-api:local .` validates and packages a non-root distroless API image. The host never installs Node dependencies. SDKs and the payment endpoints remain draft contracts.

On Linux, set `LOCAL_UID` and `LOCAL_GID` to your host user/group IDs when building the development image. CI does this automatically, so its non-root container can write to the runner-owned checkout and dependency volume. The distroless runtime always uses UID/GID 65532.
