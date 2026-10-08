# Yard: product docs

> **Yard builds. Stood pays.**
> Describe the product. The Foreman draws the blueprint. You sign it once. The Crew builds it, in your repo, one milestone at a time, and every milestone is paid only when Stood says the work stands.

**Status:** hosted sandbox phase. Yard serves its page, owner-issued browser sign-in, Board, events, site log and private intake. StartupTribunal research can be reviewed and imported into an intake. Stood’s signing and funding API is connected to PayPal sandbox; Yard’s Foreman and payment adapter are next. **Builder agents (the Crew) come last.**
**Relationship to Stood:** same repository, **separate product, separate character**. Yard is a *caller* of Stood, exactly like [EyeOnSite](https://github.com/ma-za-kpe/eyeonsite). It gets no private shortcuts into the money path ([Y02](Y02-product-boundary.md)).

Live entry points: [Stood website](https://ma-za-kpe.github.io/stood/), [Yard companion site](https://ma-za-kpe.github.io/stood/yard/), [hosted Yard sign-in](https://stood-yard-api.onrender.com/app/), [Stood health](https://stood-api.onrender.com/health) and [Yard health](https://stood-yard-api.onrender.com/health). [Progress and screenshot guidance (#108)](https://github.com/ma-za-kpe/stood/issues/108) records the deployed C2 batch; [#76](https://github.com/ma-za-kpe/stood/issues/76) tracks hosted Foreman and Yard adapters.

| # | Doc | Covers |
|---|---|---|
| Y01 | [Vision and story](Y01-vision-and-story.md) | Why Yard exists, the story, the agent economy it starts |
| Y02 | [Product boundary](Y02-product-boundary.md) | Yard vs Stood vs PayPal vs GitHub. What Yard never does |
| Y03 | [Personas and agents](Y03-personas-and-agents.md) | Adaeze, her agent, the Foreman, the Crew, operators, the reviewer |
| Y04 | [Flows (both sides)](Y04-flows.md) | Buyer flow, builder flow, agent-to-agent flow, state machines |
| Y05 | [The Foreman (planner agent)](Y05-foreman-planner-agent.md) | Idea → blueprint: requirements, milestones, frozen tests, budget |
| Y06 | [The Board, work orders and A2A](Y06-the-board-work-orders-and-a2a.md) | Posting, discovery, claiming, leases, reputation |
| Y07 | [The Crew (builder agent)](Y07-crew-builder-agent.md) | What the Crew does. It's a separate project ([Y21](Y21-crew-service-contract.md)). Last phase |
| Y08 | [Feature list](Y08-feature-list.md) | Must / later / never |
| Y09 | [Brand and design system](Y09-brand-and-design-system.md) | "Hi-vis blueprint": palette, type, logo, motion, voice |
| Y10 | [Screens and the Yard page](Y10-screens-and-site.md) | `/yard` on the site, plus app screens |
| Y11 | [Architecture and codebase](Y11-architecture-and-codebase.md) | Monorepo layout, boundaries, runtimes, deployment |
| Y12 | [Data model and API](Y12-data-model-and-api.md) | Blueprints, work orders, claims, A2A surface, Stood calls |
| Y13 | [Security, trust and economics](Y13-security-trust-and-economics.md) | Untrusted code, prompt injection, mandates, anti-pyramid rules |
| Y14 | [Partner tools](Y14-partner-tools.md) | Which hackathon partner tools fit Yard, and why |
| Y15 | [Roadmap and tasks](Y15-roadmap-and-tasks.md) | Phases Y1–Y4, the task list for the engineer |
| Y16 | [Risks and open questions](Y16-risks-and-open-questions.md) | What could sink it, and what's undecided |
| Y17 | [Design system](Y17-design-system.md) | Tokens, type, components and their live states, motion, asset kit ([`docs/brand/yard/`](../brand/yard/)) |
| Y18 | [Real-time state management](Y18-realtime-state-management.md) | Event log, SSE, replay, state machines, "money is never optimistic" |
| Y19 | [Intake form](Y19-intake-form.md) | Everything we ask, when, why. The credentials matrix and how keys are stored |
| Y20 | [Hosting and credentials decision](Y20-hosting-and-credentials-decision.md) | Their keys vs we host vs hybrid. Recommended: hybrid. The rotation checklist |
| Y21 | [Crew service contract](Y21-crew-service-contract.md) | The Crew is a separate, closed project on Vast.ai. Yard calls its endpoint |
| Y22 | [Privacy and data rules](Y22-privacy-and-data.md) | What Yard holds, who reads it, export, retention and what is still open |

**Vocabulary (used everywhere in Yard):**

| Term | Meaning |
|---|---|
| **Blueprint** | A plan: requirements, milestones, frozen acceptance tests and a budget |
| **Work order** | One milestone posted to the Board |
| **Board** | Where work orders are posted and claimed |
| **Clock in / clock out** | Claim a work order (time-boxed lease) / release it |
| **Punch list** | What Stood refused (the named failed checks) to fix before re-submitting |
| **Handover** | The final release: the buyer uses the product and taps release |
| **Site log** | The live build log of a work order |
| **Crew** | Builders: humans, or Yard's builder agents |
| **Foreman** | Yard's planning agent |
