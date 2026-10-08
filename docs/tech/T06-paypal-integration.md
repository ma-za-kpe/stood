# T06: PayPal integration

All of this lives in `adapters/payments-paypal`, the **only** module allowed to import the PayPal Server SDK (TypeScript, APIMatic-generated). It's written with the APIMatic Context Plugin in the coding agent ([S13](../stood/S13-sponsor-integration.md)).

## Products used

| PayPal capability | Use in Stood | FR |
|---|---|---|
| **Vault v3** (setup token → payment token) | The allowance signature: the payer approves once, Stood stores the payment token | FR-02 |
| **Orders v2**, `intent=AUTHORIZE` with the vaulted `payment_source` | The hold per tranche on dispatch | FR-10 |
| **Authorizations**: capture / void / reauthorize | Release / refuse / timers | FR-12, 38 |
| Order metadata: `custom_id` (tranche id); capture `invoice_id` (operation key), description | The decision bound to PayPal's record | FR-38 |
| **Webhooks** + verify-webhook-signature | State confirmation (hints; proof is read by the reconciler). Inbound verification and idempotent storage implemented (T-0033) | FR-61 |
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

The domain now reserves REAUTHORIZE_PENDING with its own effect/key/result types. Start after three elapsed days from the latest confirmed authorisation and before the expiry margin. Confirm using the new id, prior id, operation key, completion timestamp and expiry; preserve the original dispatch/nonce/deadline and visit count. Reject a returned expiry beyond the original deadline. Later captures/voids use the new id. Completion time denotes when PayPal confirmed the renewal, not when a delayed reconciliation received it. These rules follow [PayPal's authorisation/honour-period guidance](https://developer.paypal.com/payment-methods/auth-honor/), checked 3 Oct 2026. Timer execution, durable operations and live contracts remain unimplemented.

### Failure handling

| Failure | Handling |
|---|---|
| Timeout / 5xx (ambiguous outcome) | No automatic SDK retries. Keep the same persisted `PayPal-Request-Id`; T-0158 permits one bounded retry only after qualified no-capture proof and a fresh capture-window check. Keep the pending reservation for reconciliation; surface an operational system wait, without permitting a competing payment |
| Definite declined / system failure, confirmed no payment | `settlementFailed` matches the reserved effect and authorisation, clears the reservation and returns to `WAITING`. Expiry rules can then run |
| Capture succeeded, DB write failed | Reconciler sees `PAYMENT.CAPTURE.COMPLETED` / Transaction Search and completes the state transition |
| `AUTHORIZATION_EXPIRED` on capture | Never treated as a release. → `EXPIRED`, with an `EXPIRE` confirmation record and provider response reference; notify. Requires a re-signature or new authorisation |
| `INSTRUMENT_DECLINED` on authorise | `WAIT_FUNDING`. Sentence: "PayPal could not hold $1,200. Nothing was paid." |
| Webhook missing | The poller checks open authorisations hourly (and on the tick endpoint) |

`REJECTED_NO_PAYMENT` replaces `SYSTEM_FAULT` and means a confirmed failure with no payment effect. A timeout, connection loss or PayPal 5xx is always `AMBIGUOUS`. `classifyPaymentFailure` is a pure response policy, not a payment client. It only accepts operation-correlated, authenticated responses; it makes no SDK/network calls.

### Implemented response policy (T-0129)

| Endpoint / response | Classification | Reference |
|---|---|---|
| Capture, HTTP 200/201 with resource status DECLINED and non-empty capture id | DECLINED | Capture id |
| Capture, HTTP 422 UNPROCESSABLE_ENTITY, AUTHORIZATION_EXPIRED | AUTHORIZATION_EXPIRED | PayPal debug id |
| Capture, HTTP 422, MAX_CAPTURE_AMOUNT_EXCEEDED | REJECTED_NO_PAYMENT | PayPal debug id |
| Reauthorise, HTTP 422, AUTH_CURRENCY_MISMATCH or REAUTHORIZATION_TOO_SOON | REJECTED_NO_REAUTHORIZATION (separate renewal result) | PayPal debug id |
| Void, PREVIOUSLY_CAPTURED | AMBIGUOUS; reconcile and alert, never infer successful void | Logged response |
| Other endpoint/code/status combinations, transport failures, 5xx, missing or conflicting details | AMBIGUOUS | Logged response |

HTTP 422 mappings require UNPROCESSABLE_ENTITY, non-empty message/debug id and a non-empty detail array. Every issue must map to the same known classification. Unknown errors keep the reservation; additional definite mappings need documented evidence and tests. These tests use synthetic bodies, not recorded sandbox responses. Sources checked 3 Oct 2026: [PayPal's official Payments v2 OpenAPI examples and capture statuses](https://github.com/paypal/paypal-rest-api-specifications/blob/main/openapi/payments_payment_v2.json), [capture reference](https://developer.paypal.com/api/payments/v2/authorizations-capture), [reauthorisation reference](https://developer.paypal.com/api/payments/v2/authorizations-reauthorize), [void reference](https://developer.paypal.com/api/payments/v2/authorizations-void).

`classifyPaymentFailure` accepts only CAPTURE/VOID; `classifyReauthorizationFailure` returns effect REAUTHORIZE and its own failure kind. A definite renewal rejection restores the prior state and gets a fresh retry key; ambiguous renewal outcomes block all competing operations for reconciliation. A PENDING capture is neither confirmation nor a definite failure: keep CAPTURE_PENDING until completion is confirmed. T-0056 must provide status reconciliation before wiring voids, because every void error is ambiguous; it must also resolve uncertain renewals.

### Capture window and currencies

Stood reserves no new capture within **five minutes** of the provider hold expiry. This is our operational buffer, not a PayPal guarantee. The payment client must recheck `captureAllowedAt` immediately before an external capture, after durable reservation, using the same server Clock as assessment. If no request was ever submitted and the window closed, record a local REJECTED_NO_PAYMENT failure; if it may have been submitted, preserve the reservation for reconciliation. Never race a void against an unresolved capture.

Allowance and direct tranche creation accept only GBP/USD/EUR, Stood's current subset of the [PayPal currency codes](https://developer.paypal.com/reference/currency-codes/). General Money retains other currencies. No automatic conversion is implemented. Merchant capabilities and real sandbox funding still need contract tests. Durable counters and key/provider-UUID mappings are still mandatory before the payment client is wired.

## Sandbox setup

Wiring T-0027 is blocked on durable payment operations (T-0132), reconciliation/status checks (T-0056 / T-0138) and guided key onboarding/readiness (T-0135). The local `scripts/dev setup` tool asks for sandbox app/webhook credentials, keeps them out of output/Git and validates client credentials with sandbox OAuth. Missing/invalid keys leave payment readiness false; guarded financial writes return `503 payments_not_configured` with setup guidance while a key is missing, and `503 payments_not_qualified` once every key is set but qualification is still pending (T-0248). Health lists missing variable names, never values. See [USAGE: keys and configuration](../USAGE.md#keys-and-configuration); the local prompt/OAuth check and readiness guards are implemented with fake-response tests; hosted issuance/rotation remain planned under T-0150.

An ambiguous renewal must remain reserved past the deadline until provider status resolves whether it renewed. A confirmed renewal supplies the new id for expiry; a confirmed absence of renewal plus provider expiry/no payment needs a matched typed renewal-reconciliation exit (T-0138). The domain now has the matched `confirmNoRenewalExpiry` exit; elapsed time or an inconclusive lookup cannot clear it. Package intake during REAUTHORIZE_PENDING must queue durably and retry when the operation resolves (T-0137).

- One sandbox **business** account (the platform merchant: "[EyeOnSite](https://github.com/ma-za-kpe/eyeonsite) Demo") and two sandbox **personal** accounts (buyer-success, buyer-declined).
- Webhook subscription created per environment (`demo`, `ci`). The webhook ID is in env.
- CI contract tests run against sandbox with **recorded** responses (replayed by default). A nightly job runs them live against sandbox.
- **Never** a live client id or secret in any environment. CI asserts the base URL is `api-m.sandbox.paypal.com`.

### Provider-status core (T-0056, integration-tested)

`ProviderStatusReader` reads status only and returns untrusted normalised proof. The application requires a complete lookup, the exact operation key, original authorisation id, provider request UUID and a non-empty provider reference. A completed capture must also match amount and currency and explicitly contradict no absence flags: noCapture is false for CAPTURED; noRenewal is false for RENEWED. Any inconsistent or missing flag retains the reservation. Proof outcomes are CAPTURED, VOIDED, DECLINED, EXPIRED, RENEWED or NOT_RENEWED; missing, PENDING and UNKNOWN results cannot resolve an operation. The future adapter must establish `noCapture` and `noRenewal` from complete provider data, never from a timeout or a single missing search result. RENEWED requires the new authorisation identity and valid confirmation/deadline times.

The coordinator validates a candidate transition without writing, then records it through the atomic tranche store. Repeated resolved reconciliation reads no provider; stale workers return RETRY. Reconciliation command identities include the recorded server clock, so competing expiry lookups with different clocks cannot collide as changed idempotent commands; the stream version still permits only one outcome. Unknown lookups retain their reservation and return an alert signal. A confirmed renewal is adopted before expiry reserves a void against its new id; a restart between those transactions safely resumes expiry. Existing captures may be reconciled even in old-rule safe mode, but no new capture is dispatched.

Tests use a fake reader, including real Postgres persistence. The guarded SDK status reader/executor slice below is implemented with synthetic tests; financial HTTP remains disabled. Scheduled polling, Transaction Search and delivered alerts remain T-0149; real provider proof requires T-0027 sandbox contracts.

### Server SDK settlement slice (T-0027)

The pinned TypeScript Server SDK 2.5.0 is confined to the PayPal adapter. It uses explicit sandbox configuration, a ten-second timeout, zero automatic retries and a silent logger. Integer minor units format provider amounts. Capture sets `invoice_id` to the reserved operation key; the request UUID remains its persisted `PayPal-Request-Id`. The capture endpoint does not accept `custom_id`, so that field stays the tranche identity on its order.

Status lookup requires the authorisation's related order, one matching purchase unit, complete explicit capture/authorisation arrays and exact amount/currency. A capture must carry the matching invoice and related authorisation. Only then does the adapter attach our durable UUID to normalised proof; it is not an echoed provider field. Extra/unknown captures, renewals, partial resources and identity mismatches remain unresolved. A successful void response alone remains pending until the reader proves cancellation with no capture. Absence of a capture while an authorisation is still active cannot prove a timed-out request never happened.

`executePayment` records possible submission as AMBIGUOUS before the provider call and uses a fresh unique claim per invocation. Reserved means no call was attempted. Only one competing version claim wins. Failed database confirmation leaves the UUID and ambiguity intact for status reconciliation. Old-rule captures and rental returns without a human/rule safeguard are blocked. Clock checks run before claiming and immediately before calling; after a claim, uncertainty cannot be cleared by an elapsed deadline.

This slice has synthetic-response and real-Postgres/fake-executor evidence. No actual SDK payment calls ran. Vault and initial funding need the separate durable phases under T-0154; the runtime keeps financial endpoints off. Official SDK/reference sources: [pinned SDK payments controller](https://github.com/paypal/PayPal-TypeScript-Server-SDK/blob/2.5.0/src/controllers/paymentsController.ts), [capture request model](https://github.com/paypal/PayPal-TypeScript-Server-SDK/blob/2.5.0/src/models/captureRequest.ts), [SDK authorisation model](https://github.com/paypal/PayPal-TypeScript-Server-SDK/blob/2.5.0/src/models/paymentAuthorization.ts).

### Bounded capture recovery before enabling financial HTTP

`retryCapture` handles AMBIGUOUS CAPTURE only. It requires a complete matching NOT_CAPTURED lookup, no renewal, a CREATED/capturable authorisation, exact amount/expiry and a server-observed timestamp no more than five seconds old. The adapter can produce that proof only with an explicitly configured clock, matched order/custom_id and full authorisation lineage, and an empty complete capture history. Unknown/PENDING/contradictory lookup results retain the reservation and alert. An empty history proves no capture at observation time; it does not prove an earlier HTTP request never reached PayPal.

Before the external call, one atomic tranche command records the proof reference, operation/authorisation/provider identities, observation/claim times and a unique invocation claim. It consumes the single retry, leaves AMBIGUOUS in the ledger and reuses the original PayPal request ID. Competing invocations, including those sharing a worker label, cannot both win. The immediate clock must remain monotonic, inside the capture margin and within proof freshness. Old rules, rental returns, voids and renewals cannot use this path. If the process stops after committing the claim, it stays consumed even when no call was made; reconciliation or an owned alert resolves the remaining ambiguity.

[PayPal request idempotency](https://developer.paypal.com/api/make-api-requests/) is the provider boundary behind same-ID re-submission. Actual sandbox recordings and account/endpoint qualification remain required before financial HTTP activation. Unit tests, real-Postgres race/crash evidence and simulator scenarios demonstrate the local policy, not live execution. SDK retries stay disabled; the optional executor-enabled worker uses this bounded application path.

## Initial funding implementation boundary (T-0154, partial)

The order-funding application requires a server-owned `FundingAuthority`, current tranche/version and server clock before new requests. Creation/authorisation phases commit before SDK calls, and each uses its own persisted UUID. The SDK transport rejects a funding instruction whose simulated/provider mode differs from its configured mode. The adapter creates an AUTHORIZE order with an explicit merchant payee, tranche `custom_id` and funding-operation `reference_id`.

Approval and hold proofs must match the complete order, payee, amount/currency and both local identities. An approval URL must use the configured sandbox/simulator origin and the exact order ID. A hold requires one CREATED authorisation, related order identity, valid timestamps and no capture. PENDING, malformed, foreign or contradictory results stay unresolved. Only a well-formed 422 UNPROCESSABLE_ENTITY whose non-empty reasons all say INSTRUMENT_DECLINED is a definite authorisation refusal; network/server errors are ambiguous.

Read-only reconciliation remains allowed when approval has expired or rules have changed. A lost creation response can be recovered from a candidate order ID only after provider lookup matches the saved funding instruction; an arbitrary callback ID cannot attach a hold. A lost authorisation response is recovered from the saved order, without another authorisation request. If lookup confirms that the sole uncaptured authorisation has already expired, matching history plus the server deadline resolves EXPIRED without inventing a void. Time alone cannot establish that outcome. There is no automatic creation/authorisation retry, no invented order search by request ID, and no assumption of unlimited provider idempotency retention. The pinned Orders SDK documents six-hour create-order retention; actual endpoint/account behaviour remains to be qualified.

Evidence: synthetic adapter/authority tests, real SDK requests against the local HTTP simulator, and real-Postgres restart/audit-failure tests. The simulator now retains the supplied purchase-unit reference and merchant payee. Qualified acceptance/callback handling, funding alerts and actual sandbox contracts remain open, so ordinary financial HTTP stays disabled. Primary contracts: [Orders v2](https://developer.paypal.com/api/orders/v2), [Payment Method Tokens v3](https://developer.paypal.com/api/payment-tokens/v3).

### Vault consent boundary (T-0154, partial)

The pinned SDK now creates/reads setup and payment tokens using separately persisted request IDs. Setup callbacks come from server configuration, never request bodies; sandbox callbacks require HTTPS, and simulator callbacks are restricted to local service addresses. Configured transport mode must match the attempt. The adapter retains no raw payer details: complete proof requires the per-attempt merchant customer reference, known customer/setup identity and, for token creation/recovery, the approved payer. Additional payment sources, foreign IDs, partial bodies and unexpected statuses remain unknown. Customer correlation is a required qualification condition; if an actual sandbox response omits it, the adapter waits rather than assuming a match.

Possible setup/token submission commits before SDK writes. Read-only recovery can store historical provider facts after the consent window, while new requests require unchanged terms and a current server clock, checked again after claiming. A known approved setup with a lost creation reply can be recovered without an approval URL; it is re-read before creating a token. A candidate token ID is only a lookup hint, not proof that the attempt succeeded. PayPal does not promise an echoed setup ID on a payment token, so recovery matches the attempt-specific merchant customer reference, customer and payer instead.

PayPal documents **three-hour** request-ID retention for [setup creation](https://developer.paypal.com/api/payment-tokens/v3/setup-tokens-create) and [payment-token creation](https://developer.paypal.com/api/payment-tokens/v3/payment-tokens-create). The simulator expires Vault replay entries at that boundary. Neither unknown phase is automatically retried, even inside retention. Owned recovery/alerts and qualified provider event/candidate delivery must exist before activation. Vault approval is not a capture or a confirmed hold. Vault-funded orders, public acceptance/callback routes, allowance versioning and actual sandbox qualification remain open.
