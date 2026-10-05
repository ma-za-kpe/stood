# S06: Voice and states

## Code-milestone sentence pairs (target copy)

Buyer / builder replace payer / inspector in code-facing screens. The existing internal sentence field names remain unchanged until a versioned API contract changes them. These pairs describe evidence; append a money clause from confirmed state only.

| Condition | Buyer | Builder |
|---|---|---|
| Signed tests changed | Signed tests changed | Restore the frozen tests and submit a new commit |
| Skipped tests | Required tests were skipped | Run every frozen test without skips or selective execution |
| Weak tests | The tests are too weak | Request stronger signed acceptance tests before resubmitting |
| Confirmed release | Milestone 2 released. $1,200 paid | Your commit passed. $1,200 paid to the platform merchant |
| Usage pending | Usage proof is missing. $1,200 is held, not paid | Add the agreed independent usage receipt |
| Unknown provider outcome | Payment is not confirmed. A reviewer is checking | Payment is not confirmed. Do not submit another payment |

Never say nothing was paid after an ambiguous provider call: money may have moved. Do not promise an operator's onward payout based on a Stood capture.

## Scenario: site visits (legacy copy targets)

The field-specific wording below belongs to EyeOnSite. A provider timeout uses the unknown-outcome pair above; the earlier timed-retry wording is not shipping copy.

**Paga's failure was silence. Stood's product is the sentence.** [U]

## Rules

1. Second person, present tense, **one reason**.
2. Say what happened to the money in every message: paid, not paid, held.
3. A number beats an adjective: "1.4 km off", not "too far".
4. Never "Something went wrong." Never "We were unable to verify your evidence at this time."
5. [C] **Never accuse.** Describe the evidence, not the person. "These photos match a package from 12 March", not "Fraud detected".
6. [C] Every refusal tells the inspector what to redo.
7. [C] Write for people reading English as a second language: short words, no idioms, no "heads up", no "oops".

## Copy by state

| State | Ama (payer) | Kojo (inspector) | File label |
|---|---|---|---|
| Allowance signed | "You signed for 3 stages, up to £12,000. Nothing is paid until each stage is seen." | — | `ALLOWANCE_SIGNED` |
| In review (authorised) | "This tranche is in review until the photos match. £4,000 is held, not paid." | "Go to the pin. Capture 6 photos and write code **K7Q** on paper in the first photo." | `HELD` |
| Uploading / pending | "Kojo is on site." | "Saved on your phone. It will send when you have signal." | `PENDING` |
| Release | "**Foundation released.** £4,000 paid. Kojo stood on the plot at 10:42." | "Accepted. Your fee is on its way." | `RELEASED` |
| Refuse: plot | "**Wrong plot.** 1.4 km off. Nothing was paid." | "Photos were taken 1.4 km from the pin. Go back and capture again." | `REFUSED_PLOT` |
| Refuse: reused | "**Old photos.** These match the photos from 12 March. Nothing was paid." | "These photos were sent before. Take new ones on site." | `REFUSED_REUSED` |
| Refuse: missing shot | "**Missing photo.** No photo of the north wall. Nothing was paid." | "Add a photo of the north wall." | `REFUSED_MISSING` |
| Refuse: stage | "**Not finished.** The photos show blockwork, not the roof. Nothing was paid." | "The roof is not visible. Capture it when it is done." | `REFUSED_STAGE` |
| Wait: model unsure | "A person is checking these photos. £4,000 is still held, not paid." | "A reviewer is checking. You don't need to do anything." | `WAIT_REVIEW` |
| Wait: system | "PayPal did not answer. Payment is not confirmed. A reviewer is checking." | — | `WAIT_SYSTEM` |
| Hold expiring [C] | "The hold ends in 1 day. If the stage isn't seen, nothing is paid and the hold is released." | — | `HOLD_EXPIRING` |
| Dispute opened | "Your dispute is filed with the record of what Kojo saw." | — | `DISPUTED` |
| Rules changed; cancellation confirmed | "The rules changed. Your hold is cancelled. Nothing was paid." | "The hold is cancelled. Ask the platform before starting again." | `CANCELLED` |

## Words we use / avoid

| Use | Avoid |
|---|---|
| held, paid, not paid, released | escrow (legal meaning, see [10](../10-risks-and-open-questions.md)), funds, transaction failed |
| stood on the plot | verified (overclaims) |
| photos match / don't match | AI detected |
| allowance | mandate (keep it for the technical docs) |

## Implemented copy boundary

`recipientAssessment` produces separate payer reasons and inspector instructions. Missing items retain their names with spaces for display. Distances round before choosing metres or kilometres. A trusted photo-index date may be supplied for reused evidence; the current fixtures have no real match dates.

`trancheSentences` derives its money clause from the recovered domain record and the server clock. Pending capture, cancellation and renewal say "Payment is not confirmed." Confirmed CAPTURE says the exact amount paid; VOID/EXPIRE says nothing was paid and the hold ended. An overdue unresolved hold asks for an expiry check. Formatting uses integer minor units even for large amounts. It never promises an inspector fee or invents a visit time. The demo's two sentences append "No payment was executed."
