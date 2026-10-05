# Local provider simulators

**Synthetic results only. No payment is executed.** This package is separate from the production API release and boots only in local, CI or demo environments. It accepts only the fixed synthetic credentials `sim-client` / `sim-secret`, never your PayPal keys.

## PayPal subset

The pinned Server SDK 2.5.0 executes capture, void, reauthorisation and status reads against an actual local HTTP server. Since this SDK hard-codes its host and caches its OAuth controller, simulator mode uses its HTTP-client adapter configuration to redirect **all** HTTP requests, including OAuth. SDK source, serialization and response processing are unchanged. Provider mode has no redirection; redirects are disabled in both modes.

The simulator uses Orders v2, Payments v2 and Vault v3 route shapes from [PayPal's published OpenAPI specifications](https://github.com/paypal/paypal-rest-api-specifications/tree/90e8041ffe02d80c452d2b476bedd59a8d219bdc/openapi). [paypal-specs.json](paypal-specs.json) records the source commit and file digests. This is a small Stood-specific subset, not a complete implementation or a claim of sandbox parity. T-0224 will compare sanitised actual sandbox exchanges when keys exist.

| Implemented | Behaviour |
|---|---|
| OAuth token | Fixed synthetic Basic credentials only; token-route faults are injectable |
| Orders create/get/authorize | One AUTHORIZE purchase unit, explicit approval, exact USD/GBP/EUR minor-unit values |
| Payments authorizations get/capture/void/reauthorize | Final full capture only, one capture and one renewal per order lineage, optional renewal amount, honor-period and original 29-day expiry |
| Captures get | Recorded final capture details |
| Vault setup create/get | Separate synthetic approval |
| Vault payment token create/get/delete | Approved setup token required, revocation |
| Webhook event list and delivery | Synthetic event IDs and resources; explicit delivery of selected events, including duplicates/out-of-order, to a loopback receiver |
| Local controls | `/__sim/approve/{order}`, `/__sim/setup-approve/{setup}`, `/__sim/advance`, `/__sim/webhooks/deliver` |

Unsupported provider features fail rather than pretending success. Live PayPal signature verification and durable webhook ingestion, Vault funding through the real SDK, refunds, partial capture, payer disputes, full account eligibility and other providers remain queued. The fixed token and simulated approval controls are local conveniences, not a model of provider authentication security. This package must never be exposed publicly.

Idempotency is a conservative fixture policy: the same request ID returns a saved response, including a saved definite failure; changing its path or canonical JSON conflicts. A stored response is immutable even as later reads show new state. Production retention windows and provider-specific retry behaviour require sandbox evidence. Simulator state is disposable; Stood's durable ledger remains authoritative for application operations.

Renewals conservatively follow the [single-renewal checkout guide](https://developer.paypal.com/checkout/extend-authorization/), including rejecting renewal of a renewed authorization. The current [Payments v2 reference](https://developer.paypal.com/api/payments/v2/authorizations-reauthorize) describes multiple renewals, so actual sandbox qualification must resolve that documentation conflict before widening this subset. Its optional `amount` is supported: omitting it preserves the authorized amount; an explicit different amount is still outside this subset and rejected. Same-request-ID replay returns the original renewal rather than creating another hold.

## Start and test

```console
docker compose --profile simulators up -d --wait paypal-sim
curl http://127.0.0.1:8080/health
docker compose run --rm app pnpm test services/api/src/adapters/payments-paypal/simulator-contract.test.ts services/simulators/src/paypal.test.ts
```

The shared PayPal transport contracts also run against an independently implemented in-memory fake. They test same-ID replay, one capture, cancellation, day-four renewal, expiry and unknown identities. Both are synthetic tests, not sandbox tests.

Standalone listening defaults to `127.0.0.1`; Compose explicitly binds inside its container while publishing to host loopback only. The server clock begins at 5 October 2026 and advances only through authenticated local control requests. Test harnesses inject their own clock. Runtime time does not silently determine scenario outcomes. Every HTTP response has `X-Stood-Simulated: true`; health says `mode: sim`, `simulated: true`, `paymentExecuted: false`.

Set `PAYPAL_SIM_WEBHOOK_URL` to a local Stood `/v1/webhooks/paypal` receiver to enable explicit delivery with `POST /__sim/webhooks/deliver` and a JSON `indices` array. Delivery uses fixed synthetic HMAC credentials and a distinct `Stood-Sim-Signature`, **not** PayPal RSA verification. Stood requires an explicitly configured verifier and enqueue port; its normal server leaves this endpoint unavailable until a durable queue and mode-specific verifier are wired. Events are reconciliation hints only: provider lookup proof still decides money. The delivery helper refuses remote URLs and redirects and has a two-second deadline.

This command starts the isolated simulator only. It does not activate financial API routes, fund Yard work orders or provide the complete one-command product demo (T-0233).

## Scripted faults

Inject a `FaultController` when creating a test simulator. Plans match exact method/path and consume each fault once. They can return 500, rate limits, malformed JSON, stall before/after applying a request, or replace a successful response with a 503 after the state change. The latter models a lost response without inventing a second payment. `release()` explicitly releases stalled replies; tests use the actual HTTP client's bounded timeout and do not sleep. Fault controls are injected by the harness, never exposed through a product endpoint.

[capture-lost-response.json](scenarios/capture-lost-response.json) and [capture-timeout.json](scenarios/capture-timeout.json) are synthetic scenario files for the seeded first authorization. The HTTP contract tests load these files. The `replayEvents` helper selects copied event snapshots in duplicate/out-of-order sequences. The mock integration suite delivers these snapshots with synthetic signatures over actual HTTP, then obtains matching provider proof before reconciliation. It also checks lost-capture recovery across a new connection to a real throwaway PostgreSQL database, without a second submission. Production webhook verification and durable ingestion remain queued.
