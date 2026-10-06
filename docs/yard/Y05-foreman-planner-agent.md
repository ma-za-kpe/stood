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

## Implementation evidence

The first graph in `services/yard-foreman` drafts through the PlannerModel port and persists a buyer-review interrupt. Tests use scripted model output and both memory and real-Postgres checkpoints. A buyer accepting the draft yields READY_FOR_BASELINE; it remains DRAFT and grants no permission to post work or move money. Proposed test files are hashed and mapped to requirements, but never executed by the Foreman. The revision loop preserves fixed buyer/repository/commit/cap fields and advances a separate review version, up to 20 drafts. Rejecting a draft grants no build or payment authority. Failed model tasks can be recovered by their owner after restart; a stale review cannot accept a newer draft. Durable writers require a shared Postgres thread coordinator, with at least two pool connections. Its advisory lock serialises healthy workers and releases on failure; this is not a financial transaction or distributed fencing proof during a broken lock connection. Signed owner-scoped HTTP creation/read/review/revision/recovery now composes the real graph with a scripted model and durable Postgres checkpoints in the isolated mock network. Clarification and isolated baseline execution are still being built. The graph follows [LangGraph interrupt/checkpoint semantics](https://docs.langchain.com/oss/javascript/langgraph/interrupts).

Failed graph tasks resume from their persisted checkpoint rather than replacing intake, following [LangGraph persistence](https://docs.langchain.com/oss/javascript/langgraph/persistence). Exact repeated creation returns the stored plan; changed intake conflicts. Recovery does not rerun an accepted plan or a buyer-review interrupt.

Draft HTTP creation uses a stable project id and compares every request-controlled field. A later server clock on an exact retry returns the saved draft with its original createdAt; it never rewrites intake. Malformed model output is an unavailable planner result, not a buyer input error. The graph's typed errors allow the API to map failures without matching exception text. Ordinary Yard startup does not install a planner or silently fall back to the mock.
