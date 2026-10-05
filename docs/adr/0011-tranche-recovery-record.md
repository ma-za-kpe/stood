# ADR-0011: Recover tranches from accepted domain transitions

- **Status:** accepted
- **Date:** 2026-10-04

## Context and evidence

T-0132 must preserve private settlement/renewal counters, original and renewed holds, decisions and pending operations across restarts. The existing Tranche deliberately exposes no arbitrary state setters. An operation ledger alone cannot reconstruct its state. ADR-0010 requires the eventual aggregate write and operation write to commit together.

## Decision

Use a versioned JSON recovery record containing the tranche definition and an ordered list of accepted domain commands. Persist explicit times, nonce values, recorded decisions and provider confirmations. Recovery runs the pure Tranche methods; it performs no evidence assessment, processor call or database write. Replay enforces the domain's transition invariants rather than assigning private fields from an unchecked snapshot.

Money uses exactly serializable integer minor units; replay reconstructs Money and Nonce values. Commands have an explicit method allowlist and exact argument arity. Unknown formats, incompatible rule-set versions, malformed inputs and illegal sequences throw before a recovered aggregate is returned. Create/advance return immutable JSON strings; advancing validates the entire candidate history and leaves the prior record intact on failure.

T-0144 implements only the pure recovery codec. T-0145 must store the definition and immutable transition history, making one aggregate version authoritative and atomically committing a transition, reservation/outcome, provider UUID and audit event under the existing stream lock. A codec pass is not durable storage and does not complete T-0132.

## Alternatives considered

Assign a JSON snapshot to private fields: duplicates state invariants and can invent counters or settlement history. Store only the pending operation: loses original holds and retry history. Replay processor calls: could move money twice and is prohibited; only pure domain transitions are replayed.

## Risks and controls

Replay is linear in history length; it suits the current bounded tranche lifecycle. Changing replay semantics, operation-key generation or rule-set versions requires a format/version migration or a retained historical reducer, with persisted-record compatibility tests before deployment (T-0148). Do not silently reinterpret an old record under new rules. Current incompatible records fail closed.

The database slice must prevent definition/history rewrites and couple state to operation identity; application authentication and provider verification remain separate prerequisites. This record authenticates neither a caller nor a provider confirmation. No executor or HTTP endpoint consumes it yet.

## Reversal condition

History growth or rule evolution makes replay impractical. Introduce validated versioned snapshots with an explicit migration ADR and equivalent recovery/counter/history evidence before replacing this format.
