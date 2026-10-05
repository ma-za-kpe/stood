# Local provider simulators

**Synthetic results only. No payment is executed.** This package is separate from the production API release and boots only in local, CI or demo environments. It accepts only the fixed synthetic credentials `sim-client` / `sim-secret`, never your PayPal keys.

## PayPal subset

The pinned Server SDK 2.5.0 executes capture, void, reauthorisation and status reads against an actual local HTTP server. Since this SDK hard-codes its host and caches its OAuth controller, simulator mode uses its HTTP-client adapter configuration to redirect **all** HTTP requests, including OAuth. SDK source, serialization and response processing are unchanged. Provider mode has no redirection; redirects are disabled in both modes.

The simulator uses Orders v2, Payments v2 and Vault v3 route shapes from [PayPal's published OpenAPI specifications](https://github.com/paypal/paypal-rest-api-specifications/tree/90e8041ffe02d80c452d2b476bedd59a8d219bdc/openapi). [paypal-specs.json](paypal-specs.json) records the source commit and file digests. This is a small Stood-specific subset, not a complete implementation or a claim of sandbox parity. T-0224 will compare sanitised actual sandbox exchanges when keys exist.

| Implemented | Behaviour |
|---|---|
| OAuth token | Fixed synthetic Basic credentials only |
| Orders create/get/authorize | One AUTHORIZE purchase unit, explicit approval, exact USD/GBP/EUR minor-unit values |
| Payments authorizations get/capture/void/reauthorize | Final full capture only, one capture per order lineage, honor-period and original 29-day expiry |
| Captures get | Recorded final capture details |
| Vault setup create/get | Separate synthetic approval |
| Vault payment token create/get/delete | Approved setup token required, revocation |
| Webhook event list | Synthetic event IDs and resources; emitted after state changes |
| Local controls | `/__sim/approve/{order}`, `/__sim/setup-approve/{setup}`, `/__sim/advance` |

Unsupported provider features fail rather than pretending success. Actual webhook delivery/signature verification, Vault funding through the real SDK, refunds, partial capture, payer disputes, full account eligibility and other providers remain queued. The fixed token and simulated approval controls are local conveniences, not a model of provider authentication security. This package must never be exposed publicly.

Idempotency is a conservative fixture policy: the same request ID returns a saved response, including a saved definite failure; changing its path or canonical JSON conflicts. A stored response is immutable even as later reads show new state. Production retention windows and provider-specific retry behaviour require sandbox evidence. Simulator state is disposable; Stood's durable ledger remains authoritative for application operations.

## Start and test

```console
docker compose --profile simulators up -d --wait paypal-sim
curl http://127.0.0.1:8080/health
docker compose run --rm app pnpm test services/api/src/adapters/payments-paypal/simulator-contract.test.ts services/simulators/src/paypal.test.ts
```

The shared PayPal transport contracts also run against an independently implemented in-memory fake. They test same-ID replay, one capture, cancellation, day-four renewal, expiry and unknown identities. Both are synthetic tests, not sandbox tests.

The server clock begins at 5 October 2026 and advances only through authenticated local control requests. Test harnesses inject their own clock. Runtime time does not silently determine scenario outcomes. Every HTTP response has `X-Stood-Simulated: true`; health says `mode: sim`, `simulated: true`, `paymentExecuted: false`.

This command starts the isolated simulator only. It does not activate financial API routes, fund Yard work orders or provide the complete one-command product demo (T-0233).

## Scripted faults

Inject a `FaultController` when creating a test simulator. Plans match exact method/path and consume each fault once. They can return 500, rate limits, malformed JSON, stall before/after applying a request, or replace a successful response with a 503 after the state change. The latter models a lost response without inventing a second payment. `release()` explicitly releases stalled replies; tests use the actual HTTP client's bounded timeout and do not sleep. Fault controls are injected by the harness, never exposed through a product endpoint.

[capture-lost-response.json](scenarios/capture-lost-response.json) and [capture-timeout.json](scenarios/capture-timeout.json) are synthetic scenario files for the seeded first authorization. The HTTP contract tests load these files. The separate `replayEvents` helper selects copied event snapshots in duplicate/out-of-order sequences; actual signed delivery and application consumption remain queued. A test proves real-domain capture and void recovery through status lookup without a second submission, using an in-memory tranche store. Real PostgreSQL durability is covered separately by the storage suites.
