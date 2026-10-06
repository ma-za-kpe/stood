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
- `[x]` T-0019 Set up `develop` as the default branch, rulesets on `main` and `develop`, merge settings (squash for features, merge commit for promotion), repo homepage.
- `[x]` T-0020 Merge PR #1 → `develop` → promote to `main` → release-please v0.1.0 → back-merge. Verify <https://ma-za-kpe.github.io/stood/> and the changelog page.
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
- `[x]` T-0022 Docker dev stack: multi-stage digest-pinned Dockerfile, Compose (app, API, Postgres, local S3, Mailpit), wrapper and hadolint. Tier: implemented. Evidence: branch `feature/22-product-foundation`; dev and distroless builds succeed, API/DB/Mailpit healthy. MinIO image pulls failed; SeaweedFS substitute recorded in ADR-0008. Authenticated object-store contracts remain queued.
- `[x]` T-0023 Monorepo skeleton (pnpm + Turborepo), strict types, dependency-cruiser boundary, Vitest and coverage in Docker and CI. Tier: unit-tested. Evidence: `docker compose run --rm app pnpm validate`; negative domain-I/O probe rejected by `pure-domain`.
- `[x]` T-0024 TDD: Money, Geofence, Nonce property and boundary tests. Tier: unit-tested. Evidence: domain test files; red before implementation, then 100% branch coverage.
- `[x]` T-0025 TDD domain slice: Tranche state machine, decision table, required items, location, 64-bit fingerprint distance and day-four reauthorisation rules. Tier: unit-tested. Evidence: approved PR #13, green full Docker/GitHub CI and squash merge `c3cc338`. Capture-window provenance, platform-signal validation and actual novelty search remain open under T-0136; durable operations, timers and reconciliation remain T-0132 / T-0057 / T-0056. This is not sandbox or orchestration completion.
- `[x]` T-0026 Evidence profiles core (ADR-0007): immutable construction, freelance and rental profile registry, fixed precedence and explicit effect maps. Tier: unit-tested. Evidence: `decision.test.ts`; model stage failures stay WAIT pending evaluation. Profile parameter schemas and actual evidence adapters remain separate queued work.
- `[~]` T-0027 PayPal adapter: funded-tranche capture/void/renewal and status-reader slice implemented with pinned Server SDK 2.5.0, sandbox-only construction, disabled SDK retries/logging, integer amounts and conservative response mapping. Possible submission is committed before SDK calls; ambiguous outcomes are reconciled, never retried blindly. Capture/renewal margins are rechecked with the server Clock; old-rule captures and unreviewed rental returns cannot dispatch. Correlate capture invoice_id to the operation and order custom_id to the tranche plus authorisation lineage; never pretend PayPal echoes request IDs. Tier: unit-tested with synthetic bodies/SDK mocks plus fake-executor real-Postgres crash evidence, approved PR #23, merged 523c899. Full authorise/Vault integration requires T-0154; actual recorded sandbox qualification remains blocked on T-0121. No payment client is wired into HTTP/runtime yet.
- `[~]` T-0028 API v1 draft foundation: signed Bearer + HMAC requests, five-minute skew and 64 KiB body limit; durable platform-scoped idempotency commits DRAFT allowance, ownership and PENDING tranche records in one transaction. Retries return the exact stored JSON response across restart; changed bodies conflict. Tenant-scoped allowance/tranche reads include recovered state and truthful payer/inspector copy. Tier: unit-tested and signed-HTTP real-Postgres integration-tested, approved PR #23, merged 523c899. No approval URL or payment is invented. Dispatch, allowance signing/versions and package/upload processing remain guarded; full v1 completion is T-0156 and depends on T-0154, evidence/upload integration and actual T-0121 sandbox qualification. Synthetic site-visit wrong-plot/good remain separate fixture endpoints.
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
- `[x]` T-0056 Provider-status reconciliation core: matched complete status proof, atomic outcome recording and restart-safe renewal expiry. Tier: integration-tested with a fake status provider and real Postgres; implementation complete, approved. Initial regressions failed on the missing coordinator; a real-Postgres competing-clock regression exposed an idempotency collision and now passes. Contradictory completed/absent proof was also rejected after a failing regression. Unknown, pending, contradictory and mismatched lookup results retain the reservation and return an alert signal; no payment calls. Transaction Search × decisions, scheduled runner and alert delivery are extracted to T-0149. Prerequisite for T-0027, including at least authorisation/capture status polling before voids are wired: every void error is ambiguous and must remain reserved until resolved. T-0138 covers unresolved renewals across expiry; elapsed time alone is not confirmation. Approved all five tasks in PR #21; green CI, squash merge `f5020ec` (213 unit / 44 real-Postgres / 100% domain coverage).
- `[ ]` T-0057 Hold timers: reauthorise from day 4 (after three elapsed days), warn at 27, void at 29. Never treat an expiry as a release.
- `[ ]` T-0058 Reviewer override + payer acceptance (FR-39 / 40) with an audit log.
- `[ ]` T-0059 Dispute packet PDF / JSON. Disputes API where the sandbox allows it.
- `[ ]` T-0060 Receipt signed links (JWT), distance-only display.
- `[~]` T-0061 All ten synthetic scenarios implemented: substituted fitting stays WAIT for review, funding-declined demonstrates WAIT_FUNDING, and hold-expiry demonstrates EXPIRED using explicitly simulated provider proof. Tier: unit-tested; route regressions failed first. Separate recipient sentences and payment.executed false throughout. Real sandbox replay remains blocked on T-0121 / T-0027; no synthetic reference is a PayPal ID. Approved PR #23, merged 523c899.

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

## Engineering audit follow-ups (2026-10-03)

- `[~]` T-0118 Reconcile technical contracts before implementation: distinguish missing results (WAIT) from a completed required-item check (REFUSE); separate verdict from payment effect; preserve authorisation attempts and human decision history. Test list: no vacuous release, no conflicting capture/void, no reused operation identity after redispatch, immutable prior decisions.
- `[x]` T-0119 Usage webhook example now describes transactional inbox/job insertion, confirmed CAPTURE-only payout jobs, capture-based idempotency and post-commit acknowledgement. Tier: designed; caller-owned adapters are explicitly pseudocode. Runtime webhook dispatch and payout processing are still queued.
- `[ ]` T-0120 Synchronise draft SDK and HTTP examples (`item` / `shot`, completion, response shape), contribution branch names, and day-four timers across docs.
- `[!]` T-0121 Sandbox credentials for T-0007 have not been supplied. Smallest next step: identify their local secret-store/file location without pasting secrets. Domain and fixture work continue; no sandbox contract evidence is claimed.
- `[x]` T-0122 API bootstrap and explicitly synthetic site-visit/scenario fixture routes (`good`, `wrong-plot`, `recycled`, `wrong-stage`, `nonce-unreadable`, `mock-location`, `freelance-missing-screen`). Tier: unit-tested. HTTP tests and container smoke checks verify `payment.executed: false` and no PayPal IDs. No financial endpoints are enabled.
- `[x]` T-0123 Expand Biome to product TypeScript and enforce 85% overall / 100% domain coverage. Fix discovered landing-page accessibility lint errors (decorative SVG, button types, semantic fieldset). Tier: implemented; full product validation passes.
- `[x]` T-0124 Fix Linux bind-mount ownership by parameterising the non-root development UID/GID and building with runner IDs. Tier: implemented. Evidence: commit `615d84b`; local full pre-commit and UID 1001 container check pass; GitHub Actions run `37152475582` passes every required check.

- `[x]` T-0125 PR #9 settlement corrections: expiry clock, matched confirmation, definite failure exits and ambiguous reconciliation; failing regression tests first, followed by 500-case operation-sequence property tests. Tier: unit-tested. Evidence: approved PR #9 squash-merged into develop as `2854815`; full Docker validation and GitHub CI green.
- `[x]` T-0126 RULE/MODEL provenance, profile-declared sources, central pass/refusal thresholds and fail-closed malformed results. Tier: unit-tested. Evidence: approved PR #10 squash-merged as `31176e2`; 125 tests, full Docker/pre-commit and GitHub CI pass. Rule set 1.1.0; no model adapter is wired.
- `[x]` T-0127 Structured immutable details (`distance_m`, `matched_package_id`) copied into decisions and tranche history, maximum off-site pin distance, pure assessment sentences and synthetic API copy. Tier: unit-tested. Evidence: approved PR #10 squash-merged as `31176e2`; full Docker/pre-commit/GitHub CI and four HTTP container smoke checks pass. Real novelty search and confirmed-payment sentences remain queued.
- `[x]` T-0128 Allowance DRAFT creation validates the GBP/USD/EUR hold subset, exact single-currency cap/milestone sum, identifiers, names, profiles and limits. Direct tranche creation also rejects unsupported hold currencies. Tier: unit-tested. Evidence: approved PR #11, green full Docker/GitHub CI and squash merge `82e5e25`. General Money retains local currencies. Signing, persistence and HTTP allowance creation remain T-0028 work.
- `[x]` T-0129 Five-minute Stood capture safety margin and pure endpoint-specific PayPal failure mapping. Tier: unit-tested; synthetic error bodies are not recorded sandbox contracts. Timeouts/5xx/unknown or conflicting errors remain AMBIGUOUS; SYSTEM_FAULT renamed REJECTED_NO_PAYMENT. Evidence: approved PR #11, green full Docker/GitHub CI and squash merge `82e5e25`. Durable counters/key-to-provider-UUID mappings are supplied by T-0145, review/merge pending; T-0027 is still blocked.
- `[x]` T-0130 PR #9 round-2 retry identity fix: increment a settlement-attempt counter only after a validated definite failure; include it in the operation key. Tier: unit-tested. Failing capture/void tests first; ambiguous and rejected failure identities unchanged. Evidence: round-3 approval, green full Docker/GitHub CI and PR #9 squash merge `2854815`.
- `[~]` T-0131 Recipient sentences: missing items named, rounded distance units, separate payer/inspector copy and confirmed-effect money clauses; pending and overdue holds never claim payment confirmation. Tier: unit-tested, regressions failed first (including large integer money display); domain 100%. Demo exposes both sentences and explicitly says no payment executed. Trusted photo-index match dates can be rendered when supplied; no real index/date evidence exists yet. Rental shipping still requires the human/rule safeguard, enforced by the adapter guard in this round. Approved PR #23, merged 523c899.
- `[x]` T-0132 Durable payment operations before T-0027: transactional reservation and aggregate version lock, stable provider UUID mappings, settlement/reauthorisation retry counters, immutable hold/renewal history and recovery across restarts. Prove competing workers cannot submit capture/void/reauthorise concurrently. T-0139 starts the operation ledger; complete aggregate persistence and transactional coupling remain required for completion (now approved). Logical schema alone is not completion. T-0145 now supplies full aggregate/counter/history persistence and atomic coupling, integration-tested; approved and merged. Approved all five tasks in PR #21; green CI, squash merge `f5020ec` (213 unit / 44 real-Postgres / 100% domain coverage).
- `[ ]` T-0133 Consider CAD deliberately: document merchant/hold capabilities and diaspora demand with an ADR, then allowance/tranche currency tests and sandbox evidence before broadening the GBP/USD/EUR subset.
- `[x]` T-0134 T-0025 bounded reauthorisation domain slice. Tier: unit-tested. Tests failed first: day-four boundary; renewed authorisation used for settlement; original deadline/nonce/evidence window and resubmission count preserved; pending renewal excludes capture/void/expiry; ambiguous retry retains key; definite rejection gets a new key; matching confirmation; separate reauthorisation failure type. Includes 500-case renewal properties. Pure domain only; scheduler T-0057, persistence T-0132 and sandbox contracts T-0027 remain queued. Evidence: approved PR #13, green full Docker/GitHub CI and squash merge `c3cc338`.
- `[x]` T-0135 Local guided key setup/readiness, blocking T-0027 completed locally: `scripts/dev setup` prompts hidden PayPal and local platform key entries with source links; checks client id/secret with sandbox OAuth; writes only git-ignored private .env, preserving other configuration and refusing links/interpolation. No token/key logging. Health lists missing names and guidance; guarded financial writes return 503 payments_not_configured even when all keys exist, until adapter qualification. Tier: unit-tested with fake OAuth and temporary files; initial setup/readiness regressions failed on missing modules. Tests cover OAuth success/failure, transport errors, unsafe/live input, duplicate config, permissions, symlink refusal, hidden entry and absent/partial/full readiness. No real sandbox credentials used. Hosted webhook registration, issuance and rotation are extracted to T-0150; local platform keys are supplied, not issued. Review/merge pending. Source: PR #13 review `5403306483`. Approved all five tasks in PR #21; green CI, squash merge `f5020ec` (213 unit / 44 real-Postgres / 100% domain coverage).
- `[ ]` T-0136 Remaining evidence work extracted from T-0025: server-validated capture-window provenance, platform-signal validation and actual novelty index/search. Keep missing/unverifiable evidence at WAIT; qualify real check adapters before claiming an end-to-end evidence gate.
- `[ ]` T-0137 Application pipeline must durably queue/retry packages arriving during REAUTHORIZE_PENDING, never drop or reject the evidence solely because renewal is in flight. Test submission mid-renewal, completion/rejection wake-up, ambiguous renewal and worker restart when the application layer is built. Source: PR #13 review.
- `[x]` T-0138 Reconcile ambiguous renewal past expiry before T-0027: read provider status and establish whether a renewal exists. If renewal is confirmed, adopt its id then run expiry against it; if no renewal exists and provider expiry/no payment is confirmed, record a matched expiry confirmation via a separate typed renewal-reconciliation exit. Unknown/contradictory status stays reserved with an alert. Tests: no renewal, late discovered renewal, incomplete lookup, conflicting capture and repeated reconciliation. Implement with durable operations/T-0056; Typed no-renewal expiry exit now unit-tested; regressions failed first. Late confirmed renewal adopts its id before expiry; unknown/mismatched/premature proof retains the reservation. Provider orchestration is now integration-tested under T-0056, with fake provider proof and real Postgres; approved. Approved all five tasks in PR #21; green CI, squash merge `f5020ec` (213 unit / 44 real-Postgres / 100% domain coverage).
- `[x]` T-0139 T-0132 schema and integration-harness slice: Drizzle/Postgres forward migrations, stable provider request UUID column, versioned stream and one unresolved operation across capture/void/renewal. Tier: integration-tested against local Postgres. Evidence: approved PR #16, green gated real-Postgres CI, squash merge `86ab9f2`. Tests: UUID reload through a new connection, concurrent insert exclusivity, malformed rows/duplicate UUIDs, immutable identity/terminal result/history, foreign keys and migration replay. Tests first exposed missing modules and absent history guards; the guard regressions are now green. Real DB tests run in Docker/pre-commit/CI with separate coverage gates. Transaction adapter is split into T-0140 to keep PRs bounded; full aggregate/hold/counter persistence and atomic coupling remain T-0132. Approved docs PR #14 merged as `994b47f`; no financial endpoint enabled.
- `[x]` T-0140 Transaction adapter over T-0139 schema: lock/version the tranche stream, reserve UUID and append event atomically, canonicalise JSONB intents, retain ambiguous reservations, reject changed keys/intent and stale versions, permit fresh keys after definite resolution. Acceptance: new operations and each operation's first event must start RESERVED with no reference; database insert guards and regressions first. Tier: integration-tested. Evidence: approved PR #18, green Docker/GitHub CI and squash merge `a62dff4`. Store tests cover all three intents across restart, competing reservations/outcomes, identical retries, audit-failure rollback and malformed/stale commands. Insert regressions failed first; 28 real-Postgres cases and full Docker/pre-commit pass; aggregate/counter coupling remains T-0132.

- `[x]` T-0141 PR #16 database follow-ups before T-0132 closes: enforce forward operation transitions and increasing versions; immutable server-set operation/event timestamps; valid event statuses and resolved references. Tier: integration-tested. Evidence: approved PR #17, green full Docker/GitHub CI and squash merge `1056457`. Three regression tests failed first, then nine real-Postgres tests passed, including the full 16-pair transition matrix, caller timestamp overrides and event validation. Full Docker validation passes; no payment executor is enabled.
- `[ ]` T-0142 Reviewer dashboard payment-operation rows once the adapter exists: expose unresolved operations, elapsed ambiguous time and the three-hour alert with the dispute timeline. Never imply an unknown payment outcome is settled.
- `[ ]` T-0143 Before first deployment, assess squashing the undeployed schema migrations. Preserve approved forward migration history for now; confirm no persistent environment has applied it before replacing it.

- `[x]` T-0144 T-0132 tranche recovery record: versioned JSON of the immutable definition and accepted domain transitions; replay only pure domain methods, including explicit clocks and already recorded decisions. Test list: exact pending/terminal state round trips; original/renewed hold history and nonce; stable ambiguous keys and fresh keys after definite rejection; settlement/renewal counters and resubmission bounds after restart; immutable input/history; malformed/unknown versions and illegal sequences fail closed. Tier: unit-tested. Evidence: approved PR #20, green full Docker/GitHub CI, squash merge `cd0028b`. Recovery tests first failed on the missing codec; all recovery cases and a 100-case retry property pass with 100% domain coverage. ADR-0011 records the replay format. No database coupling yet; keep T-0132 open.
- `[x]` T-0145 T-0132 atomic aggregate persistence after T-0144 and the T-0148 safe-mode floor: store/recover the full tranche record; append state transitions, reserve or resolve operations and append their events under one stream lock and transaction. Tests: rollback at every write boundary, crashes/restarts, competing transitions, no orphan state or operation and matching domain/provider identities. Preserve immutable prior transitions and make the aggregate version authoritative. Tier: integration-tested; 40 real-Postgres cases, restart/races and fault injection at all four write boundaries pass. Atomic implementation complete, approved and merged; T-0132 is closed by this approved merge. Approved all five tasks in PR #21; green CI, squash merge `f5020ec` (213 unit / 44 real-Postgres / 100% domain coverage).
- `[ ]` T-0146 Typed payment-store errors before the HTTP/PayPal adapter: codes for stale version, identity conflict, unresolved operation, missing stream/operation and invalid commands; map conflict/retry/not-found responses without matching messages. Test codes and safe mappings. Source: PR #18 review.
- `[ ]` T-0147 Dispatch guard before T-0027: call PayPal only for RESERVED/AMBIGUOUS records; a retried key already CONFIRMED/FAILED is done. Tests: no processor invocation for either resolved status, including after restart; stable request ID on allowed retries. Source: PR #18 review.

- `[x]` T-0148 Safe-mode recovery blocking first hosted deployment: older-rule records restore for cancel/expiry/reconciliation only; forbid new captures, authorisations and renewals, preserve pending identities and confirmed money facts. Test a stored older-rule fixture, immutable old decisions and restart after safe cancellation. Link this floor from T-0145. Before changing tranche replay semantics or rule-set versions: preserve historical reducers or migrate records explicitly; persisted-record compatibility tests must prove identical operation keys, counters, holds and settlements. Never silently reinterpret old history. Evidence: old-rule fixture regressions failed first, then passed with 100% domain coverage; unit-tested safe-mode floor, approved. Source: ADR-0012; historical reducers/migrations remain mandatory for operational-format changes. Approved all five tasks in PR #21; green CI, squash merge `f5020ec` (213 unit / 44 real-Postgres / 100% domain coverage).

- `[~]` T-0149 Durable reconciliation scheduler and owned alerts: database leases use SKIP LOCKED, fresh tokens and expiry; stale workers cannot finish newer leases. The worker reserves safe-mode cancellation automatically (including after an old pending capture is proved declined), polls exact provider proof, retains unknown outcomes and assigns durable deduplicated three-hour alerts to RECONCILIATION_OWNER. Tier: unit-tested and real-Postgres integration-tested, approved PR #23, merged 523c899. Local CLI is provider-status-read-only; cancellation submission still requires the qualified executor. Transaction Search / gate-bypass scan and external notification delivery are extracted to T-0155; actual sandbox qualification remains T-0121.

- `[ ]` T-0150 Hosted key onboarding after local T-0135: register the platform webhook URL, issue STOOD_API_KEY / STOOD_HMAC_SECRET once with copy-once display, preserve outbound STOOD_WEBHOOK_SECRET, support revocation/rotation and test tenant isolation. Local setup only collects existing platform keys; hosted onboarding must land before hosted platforms ship.

- `[x]` T-0151 Local setup follow-up: generate STOOD_API_KEY, STOOD_HMAC_SECRET and STOOD_WEBHOOK_SECRET with a cryptographically secure generator; display once, preserve existing configuration and test rotation separately from hosted issuance.
- `[x]` T-0152 Classify setup failures safely: distinguish rejected sandbox credentials, PayPal unavailable/timeout and invalid provider responses; never expose secrets, OAuth bodies or tokens.
- `[x]` T-0153 Atomic .env persistence: write a private temporary file in the same directory, sync and rename; test interruption leaves the previous configuration intact, with link/permission guards.

- `[~]` T-0154 Initial funding and Vault durability before full T-0027 / financial HTTP activation: reserve separate stable request IDs before order/setup-token creation and order authorisation; persist approval phases and provider identities; commit confirmed hold plus funding outcome in one transaction, exclude competing operations and reconcile ambiguous creation/authorisation across restart. Test before calling the provider and qualify against actual sandbox accounts. Current tranche adapter handles existing confirmed holds only. Next pre-key test list: durable exact reservation across restart; changed funding identity rejects; competing reservations have one winner; possible submission is recorded before provider calls; unknown outcomes retain the same IDs; unapproved/mismatched order never attaches a hold; confirmed hold and funding resolution roll back together; resolved callbacks are idempotent; no second hold for a resolved funding attempt. Financial HTTP remains disabled until signed mandate and funding qualification exist.

## Success gates (hackathon)

- All three outcomes on the hosted demo, with real PayPal sandbox objects visible.
- Judges can trigger every outcome themselves (fixtures + replay).
- Zero money-boundary violations. 100% branch coverage on decision and money.

## Failure gates (stop and re-plan)

- Week 1: the vaulted `AUTHORIZE` doesn't work and the buyer-present fallback also fails → re-plan the money model.
- End of week 3: the three outcomes aren't working in sandbox → Tier 3 partners become "documented, not built".

## Review pace (standing direction, 2026-10-04)

At least five tasks per review round, one PR and one signed Conventional commit per task with `Refs: T-xxxx`. PR evidence lists each task, tests first and files touched. The 400-line guideline is waived for batched rounds. Current batch: T-0148 safe recovery, T-0138 expiry reconciliation for renewal, T-0145 atomic persistence (T-0132), T-0056 provider-status core, T-0135 local setup/readiness. PayPal SDK/execution stays off.

- `[ ]` T-0155 Reconciliation audit and notification delivery before hosted payment deployment: paginate actual PayPal Transaction Search, join operation/decision identities and amounts, detect capture without release and release without capture after three hours, persist mismatches and deliver alerts through the notifier with deduplication/retry. Test pagination, mismatched money, provider outage and notification restart; qualify actual sandbox contracts. T-0149 supplies durable status-polling jobs and reviewer-owned alert rows only.

- `[ ]` T-0156 Complete T-0028 financial/evidence v1 workflows after T-0154: sign and version allowances with durable provider approval phases, dispatch only from confirmed funding, persist package/upload sessions and process trusted evidence (including T-0137 renewal queuing). Integrate qualified executor and reconciliation; enforce tenant ownership, HMAC, idempotency and typed conflicts on every route. Generate the OpenAPI/Zod contract under T-0053, add rate limits and qualify real sandbox code milestone flows and secondary site-visit wrong-plot/good flows. Current DRAFT/read endpoints are not the full v1 payment API.

## Next approved review round (2026-10-05)

PR #23 approved all five task slices at head 8e79493 and squash-merged as 523c899 (267 unit / 55 real-Postgres / domain 100%); PR #24 landing repositioning merged as 9eebf39 with the complete CI Docker/all-files gate. T-0027, T-0028 and T-0149 remain partial only for their explicitly extracted work, not because the reviewed slices lack approval. T-0131 and T-0061 are approved at the unit-tested/synthetic tier. Source: <https://github.com/ma-za-kpe/stood/pull/23#pullrequestreview-5414326247>.

- `[x]` T-0157 Align product docs with approved agent-to-agent/code-milestone direction: README hero, S01/S03/S09/S16, a code.milestone@1 rule profile and A2A/AP2 positioning. Frozen signed acceptance tests, unchanged test hashes, new commit, zero skipped tests, mutation threshold, budget mandate and outside usage signal; buyer/builder identity must not affect verdicts. Keep EyeOnSite as a scenario and Yard/protocol integration explicitly planned; preserve historical context. Source: PR #24.
- `[x]` T-0158 Before enabling money HTTP, allow one bounded re-submission of an ambiguous CAPTURE with the same persisted PayPal request ID only after complete matching no-capture proof, a still-capturable authorisation, current rules and fresh server-clock margin. Persist proof/claim/retry consumption before calling; racing workers and restarts cannot reset it. Never retry pending/contradictory/unknown outcomes, voids or renewals through this path. Test missed-send recovery, same ID, crash, competing workers, exhausted retry, stale proof and expired/old-rule/rental guards. Source: PR #23 review.
- `[ ]` T-0159 Trusted code-runner evidence ingestion before shipping code payments: authenticate signed runner/usage attestations bound to allowance, package and exact commit; verify frozen test hashes/counts, runner identity, mutation scope and budget/usage mandate. Never execute submitted code in the payment API or accept client-authored PASS results. T-0157 adds the profile/contract only; synthetic check results are not actual signed execution evidence.

Round: T-0157, T-0151/T-0152/T-0153 (reviewer-approved grouped setup task), T-0158, T-0137, T-0154 and T-0156; T-0155 is stretch. One signed commit per task, tests before behaviour. Real sandbox qualification remains operator-owned T-0121.

## Docs realignment audit (issue #29, 2026-10-05)

T-0157 includes the approved landing repositioning (PR #24, 9eebf39) and unit-tested code-profile contract; six regression tests failed first on the absent profile. Trusted execution remains T-0159. The full audit is split below, preserving one task per commit. ADR-0014 already exists, so the pivot uses ADR-0015.

- `[x]` T-0160 Align README, docs index, overview and usage quickstart with Adaeze/code milestones, USD amounts and truthful DRAFT/payment boundaries. Tier: designed documentation; offline links and full gate required.
- `[x]` T-0161 Realign product specs, sentence pairs, commit/report screens, six-beat demo, attack model, partner fit and profile parameters. Tier: designed; no runner/payment execution claim.
- `[x]` T-0162 Realign technical requirements, architecture, API examples, artifact model, pipeline, runner security, hosting and qualification plan. Tier: designed; sandbox technology remains undecided.
- `[x]` T-0163 Preserve research/ADR provenance with historical banners, record pivot in ADR-0015, align process/submission examples and audit old-story matches. Tier: designed; preserve historical body bytes.
- `[ ]` T-0164 Build/qualify isolated code runner: no network or secrets, non-root, read-only inputs, CPU/memory/time/process/disk limits, signed results. Choose sandbox technology in a separate ADR and prove escape/resource tests before shipping.
- `[ ]` T-0165 GitHub read-only adapter: pin repository/base/new commit, recompute test hashes, detect reused diffs, limit dependencies and paths; no write, push or merge credentials. Qualify immutable fetch and archive/path attacks.
- `[ ]` T-0166 Usage-release receipt: independent outside authority, allowance/commit/milestone binding, freshness/replay protection, human acceptance where required; reject builder self-attestation and circular demand.
- `[ ]` T-0167 A2A/AP2 surfaces: pin protocol contracts, identity/mandate/operator and tenant boundaries, conformance tests; never claim certification from positioning alone.
- `[-]` T-0168 Superseded by ADR-0016 and T-0174–T-0192: Yard is a separate product in this monorepo, with accountable operator, bounded test-agent subcontract and budget, traceable new commit, outside usage proof. Yard remains planned.

The documentation review round is T-0157 and T-0160–T-0163. The funding/evidence implementation round above remains queued; this audit does not close issue #25 or qualification blockers.

- `[x]` T-0169 Issue #29 addendum: make five code-milestone fixtures the default demo set; add separate payer/builder copy, honest synthetic responses, code-first judges curl and PR checklist. Preserve geofence tests and label field demo code/docs as site-visit scenarios. Tests first for fixture outcomes, copy and demo-disabled guards.

Issue #29 provenance audit: 27 historical research/source/ADR records receive banner-only changes; ADR-0015 records the pivot without replacing ADR-0014. T-0163 also completes the code attack table and audits scenario/process boundaries. Issue closure follows code-fixture addendum T-0169 and full CI. Other open implementation issues remain open until their scope is met.

T-0169 evidence: 11 fixture regressions failed first (new routes/copy and field labels absent); all 16 new cases then pass, including demo-off visibility. Synthetic code fixtures expose separate payer/builder sentences and never claim a runner/payment ran. Weak/usage WAIT retains the existing null namedField and named reason. Full Docker gate/CI is required before closing issue #29.

## Payment contracts and Yard foundation round (2026-10-05)

Approved PR #30 merged as 0f9b6bb; Yard docs PR #31 merged as 37d2bac. All previously open issues were closed at the product owner's request; #25 closed as tracker cleanup, not implementation completion. Its unfinished tasks remain open here. Latest Yard direction is one monorepo with separate product/runtime/database permissions, replacing the earlier separate-repository plan in T-0168.

- `[x]` T-0170 Final-only usage scoping: code.milestone@1 intermediate checks auto-release when trusted build evidence passes; code.final@1 adds outside usage/buyer acceptance. Bump rules to 1.2.0, prove 1.1.0 records restore cancellation/reconciliation-only, update default fixtures/docs. Tier target: unit-tested; no actual runner or money call.
- `[x]` T-0171 Signed runner report contract and fake runner adapter (T-0159 slice): bind tenant/allowance/package/repository/base/new commit and frozen test manifest; verify trusted signer, complete execution/counts/skips and bounded mutation/budget/usage facts. Reject malformed/tampered/replayed proof before deriving RULE findings. No code execution.
- `[x]` T-0172 T-0156 commit-package intake slice: durable tenant-owned repo/SHA/report references, idempotency and immutable body; no client-authored PASS, network fetch or execution. Durably queue during renewal; processing via a trusted verifier and wake-up worker remain required. Tier: HTTP unit-tested and real-Postgres integration-tested references only. Qualification remains separate.
- `[x]` T-0173 Fix worktree commit-time link validation: isolate the hook's own git environment, keep its pinned revision and all-files gate; reproduce in a throwaway worktree with inherited GIT_DIR. No skipped hooks.
- `[x]` T-0174 Yard monorepo foundations ADR and enforced no-shortcut dependency boundaries; allocate Y-A–Y-E ledger tasks, preserve separate schema/roles, caller-only SDK and side-effect-free Foreman. No new GPU spend or technology/model claims.

Next money tasks remain T-0158, T-0154 and full T-0156; local setup trio, renewal queue and qualification also remain required. A contract/fake adapter is not a durable funding implementation.

T-0170 evidence: all three regressions failed first; intermediate auto-release, final missing/supplied usage and 1.1.0 safe recovery now pass. Rules are 1.2.0; existing records must be cancelled/expired/reconciled, never silently upgraded into capturable records. This does not implement authenticated usage receipt intake.

T-0171: 18 signed fake-report cases pass after the missing verifier initially failed. Ed25519 signature verifies exact bounded payload, binding, runner/image, hashes, full test identities/skips, mutation and budget; stale/future/wrong-signer/tampered reports return no findings. Fixture proof is refused by default. The runner cannot supply usage_release. No repository code executes, no authenticated payer contract adapter exists yet, and this verifier is not wired to payments. T-0159 remains open for qualification and trusted agreement/usage intake.

T-0173 evidence: the original hook failed with exit 100 under inherited worktree GIT_DIR. The pinned 0.24.2 hook now runs with Git context variables removed; an actual signed documentation commit in an isolated worktree passed the link hook without skips. Same offline/file/anchor flags and CI gate.

## Yard implementation rounds (ADR-0016)

Y-A foundations: T-0174 supplies the designed ADR and tested import rules. The remaining five tasks form the next Yard foundation round; money blockers remain ahead of payment activation.

- `[x]` T-0175 Yard Hono skeleton and health endpoint, separate configuration; no money endpoints or Stood imports.
- `[x]` T-0176 Separate yard Postgres schema/role and migration owner; real-database tests prove no Stood-table grants or cross-schema writes.
- `[x]` T-0177 Blueprint/Milestone domain: versions, immutable signed terms, test hashes, intermediate/final profile binding; tests first.
- `[x]` T-0178 WorkOrder/Claim domain: one current claim, 48-hour lease, explicit expiry/recovery and outside-operator identity; property tests.
- `[x]` T-0179 Public HTTP Stood SDK contract: signed requests, typed errors and truthful DRAFT/QUEUED semantics, contract tests against local API. No internal imports.
- `[x]` T-0180 Y0 Yard page with Y09 tokens/voice and Stood nav link; accessible fixtures, planned-capability labels.

Y-B Foreman (depends on tested domains and runner isolation):

- `[~]` T-0181 PlannerModel port and paused Foreman graph; no action tools, external-write credentials or automatic approval.
- `[ ]` T-0182 Blueprint validation and red-first acceptance-test gate in a qualified isolated runner; empty scaffold must fail.
- `[~]` T-0183 Intake/repository prompt-injection corpus and tool-capability tests; reject tampering with signed terms.
- `[ ]` T-0184 Buyer-approved blueprint to Stood mandate after T-0154/full T-0156; frozen test bundle and final-only usage condition.
- `[~]` T-0185 Blueprint review UI: edit/merge/split/reprice and explicit approval, accessible timeline; qualify partner component terms.

Y-C Board (depends on funding/dispatch and qualified runner):

- `[~]` T-0186 Work-order posting, tenant-scoped discovery and atomic claim/lease storage; concurrent claimant tests.
- `[ ]` T-0187 Lease-to-confirmed-hold dispatch through public Stood API; durable intent/recovery, no invented hold.
- `[ ]` T-0188 GitHub App bootstrap and brokered branch/test permissions; prove token/repository/path attacks and branch restrictions.
- `[~]` T-0189 Submit SHA to Stood package, trusted webhook projection and punch list; signed deduplication, never infer paid from a passing assessment.
- `[ ]` T-0190 Handover and outside-operator reputation: independent final usage signal, refund/dispute projection and anti-self-dealing tests.

Y-D/Y-E:

- `[ ]` T-0191 Scripted demo Crew: ordinary Board caller, pass/tamper/skip/expired-lease fixtures and site log; clearly synthetic without sandbox evidence.
- `[-]` T-0192 Real Crew implementation moved to the separate closed project by ADR-0017 / Y21. This repo retains endpoint contracts and fake qualification under T-0191; no GPU spend here.

T-0174 evidence: six forbidden-import fixtures failed first, then pass with the dependency rules; the allowed HTTP SDK/contracts fixture passes. Runtime/database permission boundaries are designed and remain separate open tasks.

## Yard foundation implementation round (PRs #32/#33 merged)

T-0175–T-0179 implement the next foundation slices. Production Crew code is external; Y18 events, Y19 credentials and Y20 hosting require separate qualified implementation. Money blockers T-0154/T-0158/full T-0156 remain open.

- `[x]` T-0193 Apply Y21 external-Crew follow-up: ADR-0017, Y11/Y15 and ledger supersession; forbid production Crew graph edges, permit only contract/fake paths. Tier: designed boundary and dependency gate. Separate-repository placement does not prove capability isolation.

T-0175: three shell tests failed first on the absent module. Yard health and guarded workflows are unit-tested; the opt-in local Docker service uses YARD_ENV/YARD_PORT only and receives no Stood or PayPal credentials. No Board, model, SSE, secret storage or funding workflow is exposed.

T-0177: five blueprint tests (including 500 property cases) pass after the absent domain failed first. DRAFT edits preserve prior versions; FROZEN copies require matching buyer/version/test hashes/red-baseline references and cannot change. Integer budget sums use BigInt; intermediate/final profiles are fixed by position. FROZEN is local terms only, not cryptographic approval or a Stood SIGNED mandate. Verified approval/red-runner receipt loading remains T-0182/T-0184. Yard domain coverage is enforced at 100%, separately from Stood.

T-0178: lease-domain tests failed first on the absent aggregate; six cases plus 500 random command-sequence properties cover one active claim, fixed 48-hour expiry, no replay extension, explicit clock-out/repost and rejection without mutation. SUBMITTED/CHECKING cannot automatically expire or reopen. Operator roots are recorded for reputation only; the authenticated registry must supply them. No PAID state or provider operation exists in this aggregate. Concurrent durable claiming and Stood-signed projections remain T-0186/T-0189.

T-0176: six real-Postgres cases run against all actual Stood migrations in a random test database with unique owner/runtime roles and a fresh restricted login. Provisioning is transactional/idempotent and rejects privileged roles, membership, Stood-table grants, executable public SECURITY DEFINER functions and another schema owner. Runtime cannot access Stood tables, create schema objects, truncate Yard tables or write migration history; future Yard tables receive scoped CRUD defaults. Injected late failure rolls the schema back. Roles/passwords are operator-created; no admin/runtime database credentials are passed to the Yard HTTP shell and no hosted provisioning occurred.

T-0179: public server-side SDK contract-tested against the actual local Stood HTTP router with fake storage. Eight SDK cases cover signed DRAFT/QUEUED requests and reads, typed conflicts/validation/auth/missing/unavailable errors, malformed or unbound receipts, bounded bodies, timeouts and no network retry. A failing browser-import graph test precedes its server-only boundary. Dispatch, signing, financial commands and webhook verification remain full T-0156/T-0053; no financial authority is exposed by this slice. Additional graph fixtures qualify the T-0193 external-Crew/fake boundary.

- `[~]` T-0194 Y18 durable project events and SSE: commit projection and gap-free per-stream sequence together; use sequence as SSE resume ID and event UUID for deduplication, replay limits/snapshot.required, role-filtered payloads, direct LISTEN connection and honest stale/gap UI. Real-Postgres concurrency/rollback and recorded-stream/chaos tests; money states require qualified Stood messages.
- `[ ]` T-0195 Y19 intake/access boundary: choices before credentials, signing gate, provider-qualified TEST/DEV scope (patterns alone cannot prove environment), encrypted write-only storage, audited preview-only decrypt, revocation/7-day deletion, no secrets in prompts/logs/events/builders. Qualify scanner/KMS/provider checks before enabling secret intake.
- `[ ]` T-0196 Y20 hybrid hosting ADR and qualified previews/handover: buyer-owned repo, pinned image identity, isolated test-data previews with bounded cost/TTL/teardown, production secrets entered only in buyer hosting and verified account/commit/usage proof. Health reachability alone is insufficient final evidence. Demo fixtures first; no automatic spend or cloud provisioning.

## Full Stood and Yard backlog (product owner request, 2026-10-05)

Everything still foreseen for **Stood** and **Yard** that wasn't yet a task. The external Crew project (ADR-0017 / Y21) is **excluded**: its models, GPU lifecycle and graph live in the separate repository. This repo keeps only the public Board surfaces any operator uses, plus the contract fake (T-0191). Status corrections: T-0019 and T-0020 are done (develop is the default branch, `protect-main` / `protect-develop` rulesets, homepage set, v0.1.0 released 2026-10-03, v0.2.0 released 2026-10-05).

### Stood

- `[x]` T-0197 Runner signing key id and rotation (PR #32 review follow-up): reports carry a key id; the verifier holds a key set with validity windows; revoked or expired keys refuse; overlap window tested. No key material in Git.
- `[ ]` T-0198 Promote develop to main as v0.3.0 once #34 lands: release-please, back-merge, verify the live site and changelog, and link the Yard docs from the README.
- `[ ]` T-0199 Brand generators for Stood and Yard under `tools/brand/` (extends T-0015): pinned OFL fonts, run in Docker, deterministic SVG output, and a CI check that committed assets match the generator. PNG store/social exports produced at release, not committed.

### Yard: design system and web app (Y17, Y18, Y10)

- `[x]` T-0200 Yard design tokens (Y17 §2, §9): one CSS token file shared by `site/yard/` and `apps/yard-web`, dark default + paper theme, font fallbacks. A CI test recomputes every documented contrast ratio and fails below AA.
- `[~]` T-0201 Yard component kit with every Y17 §5 state: button (pending), status chips, Stood verdict chip imported from Stood's kit (never restyled), work-order card (optimistic/stale), milestone row, lease timer, progress rail, site log, connection pill, secret field, Foreman message, punch list, empty state. Reduced-motion, greyscale and axe checks.
- `[~]` T-0202 `apps/yard-web` shell (React + Vite): TanStack Query, XState, Zustand and React Hook Form + Zod wired per Y18 §4; the client event applier consumes T-0194 (pure `applyEvent`, gap → snapshot, shared transition table from `packages/yard-domain`). Money states are never optimistic: a test asserts no PAID/REFUSED render without a Stood-originated event.
- `[~]` T-0203 Intake wizard UI (Y19 steps 1–8): XState wizard, autosave via `intake.saved`, shared Zod schemas, "Let the Foreman decide" on every step, plain-language summary before signing, and the free-text secret scanner that blocks a pasted key. Step 9 (keys) waits for T-0195.
- `[~]` T-0204 Project room (Y10 #5): milestone cards, progress rail, per-milestone preview URL, Stood chips, connection pill, burst summaries ("Caught up: 14 updates"), and focus-safe live updates (a focused card never moves).
- `[~]` T-0205 Builder Board and work-order screens (Y10 #7, #8): filters, keyboard navigation across columns, lease timer, read-only signed tests, submit SHA, punch list. Qualify AG Grid terms before adopting it.
- `[x]` T-0206 Site log (Y21 §4, Y10 #9): per-work-order stream with its own sequence, at most 1 write per second per builder, fixed kinds, every line secret-scanned before storage, 90-day retention then summary. Not an aria-live region.
- `[ ]` T-0207 Handover screen and rotation checklist (Y20 §5): Deploy to Render button from `render.yaml`, `HANDOVER.md` generator listing every variable, the nine checklist items (auto items shown done), and `handover.rotation_confirmed` gating CLOSED, independent of Stood's final release. Depends on T-0196.
- `[x]` T-0208 Yard page assets: wire the `docs/brand/yard/` mark, family lockup, favicon and OG card into `site/yard/` (with T-0180) and add the "Yard →" link and family lockup to Stood's landing page.

### Yard: Board, operators and protocol

- `[ ]` T-0209 Operators and payees (Y12, Y13): operator registration, PayPal payee reference only (never credentials), operator keys + HMAC with key id and rotation, operator-level claim caps and Sybil limits. Tests for the outside-buyer reputation rule.
- `[ ]` T-0210 Board A2A surface: `/.well-known/agent.json` (`post-work-order`, `claim-work-order`, `submit-work`, `create-blueprint`), A2A task ↔ work-order mapping, punch lists as task messages, conformance tests. Plus open, signed operator nudge webhooks any operator may register; the Board must work fully without them.
- `[ ]` T-0211 Work-order discovery: Postgres full-text search first, Elastic qualified later (T-0032). Public Board stream carries posted/claimed/paid only, with no buyer identity.
- `[ ]` T-0212 Change orders after signing (Y12): a signed blueprint version stays immutable; a change order creates a new version, re-runs Foreman checks, needs buyer re-approval and a Stood allowance amendment. No silent edits to frozen tests.
- `[ ]` T-0213 Yard notifications (email first, Zapier optional): paid, punch list, lease expiring, preview ready, handover ready. Driven by events, idempotent, with no secrets or amounts beyond what the recipient may see.

### Yard: operations, business and submission

- `[ ]` T-0214 Deploy `yard-api` and `yard-web` on Render as separate services with the restricted database role from T-0176; durable jobs (Render Workflows or pg-boss) for lease expiry, next-milestone posting, preview TTL teardown and handover reminders.
- `[ ]` T-0215 Yard developer surfaces: OpenAPI for `/yard/v1` with a breaking-change diff in CI, a Postman workspace, and an APIMatic-generated Yard SDK / MCP. Qualify partner terms first.
- `[~]` T-0216 Pricing and platform-fee ADR (Y13): owner-selected free pilot followed by a visible platform fee recorded in ADR-0019; no rate or charging activation approved. Fees and preview/provider costs must be separate blueprint line items within the approved cap, with disclosure before signing and immutable signed prices. Cost-line schemas, UI and tests remain open. Required before any real money.
- `[ ]` T-0217 Yard privacy and data: intake data classification (GDPR / NDPR / POPIA / Kenya DPA), export and deletion of blueprint data, retention per Y18, consent copy for agent and human builders.
- `[ ]` T-0218 Yard demo and judge path: describe → sign → milestone paid → punch list → handover, across Yard and Stood, with honest "synthetic" labels; fits the 90s video (T-0041) and the judges' fixtures.

### Provider abstraction: fake, simulator and live (product owner request, 2026-10-05)

We don't have provider keys yet. Every external service sits behind a port with **three interchangeable implementations**, so the whole product runs and is tested today, and switching to real keys is configuration, not a rewrite:

- **fake:** in-memory, deterministic, scriptable scenarios, used by unit tests.
- **simulator:** a local HTTP server that speaks the provider's real wire protocol, so the **real SDK** runs against it unchanged. Used in Docker dev, integration tests and the demo.
- **live:** the real provider, enabled only when keys are present and validated.

Rules: production code imports ports only; fakes and simulators never ship in a production build; there's no silent fallback from live to a mock; every simulated result is labelled as simulated in the API and UI.

- `[x]` T-0219 Provider abstraction ADR: the port inventory (PayPal, runner, GitHub, Render, KMS/secret store, email, object storage, LLM planner, search, browser QA, Stood-for-Yard, Crew endpoint), the fake / simulator / live modes, per-provider mode configuration (`PROVIDER_PAYPAL=fake|sim|live` …), and the rules above. A dependency-cruiser rule forbids production entry points importing `**/fakes/**` or `**/simulators/**`.
- `[~]` T-0220 Provider registry and boot-time readiness: one composition root picks each adapter from configuration; live mode requires its keys and a passing readiness check, or the service refuses to start with a named error (never a crash, never a fallback). `/health` reports each provider's mode. Production (`APP_ENV=production`) refuses fake/simulator for money and evidence providers. PR #37 follow-up: share one controllable clock between Stood and the simulators; registry lookups return the port's type, and startup errors carry a sanitised reason without exposing credentials.
- `[~]` T-0221 Shared port contract suites: one test suite per port, run against fake and simulator in CI, and against live in the nightly sandbox job (T-0096) once keys exist. A fake that drifts from the contract fails CI.
- `[~]` T-0222 PayPal simulator: stateful Orders v2 (create, AUTHORIZE), Payments v2 (capture, void, reauthorize, get), OAuth tokens, Vault/setup tokens (T-0154) and webhooks, derived from PayPal's published OpenAPI specs. The pinned Server SDK 2.5.0 runs against it through `PAYPAL_BASE_URL`. A controllable clock covers the honor period, day-four reauthorisation and 29-day expiry. PR #37 follow-up: reject repeat renewals, allow omitted renewal amounts, inject login-token faults, default standalone listening to localhost, and deliver signed simulated webhooks to Stood without weakening live verification.
- `[~]` T-0223 Fault injection for every simulator: timeouts, 5xx, rate limits, malformed bodies, duplicate and out-of-order webhooks, and **ambiguous outcomes** (request applied but response lost). Scenario files drive the T-0158 ambiguous-retry and reconciliation (T-0149, T-0155) tests.
- `[ ]` T-0224 Record and verify against the real sandbox once keys arrive: capture sanitised sandbox exchanges (no tokens, ids rewritten), diff them against the simulator, and fail when they drift. Update the simulator from the recordings, never the other way round.
- `[~]` T-0225 GitHub simulator / fake for the Yard GitHub App (T-0188, T-0165): installation tokens scoped to one repo, repo creation in the buyer's account, branch protections, `wo/*` pushes, PR merge, read-only fetch by commit SHA, archive download. Includes the token/repo/path attack cases.
- `[ ]` T-0226 Render API fake for previews and handover (T-0196, T-0207, T-0214): create a service from an image, set env vars, deploy status, delete, TTL teardown, and a `render.yaml` Blueprint validator for the Deploy to Render path. No real spend in tests.
- `[ ]` T-0227 Secret-store port (T-0195): local libsodium sealed-box adapter for dev/demo and a KMS adapter for live, with the same write-only contract (no read-back API), audit rows on decrypt and rotation tests.
- `[ ]` T-0228 Fakes for the remaining ports: email (Mailpit already in Compose), object storage (SeaweedFS already in Compose), LLM `PlannerModel` (scripted plus record/replay of real runs, T-0181), search (Postgres FTS vs Elastic, T-0211), browser QA (Kernel), notifications (Zapier), and the Crew dispatch endpoint (shares T-0191's contract fake).
- `[~]` T-0229 Stood fake for Yard: a local server implementing Stood's public `/v1` and signed webhooks from the same contracts as `packages/stood-sdk` (T-0179), with scripted RELEASE / REFUSE / WAIT. Yard's tests and demo run with no Stood database or PayPal at all.
- `[~]` T-0230 Switching guide in `docs/USAGE.md`: "Run everything without keys" (one command, simulators on), then "Switch a provider to live": the keys needed, where they come from, `scripts/dev setup`, the readiness output, and how to switch back. The README badge and `/health` show which providers are simulated.
- `[~]` T-0231 Crew simulator, the fake engineering team (product owner request): a local service implementing the full Y21 dispatch API (`/health`, agent card, `/nudges`, `/jobs/{id}`, cancel) **and** acting as an ordinary Board builder: it evaluates fit, clocks in, streams site-log lines, pushes commits to the GitHub fake (T-0225), submits SHAs and reacts to punch lists. Scenario files script each run (passes first time, fails then fixes, tampers with signed tests, skips tests, abandons honestly, declines on price, lease expires, endpoint down). It reports simulated GPU minutes and cost so Y13 economics and the operator dashboard can be built now. Selected by `PROVIDER_CREW=fake|sim|live`. When the real Crew project ships, `live` points at its endpoint and must pass the same Y21 contract suite (T-0221) before it's enabled. Extends T-0191; no model, GPU or Vast code in this repo.

### End-to-end integration tests: mock and live (product owner request, 2026-10-05)

Two suites run the **same scenario scripts** through the complete Stood and Yard flows. Only the provider configuration differs. The mock suite must pass now and on every PR. The live suite is written now and enabled once every key and real service exists.

**Scenarios both suites cover:**

- **Stood:**
  - allowance draft → buyer approval → dispatch hold ("held, not paid")
  - commit package → signed runner report → RELEASE (capture), REFUSE (void + punch list) and WAIT (in review)
  - day-four reauthorisation, expiry, ambiguous capture → reconciliation, signed webhooks and receipts
- **Yard:**
  - intake → Foreman blueprint → buyer edits and approves → Stood allowance → work orders posted
  - Crew claims → builds → Stood check → milestone paid
  - a refused attempt → punch list → rework → paid
  - lease expiry → reposted
  - preview deployed → handover in the buyer's own account → final usage release → rotation checklist → CLOSED
- **Money consistency, asserted at the end of every scenario:** Stood's ledger, Yard's projection, the event stream and the provider's state (simulator or sandbox) all agree. Nothing is paid twice, and nothing is shown as paid that wasn't captured.

- `[~]` T-0232 Shared E2E scenario definitions: one scenario file per flow above (steps, expected events, expected money state), plus Playwright page objects for the Yard and Stood screens. Both suites import the same files, so mock and live can't drift apart.
- `[~]` T-0233 **Mock E2E suite (required, must pass):** `docker compose` brings up Stood, Yard, Postgres and every simulator (PayPal T-0222, GitHub T-0225, Render T-0226, Crew T-0231, Stood webhooks, email, storage, planner replay) with a controllable clock. It runs every T-0232 scenario through the HTTP APIs **and** the browser (Playwright), including fault-injected runs (T-0223). It runs on every PR as a required check and in under 10 minutes, with traces, screenshots and the event log uploaded on failure. Also the judges' one-command demo.
- `[ ]` T-0234 **Live E2E suite (enabled when keys exist):** the same T-0232 scenarios against the PayPal sandbox, a real GitHub App on a test org, a real Render preview workspace with spend caps, and the real Crew endpoint once it passes its contract suite. Manual trigger plus nightly; skipped with a clear "keys not configured" result until T-0121 and the other credentials are in place. Sandbox only, never live money. It tears down every resource it creates and records sanitised exchanges for T-0224.

### Product presentation direction (product owner, 2026-10-05)

- `[~]` T-0235 Yard visual quality and honest simulation messaging: deliver T-0180/T-0200/T-0208 with the energy and visual polish of Stood's landing page, using Yard's Y17 blueprint grid, hi-vis amber, crane mark and purposeful build motion. Connect both pages with the family lockup and clear navigation. Put a prominent simulation notice in the project README, Stood landing page and Yard landing page/demo: current demos use synthetic evidence and simulated outcomes; no payment is executed. As T-0220/T-0230 enable individual services, show the actual per-provider mode rather than implying all services are live because one key exists. Real keys enable only qualified sandbox adapters under the sandbox-only policy; they do not authorise real-money production. Visually review desktop and mobile alongside Stood, and verify contrast, reduced motion and accessible status labels. Test that simulated/sandbox labels persist through navigation and every demo outcome; changing provider mode must never relabel synthetic fixtures as real results. This is queued direction, not a claim that the new presentation or mode switching has shipped.

## Provider simulation round (2026-10-05)

T-0233 follow-up round: `scripts/dev mock` executes all seven shared Stood integration scenarios against a randomly named local Postgres database with migrations replayed, actual signed draft/package/read HTTP, real SDK → HTTP simulator, shared controlled time and signed duplicate/reversed webhook hints. Final checks compare recovered domain, public signed projection, payment ledger/event history and provider state/references; lost capture restores through a new database connection and never resubmits. These cases are automatically included in the existing gated real-Postgres CI suite. Approval/authorization and check reports remain named fixtures; domain dispatch/assessment are operator fixture actions, not financial HTTP or signed runner evidence. This is the first mock integration slice, not the complete browser/Yard E2E suite: those flows, durable webhook ingestion, full provider Compose and trace/screenshot artifacts remain open. No real keys or money are used.

T-0231 follow-up round: a test-only Hono dispatch fake provides the Y21 health/card/nudge/job/cancel shapes with fixed synthetic HMAC/key-ID authentication and explicit simulation/cost labels. Eight scenario files run through the typed ordinary Board port and scoped GitHub fake: normal build, punch-list rework, tampering rejected by repository policy, skipped-test attempt, abandonment, price decline, lease expiry and outage. Nudge-off polling works, repeated nudges do not duplicate claims, and unresolved submitted jobs cannot be cancelled as if their check disappeared. No Board database, Stood internals, models, GPUs or payment methods are available to Crew. Real Board workflows, request throttling/SSE streaming, Compose/runtime selection, HTTP-client/external Crew contract qualification and actual Stood verdicts for its submissions remain open.

T-0232 follow-up round: seven provider-neutral Stood scenario files cover release, refusal, uncertainty, final usage pending, renewal, expiry and lost-capture recovery. A validated immutable step interpreter accepts only known actions and requires matching domain/ledger/provider state and settlement references, with zero/one capture and no real money. Definition and contradictory-evidence regressions preceded implementation. The mock driver follows in T-0233; live qualification, signed runner ingestion, expected event timelines, Yard scenarios and browser page objects remain open. Fixture authorization/report steps are explicit, not presented as buyer approval or authentic runner evidence.

T-0225 follow-up round: typed repository port and independent in-memory fake cover buyer-installation ownership, one-repository/hour-long tokens, one `wo/*` branch per builder token, protected tests/workflows/main, immutable commit reads and compare-and-swap pushes/maintainer merges. Failing-first tests exercise foreign repositories, expired tokens, forged installation IDs, stale heads and traversal/inherited-property attacks. Archives are explicitly labelled fixture JSON, not Git tarballs, and hashes are synthetic commit identifiers. GitHub HTTP/SDK protocol fidelity, real tar archives, installation qualification and Stood-gated merge orchestration remain open with T-0188/T-0224; this fake cannot confirm payments.

T-0229 follow-up round: test-only Hono fake serves the existing code-milestone DRAFT/package SDK surface over actual loopback HTTP, with fixed synthetic HMAC credentials, request-size limits, exact request replay/conflict and unknown-resource guards. Three fresh scenarios emit visibly synthetic RELEASE/REFUSE/WAIT events with signed envelopes; retries keep event IDs and resolved outcomes cannot change. These tests use neither Stood/Postgres nor PayPal. Shared webhook consumption, full future financial API contracts, Compose selection and the Yard product demo remain open; this is not a claim that Yard can yet show a confirmed payment.

T-0219: designed and graph-tested. ADR-0018 inventories current and planned ports, distinguishes fake/HTTP simulator/provider adapters, and keeps sandbox qualification separate. A failing production-fake import test now passes with the new dependency boundary. T-0220–T-0223 follow in this round; full multi-provider E2E remains T-0233.

T-0220: unit-tested registry foundation: explicit selection, whole-plan validation, required key names, positive readiness with bounded deadline/AbortSignal, sanitised named errors, no fallback and production mock rejection. HTTP health can report the immutable boot snapshot while paymentReady stays false. Full Stood/Yard composition wiring for all planned adapters remains open; an empty providers array means no providers were booted.

T-0220 follow-up: Stood's server now explicitly selects the PayPal simulator or sandbox transport, validates readiness through the real SDK, reports the actual mode and reads the simulator's shared clock for each HTTP request. One captured instant covers all rules/authentication in that request; unavailable time yields 503 without wall-clock fallback. Typed registry lookups and bounded sanitised startup reasons have regressions. Unsupported/unimplemented modes and other providers refuse boot; in-memory fake composition and the remaining ports are still open. No financial mutation route is enabled by this wiring.

T-0221: shared PayPal transport contract scenarios first implemented against an independent in-memory fake: one capture, same-ID replay, cancel, day-four renewal, expiry and unknown identity. Missing-fake import failed first. The identical suite will run through the real SDK/HTTP simulator in T-0222. Other planned ports and the qualified nightly sandbox run remain open.

T-0222: unit-tested synthetic HTTP subset with real pinned SDK capture/void/renewal/status contracts, separate order/Vault protocol tests, explicit approval, synthetic OAuth, stable IDs, fixed controllable clock, original expiry and a regression preventing two captures across renewal lineage. Source specs are pinned in services/simulators/paypal-specs.json. Separate localhost-only Compose service; no simulator dependency in API production package. SDK OAuth is redirected at HTTP-client configuration (request-builder interception alone was insufficient and failed the contract tests). Webhook delivery/signature verification, full Vault funding SDK coverage and sandbox fidelity remain open; T-0224 requires keys.

T-0222 follow-up to PR #37: failing-first regressions now cover omitted renewal amounts, attempts to renew the original or renewed authorization a second time, and synthetic OAuth faults without consuming faults on invalid credentials. The independent fake and HTTP SDK share a stronger second-renewal rejection contract. The simulator README records PayPal's conflicting renewal guidance; the conservative single-renewal subset awaits actual sandbox qualification. T-0220 adds the shared runtime clock; signed local webhook delivery and guarded reconciliation-hint ingestion are tested in this batch. Non-boolean verification and array resources are rejected. Live PayPal verification and durable webhook ingestion remain open. This local follow-up does not activate payments.

T-0223: unit-tested reusable fault plans and PayPal HTTP wiring: exact one-shot routes, 500/429, malformed JSON, explicit timeout gates, post-apply lost responses, and copied duplicate/out-of-order event replay. JSON capture scenarios exercise the real SDK; failing fault tests preceded middleware. Real-domain executor/reconciler tests prove a lost capture/void response remains ambiguous, cannot be resubmitted and resolves via matching HTTP lookups. These tests use an in-memory tranche store; existing PostgreSQL evidence is separate. Other simulators, signed webhook delivery and complete fault-injected E2E remain open with T-0233.

T-0235: implemented README and Stood hero simulation notices, with a failing-first presentation regression ensuring the notice precedes the sample verdict/quickstart. README now acknowledges shipped domain/SDK foundations without implying financial activation. Static copy checks are not browser accessibility evidence. Yard visual implementation, connected-page review and actual per-provider UI remain queued with T-0180/T-0208/T-0220. This branch is not the published main site.

- `[x]` T-0236 Exclude test fakes and simulator harnesses from production API artifacts. Discovery: pnpm deploy --prod copied services/api/test/fakes/paypal.ts and the simulator harness despite the dependency guard. Add an actual build/deploy regression, explicitly package compiled runtime files and required SQL migration assets only, and inspect the release for fake/simulator/test sources and provider-simulator dependencies.

T-0236: unit-tested real production-package evidence. The build/deploy regression first found raw src/test/.turbo/config files and a payment fake in the release; it now verifies only dist, SQL migrations and package manifest (plus runtime dependencies), a valid server entrypoint, no compiled test/fake/simulator paths, and no provider-simulator dependency. No hooks skipped; not a hosted deployment.

## Yard network round after PR #38

- `[x]` T-0237 Reconciliation uses the same explicit provider selection and controlled clock as the API. Reject simulated webhook headers/bodies in live mode before verification or enqueue. Tests first: simulator worker readiness/time, missing selection refuses work, live rejects synthetic signatures even with an accepting verifier.
- `[~]` T-0194 Durable Yard project events and SSE slice: transactionally numbered events, authenticated replay, gap/snapshot signalling and disconnect cleanup. Tests first: ordered replay, foreign-project isolation and rollback.
- `[~]` T-0186 Durable Board slice: frozen blueprint posting, server-owned operator identities, atomic 48-hour claims, exact command replay/conflicts, submission and Stood-only payment projection. Tests first: concurrent claimants, stale commands, foreign operators and duplicate/conflicting settlement notifications. No direct Stood database access.
- `[~]` T-0233 Network mock slice: a separate Docker mock stack with fixed synthetic credentials, disposable databases and real HTTP services. Run shared Stood scenarios and the Yard flow as a required CI check; retain the existing fast integration suite. Tests first: missing services fail, provider/ledger/history references agree.
- `[~]` T-0232 First network Yard scenario: frozen terms → posted → ordinary Crew claim/build/submit → simulated Stood confirmed capture → signed notification → paid projection. Test that a passing assessment alone never sets PAID and unknown/forged notifications cannot do so. Full funding API and authentic runner evidence remain T-0154/T-0156.
- `[x]` T-0180 Yard landing page with Y17 tokens, outlined brand assets, connected Stood navigation, responsive layout, motion respecting reduced-motion preference and prominent simulation labels. Tests first: notice before verdict, accessible controls and both-side links. Browser smoke is a stretch; never imply the planner/Crew/live integrations shipped.

T-0237: failing-first regressions reproduced live acceptance of synthetic notifications and missing shared worker composition. The CLI now requires explicit provider selection, boots the common runtime, reads controlled time per tick and freezes that instant through reconciliation. Live/unconfigured receivers reject simulation headers or any simulation field before verifier invocation. Simulator tests use no real keys. This does not activate webhook ingestion or real payments.

T-0194 event slice: failing-first real-Postgres and stream regressions now pass for atomic state/event/receipt writes, competing stale versions, exact replay/conflict, rollback, append-only history, authenticated project replay, cursor validation and snapshot-required gaps. Runtime uses a restricted Yard role. SSE currently polls the durable log; LISTEN/NOTIFY, public role-filtered streams and site-log retention remain open.

T-0186 durable Board slice: failing-first real-Postgres and signed HTTP tests prove one concurrent claimant, exact replay/conflict, server-owned identities, private-project denial, protected terms and checking-only submission. A Stood-authenticated integration obtains matching read proof before a capture-only PAID projection; unknown/mismatched/duplicate/conflicting notifications are tested. Full operator/payee registration, funding, expiry/repost and refusal/rework remain open. The first consuming workspace now builds Yard's domain before typechecking. Injected workspace builds sync after scripts, and production deploy uses the existing content-addressable store offline with a dedicated lockfile; release tests still assert no test/fake/simulator implementation or simulator dependency, with bounded child-process deadlines. This fixes observed legacy deploy re-resolution timeouts rather than removing the packaging check.

T-0233 network slice: all seven shared Stood definitions passed through a separate Docker project with actual Stood/PayPal HTTP services, restricted Postgres-backed Yard health, migrations from scratch, controlled time and signed duplicate/reversed notifications. Lost capture remains ambiguous, is never blindly resubmitted, and restores through a new database connection; provider capture invoice, domain/ledger references and latest audit status agree. Missing mock endpoints failed first. The non-conditional `mock-network` CI job has a ten-minute budget. Fixed synthetic setup/assessment controls are test-only; this is not the qualified financial API, full Yard/browser suite or hosted demo. Cleanup removes only the randomly named stack's volumes and leaves ordinary local services alone.

T-0232 first Yard network slice: the connected scenario uses frozen local fixture terms, persisted Board claims, the normal simulated Crew contract, scoped fake GitHub pushes and server-side SDK package submission. A completed submit retry returns its recorded receipt without an external call; changed keys/commits are rejected. That HTTP retry regression failed first. Yard stays CHECKING after assessment, rejects a forged notification, and projects PAID only after matching signed Stood proof. Event replay and provider/ledger/reference agreement are asserted. Full funding, authentic runner evidence, durable cross-service submission outbox, refusal/rework and remaining browser scenarios stay open. No live keys or money.

T-0180: the Yard static page uses Y17 colours/type, drafting grid, crane motion, outlined Yard logo/favicon/social card and Stood’s existing money stamps. Connected navigation joins both pages; T-0208 finishes the Stood footer family lockup. A missing-page presentation test failed first, then passed; real Docker Chromium checks cover desktop/mobile, keyboard scenario controls, reduced motion and missing assets, with screenshots. Both-page simulation notices precede sample verdicts. The page is illustrative, not a live Board; full Yard application screens and browser flow definitions remain open. Publishing awaits promotion to main.

- `[x]` T-0238 Durable Yard submission outbox before enabling the SDK submission bridge outside the mock stack: persist the exact tenant/claim/terms-bound request before sending, reuse one key on recovery, attach only a matching package receipt, and resolve orphaned package intake. Test crashes on both sides of the HTTP call, duplicate/racing workers and changed terms/identity. This bridge has no payment authority.

T-0208: outlined Yard assets and the family lockup now join both landing pages. A Docker browser regression failed on the missing Stood footer lockup before wiring it; desktop/mobile checks load the actual SVG and follow its link back to Yard. The existing nav link remains available on mobile. All examples remain simulated; no promotion to main or payment activation.

## Pre-credentials completion batch — issue #41 (2026-10-05)

Product-owner direction: one next PR containing all work that can be implemented and verified without keys. Do not ask for credentials during this batch. Provider qualification, paid partner access, hosted deployment and actual sandbox recordings follow the credential handoff. Complete mock evidence is not live qualification. Preserve one Conventional DCO commit per task and tests first; do not close partially delivered tasks merely because a foundation exists.

- `[x]` T-0239 Board discovery pagination and privacy (PR #39 review): keyset pages expose a continuation cursor, including open work beyond project 100; public listings omit buyer repository/base commit/identity. Evidence: failing real-Postgres test first, then 77 database cases passed; 105 projects, no skipped page, invalid cursor, scoped claimed-project access remains.
- `[x]` T-0240 Shared Yard event clock (PR #39 review): server-owned injected mock time for durable events; production defaults to database time. Evidence: real-Postgres regression failed on wall time first; create and mutation timestamps now follow controlled time, and HTTP cannot supply event time.
- `[x]` T-0241 Event subscription fanout (PR #39 review): replace one poll per viewer with database notification wakeups and bounded shared fallback; consecutive replay and snapshot-on-gap remain authoritative. Evidence: database subscription regression failed first; committed-only wakeups, shared listeners, concurrent viewers, notification loss fallback and disconnect cleanup are tested.
- `[x]` T-0242 Verify CI cancellation policy (PR #39 review): retain ref-scoped cancel-in-progress so new pushes supersede older runs, and document reruns of runner-starved jobs.

The batch includes the pre-key implementation portions of T-0154/T-0158/T-0156, T-0159/T-0164–T-0166, T-0181–T-0189, T-0190/T-0194–T-0196, T-0200–T-0218, T-0220–T-0233 and T-0238. Existing task acceptance criteria remain the source of truth. Audit the wider ledger for additional key-independent gaps before declaring handoff ready. Non-engineering owner decisions and live qualification stay explicit; credentials cannot substitute for unresolved design or missing services.

Handoff requires: full mock judge journey including refusal/rework and lease expiry/repost, connected browser application, restart-safe payment/submission paths, provider-mode/readiness reporting, secure key intake/setup and deployment manifests, green required gates, a per-provider key inventory with scopes, and an explicit list of tests deferred until keys arrive. Notify the owner at the Hosting and credentials handoff before requesting any keys. PR #39 merged as 1f3d5f1; all six required/reporting checks passed after the runner-starved jobs were rerun.

T-0181 first implementation: pinned LangGraph.js 1.4.19 draft → persisted buyer-review interrupt, strict proposed-blueprint validation, immutable intake scope/budget/identity and final-only usage profile. Acceptance returns READY_FOR_BASELINE, never signing/payment authority. Seven unit cases failed on the missing module first; a separate real-Postgres checkpoint test restores with a new connection and no model replay. Clarification/revision HTTP integration and model qualification remain in this pre-key batch; no real AI completion is claimed.

T-0238 implementation evidence: submission.reserved commits the exact actor/claim/terms-bound request before HTTP; SUBMITTING is an unresolved metadata delivery, never a money state. Recovery scans durable reservations and resends only the same package idempotency key. Matching completed receipts return without contacting Stood. A request accepted during an active lease remains unresolved until its receipt is attached; its recorded request time is replayed rather than inventing a later builder submission. Unit tests cover lost reply/recovery and mismatched receipts; a real-Postgres test restores through a new connection, including JSON key reordering and concurrent completions. SDK bridge remains mock-composed until the qualified evidence/funding API lands.

T-0151 evidence: two failing secret-generation/preservation tests preceded implementation. Only three provider prompts remain; three separate 256-bit platform secrets are generated after successful sandbox validation, saved before copy-once display, restored from guarded .env and rotated only with --rotate-platform. Fake OAuth responses exercise this without provider keys.

T-0152 evidence: four named-error regressions failed first. Setup now reports rejected sandbox credentials, unavailable/timeout transport and malformed provider responses separately via typed codes; CLI messages are fixed copy and never include exceptions, response bodies or keys. No save occurs on these failures.

T-0153 evidence: interruption regression failed first (old implementation truncated/replaced config and ignored the injection). Persistence writes a 0600 same-directory exclusive temporary file, fsyncs, checks the destination has not changed, renames and syncs the directory. Symlink/hard-link guards remain; ordinary failures clean temporary files and leave the prior configuration intact before replacement.

T-0200 evidence: the missing-token regression failed first. One shared CSS source supplies the landing page and React app, dark/paper semantic colours and system font fallbacks. The unit check recomputes every published Y17 dark foreground contrast ratio against both canvases, and paper foregrounds against their canvas, requiring AA. Docker Chromium renders both themes at desktop/mobile sizes; visual review confirms the simulation notice precedes the payment projection.

T-0202 connected mock foundation: React/Vite with the four Y18 state libraries, scoped server snapshots and cookie-backed mock composition. No browser HMAC/provider keys. The pure event reducer reloads gaps and unknown transitions; only consecutive Stood-originated, tranche/package/amount/reference-matched capture proof enters PAID. Shared immutable work-order transitions come from Yard domain. Red-first snapshot/connection/transition tests cover malformed data, illegal payment evidence and reconnect state. Browser checks connect real Docker services, display a genuine Stood stamp and verify desktop/mobile overflow, theme and simulation disclosure. Hosted authentication, full project-room states and command flows remain open; this is not live qualification.

T-0242 evidence: inspected `.github/workflows/ci.yml`; `concurrency.group` is `ci-${{ github.ref }}` and `cancel-in-progress` is already true. New pushes supersede older runs on that ref. Retained the policy. Runner-starved cancelled jobs require a rerun; cancellation alone is not evidence that the product gate failed or passed.

T-0230 local demo slice: scripts/dev demo builds and checks the real mock network, then retains only the isolated disposable stack. Stood, Yard and the connected room share a localhost-only web port. Failure cleans up; an existing stack must be stopped before reseeding. No provider controls/database ports are published. The no-key guide and README describe synthetic evidence/payment boundaries; per-provider live switching and qualification remain open until the corresponding adapters/readiness exist.

T-0186 lease/repost slice: four red-first unit regressions cover expiry boundaries, owner/builder scope, unresolved-submission protection and globally unique discovery identities. Durable action replay now includes expiry, clock-out and repost; stale owners cannot keep repository access. Early expiry maps to a typed conflict. A separate real-Postgres test serialises competing expiry writers and restores/reposts through a new connection. The nine-case HTTP network suite includes lease expiry/repost with no fabricated hold or payment. Funding/hold cancellation remains T-0187, and refusal/rework remains open. The Crew discovery adapter follows every Board page and binds its opaque offer identity to an explicit project/work-order pair.

T-0205 Board screen slice: typed paginated posted-work cards, filter over loaded pages, pending claims with one cryptographically random key per offer/version, and server-scoped room navigation. No optimistic lease/hold/payment projection. Red-first public-contract and retry-key tests reject private/invalid fields, duplicate identities and stale continuation. Actual Docker browser checks cover buyer → builder cache isolation, denied private-room access, claim → fresh room snapshot, and no Stood verdict on an unpaid metadata lease. The insecure Docker HTTP origin exposed randomUUID absence; getRandomValues now supplies the same-strength attempt key. Full work-order tests/submit/punch-list screen, lease-to-funding and complete filters remain open.

T-0201 accessibility slice: pinned axe-core/Playwright 4.13.0 checks dark and paper project rooms and the paper Board at desktop/mobile widths. All six WCAG A/AA automated scans pass without exclusions or disabled contrast rules. Explicit browser contexts support the scanner; failures save a visible-page screenshot. Existing reduced-motion and overflow checks remain. This covers the current rendered foundations, not every planned component/state or a claim of complete accessibility conformance.

T-0219 release-boundary follow-up: the real deployed API artifact regression failed because its runner verifier file exported a synthetic signed-report factory. The factory now lives under test/fakes, and the verifier imports verification capability only. The expanded artifact check confirms no fakeReport export is shipped; all 18 verifier cases and the release test pass. This tightens packaging without changing decision rules or enabling payments.

T-0202 static-path follow-up: Vite emits relative assets and the app links back through relative Yard/Stood paths. The real Docker browser suite serves the public artifacts under an additional repository prefix, verifies the logo loads and navigates back to Yard. All nine network scenarios and desktop/mobile browser checks pass; hosted authentication and the remaining app flows are still open.

T-0239 cursor follow-up: red-first unit and real-Postgres checks exposed locale ordering for mixed-case project IDs. The runtime query and its operator-created index now use C collation; the in-memory provider uses the same ASCII order. The 105-project two-page test checks order as well as completeness and privacy. Eight targeted tests pass. No repository address is restored to public discovery.

T-0181 revision/recovery evidence: four new red-first graph tests exposed duplicate model work, missing owner-authorised recovery and the absent revision loop. The graph now serialises a thread, retains immutable intake, resumes failed model tasks, advances review versions and rejects stale acceptance. Malformed review decisions are rejected before persisting a resume value. Real-Postgres evidence uses two runtime connections to race identical creation, revise and restore without model replay; failure releases its thread lock. The 20-draft bound limits repeated model work. This is draft metadata, never a signed mandate; clarification, HTTP composition and qualified baseline execution remain open.

T-0197 evidence: five key-rotation tests were written first; three failed against the single-key verifier. Reports now require keyId and an Ed25519 signature over the domain-separated UTF-8 bytes `stood-runner-report/v1\0{keyId}\0{payload}`. Trust entries bind runner identity, issue/ingest validity windows and revocation; malformed/duplicate/private-key configurations refuse construction. Explicit immutable trust-set reload applies revocation, and an overlap accepts both keys until retirement. All 23 verifier cases pass with generated test keys. No hosted signer, repository execution or actual key provisioning is claimed.

T-0158 pre-key evidence: red-first domain/application/adapter tests plus real-Postgres race/crash tests now enforce one bounded CAPTURE re-submission. Matching full no-capture/no-renewal proof must name the current authorisation/operation/request ID, amount and expiry; its observed time is no more than five seconds old. Current rules and the five-minute margin are checked before claiming and immediately before calling. The atomic tranche command stores the normalised proof reference, identities, times and unique claim, consumes the retry and keeps the same ledger UUID. A committed claim survives restart even if no request is subsequently sent; it cannot be replenished. Barrier-controlled Postgres tests exposed duplicate invocations with the same worker label on both initial and retry calls; fresh persisted claim identities now allow only one winner. Shared missed-send and lost-response scenarios assert one actual simulator capture, matching ledger/history and unchanged provider request IDs. Optional executor-enabled reconciliation uses this path; normal financial HTTP/runtime remains disabled pending T-0154/full T-0156 and real sandbox qualification. Generated findings remain synthetic.

T-0181 HTTP/mock evidence: four signed-HTTP tests were written before the routes and malformed-output classification. Owner-only draft/review/revision/recovery is now composed with the real graph, typed errors and a scripted model in Docker. Request bodies cannot choose owner/time or add authority; exact creation retries retain the saved clock. A real network scenario uses restricted Postgres checkpoints and verifies no Board or payment side effect. All 11 network scenarios and existing desktop/mobile browser checks pass. The ordinary service has no planner fallback. Clarification, the full intake/review UI and qualified red-baseline execution remain open; mock model output is not live AI evidence.

T-0154 order-funding evidence: red-first database/application/adapter/SDK tests precede separate durable create/authorise UUIDs and monotonic funding phases. Funding and settlement exclude each other under the tranche lock; confirmed hold/no-hold receipt and funding audit commit atomically. A real-Postgres failure injection proves rollback. The actual pinned SDK runs against the local HTTP simulator, including a lost authorisation reply recovered after restarting both stores with one provider hold and no capture. New provider calls require a server-owned authority; revoked approval and old rules still permit read-only recovery into a cancellable safe hold. Exact callback retries are reads. Additional pre-key regression: a hold already expired before its lost reply is recovered must resolve from matching provider expiry/no-capture proof, including old-rule records, rather than remaining silently AUTHORIZING. This remains a partial internal boundary: Vault, signed mandate records, callbacks, funding scheduler/alerts and actual sandbox qualification are still required before runtime financial HTTP can be enabled. Synthetic authority is not buyer consent.

T-0154 Vault evidence: red-first SDK, simulator, response-mapping, signing-application and real-Postgres tests precede durable v1 terms hashes, distinct setup/token UUIDs, monotonic phases and atomic matching audit snapshots. Terms/tenant/provider identities and creation timestamps cannot be rewritten; first inserts reserve, resolved receipts stay immutable and history rejects truncation. Exact retries and restarted stores return the same IDs. Concurrency admits one provider invoker; audit failure rolls back. Recovered approved setups need no obsolete approval link, but approval is re-read before token creation. Unknown setup/token writes are never automatically replayed. Simulator replay retention is three hours, matching the published Vault contracts. Actual SDK/local HTTP plus fresh Postgres connection recovers a lost token response from matching customer/payer/merchant-reference proof. Internal funding authority rejects DRAFT, changed, expired or revoked terms and mismatched stored instructions. This does not close T-0154: qualified acceptance/callback routes, version changes, Vault-funded orders, scheduling/alerts and actual sandbox qualification remain open; financial runtime is still disabled.

T-0156 request-authentication evidence: a failing replay regression precedes request HMAC v2, binding timestamp, method, external target/query, Idempotency-Key, If-Match, Content-Type and exact body with a domain separator. Body-only request v1 is rejected. SDK, fake service and mock network callers use the same published encoding; webhook delivery v1 remains a separate protocol/secret. Server/SDK and real-Postgres tests verify rejection, exact draft replay and typed conflicts. ADR-0020, T04 and USAGE document the pre-deployment change. Signing/funding/evidence workflows and rate limiting remain open; this foundation does not close T-0156 or activate payments.

T-0209 request-authentication evidence: a failing Board replay test precedes Yard request signature v2, binding the operator key ID, method, external target/query, command/version/content-type headers, Last-Event-ID and raw body. The event-feed permission check verifies the same target/query. Browser proxy and Crew/network fixtures sign actual values; secrets remain server-only. Old request v1 and key-ID substitution are rejected, while delivery webhooks keep their separate protocol. ADR-0021 and Y12 define the encoding. Operator registration, verified payees, production sessions and key rotation remain open; this slice does not close T-0209.

T-0202 operator-isolation evidence: a real-browser regression holds a buyer-only room response, switches to an unclaimed builder, then releases the old response. It fails first because the buyer request was not aborted. Room/Board queries now consume cancellation signals and use a session generation; streams update only their generation's cache. Switching cancels/removes private queries, serialises operator selection and verifies the server's synthetic session acknowledgement. Old Board callbacks cannot select a room after the generation changes. The regression now proves cancellation and no private room render; all eleven network scenarios and desktop/mobile accessibility, theme, prefix and SSE checks pass. Requests retain their timeout alongside cancellation. Hosted authentication and the full intake/room flows remain open.

T-0186 deadline follow-up: three tests failed first because elapsed offers remained visible, posting/claiming accepted elapsed terms, and discovery ignored an invalid clock. Discovery now requires the caller's shared server clock; post, claim, repost, build and new submission reservations reject the exact deadline without writes. Lease cleanup, matching historical submission receipts and settlement reconciliation remain available. A late claim cannot extend the signed milestone deadline. A real-Postgres reconnect check verifies no event is added by a rejected claim. The network suite explicitly advances Stood's shared clock before seeding fresh connected Yard examples, rather than retaining expired offers for the browser. Eleven network scenarios and the desktop/mobile accessibility and session-isolation checks pass. This does not close funding/hold coordination or refusal/rework.

T-0203 durable intake foundation: two Foreman regressions failed first because recognised pasted credentials reached the model/checkpoint or changed a saved revision. Three signed HTTP tests failed before the intake routes existed; seven real-Postgres cases prove restart/replay, competing autosaves, rollback on audit failure, owner/creation/version guards and consecutive metadata-only events. Separate red regressions protect millisecond shared-clock restoration and reject mismatched/extra audit metadata. Shared strict Zod schemas and the bounded scanner live in `packages/yard-contracts`, keeping the pure Yard domain dependency-free. Intake records use separate tables, so private drafts cannot appear in Board discovery. The API owns buyer/time, requires explicit versions, blocks credential fields and never returns a matched secret. Known test/live key formats are blocked before storage and planner checkpoints; this scanner cannot establish provider environment or detect every possible secret. No credential-upload endpoint is enabled. The wizard, clarification, complete-context planner connection and qualified signing remain open.

T-0203 planner-resume reliability: the full gate exposed an intermittent preceding-version restore. Deterministic memory and real-Postgres tests fail under a 100 ms host-clock rollback; fresh-process ID and Postgres revision tests also fail without a persisted ordering floor. ADR-0022 records a version-pinned pnpm patch plus Foreman checkpoint seeding. The real database case compiles trusted source into a temporary directory and revises in a separate Node process, then restores/approves from another connection without replaying the model or granting migrations. Financial clocks and histories are untouched. This is an intake/recovery prerequisite, not completed wizard or baseline evidence.

T-0203 saved-intake planner connection: red-first context and HTTP tests now bind all eight sections to a buyer-owned saved version. The server resolves the immutable repository head through a configured port; callers cannot choose an owner, time or trusted commit. Snapshot-thread IDs are deterministic, and retries return the original reviewed plan even after repository changes or the intake deadline, without another repository/model call. Stale versions, incomplete/expired new work and mismatched repository proofs fail before planning. The graph preserves full context across review/revision and rejects model deadlines beyond the buyer's target. Five application, four intake HTTP and 22 Foreman unit cases pass; all twelve Docker network scenarios and existing browser checks pass. The repository service and model in that network are explicitly simulated. The connected wizard, clarification and qualified baseline/signing remain open; no payment or signed mandate is created.

T-0203 connected wizard evidence: eight private steps, XState progression, shared-schema validation, exact integer budget conversion, explicit Foreman choices, summary, scripted blueprint review/revision and baseline-only acceptance are now connected to the real HTTP/Postgres services. Four conversion/secret/schema tests failed on the missing form module first. Docker browser tests prove a recognised pasted key never reaches autosave, a dropped reply retries the exact body/key/version, another tab's event blocks planning until reload, a reload resumes saved choices, and switching to a builder removes the buyer's form. Summary/plan/mobile axe scans and mobile overflow checks pass. The HTTP test origin exposed unavailable randomUUID; request keys now use the Board's secure getRandomValues approach. No answers enter browser storage; step-nine credential intake stays disabled. Feature-specific follow-up controls, Foreman clarification, qualified baseline/signing and the remaining component states remain open; this does not close the full pre-key batch.

T-0194 stream-access evidence: three red-first cases exposed that an already-open stream could keep reading after its access was withdrawn. The feed now rechecks its configured authority before replay, after a database read and before each event. A revoked/expired or unavailable check emits only `authorization.required`, closes the subscription and publishes no private event. A fourth test proves backend error details are not returned. The browser gateway can reconnect with a fresh signed request; direct signed clients must re-sign when the request window expires. All twelve Docker network scenarios and the expanded intake/browser checks pass. This is an access-boundary slice; role-filtered public feeds, full hosted operator lifecycle and remaining event/chaos qualification stay open.

T-0183 controlled planner evidence: eight injection fixtures keep payment/identity/tool instructions as plain data. Additional tests reject invented authority, changed budgets/profile/test paths, preserve the saved intake against model mutation and stop acceptance at the baseline gate. A red-first model-output test exposed recognised keys reaching review/checkpoints; the shared scanner now checks output with its existing 64 KiB bound, retaining the 48 KiB intake limit. A real-Postgres regression fails against the prior validator, then proves all recovered checkpoints/task writes omit the recognised value and owner-authorised recovery can continue with clean output. Twelve corpus/graph cases and the five shared-schema cases pass. These are controlled port tests, not evidence that a real model resists injection; immutable repository ingestion, qualified runner isolation and live-model evaluation remain open.

- `[x]` T-0244 Site-browser clean-runner dependencies: install the frozen workspace before building the standalone Yard landing page and browser image. GitHub CI failed first with `tsc: not found` on an empty runner; `scripts/check-site` now installs workspace dependencies before its package build.
- `[x]` T-0243 Canonical app directory URLs (local blank-page report): redirect GET/HEAD directory URLs to the trailing-slash form before serving relative assets; retain queries and the hosting prefix. A Node HTTP test failed on 200 instead of 308 first. Both HTTP cases pass, and Chromium verifies the exact `/yard/app` and prefixed/query URLs render with loaded assets and no page errors. The same tests are required by the product and network gates. The full Docker product gate passes with 608 unit tests, 122 real-Postgres cases and both domain coverage thresholds; the isolated twelve-scenario network and desktop/mobile browser suite also pass. The running local demo is fixed; payments remain simulated.

T-0181 scripted-deadline regression: advancing the shared simulator clock by one second exposed the fixture's hard-coded dates exceeding a minute-precision buyer deadline. The saved-context graph test fails first with INVALID_DRAFT, then passes when milestone dates divide the exact remaining interval using integer arithmetic. The final date equals the saved target; revision preserves it. The complete twelve-scenario network and desktop/mobile intake/browser suite pass with the fix. This qualifies the scripted provider, not a real model or the remaining clarification/baseline work.

T-0206 local site-log evidence: shared strict schemas and client replay tests fail first on missing modules; six real-Postgres cases cover restart receipts, concurrent builder-wide rate limiting, rollback, immutable lines/receipts, 90-day value-free summaries and a red-first shared notification connection. The application checks the exact current claim/root before scanning and again under the project row lock. Every new batch is scanned by digest-pinned Gitleaks 8.30.1 through stdin with default rules, bypass annotations disabled, no repository configuration, no reports and a bounded timeout; scan failures refuse storage. Read access is limited to the owning buyer or current claimed builder. Four signed HTTP cases prove isolated sequencing, access/error handling and unavailable composition. The React log has no live announcement region, supports paused scrolling, bounds retained rows and clears cached data across operators. Two worker tests cover the configured shared clock, non-overlap, retry and value-free failures. The complete twelve-scenario Docker network and desktop/mobile browser journey passes after the separate T-0181 deadline prerequisite. Hosted authentication/job deployment remain T-0209/T-0214; secret scanning does not prove that every arbitrary secret or private thought can be detected. No log can change payment state.

T-0206 final batch check: the full Docker gate passes 626 unit and 128 real-Postgres cases, with both pure domains at 100% coverage. All twelve network scenarios and expanded desktop/mobile axe checks pass. A browser regression proves a new builder log line arrives over SSE with one snapshot read, keeps keyboard focus and leaves the milestone CLAIMED without a money stamp. The running local demo was migrated/restarted in place; saved intakes were retained and older progress was not invented.

T-0206 retention replay: two red-first HTTP/stream regressions distinguish the actual archive boundary from the latest 200 displayed lines and force an open viewer to clear/refetch its cache when retention advances without a new event. Stream bounds use a compact metadata query; real-Postgres checks verify missing and archived boundaries.

T-0185 local manual-review slice: unsigned drafts can be edited, merged, split and repriced through an accessible native timeline and signed owner-scoped HTTP. Every save re-runs the full draft validator against the immutable intake, re-hashes tests and derives intermediate/final profiles by position. It saves an exact request receipt in the same checkpoint as the new review version, with a fresh buyer pause and no model execution. Two failing-first core regressions and an HTTP route regression protect stale/foreign/competing writes and exact retries; a real-Postgres test repeats them across connections. Merge/split helper tests preserve integer budgets and acceptance tests. The qualified baseline runner, signing flow and partner-component qualification remain open; native controls do not claim Bryntum integration.

T-0185 local verification: the Docker gate passes 631 unit and 129 real-Postgres cases with both pure domains at 100% coverage. All twelve network scenarios pass. Desktop/mobile axe and overflow checks cover the editor; the browser deliberately loses a committed save reply, proves retry uses the same key/body with one new review version, and verifies focus returns to the review controls. Partner-component qualification and the baseline/signing prerequisites remain open.

- `[x]` T-0245 Standalone site check builds local package declarations in dependency order after workspace installation. GitHub CI exposed missing `@stood/yard-contracts` declarations after T-0244 fixed clean-runner `tsc`; `scripts/check-site` builds yard-domain, yard-contracts, then yard-web before bundling. `scripts/check-site` passes locally, including Chromium desktop/mobile checks.

## Pre-credentials round 2: refusal, rework and the full judge path (2026-10-06)

Taken over by Claude (product owner direction). One signed-off Conventional commit per task, tests first, full Docker gate in every commit hook, all 14 network scenarios green.

T-0189 rework domain evidence: four red-first domain tests (rework of the exact checked package, same lease, attempt count, clock-out and expiry while reworking, late refusal after lease end) plus the shared transition test. `REWORK` is a build state; `PAID`/`REFUSED` stay out of shared transitions. Yard domain coverage remains 100%.

T-0189 Board refusal evidence: three red-first signed-HTTP tests and one real-Postgres test. A `stood.refused` notification acts only after a fresh Stood read shows a confirmed VOID for the exact checked package, a valid named punch list and remaining resubmissions. Rework archives the confirmed submission; a final refusal closes the order as `REFUSED` (no claim, build, submit or repost). Two racing refusals produce one event; replay after reconnect restores state; a replayed first refusal cannot touch the second package. Submitting from `REWORK` before rebuilding now returns 409 and reserves nothing (previously an unmapped domain error).

T-0232 evidence: the shared contract allows exactly one `REDISPATCH` after a refused, voided and reconciled attempt, with a separate `reworkAssessment`; nine invalid shapes are rejected first. `refuse-then-pass` runs in both drivers (in-process Postgres and network) and checks one confirmed VOID followed by one CAPTURE, never two captures.

T-0158 follow-up evidence (PR #46 review): a consumed but unresolved capture retry raises a named `CAPTURE_RETRY_CONSUMED` alert for the owning reviewer on every tick and never calls the provider again. Forward migration 0016 extends the alert constraint; real-Postgres tests prove storage and rejection of unknown codes.

T-0231 evidence: the network Crew treats `REWORK` as a punch list, restarts the build with a fresh command key per rebuild (a reused key replayed the first build), and can switch scripted scenarios per run.

T-0233 evidence: `yard-rework` drives the full judge path over isolated Docker services: Crew submits, Stood refuses and voids, Yard shows the punch list, Stood places a fresh hold, the same Crew reworks and resubmits, and only the matching capture marks the milestone paid. Forged types and replayed refusals are rejected. All 14 network scenarios pass.

T-0204 punch-list slice: the web reducer applies `stood.refused` only from Stood on a checking order with a valid punch list and expected attempt (otherwise reload); snapshots accept `REWORK`/`REFUSED` only with no payment or submission and a matching final flag. The milestone card shows Stood's own Refused stamp, the attempt and each named check. Browser/axe coverage of the refused card remains open.
