# ADR-0009: Separate assessment, payment effect and confirmation

- **Status:** accepted
- **Date:** 2026-10-03

## Context and evidence

ADR-0007 permits inverted deposit effects. T03 previously required a capture for every RELEASE, which cannot represent a successful rental return. T05's one-decision-per-package constraint also cannot preserve a WAIT followed by a later decision. Optimistic locking after an external payment cannot prevent a competing capture and void.

## Decision

- A pure decision records its outcome and its declared effect separately. Construction and freelance pass → CAPTURE; rental return pass → VOID. Rental failures stay WAIT for a human amount; partial capture is not implemented.
- Absent check results, incomplete uploads, invalid results and uncertain findings stay WAIT. A completed required-item check may report a hard missing-item failure. A hard failure can short-circuit later checks, but release requires every profile check to pass.
- Keep immutable decision history, hold attempts and settlement references. A disputed capture keeps its original reference.
- Reserve CAPTURE_PENDING or VOID_PENDING before executing a payment. Persist that reservation and its stable provider request ID transactionally before the external call. Only confirmed effects produce terminal states. An ambiguous timeout remains pending for reconciliation.
- Expiry can reserve a void from HELD, DECIDING or WAITING. It cannot race an already reserved capture. Reauthorisation begins from day four, following FR-12.
- Settlement assessment takes a clock: at or after hold expiry it reserves an expiry void, including a late RELEASE decision. Confirmation must match the reserved effect and authorisation. Definite declined/system failures return to WAITING; ambiguous processor outcomes keep the reservation. A verified provider expiration response ends as EXPIRED with an `EXPIRE` record and provider reference, without claiming a capture or void succeeded. This is a confirmation record, not a callable payment effect.

## Alternatives considered

- Treat every pass as capture: incompatible with deposits.
- Overwrite a WAIT: loses the audit history.
- Call PayPal and lock afterward: competing workers can reach the processor before the lock.

## Risks and controls

The initial implementation is a tested domain state machine, not durable payment orchestration. Database reservations, human identity, webhook confirmation and reconciliation remain mandatory before wiring money endpoints. Model stage failures remain WAIT until evaluation qualifies a refusal threshold.

## Reversal condition

A processor or profile cannot fit a single confirmed capture or void. Extend the operation model with an ADR and new money-safety tests, never with caller-supplied code.
