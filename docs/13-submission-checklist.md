# 13: Submission checklist (final cross-check)

Use this at the end, when we review everything against the official brief ([06](06-paypal-hackathon.md)). Tick each box only with **evidence** (a link, screenshot or commit). Target: **submit by 11 Nov**, one day before the 12 Nov 2:00 pm PT close.

## A. Eligibility and requirements (Devpost "Requirements")

- [ ] Uses the **PayPal developer platform in the sandbox**, and PayPal is **central** (the money path *is* PayPal: authorise / capture / void). Evidence:
- [ ] Integrates ≥1 PayPal technology, API, SDK, product or capability **meaningfully** (Orders v2, Vault, Disputes, Transaction Search, Agent Toolkit MCP, Server SDK). Evidence:
- [ ] Incorporates AI **meaningfully** (evidence agent: stage recognition, nonce reading, re-capture detection, spec check; AI assistants for the reviewer). Evidence:
- [ ] A working prototype (no mock-ups standing in for features). Evidence:
- [ ] Documented well enough for judges to understand it (README + docs/). Evidence:
- [ ] Complies with the **Official Rules** (read in full, including judge-contact and IP clauses). Date read:
- [ ] If any EyeOnSite code is reused: **meaningful progress during 1 Oct – 12 Nov** shown in dated commits. Evidence:

## B. What to submit

- [ ] **Text description:** features and functionality, the problem, who it's for, why it matters.
- [ ] **Functional demo:**
  - [ ] Hosted URL works, is warm (Postman monitor green), and needs no special access, **and/or**
  - [ ] Complete setup and run instructions that a fresh machine can follow (tested by someone else).
  - [ ] Judges can trigger **all three outcomes** themselves (fixtures, the "Replay as Ama" Kernel button, the Postman collection).
- [ ] **Tools section:** every tool named, and *how* it was used (PayPal, the AI model(s), each partner tool used, each MCP / plugin), linked to `docs/sponsors/*.md`.
- [ ] **Public GitHub repo:**
  - [ ] all source, assets and instructions
  - [ ] **open-source licence file at the root, visible in the About section**
  - [ ] no secrets committed (keys only in env; commercial packages not vendored)
- [ ] **Demo video:**
  - [ ] **under 3:00** (target 1:30)
  - [ ] **shows the project working on the device it was built for**: Kojo's capture on a real Android phone, Ama on a phone, reviewer on desktop
  - [ ] **public on YouTube**, link on the form
  - [ ] **no third-party trademarks or copyrighted music / material without permission**: no Paga, WhatsApp, Meta or other logos, royalty-free or original music, partner names as plain text unless their logo use is permitted
  - [ ] captions on

## C. Judging criteria self-score (1–5, with what a judge would see)

| Criterion | Our evidence | Score | Gap to fix |
|---|---|---|---|
| Technological Implementation | | | |
| Design | | | |
| Potential Impact | | | |
| Innovation / Idea | | | |
| Presentation | | | |

## D. Prize-specific checks

| Prize | What it needs | Evidence | ✓ |
|---|---|---|---|
| Best Use of PayPal + AI | PayPal central, AI meaningful, rules move money | | |
| Best Use of Agentic Commerce | An agent acting human-not-present under an allowance. The gate in front of agent payments | | |
| Most Impactful | The diaspora corridor, a real audience, demonstrated fix | | |
| Most Creative | "Pay on proof": the nonce, the gate | | |
| Best Demo Delivery | 90s story, refusal first, real Accra footage | | |
| Best Use of AG Grid / AG Studio | Reviewer file in **AG Studio**: two async data sources, reconciliation, AI assistant (read-only) | | |
| Best Use of APIMatic | Context Plugin in the workflow (before / after lesson). Stood SDK / MCP from OpenAPI | | |
| Best Use of Bryntum | Gantt of tranches locked until release. AI chat "why is X blocked?" | | |
| Best Use of Channel3 | Fixtures spec check (lookup + image search → WAIT). Honest about locale limits | | |
| Best Use of Render | Hosted demo, Workflows for durable holds, Render MCP in the dev loop | | |
| (No prize, but has a judge) Elastic | Image kNN evidence memory, hybrid reviewer search | | |
| (No prize, but has a judge) Postman | Public workspace, fixtures, monitors | | |

## E. Consistency sweep (docs ↔ build ↔ video)

- [ ] Every claim in the video and README exists in the build (no "coming soon" in the main flow).
- [ ] Local rail shown honestly as **labelled, not executed** (or a real test-mode call if built).
- [ ] Kojo is never paid on PayPal. The word "escrow" doesn't appear in user-facing copy.
- [ ] Every voice string matches [S06](stood/S06-voice-and-states.md). No "Something went wrong".
- [ ] Every screen passes the greyscale test ([S07](stood/S07-brand-and-design-tokens.md)).
- [ ] Every partner tool used has a `docs/sponsors/<tool>.md` page with the "refused uses" section.
- [ ] Every statistic in the description has a source in [sources.md](sources.md), and anything flagged ⚠️ in the [audit log](audit-log.md) is either verified or removed.
- [ ] Open questions in [S10](stood/S10-sandbox-limits-and-open-questions.md) are answered, or listed as known limitations in the README.

## F. After submitting

- [ ] Devpost page proofread. Video plays logged out.
- [ ] Hosted demo kept alive until winners are announced on **21 Dec 2026** (Render + Postman monitor).
- [ ] Repo tagged `v-hackathon-submission`.
