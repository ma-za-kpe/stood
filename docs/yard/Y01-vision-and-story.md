# Y01: Vision and story

## The one-liner

**Describe it. Sign it once. Get it built, and pay only for work that stands.**

## The story

Adaeze runs a small bookings business in Lagos. She has an idea for an app, a budget of $4,000, and no engineering team.

1. She opens **Yard** and describes it in plain words, or by voice. *"Customers book a slot, pay a deposit, get a reminder."*
2. **The Foreman**, Yard's planning agent, asks three sharp questions, then draws a **blueprint**:
   - requirements
   - four milestones
   - the **acceptance tests** that define "done" for each
   - a budget per milestone
3. She reads the blueprint as a timeline, edits one milestone, and **signs once with PayPal**. Through Stood, that signature becomes the payment mandate: a $4,000 cap, these milestones only, 60 days.
4. The Foreman **posts each milestone as a work order** on the **Board**.
5. A builder **clocks in**. It might be a developer in Nairobi, or a **Crew agent** (Yard's own builder). The builder ships into a fresh repo on **Adaeze's GitHub**.
6. For every milestone, **Stood** runs the tests she signed against the new commit.
   - **Pass:** PayPal releases that milestone to the builder's operator.
   - **Fail:** a **punch list** comes back ("3 signed tests were skipped"), and nothing is paid.
7. At **handover**, Adaeze opens the deployed app, books a slot, and taps release. That's the last payment.

**She touched it three times:** describe, sign, and use. **She never chased anyone.**

## Why this matters

- **For buyers:** no more "almost done" invoices, and no managing a developer. The contract is the tests.
- **For builders, human or agent:** work orders are precise, and payment is automatic when the work passes. No chasing clients either.
- **For the agent economy:** this is the first credible loop where **agents pay agents**:
  - Adaeze's agent pays the Crew.
  - The Crew pays a test-writing agent.
  - The whole chain ends in **a human who used the product**, a signal no agent in the chain controls (see [S17](https://github.com/ma-za-kpe/stood/blob/develop/docs/stood/S17-agent-payments-positioning.md) and the anti-pyramid rule in [Y13](Y13-security-trust-and-economics.md)).

## Yard's character

Stood is the **clerk**: careful, exact, unhurried. Yard is the **yard**: busy, cheerful, competent, a crew that ships.

| | Stood | Yard |
|---|---|---|
| Role | Decides if money moves | Gets the thing built |
| Personality | A clerk with a stamp | A foreman with a clipboard and a hard hat |
| Visual world | Night, violet glow, verdict lights | Blueprint navy, hi-vis signals, steel and grid |
| Voice | "Nothing was paid." | "Blueprint's ready. Sign it and I'll post it to the Board." |
| Motion | Things land with certainty | Things get **built**: grids draw, blocks lift, orders slide onto the board |

## What Yard is not

- Not a freelance marketplace with chat, bids and profiles. It posts precise work orders, and anyone (human or agent) who meets them can claim.
- Not a code generator that pays itself. **Yard never decides it got paid. Stood does.**
- Not "AI builds your app in 5 minutes". It's **milestone-by-milestone, test-defined, paid-on-proof** engineering.
