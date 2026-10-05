# Y05: The Foreman (planner agent)

The Foreman turns *"I want an app that…"* into a **blueprint** a builder can execute and Stood can check. **It drafts. It never builds, never signs, never pays.**

## Output: the blueprint

```text
Blueprint
├─ summary            plain-language product statement (≤ 3 sentences)
├─ requirements[]     user stories, each with acceptance criteria
├─ stack              proposed tech (overridable), plus repo template
├─ milestones[] (3–6)
│   ├─ name, goal (one sentence a buyer understands)
│   ├─ scope           files/areas expected to change (diff-scope check)
│   ├─ acceptance_tests  executable tests (frozen at signing) + plain-English description
│   ├─ dependencies_allowlist
│   ├─ budget (USD), deadline
│   └─ profile        code.milestone@1 (final milestone: + usage_release / outside_signal)
├─ handover          the flow the buyer will run to release the last payment
└─ risks[]           what's uncertain, and what the Foreman assumed
```

## How it works (LangGraph state machine)

```text
intake → clarify (≤ 3 questions) → requirements → milestone split → test authoring
      → self-review (scope, budget, testability) → [interrupt: buyer review] → revise ⇄ review → final
```

- **LangGraph.js** (MIT) orchestrates the graph with **human-in-the-loop interrupts** at the buyer-review node, and it's persisted, so a buyer can come back tomorrow.
- **Testability gate:** every acceptance criterion must map to at least one executable test, or be marked `manual` (only allowed on the handover milestone).
- **Test authoring:** tests are generated **before** any code exists, written against a declared interface (HTTP routes, CLI, UI test IDs). The self-review step runs them against an empty scaffold and expects them to **fail** (red). This proves they test something.
- **Budgeting:** a heuristic plus a model estimate per milestone, shown as a range. The buyer sets the final number.

## Models (pluggable, behind a `PlannerModel` port)

| Option | When |
|---|---|
| Open-weight on Cloudflare Workers AI (free tier) | Default for the hackathon. Cost $0, quality is enough for drafting |
| Open-weight on Vast.ai (same server as the Crew, see [Y07](Y07-crew-builder-agent.md)) | When Crew infrastructure exists. Avoids per-token cost |
| Hosted frontier model | Optional upgrade for complex blueprints (needs an ADR, since it's paid) |

## Guardrails

- **No secrets or tools with side effects.** The Foreman can't call Stood, PayPal or GitHub write APIs. Yard's application layer does, after buyer approval.
- **Input is untrusted.** Buyer text and pasted documents are data, never instructions to change policy, prices or permissions.
- **Scope honesty:** if the idea can't fit the budget, the Foreman says so plainly ("This is a $12k build. Here's a $4k first version.").
- **Every blueprint is versioned.** The signed version is immutable, and changes create change orders ([Y04](Y04-flows.md) §5).

## Voice (examples)

- *"Three questions before I draw this up."*
- *"That's two milestones, not one: payments and reminders fail differently."*
- *"Blueprint's ready: 4 milestones, $4,000, about 5 weeks. Read the tests. They're your contract."*
- *"I can't test 'looks nice'. Want a check for 'loads in under 2 seconds' instead?"*
