# ADR-0014: Atomic platform drafts and durable request replay

> Historical framing (before the 5 Oct 2026 repositioning). See [S17](../stood/S17-agent-payments-positioning.md).

- Status: Proposed; implemented local slice awaiting review
- Date: 2026-10-05
- Tasks: T-0028, T-0154, T-0156

## Context

The v1 API needs authentication, platform ownership and restart-safe idempotency before it can initiate funding. Initial order/Vault creation still lacks durable approval phases, so accepting a draft must not imply that the payer approved anything or that money is held.

## Decision

Expose a local signed DRAFT creation/read subset first. Authenticate the configured platform with Bearer plus the T04 HMAC over timestamp and raw body; reject clock skew beyond five minutes and bodies over 64 KiB. All draft money and milestone totals pass through the existing Money and Allowance invariants. Profile params remain stored draft metadata, not findings.

Fingerprint method, versioned route and exact request bytes. Serialise a platform/idempotency-key pair with a transaction advisory lock. Commit the immutable DRAFT, initial PENDING tranche records, immutable platform ownership and original JSON response in one transaction. Return the response read back from Postgres on the first request too, so JSONB ordering does not change subsequent response bytes. A changed fingerprint conflicts; an exact retry returns that original response across restart. Keys remain retained indefinitely in this local slice, satisfying the minimum 24-hour guarantee.

Scope reads by ownership before loading/replaying the tranche. Return the same not-found response for absent and foreign identities. Recovered state and recipient copy report confirmed money facts; they do not infer approval or capture. Database guards prohibit rewriting drafts, ownership or request responses.

## Consequences

Draft creation is useful without a payment call and is covered by signed HTTP and real-Postgres concurrency/rollback/restart tests. The single configured local platform is not hosted onboarding or key rotation. Signing/versions, durable initial funding, dispatch, uploads/evidence processing, rate limits and generated OpenAPI remain separate acceptance work. HTTP money operations remain unavailable until those prerequisites and actual sandbox qualification land. No endpoint invents an approval URL or trusts client-authored assessment results.
