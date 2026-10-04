# ADR-0013: Couple tranche transitions and payment operations

- **Status:** accepted
- **Date:** 2026-10-04

## Context and evidence

ADR-0010 and PR #18 require aggregate state and its payment operation to commit together. A state update followed by a separate reservation leaves a crash gap.

## Decision

The tranche stream stores its immutable initial record and current recovery record. Every accepted command has a caller-supplied idempotency id and an append-only versioned journal row. Under one stream row lock, the transaction validates/replays the command, advances the record/version, inserts the command and reserves or resolves the corresponding operation with its audit event. Commit precedes any external call.

Matching command retries return the current consistent state without another write; changed payloads or original expected versions conflict. JSONB comparisons tolerate key ordering. Snapshot reads hold a shared stream lock. Database triggers preserve metadata and history prefixes; deferred constraints require managed state/operation writes to have their journal/event before commit. Ledger-only writers reject managed streams.

Initial imports cannot contain a pending operation whose processor identity might already exist elsewhere. No caller can replace a definition or upgrade an old rule header during ordinary transitions. Dispatch still needs unresolved status and the safe-mode permission; storage is not a payment executor.

## Alternatives considered

Independent transactions: crash gap. Store only a mutable snapshot: rewritable history. Lock after processor calls: competing effects may already have reached PayPal.

## Risks and controls

The integration suite uses fixed local Postgres with random disposable databases, restart connections, competing transitions and faults at each write boundary. Provider truth and caller authentication remain the application/adapter's responsibility. Recovery-format migrations require an explicit plan. No financial HTTP route or PayPal execution is enabled.

## Reversal condition

Multiple simultaneous effects become a supported domain invariant. Change the model and constraints with a new ADR before relaxing exclusion.
