# T04: API specification (v1)

## Code-milestone example (implemented local DRAFT)

The lead example uses the actual DRAFT fields; bearer/HMAC and idempotency conventions below apply.

```json
{ "payee_ref": "yard-operator", "cap": { "minor": 400000, "currency": "USD" },
  "milestones": [
    { "name": "build", "amount": { "minor": 120000, "currency": "USD" },
      "profile": "code.milestone@1",
      "params": { "repository": "owner/repo", "base_commit": "full-sha",
                  "frozen_tests_manifest": "sha256-manifest", "usage_required": false } },
    { "name": "usage release", "amount": { "minor": 280000, "currency": "USD" },
      "profile": "code.final@1", "params": { "usage_required": true } }
  ], "window_days": 7, "max_resubmits": 2 }
```

Response: DRAFT and PENDING tranche IDs, no approval URL. Params are unverified metadata, not a signed test contract or permission to omit usage proof. Yard sign-in, Board and private intake are deployed at <https://stood-yard-api.onrender.com/app/>; its Foreman/payment adapter remain next. The legacy endpoint contracts below are targets; the second allowance/package example is the EyeOnSite scenario.

Future commit packages bind repository/base/new SHA, frozen manifest and authenticated runner/usage reports. Raw client check results cannot authorise capture. Demo fixtures are synthetic and execute no payments.

The planned **OpenAPI 3.1** document will be the source of truth (`openapi/stood.yaml`, generated from Zod route schemas under T-0053; neither is implemented yet). APIMatic generates the TypeScript SDK, docs portal and MCP server from it ([S13](../stood/S13-sponsor-integration.md)). This page is the human summary.

## Implemented draft and package API (T-0028, partial)

The API currently exposes signed DRAFT creation plus tenant-scoped allowance/tranche reads. Draft creation accepts `payee_ref`, `cap`, `milestones[]{name,amount,profile,params}`, `window_days` and `max_resubmits`, then returns DRAFT plus PENDING tranche IDs and the validated fields. It never returns a provider approval URL. Params are draft metadata, not trusted assessment input. Saved-account signing and funding intents are implemented as described below. Legacy dispatch, version amendments, report uploads and trusted runner processing remain planned. Commit-package reference intake and owned receipt reads are implemented; they do not execute a report or payment.

Bearer and HMAC authentication follow the conventions below, including signed empty GET bodies and a five-minute skew window. Requests are capped at 64 KiB. Draft idempotency fingerprints method, versioned path and exact request bytes; the platform/key namespace is durable and serialised with a database advisory lock. Allowance, immutable ownership, initial tranche records and the original response commit atomically. Local keys remain retained indefinitely; identical requests replay the same response and changed bytes conflict. Missing and foreign reads both return 404. Read responses include recovered state, hold age/expiry, decision, settlement, pending effect/status/time and separate recipient sentences. See [ADR-0014](../adr/0014-platform-drafts-and-idempotency.md).

Local fixture endpoints remain distinct and public when DEMO_MODE is on. The worker is documented in [USAGE](../USAGE.md#local-reconciliation-worker-implemented-status-polling); HTTP records durable intents and the worker makes provider calls. The legacy endpoint tables and scenario examples below are the target full contract unless identified as implemented.

## Implemented hosted signing and funding (T-0260)

Base: <https://stood-api.onrender.com/v1>. [Health](https://stood-api.onrender.com/health) earns `paymentReady` only with all keys, a ready PayPal sandbox and the saved-account path wired. Every route below uses the platform bearer/HMAC v2 conventions. POST requests require JSON and `Idempotency-Key`; keep that key for a lost-reply retry. The API reserves an intent; the reconciler's signing/funding step makes each PayPal call. No real money moves.

| Method | Path (relative to `/v1`) | Implemented behavior |
|---|---|---|
| POST | `/allowances/{id}/mandate` | Reserve saved-PayPal signing for the owned allowance's current terms; send `{}` |
| GET | `/allowances/{id}/mandate/{key}` | Read signing status and the buyer approval URL when awaiting approval |
| POST | `/tranches/{id}/funding` | Reserve funding using `{"expected_version": 0, "nonce": "K7Q"}`; use the current tranche version, and a three-character nonce from `A-HJ-NP-Z2-9` |
| GET | `/tranches/{id}/funding/{key}` | Read funding status, approval URL when required, and confirmed hold expiry |

POST returns `202`; that records acceptance, not a completed signature or hold. Mandate views contain `key`, `status`, `approve_url` and `expires_at`. Funding views contain `key`, `status`, `approve_url` and `hold_expires_at`; hold expiry appears only in `HELD`. Views never return saved tokens, setup/customer/order/authorization IDs. Missing or foreign records return the same `404`; a stale funding version returns `409 stale_version`. A missing signing composition returns `503 signing_not_configured`. Source code and route contract tests: [`platform-api.ts`](../../services/api/src/http/platform-api.ts), [`signing-funding-http.test.ts`](../../services/api/src/http/signing-funding-http.test.ts).

Yard's browser does not call these financial routes yet. Hosted Foreman, repository/preview and Yard-to-Stood adapters remain [#76](https://github.com/ma-za-kpe/stood/issues/76). [SETUP](../SETUP.md) records the actual deployment; [#108](https://github.com/ma-za-kpe/stood/issues/108) provides current progress and screenshot guidance.

## Conventions

- Base URL: `https://stood-api.onrender.com/v1` (hackathon). JSON, UTF-8, UTC ISO-8601 timestamps.
- **Auth (platform → Stood):** `Authorization: Bearer <platform_key>` plus `Stood-Signature: t=<ts>,v2=<hex HMAC-SHA256(secret, canonical-request)>`, rejected if skew > 5 min. One key pair per platform and environment. `canonical-request` is the UTF-8 encoding of `JSON.stringify(["stood.request@2", ts, method, target, idempotencyKey, ifMatch, contentType, rawBody])`, all strings. `target` includes `/v1`, the URL pathname and the exact query; method is uppercase, GET body and absent header values are empty strings. Header values match those sent. Body-only request v1 is rejected; see [ADR-0020](../adr/0020-bind-request-signatures-to-command-context.md).
- **Idempotency:** `Idempotency-Key` is required on every POST. Same key + same body → same response for 24h. Same key + a different body → `409`.
- **Money:** `{ "minor": 400000, "currency": "GBP" }`.
- **Errors:** RFC 9457 `application/problem+json` with a `type` from a fixed catalogue (`validation`, `not_found`, `conflict`, `invalid_state`, `idempotency_conflict`, `paypal_unavailable`). **Domain outcomes (refuse / wait) are 200s, not errors.**
- Pagination: cursor-based (`?cursor=&limit=`).

## Endpoints

> Before 0.2.0, the allowance body generalises to `milestones[]{ name, amount, profile: "construction.stage@1", params: { location, required_items, … } }` ([S16 §5](../stood/S16-use-cases-and-evidence-profiles.md#5-what-this-changes-in-the-technical-docs)). The construction example below shows the profile's params inlined for readability.

### Allowances

| Method | Path | Purpose | FR |
|---|---|---|---|
| POST | `/allowances` | Create the allowance (plot, stages, payee, window). Returns `approve_url` | FR-01, 02 |
| GET | `/allowances/{id}` | Allowance + stage / tranche states | — |
| POST | `/allowances/{id}/versions` | Propose changes. Needs a new signature | FR-03 |

**Scenario: site visits**, planned `POST /allowances` request (abridged):

```json
{
  "platform_ref": "eos-task-01J9…",
  "plot": { "center": { "lat": 5.6037, "lng": -0.1870 }, "radius_m": 75 },
  "currency": "GBP",
  "stages": [
    { "name": "foundation", "amount": { "minor": 400000, "currency": "GBP" },
      "required_shots": ["north_wall","south_wall","east_wall","west_wall","overview","nonce_card"],
      "checklist": ["footings_poured","dpc_visible"] },
    { "name": "blockwork", "amount": { "minor": 500000, "currency": "GBP" }, "depends_on": "foundation" }
  ],
  "window_days": 7,
  "max_resubmits": 2,
  "payer": { "email_hint": "optional, for PayPal pre-fill only" },
  "return_url": "https://…/allowance/done",
  "cancel_url": "https://…/allowance/cancelled"
}
```

Response: `201 { "id": "alw_…", "status": "AWAITING_SIGNATURE", "approve_url": "https://www.sandbox.paypal.com/…" }`.

> The coordinates above are a **synthetic example** (central Accra), not a real plot.

### Tranches

| Method | Path | Purpose | FR |
|---|---|---|---|
| POST | `/tranches/{id}/dispatch` | Authorise and hold. Returns the nonce | FR-10, 11, 13 |
| POST | `/tranches/{id}/packages` | Submit evidence (or create the upload session) | FR-20–22 |
| POST | `/tranches/{id}/packages/{pid}/complete` | Mark the upload complete and start the decision | FR-22 |
| GET | `/tranches/{id}` | State, hold age, decision, sentence | — |
| POST | `/tranches/{id}/decisions/override` | Reviewer / payer release or refuse a WAIT (reason required) | FR-39, 40 |
| POST | `/tranches/{id}/disputes` | Build (and, where possible, file) the dispute packet | FR-51, 52 |

**Photo upload:** `POST /packages` returns presigned **R2 PUT URLs** per photo (direct upload, up to 10 photos, ≤ 8 MB each, JPEG / HEIC / WebP). Alternatively the platform passes `source_url`s (for example Firebase Storage signed URLs) and Stood copies them server-side.

Per-photo metadata:

```json
{ "shot": "north_wall", "lat": 5.60371, "lng": -0.18702, "accuracy_m": 8.5,
  "captured_at_device": "2026-11-02T10:41:58Z", "received_at_server": "2026-11-02T10:42:03Z",
  "mock_location": false, "platform_phash": "a1b2…", "exif": { "lat": 5.60370, "lng": -0.18701 } }
```

Package-level `platform_signals`: `[{ "type": "ATTESTATION", "verdict": "PASSED", "source": "firebase_app_check" }, { "type": "IMPOSSIBLE_TRAVEL", "severity": "HIGH" }]`. These are stored and **re-checked where possible, never trusted blindly**.

### Records

| Method | Path | Purpose |
|---|---|---|
| GET | `/receipts/{token}` | Public receipt (signed JWT link, 30-day expiry). Distance shown, not coordinates |
| GET | `/tranches/{id}/packet` | Dispute packet (JSON). `Accept: application/pdf` for the PDF |
| GET | `/reviewer/decisions` | Reviewer grid data source (filter, sort, paging: matches the AG Studio async data source) |
| GET | `/reviewer/reconciliation` | Joined PayPal Transaction Search × Stood decisions |

Reviewer endpoints use **reviewer session auth** (GitHub OAuth via Better Auth), not platform keys.

### Demo (hackathon only, behind a `DEMO_MODE` flag)

Local code fixtures are synthetic. Hosted provider replay remains planned.

| Method | Path | Purpose |
|---|---|---|
| POST | `/demo/scenarios/{name}` | Default code fixtures: `code-good`, `signed-tests-changed`, `tests-skipped`, `weak-tests`, `usage-pending` (T-0169); field fixtures are site-visit scenarios |
| POST | `/demo/approve` | Kernel drives the sandbox buyer approval (live view URL returned) |

## Webhooks out

Planned contract; the JSON below is a site-visit scenario example.

`POST <platform webhook url>`, headers `Stood-Event-Id`, `Stood-Signature: t=<ts>,v1=<hex HMAC-SHA256(webhookSecret, ts + "." + rawBody)>`, `Stood-Event-Type`. Webhooks use their separate secret and delivery signature v1, distinct from request v2. At-least-once, exponential backoff for 24h, then dead-letter visible in the reviewer file.

```json
{ "id": "evt_…", "type": "tranche.refused", "schema_version": "1",
  "created_at": "2026-11-02T10:43:10Z",
  "data": { "tranche_id": "trn_…", "allowance_id": "alw_…", "platform_ref": "eos-task-…",
            "outcome": "REFUSE", "effect": "VOID", "named_field": "plot", "distance_m": 1400,
            "sentence": { "payer": "Wrong plot. 1.4 km off. Nothing was paid.",
                          "inspector": "Photos were taken 1.4 km from the pin. Go back and capture again." },
            "paypal": { "order_id": "…", "authorization_id": "…", "void_status": "VOIDED" },
            "receipt_url": "https://stood-web.onrender.com/r/…" } }
```

Event types: `allowance.signed`, `allowance.signature_failed`, `tranche.held`, `tranche.funding_failed`, `tranche.deciding`, `tranche.released`, `tranche.refused`, `tranche.waiting`, `tranche.hold_expiring`, `tranche.expired`, `dispute.opened`, `reconciliation.mismatch`.

Financial events explicitly identify the confirmed effect. A CAPTURE release includes `data.effect: CAPTURE`, `data.paypal.capture_id` and `data.paypal.capture_status: COMPLETED`. Only that confirmed effect can initiate a local payout. A rental return RELEASE with effect VOID cannot ([ADR-0009](../adr/0009-assessment-and-payment-confirmation.md)). These webhook contracts are not implemented by the fixture-preview API.

## Webhooks in (PayPal)

`POST /webhooks/paypal`. Live verification uses `POST /v1/notifications/verify-webhook-signature`. Simulated notifications require the configured simulator provider mode and its separate verifier; `DEMO_MODE` alone grants no acceptance, and live mode rejects them. Verified events are then deduplicated on event ID. Runtime webhook processing remains separately gated.

Subscribed events:

- `VAULT.PAYMENT-TOKEN.CREATED`
- `PAYMENT.AUTHORIZATION.CREATED`
- `PAYMENT.AUTHORIZATION.VOIDED`
- `PAYMENT.CAPTURE.COMPLETED`, `PAYMENT.CAPTURE.DENIED`, `PAYMENT.CAPTURE.REFUNDED`
- `CUSTOMER.DISPUTE.CREATED`, `CUSTOMER.DISPUTE.RESOLVED`

## Rate limits (hackathon)

60 requests/min per platform key. 10 packages/min. A `429` comes with `Retry-After`.
