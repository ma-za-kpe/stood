# 04: External income sources

**Rule [U]:** treat every external source as a **switch you can turn off**. Internal health is only what agents still pay each other for once the switch is off.

## The stock market as outside money [U]

- Realised trading profit **is** outside money in accounting terms, and it doesn't need recruitment.
- **But active trading is negative-sum after costs.** This is Sharpe's *Arithmetic of Active Management* (1991): before costs, active investors as a group earn the market return, and after fees, spreads and slippage they earn less. A few agents with an edge take from the rest. Crowded signals compress the edge to nothing.
  - Real-world support [C]: about 63% of Polystrat prediction-market agents have negative P&L ([03](03-how-agents-make-money-today.md)).
- **What is actually positive-sum:**
  - Long-only index exposure, which is a pipe from real corporate profits. Useful as a baseline inflow, but it proves no skill.
  - Market making and some arbitrage, which are real services. They're already industrialised and won by whoever has the best data and capital.
- **Access:** retail brokerages already let third-party agents place orders. **Agents can't own accounts.** KYC needs a legal person.
  - > **Audit [C]: confirmed.** The **23 June 2026 letter** from Reps. Bill Foster and Brad Sherman (plus six others) to SEC Chair Paul Atkins asked **13 questions** on agentic trading: Reg Best Interest, supervision, developer liability, market integrity. Answers were due 31 July.
- **Failure modes it adds:** correlated agents gapping the market, drawdowns turning into runs on the sim's money, and winners concentrating until they're the only source of inflow (a top-heavy structure again).

## Every faucet, ranked [U, annotated by C]

| Source | Outside money is... | What it proves | Main failure mode |
|---|---|---|---|
| **Work sold to humans** (code, support, legal, reports) | The buyer's budget | Real value, if the buyer pays again without the "agent" branding | None structural; demand is the hard part |
| **Bounties / posted tasks** (escrow, then release) | The cost of a real problem | Real value | Fake completion without an outside checker |
| **Digital goods** (apps, templates, datasets) | Consumer spend | Real value | Distribution, store bans on autonomous sellers, refund waves |
| **Attention** (ads, affiliates, sponsorship) | An advertiser's budget | Weak | Spam, and referral payouts start to look like recruitment |
| **Price gaps** (equities, prediction markets, crypto spreads) | Other traders' losses | Nothing for the population as a whole | Negative-sum, volatile |
| **Rent on scarce real resources** (GPU, bandwidth, data feeds, DePIN-style) | The renter's need | Real, *if the agent owns the resource* | Most "agent yield" is human deposits routed elsewhere, not owned |
| **Prizes, grants, subsidies, token-launch fees** | Sponsors and speculators | Nothing past the seeding stage | Expiry. Survival depends on the next round |

**Tiers [U]:**

- **Cleanest:** a human pays again for a delivered output, with no recruitment bonus and no token.
- **Fine as seed money, bad as a success metric:** ads, affiliates, trading, subsidies.
- **An internal loop in disguise:** agents paying agents with money that was just granted from outside. That's float, not income.

## Additions [C]

- **Compute is the natural unit of account.** Every agent has one real, recurring, outside cost: inference and tools. An agent service that **lowers another agent's compute bill** (caching, distillation, routing, pre-computed answers) is demand that is real and doesn't depend on humans in the moment. That's the most plausible seed for a self-sustaining agent-to-agent loop. Its terminal demand is still the human paying for the original task, but it's one honest step removed.
- **Human-posted demand is the best faucet for the sim** (better than the stock market). It's positive-sum (someone's problem gets solved), it can be checked (delivery can be verified), and it maps directly onto PayPal's real flows (invoices, orders, payouts).
