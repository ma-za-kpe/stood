# Stood: usage manual

> **Agents pay agents. Only when the work stands.**
> An open-source release gate for code milestones and staged payments, built on PayPal.

| | |
|---|---|
| **Status** | ⚠️ **Sandbox implementation in progress.** Local signed DRAFT creation/reads and metadata-only commit-package intake, synthetic demos and status polling are implemented; financial API workflows below are planned. This manual describes the API being built for the PayPal AI Hackathon 2026. Every example uses the **PayPal sandbox**. Check the [changelog](https://ma-za-kpe.github.io/stood/changelog.html) for what has shipped |
| **Licence** | MIT |
| **Hosted demo** | `https://stood-api.onrender.com/v1` (sandbox, free tier: the first request after idle can take about 1 min) |
| **SDK (planned)** | `npm i @stood/sdk` (TypeScript, APIMatic-generated). Kotlin and Python later |
| **Spec (planned)** | `openapi/stood.yaml` (OpenAPI 3.1; generation is T-0053) |
| **Docs** | [Overview](09-stood.md) · [API spec](tech/T04-api-spec.md) · [Evidence profiles](stood/S16-use-cases-and-evidence-profiles.md) |

---

## What Stood does, in 20 seconds

**Current demos are simulated. No payment is executed.** Provider keys do not change synthetic fixture results into real results. The isolated PayPal HTTP simulator can run without keys; see [the simulator guide](../services/simulators/README.md). Full provider switching and the complete Yard demo remain T-0230/T-0233. Actual PayPal connections remain sandbox-only and require qualification.

Your buyer or buying agent pays an operator for a code milestone against frozen signed acceptance tests and a budget mandate. Stood sits between "the stage is done" and "the money moves":

1. **Allowance:** the buyer agrees frozen tests, repository, operator and budget once. Provider approval binding remains planned.
2. **Hold:** when a milestone is ready, Stood asks PayPal to **authorise** (hold) the amount.
3. **Commit package:** send the exact commit and authenticated test report; trusted runner ingestion remains planned.
4. **Decision:** Stood's rules return **`RELEASE`** (PayPal capture), **`REFUSE`** (PayPal void, plus the named reason), or **`WAIT`** (a human reviews).
5. **File:** every decision leaves a receipt and a dispute packet.

Stood **never holds money**, never pays anyone locally, and never knows your industry. You choose an **evidence profile** (`construction.stage@1`, `freelance.milestone@1`, …).

The lead product direction is now code milestones and agent-to-agent payments: **Agents pay agents. Only when the work stands.** `code.milestone@1` adds deterministic signed-test, integrity, execution, new-commit, mutation and mandate findings; `code.final@1` additionally requires usage release. The profile is unit-tested; authentic runner/usage ingestion, Yard and A2A/AP2 remain planned. See [S17](stood/S17-agent-payments-positioning.md). A signed DRAFT is not a payer-approved mandate, and a synthetic passing finding is not actual execution evidence.

---

## Code-milestone quickstart (local DRAFT)

### Optional PayPal simulator and shared clock

The first shared Stood integration smoke run also works without keys:

```console
scripts/dev mock
```

It tests seven scenarios using isolated Postgres and actual local HTTP: release, refusal, review, final usage waiting, renewal, expiry and lost-capture recovery. It labels approval/authorization and assessment as fixtures, checks signed draft/package/read APIs and matching ledger/provider outcomes, and replays signed duplicate/out-of-order notification hints. This is an integration test command, not the full Yard/browser demo or live sandbox qualification. It creates and drops its own random database on the fixed local Postgres and never uses your `DATABASE_URL`. The same cases run inside the required Docker product gate.

```console
docker compose --profile simulators up -d --wait paypal-sim
PROVIDER_PAYPAL=sim docker compose up -d --force-recreate --wait api
curl http://127.0.0.1:3000/health
```

Health reports PayPal `mode: sim`, `simulated: true`, a `controlled` clock and `paymentReady: false`. Stood reads time from that same simulator for every request; clock failures return 503 instead of using the system clock. Advance both with an authenticated local `POST http://127.0.0.1:8080/__sim/advance` (`Authorization: Bearer sim-access-token`, JSON `{"milliseconds":345600000}`). This does not activate funding, financial writes or the webhook queue. Simulator time is also the signing time for signed platform requests.

An unset `PROVIDER_PAYPAL` boots no adapter. `live` requires the named sandbox keys and an SDK readiness read, and never falls back to simulation; production money is still unsupported. `fake` and all other providers' runtime selections are not wired yet and fail explicitly. To return to the original local configuration, recreate the API with `PROVIDER_PAYPAL=`. The complete multi-provider switching guide remains T-0230.

Create a signed local DRAFT using the bearer/HMAC conventions in [T04](tech/T04-api-spec.md). The request body is:

```json
{ "payee_ref": "yard-operator", "cap": { "minor": 400000, "currency": "USD" },
  "milestones": [
    { "name": "build", "amount": { "minor": 120000, "currency": "USD" },
      "profile": "code.milestone@1",
      "params": { "repository": "owner/repo", "base_commit": "full-commit-sha",
                  "frozen_tests_manifest": "sha256-manifest", "usage_required": false } },
    { "name": "usage release", "amount": { "minor": 280000, "currency": "USD" },
      "profile": "code.final@1", "params": { "usage_required": true } }
  ], "window_days": 7, "max_resubmits": 2 }
```

These params are draft metadata. This endpoint does not freeze/sign tests, validate a runner, approve a mandate or fund a hold. The future signed contract must replace the illustrative hashes with exact values and explicitly agree any usage exemption; a client flag cannot waive proof. The response is DRAFT with PENDING tranche IDs, no approval URL. Yard is planned.

## For hackathon judges: try it in 2 minutes

The live landing page's four commit cards are illustrative. The local API now defaults to code-milestone fixtures, using synthetic findings through the real pure gate. No test runner or payment is executed.

```bash
docker compose up -d api
BASE=http://localhost:3000/v1
curl -s "$BASE/demo/scenarios"
curl -s -X POST "$BASE/demo/scenarios/signed-tests-changed"
curl -s -X POST "$BASE/demo/scenarios/code-good"
```

Changed-test response (excerpt):

```json
{ "outcome": "REFUSE", "effect": "VOID", "namedField": "signed_tests_changed",
  "profileId": "code.milestone@1", "ruleSetVersion": "1.2.0", "scenario": "code_milestone",
  "sentence": "The signed tests were changed. Nothing was paid. No payment was executed.",
  "sentences": {
    "payer": "The signed tests were changed. Nothing was paid. No payment was executed.",
    "builder": "Restore the frozen signed tests and submit a new commit. No payment was executed."
  },
  "evidenceTier": "fixture", "source": "synthetic_check_results",
  "payment": { "executed": false } }
```

The full response also includes checks, reason, detail and a compatibility inspector sentence. It has no paypal block. RELEASE is assessment eligibility, not a confirmed RELEASED settlement.

| Default fixture | Assessment | Reason / next action |
|---|---|---|
| code-good | RELEASE | Synthetic findings pass, no capture |
| signed-tests-changed | REFUSE | Restore the frozen signed tests |
| tests-skipped | REFUSE | Run every required test |
| weak-tests | WAIT | Human review of weak mutation quality |
| usage-pending | WAIT | Independent usage receipt and buyer acceptance missing |

Both WAIT responses keep namedField null and expose weak_tests / usage_pending in reason, preserving the existing decision contract. Money copy is conservative: this fixture knows no call was made; ordinary assessments never claim payment or successful cancellation. A future final usage milestone cannot release without trusted outside proof and the agreed buyer acceptance.

### Scenario: site visits (secondary synthetic fixtures)

Existing good, wrong-plot, recycled, wrong-stage, substituted-fitting, nonce-unreadable, mock-location, funding-declined and hold-expiry remain reachable at the same fixture paths and return scenario: site_visit. The secondary freelance-missing-screen fixture returns scenario: freelance. They are not the default judge path. Site-visit wrong-plot retains the 1.4 km detail and separate payer/inspector instructions. Location/geofence tests remain valid generic checks.

Funding-declined and hold-expiry simulate domain transitions: outcome WAIT, states WAIT_FUNDING/EXPIRED and source synthetic_domain_transitions. Expiry requires simulated matched provider proof, not elapsed time alone. No reference is a real PayPal ID.

Hosted provider replay, approval browser automation, receipts and Postman workspace remain planned; no hosted URL or provider confirmation is claimed here. Allowances/tranches accept GBP/USD/EUR with exact totals. The guarded funded-hold adapter is tested with fake/synthetic provider evidence and rechecks the five-minute expiry margin before calling; financial HTTP remains off.

---

## Keys and configuration

### First run (local tool implemented, T-0135)

Run `scripts/dev setup` from an interactive terminal. Docker builds the API and prompts only for `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` and `PAYPAL_WEBHOOK_ID`; all provider input is hidden. Stood generates its own three independent platform secrets, saves them privately and displays newly generated values once in your terminal. Existing platform secrets are preserved. `scripts/dev setup --rotate-platform` explicitly replaces them; restart callers with the new values. This does not issue hosted platform keys or enable payments.

Create the PayPal credentials in your [sandbox app](https://developer.paypal.com/dashboard/applications/sandbox); see [PayPal authentication](https://developer.paypal.com/api/rest/authentication/). Obtain the webhook id from that app's [webhook configuration](https://developer.paypal.com/api/rest/webhooks/). The tool validates the client id/secret using sandbox OAuth, discards the access token and writes only the six keys into git-ignored `.env`, with private file permissions. Other configuration is preserved. Invalid input or failed OAuth validation leaves existing configuration untouched. Values containing whitespace, quotes, backslashes or interpolation characters are rejected; keys are never altered silently. Symlinks and hard links are refused. The webhook id and platform keys are collected, but their provider ownership is not checked by this local tool.

Restart the API with `docker compose up -d --force-recreate api` after setup. Compose passes named variables only; the API also gets its fixed local database connection and STOOD_PLATFORM_ID (default local-platform). The local `/health` returns `paymentReady: false`, `missing` (variable **names** only) and setup guidance. Presence of every variable is not proof of valid credentials or payment readiness. With STOOD_API_KEY and STOOD_HMAC_SECRET configured, POST `/v1/allowances` creates a DRAFT and signed reads are available after migrations. Metadata-only commit-package intake is available; other allowance, tranche and payment writes return `503 payments_not_configured`; initial funding, evidence processing and real sandbox qualification are still required. Synthetic demo scenarios remain available. No financial request is executed by setup or these guards.

Hosted onboarding, webhook URL registration, copy-once platform key issuance and rotation remain planned under T-0150. Tests for the local tool use fake OAuth responses; no real sandbox credentials were supplied or verified during development. The sandbox-only boot guard remains in place.

### Local signed draft API (implemented subset)

Start Postgres with `scripts/dev up`, replay migrations with `scripts/dev db:migrate`, then start the API. Configure the local Stood platform key and HMAC secret privately; PayPal credentials are not needed for draft creation. Hosted key issuance is still planned. Every draft request and read requires `Authorization: Bearer <STOOD_API_KEY>` and `Stood-Signature: t=<unix-seconds>,v1=<hex HMAC-SHA256(STOOD_HMAC_SECRET, timestamp + "." + raw-body)>`. For GET, sign an empty body. The server rejects timestamps more than five minutes away. Draft POST also requires JSON and `Idempotency-Key`; the maximum request body is 64 KiB.

`POST /v1/allowances` accepts this implemented draft shape:

```json
{
  "payee_ref": "builder-reference",
  "cap": { "minor": 400000, "currency": "GBP" },
  "milestones": [{ "name": "foundation", "amount": { "minor": 400000, "currency": "GBP" },
    "profile": "construction.stage@1", "params": {} }],
  "window_days": 7, "max_resubmits": 2
}
```

Response: `201 { "id": "alw_…", "status": "DRAFT", "tranches": [{ "id": "trn_…", "name": "foundation" }], … }`, including the validated input fields. It contains no `approve_url` and creates no hold. Params are stored draft metadata; profile-specific activation/evidence validation remains planned. Unknown top-level or milestone fields are rejected; platform identity comes from configured authentication.

`GET /v1/allowances/{id}` returns the owned draft. `GET /v1/tranches/{id}` returns recovered state, version, amount, profile, decision, hold age/expiry, pending effect/status/creation time, settlement and `sentences.payer` / `sentences.inspector`. A missing or foreign record returns the same 404. Identical POST bytes with the same platform/key replay the stored response across restart; changed bytes return 409. The local implementation retains keys indefinitely (at least the promised 24 hours). JSON formatting changes count as changed bytes.

Dispatch, versions and uploads are still guarded. The allowance examples and approval URLs in the hosted sections below describe the **planned full API**, not this draft subset. Fixtures remain public synthetic previews and execute no payment.

### A. Calling Stood from your platform (hosted)

| Key | What it is | Where it comes from | Where it lives |
|---|---|---|---|
| `STOOD_API_KEY` | Bearer key identifying your platform | Planned platform onboarding: issued per platform/environment, shown once and rotatable. Until then, contact the maintainer without posting secrets | Your server's secret store (for example Google Secret Manager). **Never in a mobile app or browser** |
| `STOOD_HMAC_SECRET` | Signs every request you send (`Stood-Signature`) | Issued with the API key | Server secret store |
| `STOOD_WEBHOOK_SECRET` | Verifies the webhooks Stood sends you | Issued when you register a webhook URL | Server secret store |
| `STOOD_BASE_URL` | `https://stood-api.onrender.com/v1` (sandbox) | — | Config |

You **don't** give Stood your users' PayPal passwords or card details. Payers approve in PayPal's own window.

### B. Self-hosting Stood (Docker)

| Variable | Required | Notes |
|---|---|---|
| `APP_ENV` | ✓ | `local` / `ci` / `demo`. **There's no `live` until an ADR allows it** |
| `PAYPAL_BASE_URL` | ✓ | Must be `https://api-m.sandbox.paypal.com`. The app refuses to boot otherwise |
| `PAYPAL_CLIENT_ID` / `PAYPAL_CLIENT_SECRET` | ✓ | From a **sandbox** app at developer.paypal.com (merchant = the platform's business account) |
| `PAYPAL_WEBHOOK_ID` | ✓ | From the sandbox app's webhook settings (used to verify PayPal webhooks) |
| `DATABASE_URL` | ✓ | Postgres 17 (local: the `db` container. Demo: Neon) |
| `S3_ENDPOINT` / `S3_BUCKET` / `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | ✓ | Local: SeaweedFS. Demo: Cloudflare R2 (a bucket-scoped token) |
| `RECEIPT_SIGNING_KEY` | ✓ | Random 32+ bytes. Signs public receipt links |
| `PLATFORM_KEYS_JSON` | ✓ | Platform id → hashed API key, HMAC secret ref, webhook URL |
| `EVIDENCE_AGENT_URL` / `EVIDENCE_AGENT_TOKEN` | ✓ | The evidence agent (Astropods or a separate container). **The agent itself gets no PayPal keys** |
| `VISION_MODEL` / `WORKERS_AI_TOKEN` | agent only | Default `@cf/meta/llama-3.2-11b-vision-instruct` |
| `EVIDENCE_INDEX` | | `pgvector` (default) or `elastic` (+ `ELASTIC_URL`, `ELASTIC_API_KEY`) |
| `CHANNEL3_API_KEY` | optional | For `catalog_match`. The free tier works without a key |
| `KERNEL_API_KEY` | demo only | Headless sandbox approval |
| `NOTIFIER` | | `none` / `email` (+ `RESEND_API_KEY`) / `zapier` (+ `ZAPIER_HOOK_URL`) |
| `DEMO_MODE` | | `true` enables synthetic `/v1/demo/*` fixtures; it does not enable a webhook verifier |

```bash
git clone https://github.com/ma-za-kpe/stood && cd stood
cp .env.example .env            # fill the sandbox values above
docker compose up -d db s3 mail
docker compose run --rm app pnpm install
docker compose run --rm app pnpm db:migrate
docker compose up -d api        # local API on :3000; product web app is planned
```

---

## Scenario: site visits (planned TypeScript SDK)

```ts
import { Stood } from '@stood/sdk';

const stood = new Stood({
  baseUrl: process.env.STOOD_BASE_URL,
  apiKey: process.env.STOOD_API_KEY,
  hmacSecret: process.env.STOOD_HMAC_SECRET,
});

// 1. Create the allowance: what "done" means
const allowance = await stood.allowances.create({
  platform_ref: 'eos-project-123',               // your id (idempotent)
  currency: 'GBP',
  milestones: [
    { name: 'foundation', amount: { minor: 400000, currency: 'GBP' },
      profile: 'construction.stage@1',
      params: { location: { lat: 5.6037, lng: -0.1870, radius_m: 75 },   // synthetic example
                required_items: ['north_wall', 'south_wall', 'overview', 'nonce_card'] } },
    { name: 'blockwork', amount: { minor: 500000, currency: 'GBP' },
      profile: 'construction.stage@1', depends_on: 'foundation' },
  ],
  window_days: 7,
  return_url: 'https://your.app/projects/123/signed',
  cancel_url: 'https://your.app/projects/123/cancelled',
}, { idempotencyKey: 'create-eos-project-123' });

// 2. Send the payer to PayPal to sign once
redirect(allowance.approve_url);

// 3. Later: the stage is ready → hold the money
const held = await stood.tranches.dispatch(allowance.milestones[0].tranche_id,
  { idempotencyKey: 'dispatch-foundation-1' });
// held.state === 'HELD', held.nonce === 'K7Q' → show the code to your inspector

// 4. Submit evidence (Stood copies from your signed URLs)
await stood.tranches.submitPackage(held.id, {
  platform_ref: 'evidence-doc-789',
  photos: [{ item: 'nonce_card', source_url: signedUrl1, lat: 5.60371, lng: -0.18702,
             accuracy_m: 8.5, captured_at_device: '2026-11-02T10:41:58Z' } /* … */],
  platform_signals: [{ type: 'ATTESTATION', verdict: 'PASSED', source: 'firebase_app_check' }],
  complete: true,
}, { idempotencyKey: 'package-evidence-doc-789' });

// 5. The decision arrives by webhook (below). You can also poll:
const t = await stood.tranches.get(held.id); // t.state: RELEASED | REFUSED | WAITING
```

### Freelance example (same endpoint, different profile)

```ts
{ name: 'homepage', amount: { minor: 120000, currency: 'USD' },
  profile: 'freelance.milestone@1',
  params: { required_items: ['screen_home', 'screen_pricing', 'screen_contact', 'figma_link'],
            artifact_hash: { must_differ_from: 'previous_deliveries' } } }
```

---

## Webhooks you'll receive (planned)

Register one HTTPS URL. Every event is signed: `Stood-Signature: t=<unix>,v1=<hex hmac_sha256(secret, t + "." + body)>`.

```ts
import { verifyStoodSignature } from '@stood/sdk/webhooks';

app.post('/stood/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  if (!verifyStoodSignature(req.body, req.header('Stood-Signature'), process.env.STOOD_WEBHOOK_SECRET)) {
    return res.sendStatus(400);
  }
  try {
    const event = JSON.parse(req.body);
    // Your durable inbox adapter must insert the event and jobs in ONE transaction.
    await db.transaction(async (tx) => {
      if (!await tx.events.insertIfAbsent(event.id, event)) return;
      if (event.type === 'tranche.released' && event.data.effect === 'CAPTURE') {
        const captureId = event.data.paypal.capture_id;
        if (!captureId || event.data.paypal.capture_status !== 'COMPLETED') {
          throw new Error('A payout requires confirmed capture');
        }
        await tx.payoutJobs.enqueueOnce(`capture:${captureId}`, event.data);
      }
      await tx.notificationJobs.enqueueOnce(`event:${event.id}`, event);
    });
    return res.sendStatus(200); // acknowledge only after the transaction commits
  } catch {
    return res.sendStatus(503); // Stood retries; do not lose an unpersisted event
  }
});
```

`db` and its inbox/job methods are caller-owned pseudocode, not SDK exports. Jobs run after acknowledgement. The payout worker must reuse the capture-based key with the local processor and reconcile ambiguous results. Event-id deduplication alone cannot prevent two different events from paying the same capture twice. VOID effects (including a successful deposit return) never enqueue a payout. Financial webhook fields remain draft until the payment API is implemented.

| Event | Meaning | Typical action |
|---|---|---|
| `allowance.signed` | The payer approved in PayPal | Enable "dispatch" in your UI |
| `tranche.held` | PayPal authorised the hold | Start matching or inspection. Show the nonce |
| `tranche.funding_failed` | PayPal couldn't hold the amount | Show `sentence.payer`. Don't dispatch |
| `tranche.released` | Captured. The money moved to the platform merchant | Pay the payee on your local rail |
| `tranche.refused` | Voided. `named_field` says why | Show `sentence.inspector` ("what to redo") |
| `tranche.waiting` | A human must decide | Show "in review". The reviewer acts in Stood |
| `tranche.hold_expiring` / `tranche.expired` | The hold is ending or has ended (nothing paid) | Ask the payer to re-approve if needed |
| `dispute.opened` | The payer disputed a release | Link the packet in your admin |

Every event includes `sentence.payer` and `sentence.inspector`, plain-language text you can show as-is.

---

## Evidence profiles

| Profile | Use it for | Key params |
|---|---|---|
| `code.milestone@1` | Intermediate code milestones | Frozen tests, commit, runner report, mutation and mandate; authentic ingestion planned |
| `code.final@1` | Final handover | Intermediate code checks plus independent outside usage / buyer acceptance |
| `construction.stage@1` | Build stages verified on site | `location`, `required_items`, stage label |
| `freelance.milestone@1` | Digital deliverables | `required_items`, `artifact_hash`, `link_check` |
| `claims.field_visit@1` | Insurance / lending field visits | `location`, `pair_match` (before / after) |
| `rental.return@1` | Deposits (**inverted:** a match voids the hold, so the deposit is returned) | `pair_match` (checkout vs return) |
| `grant.site_visit@1` | NGO / grant tranches | `location`, `document_fields`, `human_review` |
| `delivery.goods@1` | Goods received | `required_items` (seal, container no.), `document_fields` |

Need another? Open a **Feature or use case** issue. Profiles are compositions of [generic checks](stood/S16-use-cases-and-evidence-profiles.md#check-library-generic), never custom code.

---

## Other ways to plug in (planned)

| Path | How |
|---|---|
| **No backend?** | Use the **hosted pages**: redirect the payer to Stood's allowance-sign page, and link the hosted receipt |
| **AI agents** | Connect the **Stood MCP server** (`stood.create_allowance`, `stood.dispatch`, `stood.submit_package`, `stood.get_decision`). Agents pay only for delivery that passes the checks |
| **No code** | Zapier: "New Stood decision" → email, SMS or Slack |
| **Postman** | Fork the public workspace. Environments for sandbox are included |

---

## Target limits and guarantees (financial API planned)

| | |
|---|---|
| Hold length | Up to **29 days** per tranche. Day-four renewal rules and the funded-hold adapter are tested; status polling is implemented, automatic provider renewal submission is not enabled |
| Photos per package | ≤ 10, ≤ 8 MB each (JPEG / HEIC / WebP) |
| Rate limits (demo) | 60 req/min per key, 10 packages/min |
| Idempotency | Required on every POST (`Idempotency-Key`, 24h) |
| Money format | Integer minor units + ISO currency. Never floats |
| Decision guarantee | Unknown or uncertain evidence → `WAIT`. **Never an implicit release.** An expired hold pays nothing |

## Errors

RFC 9457 `application/problem+json`. A **refusal is not an error**: it's a `200` with `outcome: "REFUSE"`.

| `type` | HTTP | Fix |
|---|---|---|
| `validation` | 422 | Check the `errors[]` field paths |
| `invalid_state` | 409 | For example dispatching a tranche that's already `HELD` |
| `idempotency_conflict` | 409 | Same key, different body. Use a new key |
| `unauthorized` | 401 | Wrong key or a bad `Stood-Signature` (check the clock skew is under 5 min) |
| `payments_not_configured` | 503 | Payments are off. Follow [Keys and configuration](#keys-and-configuration); missing/invalid keys must not crash the service |
| `paypal_unavailable` | 503 | Retry with the same idempotency key. State is reconciled automatically |

## FAQ

**Does Stood hold my users' money?** No. PayPal holds it as an authorisation on the payer's account, until Stood captures or voids it. Stood never pools funds.

**Who pays the builder or inspector?** You do, on your local rail (Flutterwave, Paystack, MoMo…), after `tranche.released`.

**Can the AI release money?** No. The model only reports findings. Deterministic rules decide, and the model runs without PayPal credentials.

**Is this production-ready?** Not yet. It's sandbox only during the hackathon. Going live needs PayPal live review, licensing and data-protection steps ([TASKS.md](../TASKS.md) T-0111…T-0115).

**How do I report a security issue?** Privately: [SECURITY.md](../SECURITY.md).

## Local reconciliation worker (implemented status polling)

After database migrations and sandbox key setup, run `scripts/dev reconcile` in the foreground, or `docker compose --profile operations up -d reconciler` in the background. Compose reads the named sandbox credentials from the private `.env`; it does not forward the whole file. Set `RECONCILIATION_OWNER` to the responsible reviewer. The local default, `local-reviewer`, means the person running this checkout.

The worker ticks every 15 seconds, claims up to ten due jobs, retries unresolved status checks after 60 seconds and idle states after an hour. Database leases expire after 90 seconds and require a matching token to finish. It reserves cancellation of old-rule holds automatically and records reviewer-owned `SAFE_CANCEL_REQUESTED`, `PROVIDER_UNKNOWN`, `UNRESOLVED_3H` and `WORKER_FAILURE` rows in `payment_alerts`; resolved rows remain available. The reviewer must investigate unknown outcomes and any pending safe-mode cancellation.

This command reads PayPal status and writes local state and alerts. It does **not** submit captures, cancellations or renewals. A reserved safe-mode cancellation therefore remains pending until a qualified executor submits it or the reviewer cancels it through PayPal and matching provider proof confirms the outcome. Transaction Search auditing, dashboard presentation and email/Slack notification delivery remain planned (T-0155 / T-0142). No raw provider responses or credentials are logged.

## Local commit-package references (T-0172)

After migrations and platform authentication are configured, `POST /v1/tranches/:id/packages` accepts exactly `repository` (`owner/repo`), `base_commit` and `commit_sha` (40 lowercase hex characters), `report_ref` (an opaque private object key such as `reports/package.json`) and `report_sha256` (64 lowercase hex characters). Use the same bearer/HMAC headers and an Idempotency-Key. A signed request returns 202 with `id`, `trancheId`, `status: QUEUED`, immutable `metadata`, server `createdAt` and `waitingFor: HOLD | RENEWAL | RUNNER`. Signed `GET /v1/tranches/:id/packages/:packageId` returns that stored intake receipt; missing or foreign records return 404. Changed bodies under the same key return 409.

This stores references only: no report upload/fetch, repository execution, assessment or payment occurs. Intake during renewal is durable, but renewal wake-up and trusted runner processing remain planned. `waitingFor` records the intake reason, not a live worker status. URLs and client-authored PASS findings are rejected. Full T-0156 and T-0137 remain open.

## Local Yard API shell (T-0175)

Run `docker compose --profile yard up -d --wait yard-api`. Its localhost-only port 3001 exposes `GET /health`, reporting every product capability as false. Planned `/yard/v1/*` workflows return 503 without processing input. This is a separate runtime receiving no Stood/PayPal credentials; the Board, Foreman, events, credential intake and Yard website remain unimplemented.

## Server-side Stood SDK foundation (T-0179)

`@stood/stood-sdk` exposes `StoodClient` for trusted server callers: `createDraft(input, key)`, `getDraft(id)`, `submitPackage(trancheId, references, key)` and `getPackage(trancheId, packageId)`. Configure a pinned HTTPS root (localhost HTTP is allowed), the platform key/HMAC secret and a server clock. It signs exact request bytes, disallows redirects, bounds response bodies to 64 KiB and times out after five seconds. Yard web cannot import this package.

Results remain DRAFT or QUEUED. Typed `StoodClientError.code` values identify authentication, validation, not-found, conflict, invalid response and unavailable storage. TIMEOUT/UNKNOWN_OUTCOME do not prove a POST was absent: inspect the resource or deliberately resend the same request with the same durable key. The SDK never retries automatically. It has no dispatch, signing, settlement or webhook-authority method. The contract tests use the real local HTTP router with fake storage, not a deployed service or PayPal sandbox.

The reconciliation worker now requires an explicit `PROVIDER_PAYPAL` selection and uses the same provider runtime as the API. With `PROVIDER_PAYPAL=sim`, `scripts/dev reconcile` reads the simulator clock and needs no PayPal keys. With `live`, sandbox readiness and keys are required; there is no fallback. Each reconciliation tick freezes one provider-clock instant. Simulated notification headers or bodies are rejected unless the receiver is explicitly in simulator mode, even if a verifier would otherwise accept them. Normal runtime webhook ingestion remains off until its durable queue is wired.

### Isolated network simulation

`scripts/dev mock` now builds and starts a separate Docker project for Stood, the restricted Postgres-backed Yard Board and the PayPal simulator, then drives the shared Stood scenario files over HTTP. It uses fixed synthetic credentials, publishes no host ports and deletes only its own containers and disposable database/dependency volumes on exit. It never reads your DATABASE_URL or forwards your PayPal keys. Failed runs save synthetic service logs under `artifacts/mock-network/`.

Authorization/approval and assessments are explicitly test-only fixture commands, not shipped financial API routes or authentic runner reports. Those controls compile into `.mock-dist` for this stack and cannot enter the production API package. `scripts/dev mock:integration` retains the faster seven-case integration suite. The `mock-network` CI job runs on every PR with a ten-minute timeout; it must pass before merge. Yard/Crew and browser scenarios are added separately, and qualified live funding remains blocked.

### First connected Yard fixture

`scripts/dev mock` also runs the first Yard flow over the isolated Docker network: locally frozen fixture terms, a real persisted Board post, an ordinary simulated Crew claim, a commit pushed to the GitHub fake, and a package submitted through Yard’s server-side Stood SDK. A passing assessment leaves Yard in CHECKING. Only a signed Stood notification with matching read proof projects the confirmed simulated capture as PAID; forged notifications and duplicates are checked. No payment is executed.

Funding and assessment are explicit test-only fixture controls, not authenticated production funding or runner evidence. Crew receives only its Board identity and scoped fake GitHub token; it has no Stood payment credentials or database access. Cross-service package submission retries use a stable key, and recorded Board commands replay without another SDK call. A crash between package submission and Board persistence can leave an unreferenced package; a durable submission outbox remains follow-up work before this integration is enabled outside the isolated mock stack.

### Yard page and browser checks

The static Yard preview lives in `site/yard/`, connects to Stood’s page, and uses the outlined Yard kit. The page’s scenario controls change illustrations only; they do not call the Board or payment APIs. It says that no payment is executed before the first sample verdict. Planner, hosting, handover and live integration claims remain labelled as planned.

Run `scripts/dev site` to build and serve Stood at <http://localhost:8082/> and Yard at <http://localhost:8082/yard/>. Ports 3000/3001 remain API-only; their `/` route returns 404. Re-run the command after page changes to rebuild the preview.

Run `scripts/check-site` to build the static site and check it in a dedicated Docker Chromium browser on Node 24. It checks desktop/mobile layout, keyboard fixture selection, both-way navigation, missing assets, reduced motion and simulation disclosure. Screenshots go to `artifacts/site/`. The separate `site-browser` CI job runs the same command; it is a page smoke test, not a full accessibility audit or the remaining Yard application E2E suite.

Local setup distinguishes rejected sandbox credentials, sandbox unavailability/timeouts and invalid provider responses. These failures save nothing and never print provider response bodies, OAuth tokens or entered credentials.

Setup writes a private temporary .env file, syncs it and replaces the destination atomically. It refuses linked files or configuration changed by another writer during setup. An interruption before replacement preserves the previous configuration.
