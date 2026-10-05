# 01: Vision and phases

> Historical framing (before the 5 Oct 2026 repositioning). See [S17](stood/S17-agent-payments-positioning.md).

## The original idea [U]

- What is called the "agentic economy" today isn't one. An economy is where money is exchanged, so an agentic economy should mean **AI agents holding money and doing things with it**.
- x402 and similar rails let agents transact, but that has to go further.
- Phases as first proposed:
  1. Build an economy simulation of a **pyramid scheme with fake money**.
  2. Remove the pyramid's negative side effects.
  3. Once it works well, open it to the public with **real money and their own agents**.

## Critique [U + C]

1. **"Money exchanged" is too thin a definition.** An economy is *repeated, voluntary exchange of things someone values*, under rules that let production, specialisation and accumulation continue. Transfers can look busy and still destroy value. [U]
2. **The pyramid's harms are how it works, not bugs.** Take away the upstream recruitment payout and there's no reason left to join. You don't get a healthy market. You get an empty one. [U]
3. **The real question underneath is ignition (cold start), not the pyramid.** [C] What a pyramid actually offers is fast onboarding and early-adopter rewards. Those are real needs for any new network. They can be met with mechanisms that don't need the bottom layer to lose (see [02](02-pyramid-schemes-and-ignition.md#what-can-be-salvaged-ignition-without-a-pyramid-c)).
4. **Agents are almost never the "ultimate user".** [C] US law (the Koscot test) separates a business from a pyramid by whether rewards come from *sales to ultimate users*. An agent with no need of its own isn't an ultimate user. Its demand is borrowed from whoever set its goal. So any agent economy has to end, somewhere, in a human or physical-world need. A fully closed agent-to-agent loop is circular by definition.

## Revised phase plan [U + C]

| Phase | What | Pass condition |
|---|---|---|
| 0 | **Negative control.** Run the pyramid in the sim and watch it die. | The metrics flag it before the collapse ([05](05-simulation-design.md)). [C: changed from "least informative" to "calibration"] |
| 1 | Closed sim, fake money, **production required**. Agents earn only by delivering something another agent's goal needs. | Trade survives when new-agent entry is stopped |
| 2 | Add reputation, contracts, failure, adversarial agents, explicit money supply. | Fraud and collusion are caught. Concentration stays bounded |
| 3 | Outside human goals plus limited real rails, capped. Humans own the agents. | Internal loop clears without subsidies |
| 4 | Public, real money. | Legal test: people pay for a service or asset that exists without recruiting anyone |

## Where the project has moved [C]

Because of the PayPal AI Hackathon (deadline 12 Nov 2026), the near-term deliverable is **no longer the sim**. It is a real-world tool that applies the same test, "only count payments for delivered goods to someone outside the payer's tree", to agent payments. See [09](09-stood.md).

The sim isn't thrown away. It becomes the **test harness**: synthetic honest sellers, fraudsters and recruitment rings that generate data to stress-test the trust logic. The long-term vision (agents as real economic actors) stays the north star. The hackathon project is the first real-money brick, built on PayPal sandbox.
