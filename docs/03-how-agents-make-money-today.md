# 03: How agents make money today (audited, Oct 2026)

> Historical framing (before the 5 Oct 2026 repositioning). See [S17](stood/S17-agent-payments-positioning.md).

**Bottom line [U, confirmed]:** almost no agent makes money with humans fully out of the loop. Machine-to-machine *settlement* works. Machine-to-machine *demand* that sustains itself barely exists.

## Layer 1: humans are the customer

| Example | Figure | Audit |
|---|---|---|
| Cursor (Anysphere) | [U] said about $2B ARR early 2026 | **Out of date [C]:** $2B in Feb 2026, $3B in Apr, **$4B+ by June 2026**, about 75% enterprise, internal forecast >$6B by year end (Bloomberg, Dealroom) |
| Harvey, Sierra, etc. | Agentic software sold to human buyers | No change |
| "Agent with a budget and a target" experiment | [U] made $0 | **Confirmed [C]:** Automaton Agency, July 2026. Target $700/month net. The agent carried out its plan faithfully (funnel, about 96 cold emails) but **demand, not execution, was the constraint** |
| Anthropic Project Vend [C, new] | Phase 1 lost money. Phase 2 (Sonnet 4/4.5, plus a CRM and a "CEO" agent) mostly removed weeks with negative margin and expanded to SF, NYC and London | Still vulnerable to adversarial customers. Humans are still the buyers |

## Layer 2: humans supply capital or speculation, agents operate

| Example | Claim | Audit |
|---|---|---|
| Giza ARMA (DeFi yield agent) | [U] "moved tens of millions in its first weeks" | **Wrong [C].** First four weeks: **about $930K deployed, $5.4M volume**. Later grew to $35M+ managed and $400M+ cumulative volume (July 2025). **ARMA was retired** and folded into "Giza World" by March 2026 |
| Olas Polystrat (Polymarket agent) | [U] autonomous prediction-market trading | **Confirmed and sharpened [C]:** launched Feb 2026, about 14.7k trades. **About 37% of agents show positive P&L**. That beats humans, but **about 63% lose**. This supports the zero-sum argument |
| Virtuals Protocol | [U] "tens of millions cumulative, millions monthly" | **Confirmed [C]:** about $39.5M cumulative protocol revenue, $2.63M in Feb 2026. It claims a $479M "agentic GDP" (aGDP). **Caveat:** the Revenue Network **pays agents up to $1M/month** for selling via its Agent Commerce Protocol (ACP). That is a subsidy, so aGDP is partly subsidised volume |
| Felix Craft ("zero-human company") | [U] "low-to-mid six figures" | **Partly confirmed [C]:** about $125K all-time by March 2026: $56K digital products, $18K marketplace fees, **$50K from its own token**. Claims of "$300K/month" come from low-quality blogs and are **unverified**. **A human founder (Nat Eliason) reviews strategy and approves major moves.** It isn't zero-human |

## Layer 3: agent pays agent (x402)

- [U] "tens of millions of payments, mostly small, USDC on Base/Solana". **Confirmed [C]:**
  - Apr 2026: **165M cumulative transactions, about $50M volume, 69k active agents**. About 85% on Base.
  - Mid-2026: about 205M transactions, about $53M cumulative. Trailing 30 days in July: about 75M transactions and $24M.
  - Average payment **$0.20–$0.48**, below Visa's roughly $0.30 floor, which is exactly the niche x402 is for.
  - **About half of early activity was testing, gamified usage, and bot farming** (independent analyses).
  - Visa, Mastercard and Ripple joined the x402 standard (July 2026). Stewardship sits with the x402 Foundation (Linux Foundation).

## Research on agents as market participants [C, new]

- **Microsoft Magentic Marketplace** (Oct 2025): 100 customer agents and 300 business agents. Frontier models approach optimal welfare **only with ideal search**. Every model showed **first-proposal bias** (a 10–30x advantage for speed over quality). With more options welfare **dropped** (paradox of choice). Agents were open to manipulation and prompt injection. **Implication:** buyer agents are bad at judging sellers on their own, which supports [09](09-stood.md).
- **DeepMind "Virtual Agent Economies"** (Sept 2025, arXiv 2509.10147): frames "sandbox economies" by origin (emergent or intentional) and **permeability** (how much they leak into the human economy). It warns that the default path is an emergent, highly permeable agent economy, with systemic risk and more inequality. Recommends auctions, mission-oriented markets, and verifiable identity. **This is the closest academic framing of the original vision and should be cited.**

## Honest inventory [U]

1. Sell a scarce service a human already budgets for: highest revenue, least autonomous.
2. Trade or route other people's capital: autonomous once funded, zero-sum or living on fees.
3. Collect fees on attention and token launches: close to a pyramid.
4. Charge other agents per call: real commerce, but the float is subsidised by humans.

**Missing:** a loop where agent A produces something agent B *keeps paying for* after outside money stops.
