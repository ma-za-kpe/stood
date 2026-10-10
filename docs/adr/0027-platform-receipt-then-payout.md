# ADR-0027: Platform receipt, then payout

- Status: accepted
- Date: 2026-10-10
- Deciders: product owner (payee model, holdback and fees, 2026-10-10) and engineer
- Tasks: payee configuration, per-job ledger, Payouts, payout reconciliation, holdback, buyer fee line (#77, #78)
- Found by: the live end-to-end run (T-0296), which showed Yard sending `payee_ref: yard:<project>` where Stood pays `payee_ref` as the PayPal merchant

## Context

Stood holds a buyer's money per milestone (a PayPal authorization), decides from evidence, then captures (release) or voids (refuse). Stood pays the allowance's `payee_ref` as the PayPal merchant on the order.

When a buyer signs an allowance in Yard, no builder is known: the buyer is funding a job, not paying a person. Builders, human or agent, claim work later. So the payee cannot be the builder at signing or at funding without blocking signup until a builder is matched, or writing a placeholder that has to be unwound.

## Decision

**Yard's PayPal account is the payee. A builder becomes a payee only after Stood releases their milestone, through a separate PayPal payout.**

1. **Hold, not capture, at funding.** The buyer's money is authorized per milestone (as today). Nothing is captured until Stood releases that milestone, so a refusal voids the hold and no money moves at all.
2. **Capture into Yard on release.** The capture lands in Yard's PayPal account and is ledgered **to that job**, never to a general balance.
3. **Holdback before payout.** For milestones released on the runner's evidence alone (the buyer was not in the loop), Yard holds the milestone amount for **48 hours** after the release, then pays out. In that window the buyer can open a dispute; the packet is the allowance, the commit and Stood's decision. No dispute: the payout fires. A dispute: the money stays in the job's ledger until it closes. Builders see this once, at signup: "paid after the review window".
4. **No second hold for the final milestone.** It already waits for the buyer's own confirmation of use (`usage_release`), so it pays out on release.
5. **The payout is a PayPal transaction**, not an internal note: PayPal Payouts to the builder's (or the agent's operator's) PayPal account, with the allowance, commit and decision in the payout item's references.
6. **The buyer pays the fee, on top of the milestone** (see the business model below). The builder's quoted amount is exactly what they receive: the milestone amount equals the payout amount. Yard's fee is a separate line on the allowance, visible before signing, and is part of what the buyer authorizes. Yard does not absorb fees.

## The business model

Yard earns a percentage, paid by the buyer on top of each milestone, **only when that milestone clears Stood's gate**.

Example: a builder prices a milestone at £500. The allowance the buyer signs shows **£500 to the builder and £25 to Yard**, and the hold is £525. On release (after the review window), £500 is paid out to the builder and £25 stays with Yard. The amounts match the contract, so a dispute is never about Yard's cut.

- **Refused milestones pay Yard nothing.** The fee is part of the same hold, so a refusal voids it with the milestone. Yard is paid for money that should move, never for money that should not.
- **The final milestone** (released on the buyer's confirmation of use) carries the same fee.
- **Not charged:** signing up, or an agent merely running.
- **Later, on the same rail (not in the hackathon):**
  - a builder who wants payment sooner than the 48-hour window pays a small fee to skip it;
  - a caller other than Yard (EyeOnSite, a freelance tool, a grant platform) pays a per-decision fee to use Stood's endpoint, bringing its own PayPal merchant account, with Stood only the gate.

## Why

- **Refuse is a non-event.** Paying a builder at funding would put money in their account before any work exists, and a refusal would become a clawback ("the Paga problem in miniature").
- **A clawback clause is a right we cannot exercise.** A paid builder will not return money because a checkbox said so, and PayPal will not reverse a completed payout to a third party. A short holdback can be enforced; a clause cannot.
- **Net versus gross never arises.** Deducting fees from the builder makes every refusal and dispute an argument about amounts, and makes agent-to-agent pricing opaque. A buyer-paid fee shown up front stays stable when the signer is an agent.
- **Not a shadow bank.** Money is only in Yard between capture and payout (48 hours, or the dispute's length), always ledgered to one job. Stood still decides whether a milestone may leave.

## Consequences

- **Stood:** an allowance's `payee_ref` is Yard's PayPal merchant id, from configuration, never a project reference. Stood's money rules do not change. (T-0295 already refuses a live payee that is not a merchant id.)
- **Yard:**
  - a per-job ledger: authorized, captured, held back, disputed, paid out, unclaimed, returned;
  - a payout worker that sends PayPal Payouts after the holdback and reconciles their status, including payouts PayPal reports unclaimed or returned;
  - the builder's payee comes from their operator record (a PayPal email or merchant id), and an agent is paid through its operator;
  - Yard's fee is a line on the allowance the buyer signs.
- **Limits:**
  - PayPal enables Payouts for real money only on approval; until then everything is sandbox.
  - Taking buyers' money and paying third parties makes Yard the merchant of record for real money: builder verification and tax reporting come before any real launch, and public docs say so.
  - A dispute opened after a payout (beyond the 48 hours) remains a loss Yard carries; the window keeps that rare.
- **Alternatives rejected:**
  - payee set per milestone at funding (the builder is not known);
  - builder paid at funding (refusal becomes clawback);
  - fee deducted from the builder (net versus gross);
  - PayPal's marketplace product with delayed disbursement (it needs the seller at order time).
