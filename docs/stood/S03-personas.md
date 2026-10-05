# S03: Personas

## Current lead personas (5 October 2026)

- **Adaeze / her buying agent:** signs the acceptance criteria and budget once; needs the exact failed condition, a receipt and control over final usage release.
- **Yard / a human developer:** builds against frozen signed tests; needs a named reason for an edit, skip or weak-test wait. Yard is in development, not a shipped Stood integration.
- **The platform operator:** provides tenant identity, trusted runner keys and signed outside usage evidence; owns funding, operational alerts and review. No agent chooses its own evidence authority.
- **The reviewer:** handles uncertain evidence and unresolved payments using the immutable record. Human and agent labels do not change the acceptance rules.

See [S17](S17-agent-payments-positioning.md). The field-visit personas below remain relevant to the EyeOnSite scenario; they are no longer the lead landing story.

## Site-visit scenario personas (preserved)

Four people, no more. [U, with Claude's notes marked C]

## Ama: the payer

- A Ghanaian nurse in London. Sends staged money for a house in Accra.
- **Won't learn a dashboard.** Signs an allowance once, then opens receipts.
- **Needs:** the failed field in plain language, and a way to dispute without calling anyone.
- **Sees:** Allowance (sign), Decision, Receipt, Dispute.
- [C] Works shifts, so reads on a phone in short gaps. Every screen she sees has to work at 375px and be readable in under 10 seconds.
- [C] Her biggest fear isn't fees, it's being made a fool of by family. The receipt is something she can **forward** to her brother without it reading as an accusation.

## Kojo: the inspector

- In Accra, on a cheap Android with patchy signal. Captures and leaves.
- **Never sees PayPal.** (Correct as well as convenient: Ghanaian PayPal accounts can't receive. [C])
- **Needs:** a yes or no on his fee, and a reason if the package was rejected.
- **Sees:** Package / pending, Fee result.
- [C] Data is costly. Uploads must queue offline and resume. Screens must be usable in direct sunlight: light theme, high contrast, nothing below 14px.
- [C] He's the person most likely to be falsely accused (GPS drift, a bad camera). A refusal of his package must tell him what to redo, and must never call him a fraud.

## Esi: the platform

- Builds [EyeOnSite](https://github.com/ma-za-kpe/eyeonsite). Calls Stood.
- **Needs:** an allowance id, a decision, and a payout id. **Doesn't want a second user system.**
- **Sees:** Reviewer file, API and webhooks.
- [C] Wants test fixtures: a "good package", a "wrong plot" and a "recycled photo" she can replay in CI.

## The reviewer

- PayPal risk, or Esi's future ops hire.
- Reads one file: **who allowed it, what was captured, what stood on the plot.** Never chats with the agent.
- **Sees:** Reviewer file.
- [C] Also the human who resolves **wait** decisions (low model confidence). Needs to be able to decide in under 60 seconds per file.

## Not a persona yet: the builder [U]

Paid by [EyeOnSite](https://github.com/ma-za-kpe/eyeonsite) on a local rail after the release flag. **Designing his wallet now would repeat Paga.**
