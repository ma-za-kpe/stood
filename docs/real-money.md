# Sandbox only: what has to be true before real money

**Stood and Yard move no real money.** Every PayPal call goes to the PayPal **sandbox**, with test accounts and test balances. There is no live PayPal app. This page lists what would have to change before that could be different, so nobody mistakes a working sandbox for a business that may take payments.

## What runs today (sandbox)

- **Stood** holds a buyer's money per milestone as a PayPal authorization, decides from evidence, then captures (release) or voids (refuse). Settlement is a separate owner switch, and it is **off** in production until the owner has reviewed the runner's past decisions ([ADR-0026 amendment](adr/0026-isolated-code-runner-on-vercel-sandbox.md)).
- **Yard** is the payee of every allowance; it would pay builders out of its own PayPal account with PayPal Payouts, 48 hours after release (on release for the final milestone), and charges the buyer a fee on top ([ADR-0027](adr/0027-platform-receipt-then-payout.md)). Payouts run from Yard's own sandbox PayPal app (qualified live on 11 October 2026), but none are due while settlement is off.

## Before any real money

1. **PayPal approvals.**
   - PayPal's Acceptable Use Policy requires pre-approval for escrow-like services. Stood was redesigned around "authorize on dispatch, capture on proof" for this reason ([audit log](audit-log.md)), and that design still needs PayPal's review for live use.
   - PayPal enables Payouts for real money only after it approves the business.
2. **Yard becomes the merchant of record.** Taking buyers' money and paying builders makes Yard responsible for the money in between:
   - **Builder verification.** Know who is paid: identity checks, sanctions screening, and a verified PayPal account for every builder (and for every agent's operator).
   - **Tax reporting.** Payment-platform reporting for builders paid through Yard, in each country where builders and buyers are.
   - **Refunds and disputes.** A process, staffed by people, for disputes opened after a payout (beyond the 48-hour review window), which Yard carries as a loss.
3. **Stood's own gates.**
   - The runner qualified live, settlement switched on deliberately by the owner, and every release from the old in-process runner reviewed (they can never be paid: [`scripts/dev release-review`](SETUP.md)). Done on 11 October 2026: the judge qualified live, and production had no releases from the old runner. Settlement itself is still off.
   - A full live end-to-end run on the sandbox, each step confirmed in PayPal.
   - A human approves every change to the money path ([ADR-0024](adr/0024-ci-gate-reviews-agent-code-in-the-sandbox.md)).
4. **Legal review.** Terms for buyers and builders, privacy, and the licences a payments intermediary needs where it operates.

None of this is done, and none of it is claimed. If a page or a message suggests real money moves, it is wrong; please [open an issue](https://github.com/ma-za-kpe/stood/issues).
