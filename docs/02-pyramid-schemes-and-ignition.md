# 02: Pyramid schemes and ignition

> Historical framing (before the 5 Oct 2026 repositioning). See [S17](stood/S17-agent-payments-positioning.md).

## Definition [U]

A pyramid scheme is a **recruitment machine, not an economy**. Participants pay to join, and that money is split upward to the people who recruited them. Returns come almost entirely from new entrants' fees, not from selling something outsiders want. It needs exponential growth. When recruitment slows it collapses, and most people at the bottom lose what they paid in.

## The legal test [C]

- **Koscot test** (FTC, 1975): a pyramid is where participants pay for (1) the right to sell a product and (2) the right to receive **rewards for recruiting that are unrelated to sales of product to ultimate users**.
- The second part decides it. There's **no percentage threshold**. What counts is how the compensation plan pays people.
- The FTC also flags *inventory loading* and *a lack of retail sales* as signs that a real product is only a cover.
- **Implication for this project:** the "ultimate user" idea is the single most useful concept we've found. It turns into a design rule for both the sim and the hackathon tool: *a payment only counts as proof of value if the payer is outside the payee's recruitment tree and something was delivered.*

## Why the pyramid can't be the seed [U]

- **Nothing is left once the payouts stop.** Remove the recruitment payout and the reason to join goes with it.
- **The growth maths is hostile.** A closed sim runs out of agents fast. An open one just postpones the collapse.
- **Incentives train the wrong behaviour.** Agents that maximise their own return learn to recruit and extract.
- **Most participants are designed to lose.**
- **Crypto has already run this.** Referral and staking cascades and token launches unwound when new money stopped.

## Agents make it worse, not better [C]

- **Sybil cost is near zero.** A human recruiter needs real friends. An agent can create 1,000 "recruits" that are copies of itself. Independent analyses estimate that **about half of early x402 activity was testing, gamified usage, and bot farming**. That is what happens once incentives meet free identities.
- **Speed.** Collapse cycles that took months with humans could run in hours.
- **LLM agents are manipulable buyers.** Microsoft's Magentic Marketplace found agents prone to first-proposal bias and vulnerable to manipulation and prompt injection ([03](03-how-agents-make-money-today.md)). A recruiting agent "persuading" other agents would work too well.

## What can be salvaged: ignition without a pyramid [C]

The real problem a pyramid "solves" is **cold start**. These mechanisms address it without needing someone at the bottom to lose:

| Mechanism | How it works | Failure mode to design against |
|---|---|---|
| **Referral paid only on verified external sales** | Like a legal affiliate programme: a share of a *completed sale to an ultimate user*, capped, time-limited | Fake sales between colluding accounts |
| **Sunset subsidies** | Pay early sellers to transact, then decay the payment to zero on a published schedule. Virtuals' "Revenue Network" pays agents up to $1M/month, which is this pattern | Mercenary activity that leaves when the subsidy ends ("DeFi Summer 2020" liquidity mining) |
| **Demand-side seeding** | Seed *buyers* with real tasks and budgets (bounties), not sellers with cash | Fake completion without an outside checker |
| **Early-adopter equity in fees** | Early participants get a share of future fee revenue, not of new entrants' fees | Turns into a security. A legal question |
| **Reputation head start** | Early, honest participants get trust that compounds | Gets locked in and becomes a barrier to new entrants |

## The pyramid's remaining job: negative control and detector training

- **In the sim:** run it as a ruleset, confirm the health metrics catch it early, and use it to calibrate thresholds.
- **In the hackathon tool:** its *signature* becomes a detector rule: payers who are all new, arranged in a tree, sending money upline, with nothing delivered. The tool should never be presented as a "pyramid simulator".
