# S12: Hackathon plan [C]

Deadline **12 Nov 2026, 2 pm PT**. Winners announced **21 Dec 2026**. Today is 3 Oct: about **5.5 weeks**.

## Judging criteria → how Stood scores

| Criterion | Stood's answer | Risk |
|---|---|---|
| Technological implementation | Real Orders v2 authorise / capture / void, Vault, webhooks. A vision model plus a rules engine. Durable workflow | Sandbox Vault / dispute limits ([S10](S10-sandbox-limits-and-open-questions.md)) |
| Design | A distinctive paper-and-stamp system ([S07](S07-brand-and-design-tokens.md)). Nothing like the usual fintech gradient | Must still feel finished, not "concept" |
| Potential impact | $95–100B diaspora corridor, the Paga story, a reusable API (lenders / NGOs / insurers / farm inputs) | Judges must believe the AI checks work |
| Innovation | "Pay on proof": the agent spends against **evidence**, not a cart. AP2-style intent bound to evidence (answers the Whisper-attack gap) | Explain in one sentence |
| Presentation | The 90-second script ([S09](S09-demo-script.md)). Real Accra footage | Recording quality |

**Category targets:** Most Impactful, Best Use of Agentic Commerce, Best Use of PayPal + AI. Also Best Demo Delivery.

## Sponsor strategy

**Superseded:** the user decided to **use all ten partners** (2026-10-03), built in three tiers. The full map is in **[S13: sponsor integration](S13-sponsor-integration.md)** and the open-source lesson in **[S14](S14-open-source-plan.md)**.

These principles from the earlier version still hold:
- The video opens on the refusal. Sponsors appear as the file you open after the money stays.
- Runtime LLMs never improvise money calls. Assistants (AG Studio, Bryntum chat) read and arrange, they don't decide.
- Each sponsor's docs page says what we *refused* to use it for.

## Six-week plan

| Week | Dates | Goal | Exit check |
|---|---|---|---|
| 1 | 3–9 Oct | **Webinars: 6 Oct (PayPal), 7 Oct (APIMatic Context Plugins), both 9 am PT.**  Sandbox spikes: Vault + AUTHORIZE + capture / void + metadata + disputes. Install every MCP / plugin (S14). Kernel: automate sandbox buyer approval (Tier 1). Email APIMatic for MCP-gen access. Channel3 image-search test. Read official rules. Collect 50 real site photos | Q1, Q9, Q12, Q13 answered |
| 2 | 10–16 Oct | **Attend the AG Studio × PayPal workshop (12 Oct, 7 am PT / 2 pm Ghana).** Allowance + dispatch + package intake + rules (plot, reused, missing). Deployed on Render from day one | Refuse works end to end in sandbox |
| 3 | 17–23 Oct | Vision checks (nonce, stage, re-capture). Release path. Receipt | All three outcomes work with fixtures |
| 4 | 24–30 Oct | Reviewer file in AG Studio (two data sources plus reconciliation), Bryntum Gantt + AI chat, Channel3 spec check, dispute packet, Stood OpenAPI → APIMatic SDK / MCP | Feature-complete |
| 5 | 31 Oct–6 Nov | Design polish against S07, greyscale test, copy pass against S06. **Film in Accra.** Publish the Postman fixture collection. Write the six `docs/sponsors/*.md` pages and record the short sponsor clips | Video draft |
| 6 | 7–12 Nov | Final video (<3 min, YouTube), README, licence, hosted URL, submission text. **Submit by 11 Nov** (one day of buffer) | Submitted |
