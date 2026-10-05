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
- `[x]` T-0022 Docker dev stack: multi-stage digest-pinned Dockerfile, Compose (app, API, Postgres, local S3, Mailpit), wrapper and hadolint. Tier: implemented. Evidence: branch `feature/22-product-foundation`; dev and distroless builds succeed, API/DB/Mailpit healthy. MinIO image pulls failed; SeaweedFS substitute recorded in ADR-0008. Authenticated object-store contracts remain queued.
- `[x]` T-0023 Monorepo skeleton (pnpm + Turborepo), strict types, dependency-cruiser boundary, Vitest and coverage in Docker and CI. Tier: unit-tested. Evidence: `docker compose run --rm app pnpm validate`; negative domain-I/O probe rejected by `pure-domain`.
- `[x]` T-0024 TDD: Money, Geofence, Nonce property and boundary tests. Tier: unit-tested. Evidence: domain test files; red before implementation, then 100% branch coverage.
- `[x]` T-0025 TDD domain slice: Tranche state machine, decision table, required items, location, 64-bit fingerprint distance and day-four reauthorisation rules. Tier: unit-tested. Evidence: approved PR #13, green full Docker/GitHub CI and squash merge `c3cc338`. Capture-window provenance, platform-signal validation and actual novelty search remain open under T-0136; durable operations, timers and reconciliation remain T-0132 / T-0057 / T-0056. This is not sandbox or orchestration completion.
- `[x]` T-0026 Evidence profiles core (ADR-0007): immutable construction, freelance and rental profile registry, fixed precedence and explicit effect maps. Tier: unit-tested. Evidence: `decision.test.ts`; model stage failures stay WAIT pending evaluation. Profile parameter schemas and actual evidence adapters remain separate queued work.
- `[~]` T-0027 PayPal adapter: funded-tranche capture/void/renewal and status-reader slice implemented with pinned Server SDK 2.5.0, sandbox-only construction, disabled SDK retries/logging, integer amounts and conservative response mapping. Possible submission is committed before SDK calls; ambiguous outcomes are reconciled, never retried blindly. Capture/renewal margins are rechecked with the server Clock; old-rule captures and unreviewed rental returns cannot dispatch. Correlate capture invoice_id to the operation and order custom_id to the tranche plus authorisation lineage; never pretend PayPal echoes request IDs. Tier: unit-tested with synthetic bodies/SDK mocks plus fake-executor real-Postgres crash evidence, review pending. Full authorise/Vault integration requires T-0154; actual recorded sandbox qualification remains blocked on T-0121. No payment client is wired into HTTP/runtime yet.
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
- `[x]` T-0056 Provider-status reconciliation core: matched complete status proof, atomic outcome recording and restart-safe renewal expiry. Tier: integration-tested with a fake status provider and real Postgres; implementation complete, approved. Initial regressions failed on the missing coordinator; a real-Postgres competing-clock regression exposed an idempotency collision and now passes. Contradictory completed/absent proof was also rejected after a failing regression. Unknown, pending, contradictory and mismatched lookup results retain the reservation and return an alert signal; no payment calls. Transaction Search × decisions, scheduled runner and alert delivery are extracted to T-0149. Prerequisite for T-0027, including at least authorisation/capture status polling before voids are wired: every void error is ambiguous and must remain reserved until resolved. T-0138 covers unresolved renewals across expiry; elapsed time alone is not confirmation. Approved all five tasks in PR #21; green CI, squash merge `f5020ec` (213 unit / 44 real-Postgres / 100% domain coverage).
- `[ ]` T-0057 Hold timers: reauthorise from day 4 (after three elapsed days), warn at 27, void at 29. Never treat an expiry as a release.
- `[ ]` T-0058 Reviewer override + payer acceptance (FR-39 / 40) with an audit log.
- `[ ]` T-0059 Dispute packet PDF / JSON. Disputes API where the sandbox allows it.
- `[ ]` T-0060 Receipt signed links (JWT), distance-only display.
- `[~]` T-0061 All ten synthetic scenarios implemented: substituted fitting stays WAIT for review, funding-declined demonstrates WAIT_FUNDING, and hold-expiry demonstrates EXPIRED using explicitly simulated provider proof. Tier: unit-tested; route regressions failed first. Separate recipient sentences and payment.executed false throughout. Real sandbox replay remains blocked on T-0121 / T-0027; no synthetic reference is a PayPal ID. Review pending.

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
- `[x]` T-0122 API bootstrap and explicitly synthetic fixture routes (`good`, `wrong-plot`, `recycled`, `wrong-stage`, `nonce-unreadable`, `mock-location`, `freelance-missing-screen`). Tier: unit-tested. HTTP tests and container smoke checks verify `payment.executed: false` and no PayPal IDs. No financial endpoints are enabled.
- `[x]` T-0123 Expand Biome to product TypeScript and enforce 85% overall / 100% domain coverage. Fix discovered landing-page accessibility lint errors (decorative SVG, button types, semantic fieldset). Tier: implemented; full product validation passes.
- `[x]` T-0124 Fix Linux bind-mount ownership by parameterising the non-root development UID/GID and building with runner IDs. Tier: implemented. Evidence: commit `615d84b`; local full pre-commit and UID 1001 container check pass; GitHub Actions run `37152475582` passes every required check.

- `[x]` T-0125 PR #9 settlement corrections: expiry clock, matched confirmation, definite failure exits and ambiguous reconciliation; failing regression tests first, followed by 500-case operation-sequence property tests. Tier: unit-tested. Evidence: approved PR #9 squash-merged into develop as `2854815`; full Docker validation and GitHub CI green.
- `[x]` T-0126 RULE/MODEL provenance, profile-declared sources, central pass/refusal thresholds and fail-closed malformed results. Tier: unit-tested. Evidence: approved PR #10 squash-merged as `31176e2`; 125 tests, full Docker/pre-commit and GitHub CI pass. Rule set 1.1.0; no model adapter is wired.
- `[x]` T-0127 Structured immutable details (`distance_m`, `matched_package_id`) copied into decisions and tranche history, maximum off-site pin distance, pure assessment sentences and synthetic API copy. Tier: unit-tested. Evidence: approved PR #10 squash-merged as `31176e2`; full Docker/pre-commit/GitHub CI and four HTTP container smoke checks pass. Real novelty search and confirmed-payment sentences remain queued.
- `[x]` T-0128 Allowance DRAFT creation validates the GBP/USD/EUR hold subset, exact single-currency cap/milestone sum, identifiers, names, profiles and limits. Direct tranche creation also rejects unsupported hold currencies. Tier: unit-tested. Evidence: approved PR #11, green full Docker/GitHub CI and squash merge `82e5e25`. General Money retains local currencies. Signing, persistence and HTTP allowance creation remain T-0028 work.
- `[x]` T-0129 Five-minute Stood capture safety margin and pure endpoint-specific PayPal failure mapping. Tier: unit-tested; synthetic error bodies are not recorded sandbox contracts. Timeouts/5xx/unknown or conflicting errors remain AMBIGUOUS; SYSTEM_FAULT renamed REJECTED_NO_PAYMENT. Evidence: approved PR #11, green full Docker/GitHub CI and squash merge `82e5e25`. Durable counters/key-to-provider-UUID mappings are supplied by T-0145, review/merge pending; T-0027 is still blocked.
- `[x]` T-0130 PR #9 round-2 retry identity fix: increment a settlement-attempt counter only after a validated definite failure; include it in the operation key. Tier: unit-tested. Failing capture/void tests first; ambiguous and rejected failure identities unchanged. Evidence: round-3 approval, green full Docker/GitHub CI and PR #9 squash merge `2854815`.
- `[~]` T-0131 Recipient sentences: missing items named, rounded distance units, separate payer/inspector copy and confirmed-effect money clauses; pending and overdue holds never claim payment confirmation. Tier: unit-tested, regressions failed first (including large integer money display); domain 100%. Demo exposes both sentences and explicitly says no payment executed. Trusted photo-index match dates can be rendered when supplied; no real index/date evidence exists yet. Rental shipping still requires the human/rule safeguard, enforced by the adapter guard in this round. Review pending.
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

- `[~]` T-0149 Durable reconciliation scheduler and owned alerts: database leases use SKIP LOCKED, fresh tokens and expiry; stale workers cannot finish newer leases. The worker reserves safe-mode cancellation automatically (including after an old pending capture is proved declined), polls exact provider proof, retains unknown outcomes and assigns durable deduplicated three-hour alerts to RECONCILIATION_OWNER. Tier: unit-tested and real-Postgres integration-tested, review pending. Local CLI is provider-status-read-only; cancellation submission still requires the qualified executor. Transaction Search / gate-bypass scan and external notification delivery are extracted to T-0155; actual sandbox qualification remains T-0121.

- `[ ]` T-0150 Hosted key onboarding after local T-0135: register the platform webhook URL, issue STOOD_API_KEY / STOOD_HMAC_SECRET once with copy-once display, preserve outbound STOOD_WEBHOOK_SECRET, support revocation/rotation and test tenant isolation. Local setup only collects existing platform keys; hosted onboarding must land before hosted platforms ship.

- `[ ]` T-0151 Local setup follow-up: generate STOOD_API_KEY, STOOD_HMAC_SECRET and STOOD_WEBHOOK_SECRET with a cryptographically secure generator; display once, preserve existing configuration and test rotation separately from hosted issuance.
- `[ ]` T-0152 Classify setup failures safely: distinguish rejected sandbox credentials, PayPal unavailable/timeout and invalid provider responses; never expose secrets, OAuth bodies or tokens.
- `[ ]` T-0153 Atomic .env persistence: write a private temporary file in the same directory, sync and rename; test interruption leaves the previous configuration intact, with link/permission guards.

- `[ ]` T-0154 Initial funding and Vault durability before full T-0027 / financial HTTP activation: reserve separate stable request IDs before order/setup-token creation and order authorisation; persist approval phases and provider identities; commit confirmed hold plus funding outcome in one transaction, exclude competing operations and reconcile ambiguous creation/authorisation across restart. Test before calling the provider and qualify against actual sandbox accounts. The current adapter intentionally handles existing confirmed holds only.

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
