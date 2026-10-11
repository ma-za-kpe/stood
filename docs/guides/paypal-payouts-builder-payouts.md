# PayPal Payouts: pay builders after the money is released, step by step

A practical guide for developers who take a buyer's payment on a platform and **pay a third party later**: a builder, a contractor, a seller. It uses [PayPal Payouts](https://developer.paypal.com/docs/payouts/) on the **sandbox**, and every step, answer and mistake below comes from our own runs on 11 October 2026. No real money.

The code is linked at each step:

- [`services/yard-api/src/adapters/paypal/payouts.ts`](../../services/yard-api/src/adapters/paypal/payouts.ts): the Payouts adapter
- [`services/yard-api/src/application/payouts.ts`](../../services/yard-api/src/application/payouts.ts): the worker (holdback, reserve, send, reconcile)
- [`services/yard-api/src/payout-check-cli.ts`](../../services/yard-api/src/payout-check-cli.ts): the live sandbox check (`scripts/dev payout-check`)
- [`services/yard-api/src/payout-cli.ts`](../../services/yard-api/src/payout-cli.ts): the owner's actions (`scripts/dev yard-payout`)
- Decision record: [ADR-0027](../adr/0027-platform-receipt-then-payout.md)

## 1. The problem Payouts solves

When a buyer funds a job, nobody knows yet who will build it. So the buyer cannot pay the builder directly. Stood holds the buyer's money per milestone and captures it only when the work is proven; that capture lands in **Yard's** PayPal account. Yard then has to pay the builder, from its own account, as a separate PayPal transaction. That second step is a payout.

## 2. Payouts' role in the whole platform

```text
 buyer ──hold──► Stood ──capture on evidence──► Yard's PayPal account ──payout after 48 h──► builder
                (refuse: void, nothing moves)        (builder's price + Yard's fee)          (builder's price)
```

- **Stood** decides whether a milestone's money may move. It never pays the builder.
- **Yard** keeps a ledger per job, waits out a 48-hour review window (none for the final milestone), then pays the builder with Payouts.
- Yard uses **its own** PayPal app. Stood's credentials never reach Yard, and Yard's never reach Stood.

## 3. Use cases

- A marketplace paying a seller after delivery is confirmed.
- A platform paying a contractor after an independent check.
- Any flow where "who gets paid" is decided after the buyer pays.

## 4. Results from our run (11 October 2026)

`scripts/dev payout-check`, against the real PayPal sandbox with Yard's app:

```text
ok  send: SENT (payout batch PVT43YLTX94MG)
ok  item status: PAID_OUT
ok  retry with the same request id: SENT, same batch: true
    PayPal's duplicate answer: HTTP 400, name USER_BUSINESS_ERROR, links [], details: Batch with given sender_batch_id already exists
ok  duplicate sender_batch_id: SENT, recovered the original batch: true
```

$1.00 of sandbox money went to the sandbox buyer's personal account, settled to `SUCCESS` within seconds, and a retry after a "lost answer" did not pay twice.

## 5. Setup

1. **Create a separate sandbox app.** In the [PayPal developer dashboard](https://developer.paypal.com/dashboard/applications/sandbox), Apps & Credentials, Sandbox, **Create App**:
   - name it for what it does (ours: `Yard Payouts (sandbox)`);
   - type **Merchant**;
   - sandbox account: the **business account that receives the captures** (its Account ID is `YARD_PAYPAL_MERCHANT_ID`), because payouts must leave the account the money lands in.
2. **Check the scope.** Ask for a token; the answer's `scope` must include `https://uri.paypal.com/services/payments/payouts`. Ours did, out of the box.
3. **Keep the keys apart.** `YARD_PAYPAL_CLIENT_ID` and `YARD_PAYPAL_CLIENT_SECRET` in `.env`, and on Render's `stood-yard-api` only. Without them Yard logs `Payouts off` and pays nobody.
4. **Give each builder a payee.** A builder's `payeeRef` (a PayPal email or a 13-character merchant id) on their `YARD_OPERATORS` entry. A builder without one is skipped and logged.

## 6. Run it

```bash
scripts/dev payout-check     # qualify Payouts live: pay $1.00 (sandbox), read it to paid out, retry, recover a duplicate
scripts/dev yard-payout list # what needs the owner: disputes, payouts to reconcile, refunds owed
```

In production the worker runs every minute on `stood-yard-api`.

## 7. What a payout looks like, step by step

1. **Released.** Stood captures the milestone into Yard's account. Yard records the split: builder's price, Yard's fee.
2. **Held back.** For 48 hours (none for the final milestone, which already waited for the buyer's own confirmation). The buyer can dispute in that window; the money then stays in the job's ledger until the owner decides.
3. **Reserved.** Yard writes the payout to its ledger **before** calling PayPal, with a batch id fixed for that work order and attempt.
4. **Sent.** `POST /v1/payments/payouts`, one item, with the batch id as both `sender_batch_id` and `PayPal-Request-Id`. PayPal answers `201` with its `payout_batch_id`.
5. **Reconciled.** `GET /v1/payments/payouts/{payout_batch_id}` until the item is `SUCCESS` (paid out), `UNCLAIMED`, `RETURNED`, `REFUNDED`, `REVERSED` or `FAILED`. Paid-out payouts are read again once a day for 180 days, because a builder can refund one later.

## 8. How it works

- **One batch id per attempt.** It is a hash of the job, the work order and the attempt number, so a crash and restart reserve and send the same batch, and PayPal refuses to pay it twice for 30 days.
- **A resend window of 7 days.** Inside PayPal's 30-day duplicate protection, Yard may resend a reservation with no answer. After 7 days it stops and asks the owner to reconcile it (`REVIEW`).
- **Answers by PayPal's contract.** A duplicate is recovered (below); `5xx`, `401` (fetch a new token), `408`, `409` and `429` are retried; only a validated `4xx` refusal is final (`FAILED`, nothing was paid).
- **No dead ends.** The owner can decide a dispute, retry a failed or returned payout under a new batch id, refund the buyer instead, or record what PayPal shows for a `REVIEW` (`scripts/dev yard-payout`).

## 9. Safety rules

- Sandbox only. The check pays sandbox money to a sandbox account.
- Never print a key, token or email; the check prints batch ids and statuses only.
- Reserve before you call; never call twice without the same batch id.
- A refusal Yard cannot read is never treated as "not paid".

## 10. Mistakes we made, and the fixes

1. **We trusted the schema's word on duplicates.** PayPal's Payouts schema says a reused `sender_batch_id` is rejected "with an error message that shows the duplicate `sender_batch_id` and includes a HATEOAS link to the original payout". Our adapter read the top-level `links`, which the live sandbox returns **empty**. The link is inside the error detail:

   ```json
   {
     "name": "USER_BUSINESS_ERROR",
     "details": [
       {
         "field": "SENDER_BATCH_ID",
         "issue": "Batch with given sender_batch_id already exists",
         "link": [{ "href": "https://api.sandbox.paypal.com/v1/payments/payouts/PQ554D2M5R29L", "rel": "self" }]
       }
     ],
     "links": []
   }
   ```

   Every retry after a lost answer would have gone to the owner. The adapter now reads both places, and its test uses this real response.
2. **We expected `PayPal-Request-Id` to replay the first answer.** It does not on Payouts: a resend with the same request id and the same `sender_batch_id` gets the same `400` duplicate rejection as one with a new request id. Recovering the original batch from the rejection is what makes a retry safe.
3. **We first counted every 4xx as a final refusal.** An external audit pointed out that a `401` (an expired token) or a `429` would have marked a payout failed for good, and a duplicate (proof it was paid) would have too. Only validated refusals are final now.
4. **We first resent forever.** PayPal's duplicate protection lasts 30 days; after that the same batch id could pay again. Resends stop after 7 days.

## 11. Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `Payouts off` in Yard's log | `YARD_PAYPAL_CLIENT_ID` or `YARD_PAYPAL_CLIENT_SECRET` unset | Set both on `stood-yard-api` |
| Token refused | Wrong app keys, or Stood's keys used by mistake | Use the `Yard Payouts (sandbox)` app's keys |
| `PAYOUT_NO_PAYEE` in the log | The builder has no `payeeRef` | Add it to their `YARD_OPERATORS` entry |
| A payout in `REVIEW` | No answer within 7 days, or a duplicate PayPal gave no link for, or a `BLOCKED` item | Look it up in PayPal, then `scripts/dev yard-payout <job> <wo> settle paid <batch> <ref> "<note>"` or `settle not-sent` |
| `UNCLAIMED` | The payee has no PayPal account yet | PayPal returns it after 30 days; then retry to another payee or refund |

## 12. Cost

On the sandbox, nothing. With real money, PayPal charges Payouts per item and only after it approves the business for Payouts; see [real-money.md](../real-money.md) for everything that has to be true first.
