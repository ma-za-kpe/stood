# ADR-0020: Bind request signatures to the command context

**Status:** accepted, pre-deployment implementation.

## Context

ADR-0014 introduced request HMACs covering timestamp and body. That leaves the method, resource, query and command headers unsigned. A captured request could be moved to another target or sent with another idempotency key while retaining a valid signature. Public signing/funding commands must close that gap before activation.

## Decision

Require request signature v2 across the Stood platform API. Sign the UTF-8 JSON array of domain separator, timestamp string, uppercase method, external pathname plus query, Idempotency-Key, If-Match, Content-Type and raw body. Missing header values and GET bodies are empty strings. Compare digests in constant time after Bearer authentication and the existing five-minute clock window; retain the 64 KiB limit before buffering. The SDK signs the normalised URL and header values it actually sends.

Reject request v1 instead of maintaining a downgrade path. No financial HTTP is enabled and no hosted client compatibility is claimed. Update all local callers and the fake service together, and publish the exact encoding in T04 and USAGE. Historical ADR-0014 records the earlier decision and remains unchanged. Webhook delivery v1 is a separate protocol with a separate secret; it does not grant request authority.

## Evidence and limits

A failing regression demonstrated acceptance after a URL/query or idempotency-key change. Server/SDK contract tests now reject changed method, target, query, command key and version header, including method changes with identical empty bodies. Tests also reject body-only request v1. Real-Postgres tests preserve exact response replay and typed conflicts; mock callers use the new encoding.

A signature authenticates a command, not provider approval or evidence. Identical signed requests can be replayed within the window; durable idempotency and transactional version checks remain required. Keys stay scoped per platform and environment. This change does not enable financial commands or satisfy actual sandbox qualification.
