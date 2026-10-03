# 05: Simulation design principles

**Status:** paused as a product. **Kept as the test harness** for the hackathon trust logic ([09](09-stood.md)) and as the long-term research track.

## Core principles [U]

- Agents have **different endowments and costly actions**: compute, data, tool access, storage, attention.
- Agents have **different goals**: some need data, some need compute, some arbitrage, some sell services.
- **Money is the settlement layer, not the product.**
- Budgets are **not refilled**. Agents pay for their own inference and tools.
- **Only count revenue from another agent voluntarily buying a delivered output.**

## The two-ledger rule [U]

Keep two separate ledgers:

1. **Exogenous grants.** Trading P&L, bounties, subsidies. Each one can be switched off.
2. **Internal revenue.** Agent A pays agent B for delivered output that A still wants after the grants shrink.

If internal trade dies when the grants stop, "you had a hedge fund with a chat layer."

## Health metrics [U + C]

| Metric | Healthy | Pyramid signature |
|---|---|---|
| Repeat purchases from the same counterparty | High | Low (one-time entry fees) |
| Share of volume that is payment for delivered service vs pure transfer | High | Low |
| Activity after new-agent entry stops | Slows | Collapses |
| Balance concentration (Gini) over time | Bounded, tied to production | Rises fast, tied to tree depth |
| Bankruptcy / inactivity rate | Some, spread out | Concentrated at the bottom layers |
| **Payer outside the payee's tree** [C] | Most volume | Almost none |
| **Graph shape** [C] | Dense, cyclic trade graph | Tree / DAG pointing upward |
| **Value-weighted delivery confirmation** [C] | High | Zero or self-attested |

## Collapse modes worth studying [U]

Bank runs on agent treasuries, oracle failures, collusion, resource exhaustion. A pyramid collapse is the *control*, not the experiment.

## Agent implementation choice [C, new]: an open decision

| Option | Pros | Cons |
|---|---|---|
| Rule-based agents | Cheap, reproducible, scales to 100k agents | Tests the mechanism, not LLM behaviour |
| LLM agents | Realistic (manipulable, biased, as Magentic Marketplace found) | Costly. The *inference bill is real money* even when balances are fake. Behaviour isn't reproducible |
| **Hybrid (recommended)** | Rule-based crowd plus a few LLM agents in key roles (buyers' agents, fraudsters) | More complicated to build |

## Prior art to read before building [C]

- Microsoft **Magentic Marketplace** (open-source sim environment, arXiv 2510.25779). It could be reused instead of starting from scratch.
- DeepMind **Virtual Agent Economies** (arXiv 2509.10147).
- Anthropic **Project Vend** / Andon Labs **Vending-Bench** (long-run coherence of autonomous businesses).
