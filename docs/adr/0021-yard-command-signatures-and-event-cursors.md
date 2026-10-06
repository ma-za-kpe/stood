# ADR-0021: Yard command signatures and event cursors

**Status:** accepted, pre-deployment implementation.

## Context

Yard request v1 covered method, path and body, but omitted query parameters and command headers. A regression demonstrated that the Board accepted a signed request after changes to its query, Idempotency-Key, If-Match, Content-Type or Last-Event-ID. Stood closes its analogous gap in ADR-0020. Yard also needs operator identity and event cursor binding.

## Decision

Require Yard request signature v2 over the UTF-8 JSON array of domain separator `yard.request@2`, timestamp string, Yard-Key-Id, uppercase method, external pathname plus query, Idempotency-Key, If-Match, Content-Type, Last-Event-ID and raw body. Missing headers and GET bodies are empty strings. Keep constant-time digest comparison, the five-minute clock window and the pre-buffering 64 KiB limit. Reject v1 rather than accepting a downgrade path.

The browser mock gateway forwards the command headers and signs their actual values and target on the server. Crew and network fixtures use the same encoding. The SSE permission check receives the actual target/query, so it verifies the same signature as the router. A reconnect uses a fresh signature reflecting its actual query and cursor header. Platform secrets remain out of cookies and browser bundles.

## Evidence and limits

The failing replay regression precedes implementation. Signed Board and Foreman tests still enforce tenant ownership and state/version conflicts. Additional tests reject old request v1 and key-ID substitution, including a deliberately shared-secret fixture. Real event-stream/browser evidence remains in the mock network gate. Stood notifications and Crew-service notifications retain their separate delivery signatures and secrets.

This authenticates a request; it does not qualify baseline evidence, fund a claim, or approve a payment. Identical requests remain subject to durable idempotency and version checks. Production sessions, operator registration, payee verification, key rotation and actual provider qualification remain open under T-0209 and related tasks.
