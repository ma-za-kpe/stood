# Y03: Personas and agents

## Humans

### Adaeze: the buyer

- Runs a small business in Lagos. Has an idea, a budget ($4,000) and no engineering team.
- **Wants:** to describe it once, understand the plan, sign once, and never chase anyone.
- **Fears:** paying for "almost done", and ending up with a repo she can't run.
- **Touches Yard three times:** describe → sign → handover (use and release).
- Reads plans as a **timeline**, not as code. Sees each milestone as a plain sentence plus its tests, in human language.

### Musa: the human builder (Nairobi)

- A senior full-stack developer. Picks work orders that fit his stack.
- **Wants:** precise scope, no scope creep, fast payment when tests pass, and no chasing.
- **Sees:** the Board, work-order detail (requirements, signed tests, budget, deadline), the site log, and the punch list on refusal.
- Is paid to **his own PayPal**: he's his own operator.

### Ops: the operator

- The person or company **running builder agents** (for example Manti Labs running Yard's Crew).
- The PayPal payee for Crew work. Accountable for agent behaviour. Sets the Crew's capacity and budget.

### The reviewer

- Same as in Stood: resolves WAIT decisions (weak tests, ambiguous evidence). Reads the Stood reviewer file. In Yard, sees the work-order context alongside it.

## Agents

### Adaeze's agent (buyer agent)

- Optional. It can describe the project on her behalf, answer the Foreman's questions, and later **hire** builders over A2A, always inside **the mandate she signed** (cap, time, milestones).
- In the long run, the buyer is an agent too ([S17](https://github.com/ma-za-kpe/stood/blob/develop/docs/stood/S17-agent-payments-positioning.md)), and handover becomes an **outside signal** (real users, a third party paying for the result).

### The Foreman: Yard's planning agent

- Turns an idea into a **blueprint**, and never builds anything ([Y05](Y05-foreman-planner-agent.md)).
- **Personality:** a seasoned site foreman. Short questions, plain answers, opinionated about scope ("That's two milestones, not one").
- Has **no PayPal or GitHub write access**. It drafts. Humans sign.

### The Board: job-posting service (not an LLM)

- Deterministic. Posts work orders, matches by declared skills, runs claims and leases, exposes the A2A surface ([Y06](Y06-the-board-work-orders-and-a2a.md)).

### The Crew: Yard's builder agents

- **Built last** ([Y07](Y07-crew-builder-agent.md)). Run on Vast.ai with open-weight coding models, orchestrated with LangGraph.
- Clock in like any builder. Ship into the buyer's repo. Can **subcontract** (for example pay a test-writing agent through Stood).
- **Personality in the UI:** numbered crew members (`crew-7`) with a visible site log. Confident, terse, and honest about failure ("Punch list: 2 tests failing. Fixing.").

### Third-party builder agents

- Any agent that speaks A2A and meets the work order's requirements. Paid to its operator. Treated exactly like the Crew.
