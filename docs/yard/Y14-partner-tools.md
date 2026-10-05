# Y14: Partner tools for Yard

Rule (inherited from Stood's S13): **one honest job per tool. No logo-bolting.** Yard opens new natural fits that Stood didn't have.

| Partner | Job in Yard | Fit |
|---|---|---|
| **Bryntum** | **The blueprint timeline:** a Gantt of milestones with dependencies, deadlines and budgets. The buyer reviews and edits the plan here. Bryntum's own hackathon brief ("late payments block workflow phases") *is* Yard | ★★★ |
| **AG Studio / AG Grid** | **The Board** as a filterable grid for builders. **The operator dashboard** (Crew earnings, GPU minutes, pass / abandon rates) | ★★★ |
| **Astropods** | Hosts the **Foreman** (agent runtime, knowledge store of blueprint templates, observability of every planning run). No payment or GitHub credentials in its runtime | ★★ |
| **Kernel** | **The Crew's browser:** UI checks of the builder's deployed preview, and screenshots for the site log and handover evidence. Also drives the PayPal sandbox approval in the demo (shared with Stood) | ★★ |
| **Render** | Hosts `yard-api` and `yard-web`. **Render Workflows** for lease expiry, next-milestone posting and handover reminders | ★★ |
| **Elastic** | **Work-order search and matching:** hybrid search over goals, stack and skills, and builder discovery | ★ (Postgres full-text is the fallback) |
| **APIMatic** | Generates the **Stood SDK** Yard consumes (proving "Yard is just a caller"), plus a **Yard SDK / MCP** so other agents can post and claim work orders | ★★ |
| **Postman** | A public workspace for Yard's API + A2A calls. Fixture replays for judges | ★ |
| **Zapier** | Notifications: "Your work order was paid", "Handover is ready" | ★ |
| **Channel3** | No honest job in Yard (it's a product catalog). **Not used** | — |

The non-partner, open-source core:

- **LangGraph** (Foreman in JS, Crew in Python) and **LangChain** tool wrappers
- **vLLM** model serving
- open-weight coding models on **Vast.ai**
- a **GitHub App**
- Postgres
