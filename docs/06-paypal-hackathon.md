# 06: PayPal AI Hackathon (verified rules)

Source: [paypalaihackathon.devpost.com](https://paypalaihackathon.devpost.com/), checked 2026-10-03.

## Facts

- **Deadline:** 12 Nov 2026, 2:00 pm PT. [U, confirmed]
- **Eligibility:** all countries (standard exceptions apply), over the age of majority.
- **Hard requirement:** *meaningfully* use both the **PayPal developer platform (sandbox)** and **an AI tool, model, or platform**.
- **Submission:**
  - Text description.
  - **A working demo judges can actually use** (hosted URL or setup instructions).
  - **A public GitHub repo with an open-source licence file.**
  - **A demo video under 3 minutes, on YouTube.**
  - A list of the tools used and how.

## Official brief, summarised [U, Devpost 2026-10-03]

- **The challenge:** "what happens when you put AI behind the wheel": new agents, new ways to pay and get paid, tools nobody's built yet. A global online hackathon with no tracks and no set problem statements.
- **Only hard requirement:** *meaningfully* use **both PayPal and AI**. Partner tools are optional: "any AI tool works, as long as **PayPal integration is central** to the project."
- **The project should:**
  1. meaningfully integrate ≥1 PayPal technology, API, SDK, product or capability
  2. meaningfully incorporate AI
  3. be a working prototype or proof of concept
  4. be documented well enough for judges
  5. comply with the Official Rules
- **Existing projects allowed** if there's *meaningful progress during the hackathon*. Building Stood alongside [EyeOnSite](https://github.com/ma-za-kpe/eyeonsite) is fine. Keep dated commits to show progress.
- **Individual or team.**

### What to submit (official)

1. **Project** meeting the requirements.
2. **Text description** of features and functionality.
3. **Functional demo:** judges must actually run or interact with it, through **either** complete setup and run instructions **or** a hosted URL. *Mock-ups, static prototypes and non-functional demos don't qualify.*
4. **Tools:** name each tool **and explain how it was used**.
5. **Public GitHub repo:** all source, assets and instructions. **Public, open source, licence file visible at the top of the repo (the About section).**
6. **Demo video:** **under 3 minutes** (judges needn't watch past that), **shows the project functioning on the device it was built for**, **public on YouTube**, link on the form, **no third-party trademarks or copyrighted music or material without permission**.

Judges: see [12-judges.md](12-judges.md). Final cross-check: see [13-submission-checklist.md](13-submission-checklist.md).

## Judging criteria

> **Audit [C]: corrected.** [U] said "four criteria, equally weighted: tech, complete product, real problem, novelty". The Devpost page lists **five criteria with no weights stated**:
| Criterion | Official question |
|---|---|
| **Technological Implementation** | How thoroughly and skilfully does the project use the PayPal Developer Platform and AI tool(s)? Genuine effort, a working, non-trivial implementation? |
| **Design** | Does it deliver a complete, coherent product experience, not just a technical proof of concept? |
| **Potential Impact** | A credible, specific case for solving a real problem for a real audience, and does what's demonstrated actually address it? |
| **Innovation / Idea** | How creative and novel, and how different from existing concepts? |
| **Presentation** | Does the video clearly show it working end to end? Does the pitch say what problem is solved, who it's for, and why it matters? Is it easy to follow? |

Design and Presentation are separate criteria. Together with the **Best Demo Delivery** prize, that means video and UX quality count for a lot.

## Dates [U, official announcement]

Submissions open **1 Oct 2026**, close **12 Nov 2026** (a 6-week window). Winners announced **21 Dec 2026**.

## Webinars (official, Pacific Time) [U]

| Date | Time (PT) | UK time (BST, UTC+1) | Session | Why it matters for Stood |
|---|---|---|---|---|
| Tue 6 Oct | 9:00–9:45 am | 5:00–5:45 pm | Start building with PayPal | Sandbox setup, Orders v2 basics |
| Wed 7 Oct | 9:00–9:30 am | 5:00–5:30 pm | **Power your PayPal hackathon project with APIMatic Context Plugins** | Our build-time PayPal grounding ([S13](stood/S13-sponsor-integration.md)). Ameer Hassan (APIMatic) is a judge |
| Mon 12 Oct | **7:00–7:45 am** | 3:00–3:45 pm | **Build a payments dashboard without building a dashboard** (AG Studio × PayPal) | Our Reviewer file and reconciliation. Presenters include two judges (Eddie Jaoude, Sylwia Vargas) |
| Tue 13 Oct | 1:00–2:00 am | 9:00–10:00 am | Start building with PayPal (repeat, for other timezones) | Backup slot |

> ✏️ Correction [C]: the Teams listing showed "2:00 PM" for the 12 Oct session. The official time is **7:00 am PT**, so the listing time was UTC. Ghana (GMT): 2:00 pm.

Workshop notes: AG Grid and Bryntum are one group ("AG Grid × Bryntum"). APIMatic's Context Plugin install and usage notes are in [S13](stood/S13-sponsor-integration.md).

## Prizes ($69,750 total; $67,500+ cash) [U, official Devpost]

| Prize | Amount |
|---|---|
| Best Overall 1st / 2nd / 3rd | $12K / $8K / $5K |
| Honourable mentions ($5K each) | Most Creative, Most Impactful, **Best Demo Delivery**, Best Use of PayPal + AI, **Best Use of Agentic Commerce** |
| Best Use of **AG Grid** (AG Grid's blog calls it **Best Use of AG Studio**) | 1st $5K, 2nd $2K, 3rd ×3 $1K |
| Best Use of **APIMatic** | ×3 $1K **plus 6 months of APIMatic business subscription** |
| Best Use of **Bryntum** | ×3 $1K |
| Best Use of **Channel3** | $1.5K |
| Best Use of **Render** | $1K / $750 / $500 in Render credits |

**Partners [U, official list]:** AG Grid, APIMatic, Astropods, Bryntum, Channel3, Elastic, Kernel, Postman, Render, **Zapier**. Prize lines exist only for AG Grid / AG Studio, APIMatic, Bryntum, Channel3 and Render. The rest offer credits and support. Descriptions: APIMatic (Context Plugin for PayPal), Render (Workflows), Kernel (cloud browsers for agents), Channel3 (100M+ product catalog), Postman, Astropods (agent infrastructure), Elastic (hybrid / vector search), AG Grid (AG Studio dashboards plus an AI assistant), Bryntum (Gantt / Scheduler / Calendar / Grid), Zapier (MCP to 9,000+ apps).

**Sponsor strategy:** **use all ten partners**, each with one honest job, built in three tiers: see [S13](stood/S13-sponsor-integration.md), plus the open-source lesson in [S14](stood/S14-open-source-plan.md).

## Competitors already building [C, new]

Public repos already tagged for this hackathon:

- **Mandat** (`blanco1er/mandat`): an agent with a budget that you sign a **PayPal mandate** for once (Vault v3 setup and payment tokens). It holds deposits as **authorisations** (Orders v2), captures on merchant confirmation, issues invoices through the Agent Toolkit, and uses Channel3, AG Grid and Bryntum. **Deployed and well along.**
- **subscription-killer:** finds and cancels forgotten subscriptions.
- **Pr1meGG/paypal-ai-hackathon:** payment-aware agents for RTO (return-to-origin) reduction and lead conversion.
- **paypal-a2a-commerce** (`adamm285-dev`): agent-to-agent commerce for solo tradespeople with PayPal Subscriptions and **AG Studio v3**. A direct AG Studio competitor.
- **callcheck** (`jo2980958-hub/callcheck`): predicts what a PayPal call will do, then runs it in sandbox. It's aiming at **Best Use of APIMatic**.

**Implication:** "an agent that shops within a mandate or budget" is **already taken, and taken well**. Idea #1 from the original list ("mandate receipt") is crowded. **Stood** is different: Mandat controls *how much the buyer's agent may spend*. Stood controls *whether a payment may move at all*, based on **evidence that the work happened**. If judges compare the two, Stood's answer to "Mandat already has mandates" is: a mandate proves who approved, Stood proves what was delivered.

## PayPal building blocks relevant to us [U + C]

- **Orders v2:** create, then **authorise, then capture later**. Authorise-and-hold, with capture on confirmed delivery, *is* an escrow-like primitive. That's key for graduated trust.
- **Vault v3:** reusable payment tokens (a mandate stand-in).
- **Invoicing v2**, **Payouts**, **Transaction Search / reporting** (a source for seller history).
- **PayPal Agent Toolkit / MCP server:** exposes orders, invoices, subscriptions and refunds to agents.
- **AP2 mandates** (intent, cart, payment). PayPal supports the model. Implement it as a *record format* alongside sandbox orders, not as a live PayPal API.
- **Not available in sandbox:** PayPal World wallet interoperability, M-Pesa or Flutterwave payouts. These can only be *shown* as a payout instruction, not executed.
