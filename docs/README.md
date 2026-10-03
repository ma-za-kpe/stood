# Stood: project docs

> **Money does not move until someone stood there.**

**Status:** research and design. No code yet.
**Last updated:** 2026-10-03
**Target:** PayPal AI Hackathon. Submissions close **12 Nov 2026, 2:00 pm PT**. Winners announced 21 Dec 2026.

## Where the thinking is now

This started as "use a pyramid scheme to ignite a real agentic economy". Research showed that a pyramid can't be the seed. Its harms are how it works. What survived is the test it fails: **money should move only for something actually delivered, to someone outside the payer's recruitment tree.** The PayPal AI Hackathon, PayPal's stalled push into Africa (the Paga holds), and the user's existing project **[EyeOnSite](https://github.com/ma-za-kpe/eyeonsite)** turned that test into a product.

**Stood** is a release gate that platforms call before a staged payment leaves. A payer abroad signs what "done" means. An inspector's evidence is checked. Stood **releases** (PayPal capture), **refuses** (void, with a named reason), or **waits** (a human reviews), and every decision leaves a file a dispute can use.

**Start here:** [09: Stood overview](09-stood.md), then [S12: hackathon plan](stood/S12-hackathon-plan.md).

## Stood product docs (`stood/`)

| # | Doc |
|---|---|
| S01 | [Problem statement](stood/S01-problem-statement.md) |
| S02 | [Product boundary](stood/S02-product-boundary.md) |
| S03 | [Personas](stood/S03-personas.md) |
| S04 | [Job story and the three outcomes](stood/S04-job-story-and-outcomes.md) |
| S05 | [Feature list](stood/S05-feature-list.md) |
| S06 | [Voice and states](stood/S06-voice-and-states.md) |
| S07 | [Brand and design tokens](stood/S07-brand-and-design-tokens.md) |
| S08 | [Screens](stood/S08-screens.md) |
| S09 | [Demo script](stood/S09-demo-script.md) |
| S10 | [Sandbox limits and open questions](stood/S10-sandbox-limits-and-open-questions.md) |
| S11 | [Evidence integrity](stood/S11-evidence-integrity.md) |
| S12 | [Hackathon plan](stood/S12-hackathon-plan.md) |
| S13 | [Partner integration map: all ten partners + PayPal, build-time MCPs, run-time jobs, build tiers](stood/S13-sponsor-integration.md) |
| S14 | [Open-source plan: "how we used every tool"](stood/S14-open-source-plan.md) |
| S15 | [Design system: themes (Paper / Ledger / Field), tokens, type, components, logo, web / iOS / Android / social assets](stood/S15-design-system.md) |

Brand assets (SVG): [`brand/`](brand/): logo, app icons, social, stamps.

## Technical docs (`tech/`)

Requirements, architecture, domain model, API, data, PayPal integration, evidence pipeline, **[EyeOnSite](https://github.com/ma-za-kpe/eyeonsite) integration**, stack, **deployment (free tier)**, security, testing, runbooks, milestones: **[tech/README.md](tech/README.md)**.

## Research docs

| # | Doc | What it covers |
|---|-----|----------------|
| 01 | [Vision and phases](01-vision-and-phases.md) | The original agent-economy idea, the critique, revised phases |
| 02 | [Pyramid schemes and ignition](02-pyramid-schemes-and-ignition.md) | Definition, the Koscot "ultimate user" test, what can be salvaged |
| 03 | [How agents make money today](03-how-agents-make-money-today.md) | Audited inventory, as of 2026 |
| 04 | [External income sources](04-external-income-sources.md) | Stock market and other faucets, ranked |
| 05 | [Simulation design](05-simulation-design.md) | Two-ledger rule and metrics. Now the test harness |
| 06 | [PayPal AI Hackathon](06-paypal-hackathon.md) | Rules, prizes, criteria, competitors |
| 07 | [PayPal landscape](07-paypal-landscape.md) | Company, Muse, standards, competitors, geography, fraud |
| 08 | [Idea bank](08-idea-bank.md) | All 26 ideas, scored |
| 09 | [Stood overview](09-stood.md) | Vision, money model, where the AI is |
| 10 | [Risks and open questions](10-risks-and-open-questions.md) | Project-level risks |
| 11 | [Africa payments and EyeOnSite](11-africa-payments-and-eyeonsite.md) | Paga, Xoom, Paystack, Ghana, [EyeOnSite](https://github.com/ma-za-kpe/eyeonsite) |
| 12 | [Judges](12-judges.md) | All 13 judges, LinkedIn / X, what each will notice |
| 13 | [Submission checklist](13-submission-checklist.md) | **Final cross-check** against the official brief |
| — | [Audit log](audit-log.md) | Every claim checked: confirmed, corrected, flagged |
| — | [Sources](sources.md) | Links |

## How we work

- [Ways of working](WAYS_OF_WORKING.md): TDD, DDD, OOP, trunk-based branches, Conventional Commits, release-please, pre-commit, Definition of Done
- [Architecture decisions (ADRs)](adr/)
- [Task ledger](../TASKS.md)

## Provenance legend

- **[U]**: from the user's pasted research.
- **[C]**: added by Claude (independent research, verification, or new reasoning).

## Working agreement

The user adds research. Claude researches alongside it, audits it, and updates these docs. When the user says **"done"**, Claude does a full consolidation pass.
