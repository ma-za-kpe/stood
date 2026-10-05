# Y15: Roadmap and tasks

Yard ships in phases. **Each phase is useful without the next one.** The Crew (builder agent) is last.

| Phase | Outcome | Depends on |
|---|---|---|
| **Y0: page** | `/yard/` landing page with the design system, linked from Stood's nav. Fixture "blueprint draws" + Board animation | Docs (this set) |
| **Y1: Foreman + approval** | Describe → questions → blueprint (with red-first tests) → Gantt review → approve → **Stood allowance** + PayPal sign-once → repo bootstrap | Stood `code.milestone@1` + final-milestone scoping (PR #30 follow-up), the funded allowance API (DRAFT creation alone is insufficient) |
| **Y2: the Board (humans)** | Work orders, claims / leases, submit SHA → Stood package, punch lists, handover | The Stood runner contract + dispatch + package APIs |
| **Y3a: demo Crew** | A scripted agent builder that claims, submits pass / fail commits, and shows refusals honestly in the video | Y2 |
| **Y3b: real Crew** | A LangGraph + vLLM agent on Vast.ai with one open-weight coding model, on small work orders | Y2, the sandbox, a GPU budget |
| **Y4: A2A economy** | Agent card + A2A tasks, buyer agents, subcontracting, operator dashboard, reputation | Y3b |

## Task list for the engineer

Allocated IDs are in [TASKS.md](../../TASKS.md), T-0174–T-0192. Delivered in the usual ≥ 5-task rounds. ADR and import boundaries are implemented at the designed/tested tier; the remaining runtime tasks below are planned.

**Round Y-A (foundations):**

- [x] ADR: "Yard as a companion product in the monorepo, a Stood caller with no shortcuts" (Y02 / Y11)
- [x] dependency-cruiser rules: no `yard-*` → `services/api` imports. Foreman has no side-effect imports
- [ ] `services/yard-api` skeleton (Hono) + `yard` schema + role with no grants on Stood tables
- [ ] Domain: Blueprint (versioned, immutable when signed), Milestone, WorkOrder state machine, Claim / lease (TDD, property tests)
- [ ] Stood SDK package (`packages/stood-sdk`, generated or hand-typed until APIMatic) + a contract test against the local Stood
- [ ] `site/yard/` page (Y0) with Y09 tokens + a nav link from Stood

**Round Y-B (Foreman):**

- [ ] LangGraph.js Foreman graph with an interrupt at buyer review. A `PlannerModel` port (Workers AI default)
- [ ] Blueprint schema validation + the testability gate (tests run red on the scaffold)
- [ ] Prompt-injection test set for intake text
- [ ] Approve → Stood allowance (signed tests bundled + hashed)
- [ ] Blueprint review UI (Bryntum Gantt) + edit / merge / split / reprice

**Round Y-C (Board):** claims / leases + Stood dispatch, the GitHub App (repo bootstrap, scoped branch tokens, read-only tests), submit → Stood package, webhook → work-order state + punch list, handover.

**Round Y-D (demo Crew):** a scripted Crew + fixtures (pass, `signed-tests-changed`, `tests-skipped`, lease-expired), a site-log stream.

**Round Y-E (real Crew):** Vast lifecycle (inventory → rent → serve vLLM → teardown), LangGraph Python graph, sandbox, cost guard, metrics.

## Hackathon cut (by 11 Nov)

The video needs **Y0 + Y1 + Y2 + Y3a**. The real Crew (Y3b) is a stretch. If it isn't ready, the page and the README say "Crew in development" (honesty rule).
