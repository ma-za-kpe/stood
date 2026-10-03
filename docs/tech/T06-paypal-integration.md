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
- Refuse / expire: `POST /v2/payments/authorizations/{id}/void` with its own stable operation UUID. Persist request identities per authorisation attempt and action, reuse them for retries, and never reuse an old hold's identity after redispatch.

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

## Sandbox setup

- One sandbox **business** account (the platform merchant: "[EyeOnSite](https://github.com/ma-za-kpe/eyeonsite) Demo") and two sandbox **personal** accounts (Ama-success, Ama-declined).
- Webhook subscription created per environment (`demo`, `ci`). The webhook ID is in env.
- CI contract tests run against sandbox with **recorded** responses (replayed by default). A nightly job runs them live against sandbox.
- **Never** a live client id or secret in any environment. CI asserts the base URL is `api-m.sandbox.paypal.com`.
