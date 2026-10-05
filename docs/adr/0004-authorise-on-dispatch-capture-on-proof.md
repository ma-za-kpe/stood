# ADR-0004: Authorise on dispatch, capture on proof (no escrow)

> Historical framing (before the 5 Oct 2026 repositioning). See [S17](../stood/S17-agent-payments-positioning.md).

- **Status:** accepted
- **Date:** 2026-10-03

## Context and evidence

- PayPal's Acceptable Use Policy requires pre-approval for escrow services.
- Authorisations are valid for 29 days, with a 3-day honour period.
- Multiparty delayed disbursement maxes out at 28 days, then auto-releases.
- Ghanaian PayPal accounts can't receive money.

See [09](../09-stood.md) and [audit-log](../audit-log.md).

## Decision

- For each stage, create an Orders v2 order with `intent=AUTHORIZE` when the inspection is dispatched. This is the hold.
- **Capture** on release. **Void** on refuse. Reauthorise near day 3 if review runs long.
- The payee is the platform's PayPal merchant account. Local payouts (builder, inspector) are the platform's job, on local rails.
- Stood never holds funds.

## Alternatives considered

- Pooled escrow: rejected (AUP pre-approval, licensing, and the 28-day auto-release).
- Paying the inspector via PayPal Payouts: rejected (Ghana accounts are send-only).

## Risks and controls

- The payer's funding fails at authorisation time → **wait** with a clear sentence, and notify.
- The hold expires → timers at day 3 / 27 / 29 (Render Workflows), and an expiry is never treated as a release.

## Reversal condition

PayPal approval for an escrow-style product, or PayPal World receiving rails that become callable in the target corridor.
