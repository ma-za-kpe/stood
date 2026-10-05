# T04: API specification (v1)

The planned **OpenAPI 3.1** document will be the source of truth (`openapi/stood.yaml`, generated from Zod route schemas under T-0053; neither is implemented yet). APIMatic generates the TypeScript SDK, docs portal and MCP server from it ([S13](../stood/S13-sponsor-integration.md)). This page is the human summary.

## Implemented local subset (T-0028, partial)

The API currently exposes signed DRAFT creation plus tenant-scoped allowance/tranche reads. Draft creation accepts `payee_ref`, `cap`, `milestones[]{name,amount,profile,params}`, `window_days` and `max_resubmits`, then returns DRAFT plus PENDING tranche IDs and the validated fields. It never returns a provider approval URL. Params are draft metadata, not trusted assessment input. Financial dispatch, signing/versions and package/upload processing below remain planned (T-0154 / T-0156).

Bearer and HMAC authentication follow the conventions below, including signed empty GET bodies and a five-minute skew window. Requests are capped at 64 KiB. Draft idempotency fingerprints method, versioned path and exact request bytes; the platform/key namespace is durable and serialised with a database advisory lock. Allowance, immutable ownership, initial tranche records and the original response commit atomically. Local keys remain retained indefinitely; identical requests replay the same response and changed bytes conflict. Missing and foreign reads both return 404. Read responses include recovered state, hold age/expiry, decision, settlement, pending effect/status/time and separate recipient sentences. See [ADR-0014](../adr/0014-platform-drafts-and-idempotency.md).

The synthetic demo endpoints remain distinct and public when DEMO_MODE is on. The provider-status polling CLI is documented in [USAGE](../USAGE.md#local-reconciliation-worker-implemented-status-polling); HTTP does not execute money calls. The endpoints and examples below are the target full contract.

## Conventions

- Base URL: `https://stood-api.onrender.com/v1` (hackathon). JSON, UTF-8, UTC ISO-8601 timestamps.
- **Auth (platform → Stood):** `Authorization: Bearer <platform_key>` plus an **HMAC request signature** `Stood-Signature: t=<ts>,v1=<hmac_sha256(secret, ts + "." + body)>`, rejected if skew > 5 min. One key pair per platform and environment.
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

`POST /allowances`, request (abridged):

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

| Method | Path | Purpose |
|---|---|---|
| POST | `/demo/scenarios/{name}` | Run a fixture end to end: `good`, `wrong-plot`, `recycled`, `wrong-stage`, `substituted-fitting` |
| POST | `/demo/approve` | Kernel drives the sandbox buyer approval (live view URL returned) |

## Webhooks out

`POST <platform webhook url>`, headers `Stood-Event-Id`, `Stood-Signature` (same HMAC scheme), `Stood-Event-Type`. At-least-once, exponential backoff for 24h, then dead-letter visible in the reviewer file.

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

`POST /webhooks/paypal`. Verified with `POST /v1/notifications/verify-webhook-signature` (simulator events can't be verified that way, so they're accepted only when `DEMO_MODE` is on), then deduplicated on event id.

Subscribed events:

- `VAULT.PAYMENT-TOKEN.CREATED`
- `PAYMENT.AUTHORIZATION.CREATED`
- `PAYMENT.AUTHORIZATION.VOIDED`
- `PAYMENT.CAPTURE.COMPLETED`, `PAYMENT.CAPTURE.DENIED`, `PAYMENT.CAPTURE.REFUNDED`
- `CUSTOMER.DISPUTE.CREATED`, `CUSTOMER.DISPUTE.RESOLVED`

## Rate limits (hackathon)

60 requests/min per platform key. 10 packages/min. A `429` comes with `Retry-After`.
