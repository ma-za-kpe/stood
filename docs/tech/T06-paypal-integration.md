# T06: PayPal integration

All of this lives in `adapters/payments-paypal`, the **only** module allowed to import the PayPal Server SDK (TypeScript, APIMatic-generated). It's written with the APIMatic Context Plugin in the coding agent ([S13](../stood/S13-sponsor-integration.md)).

## Products used

| PayPal capability | Use in Stood | FR |
|---|---|---|
| **Vault v3** (setup token → payment token) | The allowance signature: the payer approves once, Stood stores the payment token | FR-02 |
| **Orders v2**, `intent=AUTHORIZE` with the vaulted `payment_source` | The hold per tranche on dispatch | FR-10 |
| **Authorizations**: capture / void / reauthorize | Release / refuse / timers | FR-12, 38 |
| Order metadata: `custom_id` (decision id), `invoice_id` (tranche id), description | The decision bound to PayPal's record | FR-38 |
| **Webhooks** + verify-webhook-signature | State confirmation | FR-61 |
| **Disputes API** | The dispute packet and evidence | FR-52 |
| **Transaction Search** (`/v1/reporting/transactions`) | Reconciliation in the reviewer file | FR-54 |
| **Agent Toolkit MCP** (read tools) | Reviewer agent reads disputes and transactions | FR-53 |

## Flows

### Sign (Vault)

1. `POST /v3/vault/setup-tokens` with `payment_source.paypal` (usage: merchant-initiated, `customer_type: CONSUMER`), plus return / cancel URLs.
2. Redirect the payer to the approve link. In the demo, **Kernel** drives this in a headless browser with a sandbox buyer.
3. On return, or on `VAULT.PAYMENT-TOKEN.CREATED`: `POST /v3/vault/payment-tokens` from the setup token. Store the token ref. The allowance becomes `SIGNED`.

### Hold (dispatch)

`POST /v2/checkout/orders`:

- `intent: AUTHORIZE`
- `purchase_units[0]`: `amount`, `custom_id = tranche_id`, `invoice_id = alw_id:stage`, `description = "Stood hold: <stage>, released only on evidence"`
- `payment_source.paypal.vault_id`
- Header `PayPal-Request-Id`: a persisted UUID for this attempt's order-creation operation. Order authorisation has its own stable request UUID.

Then authorise the order and record the `authorization_id` and `expiration_time`.

> ⚠️ **Spike S10-Q1 (week 1):** confirm that vaulted PayPal wallet tokens support `AUTHORIZE` orders, human not present, in sandbox. **Fallback:** buyer-present authorisation per stage (the payer taps approve at dispatch; Kernel drives it in the demo). The domain is unchanged. Only the adapter differs.

### Release / refuse

- Release: `POST /v2/payments/authorizations/{id}/capture` with `final_capture: true`, `invoice_id`, `note_to_payer = sentence`, and a stable operation UUID as `PayPal-Request-Id`.
- Refuse / expire: `POST /v2/payments/authorizations/{id}/void` with its own stable operation UUID. Persist request identities per authorisation attempt, action and settlement attempt. Reuse them for ambiguous retries; after a confirmed definite failure, increment the settlement-attempt counter and allocate a fresh operation UUID. Never reuse an old hold's identity after redispatch. The pure domain key includes this counter; the adapter must persist its mapping to the provider UUID and the counter before calling PayPal.

### Timers (Render Workflows or pg-boss)

| When | Action |
|---|---|
| From day 4 + still undecided | `reauthorize` (allowed days 4–29). Records a new authorisation id |
| Day 27 | Emit `tranche.hold_expiring`. Notify the payer and reviewer |
| Day 29 | Void. State `EXPIRED`. Sentence: "The hold ended. Nothing was paid." |

### Failure handling

| Failure | Handling |
|---|---|
| Timeout / 5xx (ambiguous outcome) | Retry with the **same** `PayPal-Request-Id` (PayPal idempotency), up to 3 times with backoff. Keep the pending reservation for reconciliation; surface an operational system wait, without permitting a competing payment |
| Definite declined / system failure, confirmed no payment | `settlementFailed` matches the reserved effect and authorisation, clears the reservation and returns to `WAITING`. Expiry rules can then run |
| Capture succeeded, DB write failed | Reconciler sees `PAYMENT.CAPTURE.COMPLETED` / Transaction Search and completes the state transition |
| `AUTHORIZATION_EXPIRED` on capture | Never treated as a release. → `EXPIRED`, with an `EXPIRE` confirmation record and provider response reference; notify. Requires a re-signature or new authorisation |
| `INSTRUMENT_DECLINED` on authorise | `WAIT_FUNDING`. Sentence: "PayPal could not hold £4,000. Nothing was sent to inspect." |
| Webhook missing | The poller checks open authorisations hourly (and on the tick endpoint) |

`REJECTED_NO_PAYMENT` replaces `SYSTEM_FAULT` and means a confirmed failure with no payment effect. A timeout, connection loss or PayPal 5xx is always `AMBIGUOUS`. `classifyPaymentFailure` is a pure response policy, not a payment client. It only accepts operation-correlated, authenticated responses; it makes no SDK/network calls.

### Implemented response policy (T-0129)

| Endpoint / response | Classification | Reference |
|---|---|---|
| Capture, HTTP 200/201 with resource status DECLINED and non-empty capture id | DECLINED | Capture id |
| Capture, HTTP 422 UNPROCESSABLE_ENTITY, AUTHORIZATION_EXPIRED | AUTHORIZATION_EXPIRED | PayPal debug id |
| Capture, HTTP 422, MAX_CAPTURE_AMOUNT_EXCEEDED | REJECTED_NO_PAYMENT | PayPal debug id |
| Reauthorise, HTTP 422, AUTH_CURRENCY_MISMATCH or REAUTHORIZATION_TOO_SOON | REJECTED_NO_PAYMENT | PayPal debug id |
| Void, PREVIOUSLY_CAPTURED | AMBIGUOUS; reconcile and alert, never infer successful void | Logged response |
| Other endpoint/code/status combinations, transport failures, 5xx, missing or conflicting details | AMBIGUOUS | Logged response |

HTTP 422 mappings require UNPROCESSABLE_ENTITY, non-empty message/debug id and a non-empty detail array. Every issue must map to the same known classification. Unknown errors keep the reservation; additional definite mappings need documented evidence and tests. These tests use synthetic bodies, not recorded sandbox responses. Sources checked 3 Oct 2026: [PayPal's official Payments v2 OpenAPI examples and capture statuses](https://github.com/paypal/paypal-rest-api-specifications/blob/main/openapi/payments_payment_v2.json), [capture reference](https://developer.paypal.com/api/payments/v2/authorizations-capture), [reauthorisation reference](https://developer.paypal.com/api/payments/v2/authorizations-reauthorize), [void reference](https://developer.paypal.com/api/payments/v2/authorizations-void).

### Capture window and currencies

Stood reserves no new capture within **five minutes** of the provider hold expiry. This is our operational buffer, not a PayPal guarantee. The payment client must recheck `captureAllowedAt` immediately before an external capture, after durable reservation. If no request was ever submitted and the window closed, record a local REJECTED_NO_PAYMENT failure; if it may have been submitted, preserve the reservation for reconciliation. Never race a void against an unresolved capture.

Allowance and direct tranche creation accept only GBP/USD/EUR, Stood's current subset of the [PayPal currency codes](https://developer.paypal.com/reference/currency-codes/). General Money retains other currencies. No automatic conversion is implemented. Merchant capabilities and real sandbox funding still need contract tests. Durable counters and key/provider-UUID mappings are still mandatory before the payment client is wired.

## Sandbox setup

- One sandbox **business** account (the platform merchant: "[EyeOnSite](https://github.com/ma-za-kpe/eyeonsite) Demo") and two sandbox **personal** accounts (Ama-success, Ama-declined).
- Webhook subscription created per environment (`demo`, `ci`). The webhook ID is in env.
- CI contract tests run against sandbox with **recorded** responses (replayed by default). A nightly job runs them live against sandbox.
- **Never** a live client id or secret in any environment. CI asserts the base URL is `api-m.sandbox.paypal.com`.
