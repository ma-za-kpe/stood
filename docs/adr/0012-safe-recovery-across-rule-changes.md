# ADR-0012: Preserve old holds in restricted recovery

> Historical framing (before the 5 Oct 2026 repositioning). See [S17](../stood/S17-agent-payments-positioning.md).

- **Status:** accepted
- **Date:** 2026-10-04
- **Supersedes:** ADR-0011's rejection of all older rule-set versions

## Context and evidence

PR #20 review identified that rejecting older rules prevents cancellation and reconciliation of live holds. Fail-closed capture must not strand authorised money.

## Decision

For the unchanged version-1 transition format, canonical older rule versions restore into safe recovery. Future/malformed versions and illegal histories remain errors. Replay preserves recorded decision versions and effects; it does not rejudge evidence. Historical replay is private to recovery; the returned aggregate blocks new assessments, authorisations, renewals and captures.

Old pending captures/renewals retain their identity for provider-status reconciliation. They cannot be submitted or raced by a void. A verified completed capture can still be recorded as money already moved; verified no-payment failures free the slot for cancellation. Cancellation reserves VOID and reaches CANCELLED only after matching confirmation. Expiry remains available on a hold without an unresolved operation.

Adapters must require both an unresolved ledger status and `canSubmitPendingOperation`. T-0145 must preserve the original rule header/history, so ordinary writes cannot upgrade a safe record. Replay-format, key-generation or operational-state semantic changes still require explicit migration/historical reducers. Retain referenced profile contracts.

## Alternatives considered

Reject all old records: silent holds. Rejudge old evidence: may authorise money under different rules. Unconditionally void a pending capture: may race money already moving.

## Risks and controls

No provider execution is enabled. The reconciler/provider verifier must establish truth before confirming or freeing a pending slot. Safe mode is a floor; replaying archived decision policies for new work remains future work. First hosted deployment requires the atomic store and reconciliation to honour this mode and expose unresolved holds.

## Reversal condition

A historical transition format cannot reproduce its original operational facts. Add an explicit migration or historical reducer, preserving processor identity and restricting dispatch until verified.
