# Y07: The Crew (builder agent): **last phase**

> Built **last**, on purpose. It's a whole other beast (GPU infrastructure, open-weight coding models, agent orchestration, untrusted execution). Everything before it works with **human builders**, and the gate is proven before an agent is ever paid.

## What a Crew member does

```text
discover (A2A) → evaluate fit (stack, budget, tests) → clock in → plan the change
  → loop: write code → run signed tests locally in its sandbox → fix
  → open PR → submit → (Stood) → paid | punch list → loop | give up (clock out honestly)
```

## Stack (open-source first)

| Layer | Choice | Notes |
|---|---|---|
| Compute | **Vast.ai** GPU instances | The product owner already runs Vast infrastructure (speedo). Per-hour GPU, no idle workers, the same lifecycle discipline: inventory → bounded rental → verified teardown |
| Model serving | **vLLM** (Apache-2.0) | An OpenAI-compatible endpoint on the instance |
| Coding models | Open-weight coding models (for example the Qwen-Coder family and similar). Pick by benchmark at build time | Evaluate on *our* work orders: pass rate on signed tests, cost per milestone |
| Orchestration | **LangGraph** (Python) + **LangChain** tool wrappers | Graph: plan → edit → test → reflect → submit. Checkpointed, so a crash resumes |
| Tools | git, a file editor, the test runner, a package manager (allowlist), browser QA | The browser through **Kernel** (partner) for UI checks and screenshots |
| Sandbox | A per-work-order container: no secrets, egress allowlist (package registries + GitHub only), CPU / memory / time caps | The same isolation discipline as Stood's runner ([T11](../tech/T11-security-privacy.md)) |
| Identity | A GitHub App installation token scoped to **one repo branch**. The operator's PayPal account is the payee | The agent never sees buyer payment credentials |

## Rules the Crew must obey

1. **Never edit the signed test bundle.** Stood refuses with `signed_tests_changed` anyway, and the Crew must also refuse to try.
2. **Honest failure:** if it can't pass after the attempt limit, it **clocks out** with a site-log summary. It doesn't submit garbage to burn attempts.
3. **Budget awareness:** the GPU cost per work order is tracked. If the projected cost is greater than the work-order price, it doesn't claim.
4. **No self-dealing:** the Crew can't claim work orders posted by its own operator for reputation ([Y06](Y06-the-board-work-orders-and-a2a.md)).

## Phasing

| Phase | Crew capability |
|---|---|
| Y3a | A **scripted** Crew for the demo: deterministic patches against a reference app, used to show pass / refuse / punch-list loops honestly ("demo crew") |
| Y3b | A real LangGraph agent on Vast with one open-weight model, on small, well-specified work orders |
| Y4 | Multiple models, cost-aware routing, subcontracting (child work orders), operator dashboard |

## Measured, not claimed

Track per model and per work-order type:

- first-attempt pass rate
- attempts to pass
- GPU minutes per milestone
- `signed_tests_changed` attempts (should be **0**)
- abandon rate

Publish them on the Yard page only once real.
