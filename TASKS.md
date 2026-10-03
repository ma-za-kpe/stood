# Task List

Date: 2026-10-03

This is the operating checklist for Stood. **Every work session starts from this list, updates statuses as work lands, and ends with the Docker validation pipeline** when code or project behaviour changes. Policy: [docs/WAYS_OF_WORKING.md](docs/WAYS_OF_WORKING.md).

Status key:

- `[ ]` Not started
- `[~]` In progress
- `[x]` Done (with evidence: PR, commit, receipt, screenshot)
- `[!]` Blocked or needs a decision (name the smallest safe next step)
- `[-]` Dropped (with reason, never deleted)

Evidence tiers (state one when marking `[x]`): designed → implemented → unit-tested → contract-tested (PayPal sandbox) → deployed → demo-verified → field-tested.

## Ground Rules

- `[x]` **Work inside Docker only.** Code, tests, builds and scripts run through `docker compose run --rm app <cmd>` ([T15](docs/tech/T15-docker-and-local-dev.md)). The host only runs git, pre-commit and Docker.
- `[x]` **Keep this file cumulative.** Append, never delete. Completed work stays `[x]`. Every discovered gap, defect or follow-up becomes a new task.
- `[x]` **Tests first.** No product code without a failing test that needs it ([WoW §4](docs/WAYS_OF_WORKING.md#4-test-driven-development)).
- `[x]` **Rules move money. Models only report.** No change may give a model, prompt or adapter other than `payments` a path to a PayPal call ([ADR-0003](docs/adr/0003-rules-move-money.md)).
- `[x]` **Sandbox only.** No live PayPal keys, no real money, no real personal data, anywhere, ever, until a separate ADR says otherwise.
- `[x]` **Fail closed.** Missing or uncertain evidence → wait. Never an inferred release.
- `[x]` **GitFlow.** `feature/*` → `develop` (squash) → `main` (merge commit) → release-please. Never commit to `main` or `develop` ([ADR-0006](docs/adr/0006-open-source-branching-strategy.md)).
- `[x]` **The pre-commit gate is law.** `pre-commit run --all-files` passes before every push. Never `--no-verify`. Every commit is signed off (`git commit -s`).
- `[x]` **Claims match evidence.** A fixture pass isn't a sandbox pass, and a sandbox pass isn't a field test. Say which tier was reached.
- `[x]` **Inventory before creating.** Check what exists (services, accounts, dependencies, assets) before adding anything new. Free tier or open source unless an ADR approves a cost ([T09](docs/tech/T09-tech-stack.md)).
- `[x]` **Safe handoff** at the end of every material slice ([WoW §14](docs/WAYS_OF_WORKING.md#14-safe-handoff-end-of-every-material-slice)).
- `[x]` **Roles (from 2026-10-03):** the **software engineer implements**. **Claude reviews**: a code review and a product review on every PR, against [WoW](docs/WAYS_OF_WORKING.md), the specs (S / T docs) and the Definition of Done. Claude doesn't push code changes.
- `[x]` **Continue without asking for "proceed"** after a progress summary. Pause only for a real decision, new authority, or a blocker with no safe alternative.

## Current Work Package: Publish the foundation (v0.1.0)

- `[x]` T-0001 Research and product docs (docs/01–13, docs/stood/S01–S16). Tier: designed.
- `[x]` T-0002 Brand assets v1 (superseded by T-0013).
- `[x]` T-0003 Ways of working, ADRs 0001–0007, pre-commit, release-please, PR template, CODEOWNERS. Tier: designed.
- `[x]` T-0009 Technical docs T01–T15. Tier: designed.
- `[x]` T-0010 Link every EyeOnSite mention to <https://github.com/ma-za-kpe/eyeonsite>.
- `[x]` T-0013 Design system v2 "Volt" + regenerated brand assets with an outlined wordmark. Tier: designed.
- `[x]` T-0014 Landing page (`site/`) with motion, use cases, changelog page, and Pages workflow. Tier: implemented (rendered locally at 1440 px and 390 px).
- `[x]` T-0017 Cutthroat pre-commit + CI (`pre-commit`, `pr-title`, `dco`). The gate found and fixed a real JS syntax bug in `site/app.js`. Tier: implemented.
- `[x]` T-0116 Usage manual `docs/USAGE.md` (package-page style: judges' path, keys, quickstart, webhooks, profiles, self-hosting). Tier: designed. **Must be kept in sync with the implemented API (review item on every API PR).**
- `[x]` T-0018 GitFlow branching (ADR-0006), SECURITY.md, CODE_OF_CONDUCT.md, issue templates.
- `[~]` T-0019 Set up `develop` as the default branch, rulesets on `main` and `develop`, merge settings (squash for features, merge commit for promotion), repo homepage.
- `[~]` T-0020 Merge PR #1 → `develop` → promote to `main` → release-please v0.1.0 → back-merge. Verify <https://ma-za-kpe.github.io/stood/> and the changelog page.
- `[ ]` T-0004 Decide whether `docs/12-judges.md` stays public.
- `[ ]` T-0006 Raise required approvals to 1 + CODEOWNERS on the money path when a second maintainer joins.
- `[ ]` T-0015 Move the brand generator script into `tools/brand/` (runs in Docker).
- `[x]` T-0117 Release-please fixes: target `main` (the default branch is `develop`), `initial-version` 0.1.0. Allowed Actions to open PRs. `develop` ruleset now allows back-merge merge commits. The first release PR (#4, wrong target and 1.0.0) was closed.
- `[ ]` T-0021 Replace `GITHUB_TOKEN` in release-please and back-merge with a GitHub App token, so bot PRs trigger CI and no admin bypass is needed.

## Milestone 0.2.0: Refuse path end to end (target 16 Oct)

- `[ ]` T-0007 Week-1 spikes:
  - Vault + `AUTHORIZE` + capture / void in sandbox ([S10](docs/stood/S10-sandbox-limits-and-open-questions.md) Q1, Q15).
  - Kernel sandbox approval.
  - Channel3 image-search test.
  - Email APIMatic for MCP generation access.
  - Read the Official Rules (Q9).
- `[ ]` T-0008 Webinars: 6 Oct and 7 Oct (9am PT), 12 Oct (7am PT, AG Studio × PayPal).
- `[ ]` T-0012 Free-tier accounts:
  - Create Neon (eu-central), Cloudflare (R2 + Workers AI), Render (Frankfurt), Astropods and Kernel.
  - Ask partners about credits.
- `[ ]` T-0022 Docker dev stack: `Dockerfile` (multi-stage, pinned digest), `compose.yaml` (app, Postgres, MinIO, Mailpit), `scripts/dev` wrapper. Add `hadolint` to pre-commit.
- `[ ]` T-0023 Monorepo skeleton (pnpm + Turborepo) in Docker. Enable the pre-registered hooks: `tsc --strict`, dependency-cruiser money boundary, Vitest.
- `[ ]` T-0024 TDD: `Money`, `Geofence`, `Nonce` value objects (property tests).
- `[ ]` T-0025 TDD: `Tranche` state machine and `decide()` table (C1–C5) ([T03](docs/tech/T03-domain-model.md)).
- `[ ]` T-0026 Evidence profiles core (ADR-0007): `construction.stage@1`, `freelance.milestone@1`.
- `[ ]` T-0027 PayPal adapter (recorded sandbox contract tests): authorise / void / capture / reauthorise.
- `[ ]` T-0028 API v1: allowances, dispatch, packages (HMAC + idempotency). Fixtures `wrong-plot` and `good`.
- `[ ]` T-0029 Deploy to Render (Docker image) + Neon + R2. `/health`. Postman monitor.
- `[ ]` T-0011 Open the matching issue / PR in EyeOnSite for the `stood/` functions and removing the 48h auto-accept ([T08](docs/tech/T08-eyeonsite-integration.md)).

## Milestone 0.3.0: All three outcomes (target 23 Oct)

- `[ ]` T-0030 Release path (capture) + receipt page.
- `[ ]` T-0031 Evidence agent (Astropods + Workers AI): nonce, stage, recapture. Evaluation set of 50 consented photos.
- `[ ]` T-0032 Near-duplicate index (Elastic, with a pgvector fallback) + seed corpus.
- `[ ]` T-0033 Outbound webhooks + PayPal inbound verification.
- `[ ]` T-0034 EyeOnSite E1–E5 wired behind `stoodPayments`. A real Android capture.

## Milestone 0.4.0: Reviewer and partners (target 30 Oct)

- `[ ]` T-0035 Reviewer file in AG Studio (two data sources + reconciliation).
- `[ ]` T-0036 Bryntum Gantt + AI chat.
- `[ ]` T-0037 Dispute packet. Hold timers (Render Workflows / pg-boss).
- `[ ]` T-0038 Notifications (Zapier / email).

## Milestone 0.5.0 → 1.0.0: Polish and submit (6–11 Nov)

- `[ ]` T-0039 Channel3 fixtures check. APIMatic SDK / MCP. Postman workspace.
- `[ ]` T-0040 Accessibility (axe, greyscale) and design polish.
- `[ ]` T-0041 Film in Accra. 90s video. `docs/sponsors/*.md`.
- `[ ]` T-0042 Final cross-check ([13](docs/13-submission-checklist.md)). Submit by 11 Nov. Tag `v-hackathon-submission`.

## Backlog: every task foreseen so far (append new ones, never delete)

### Onboarding and team

- `[ ]` T-0043 Onboard the new software engineer: read the README, WoW, S-docs and T-docs. Run `pre-commit install`. Get the Docker stack up. First PR = one TDD value object (T-0024).
- `[ ]` T-0044 Add the engineer to CODEOWNERS for non-money paths. Keep money-path ownership with the maintainer until a second reviewer exists.
- `[ ]` T-0045 Define the review protocol in the PR template: engineer self-check, then Claude code review + product review, then the maintainer merges.

### Repository and community

- `[ ]` T-0046 Labels: `good first issue`, `help wanted`, `money-path`, `evidence`, `profiles`, `backport`, `blocked`, `needs-product-review`.
- `[ ]` T-0047 Open GitHub Issues mirroring the milestone tasks below. Link issue numbers back here.
- `[ ]` T-0048 Enable private vulnerability reporting, secret scanning and push protection, and Dependabot alerts.
- `[ ]` T-0049 README badges: CI, Pages, release, licence. Pin `v0.1.0` in the README once released.
- `[ ]` T-0050 Enable GitHub Discussions (Q&A, Ideas: new evidence profiles).

### Domain and API (product code)

- `[ ]` T-0051 Generalise the domain per ADR-0007: `Milestone`, `location` check, `required_items`, evidence profile registry + versioning.
- `[ ]` T-0052 Effect maps (deposit inversion, partial capture → reviewer). Property tests.
- `[ ]` T-0053 OpenAPI 3.1 spec generated from Zod. Breaking-change diff in CI.
- `[ ]` T-0054 Idempotency middleware, HMAC auth, rate limits, problem+json error catalogue.
- `[ ]` T-0055 Transactional outbox + webhook dispatcher (retries, dead-letter).
- `[ ]` T-0056 Reconciliation job (Transaction Search × decisions). Gate-bypass alert.
- `[ ]` T-0057 Hold timers: reauthorise at day 3, warn at 27, void at 29. Never treat an expiry as a release.
- `[ ]` T-0058 Reviewer override + payer acceptance (FR-39 / 40) with an audit log.
- `[ ]` T-0059 Dispute packet PDF / JSON. Disputes API where the sandbox allows it.
- `[ ]` T-0060 Receipt signed links (JWT), distance-only display.
- `[ ]` T-0061 Demo endpoints + fixtures (good, wrong-plot, recycled, wrong-stage, substituted-fitting, nonce-unreadable, mock-location, funding-declined, hold-expiry, freelance-missing-screen).

### Evidence

- `[ ]` T-0062 pHash / dHash implementation + tests. Server recompute vs the platform pHash (tamper → WAIT).
- `[ ]` T-0063 Seed corpus of public-domain construction images (licence-checked) for the reused-photo check.
- `[ ]` T-0064 Vision prompt + Zod schema. Prompt-injection test set (text in images).
- `[ ]` T-0065 Model evaluation harness: stage accuracy, nonce OCR, **false-refusal rate**. REFUSE on stage stays off until the thresholds are met.
- `[ ]` T-0066 Daily AI budget guard (exhausted → WAIT).
- `[ ]` T-0067 Freelance checks: `artifact_hash`, `link_check` (Figma / GitHub / Drive).

### Web product (screens S08)

- `[ ]` T-0068 Allowance (sign) screen + Bryntum Gantt of milestones.
- `[ ]` T-0069 Decision screen (verdict chip, live checks, PayPal state).
- `[ ]` T-0070 Receipt + dispute packet screens.
- `[ ]` T-0071 Reviewer file (AG Studio) + wait queue + reconciliation widget.
- `[ ]` T-0072 Hosted, white-label allowance and receipt pages (theme tokens) for callers without a frontend.
- `[ ]` T-0073 Reference capture page (PWA) for platforms without an app: offline queue, nonce card, in-app camera only.

### EyeOnSite integration (in the EyeOnSite repo)

- `[ ]` T-0074 `createProject`, `stoodWebhook`, `dispatchStage` functions + Stood SDK + secrets in Secret Manager.
- `[ ]` T-0075 `onEvidenceSubmitted` → Stood package (EvidenceTrust signals as `platform_signals`).
- `[ ]` T-0076 Inspector app: nonce display + `nonce_card` shot.
- `[ ]` T-0077 Remove the planned 48h auto-accept. Copy change: "held by PayPal until the evidence passes". Update EOS-08.
- `[ ]` T-0078 Builder draw payout via Flutterwave after `tranche.released`.

### Partner tools (S13)

- `[ ]` T-0079 APIMatic: Context Plugin before/after lesson. Stood SDK (TS) + docs portal. MCP server (if access is granted).
- `[ ]` T-0080 Kernel: headless sandbox buyer approval + live view embed + CI usage.
- `[ ]` T-0081 Astropods: `astropods.yml` evidence agent with no PayPal credentials.
- `[ ]` T-0082 Elastic index + hybrid reviewer search. pgvector parity tests.
- `[ ]` T-0083 Postman public workspace, fixtures collection, monitors (keep-warm).
- `[ ]` T-0084 Zapier notifications (or the email fallback). Confirm whether hackathon credits cover webhooks.
- `[ ]` T-0085 Channel3 lookup + image search for `catalog_match`.
- `[ ]` T-0086 `docs/sponsors/*.md` (11 pages) + `LESSONS.md`.

### Infrastructure and operations

- `[ ]` T-0087 `render.yaml` Blueprint (Docker runtime), env groups, deploy hooks on release tags.
- `[ ]` T-0088 Neon project + migrations on deploy. R2 bucket + lifecycle rule + scoped tokens.
- `[ ]` T-0089 GitHub Actions cron tick (every 10 min) + Postman monitor. Cold-start messaging in the UI.
- `[ ]` T-0090 Observability: pino → Grafana Cloud, OpenTelemetry traces, Sentry. Alerts from T13.
- `[ ]` T-0091 Trivy image scan + `pnpm audit` in CI. hadolint in pre-commit.
- `[ ]` T-0092 Secret rotation runbook rehearsal before submission.

### Quality

- `[ ]` T-0093 Coverage gates (85% overall, 100% decision / money) in CI.
- `[ ]` T-0094 Stryker mutation testing on `domain/decision` (≥ 80%) nightly.
- `[ ]` T-0095 Playwright E2E judge path (5/5 fixtures) + axe accessibility checks.
- `[ ]` T-0096 Nightly live PayPal sandbox contract tests.

### Brand and site

- `[ ]` T-0097 Missing assets: YouTube thumbnail 1280×720, YouTube channel banner, Play feature graphic 1024×500, Devpost gallery 3:2.
- `[ ]` T-0098 Landing page: real-phone QA (scroll reveals, tilt off on touch), Lighthouse ≥ 90, self-hosted fonts.
- `[ ]` T-0099 Freelance profile demo on the landing page ("Try the gate" second tab).

### Hackathon submission

- `[ ]` T-0100 Devpost text (problem, who, why, tools used and how).
- `[ ]` T-0101 90-second video: storyboard (S09), Accra shoot, captions, no third-party trademarks or music.
- `[ ]` T-0102 Judges' self-serve path in the README (hosted URL + setup instructions).
- `[ ]` T-0103 Keep the demo alive until 21 Dec (monitor, credits, a token-expiry check).

### Legal, privacy and business

- `[ ]` T-0104 Trademark and domain check for "Stood" (USPTO, UKIPO, Ghana RGD).
- `[ ]` T-0105 Privacy notice for the demo (processors list, retention, Ghana DPA Act 843 / UK GDPR).
- `[ ]` T-0106 Confirm the licence terms for AG Studio, AG Grid Enterprise and Bryntum in a public repo.
- `[ ]` T-0107 Verify flagged statistics before the video or pitch (audit-log ⚠️ items).
- `[ ]` T-0108 Decide: Stood as a standalone company / API vs an EyeOnSite module (10 §Strategic Q1).
- `[ ]` T-0109 Choose the second consumer after EyeOnSite (freelance vs agri input finance vs grants) and validate with 3 interviews.
- `[ ]` T-0110 Builder mobilisation-advance policy (S10 Q2) with 3 Accra builders.

### Post-hackathon (live readiness, each needs its own ADR)

- `[ ]` T-0111 PayPal live app review. AUP check (no escrow framing). Live webhook verification.
- `[ ]` T-0112 Licensing / PSP posture with a licensed local partner (Ghana, Nigeria). Money-transmission review (US).
- `[ ]` T-0113 Ghana Data Protection Commission registration and a DPIA for evidence photos.
- `[ ]` T-0114 Device attestation in the capture SDK. Random second inspections. Inspector record (accepted visits only).
- `[ ]` T-0115 Production SLOs, on-call, incident process. Move bot tokens to a GitHub App.

## Success gates (hackathon)

- All three outcomes on the hosted demo, with real PayPal sandbox objects visible.
- Judges can trigger every outcome themselves (fixtures + replay).
- Zero money-boundary violations. 100% branch coverage on decision and money.

## Failure gates (stop and re-plan)

- Week 1: the vaulted `AUTHORIZE` doesn't work and the buyer-present fallback also fails → re-plan the money model.
- End of week 3: the three outcomes aren't working in sandbox → Tier 3 partners become "documented, not built".
