# Audit log

> Historical framing (before the 5 Oct 2026 repositioning). See [S17](stood/S17-agent-payments-positioning.md).

Claims from the pasted research, checked against sources on **2026-10-03**.
✅ confirmed · ✏️ corrected · ⚠️ flagged (unverified, or a design problem) · ➕ new finding

## Agent economy

| | Claim | Result |
|---|---|---|
| ✏️ | Cursor about $2B ARR early 2026 | True for Feb. **$4B+ by June 2026** |
| ✏️ | Giza ARMA "tens of millions in first weeks" | **About $930K deployed / $5.4M volume in 4 weeks.** ARMA was **retired** by Mar 2026 |
| ✅ | Agent given a budget and target made $0 | Automaton Agency, July 2026 |
| ✅ | Virtuals: tens of millions cumulative revenue | About $39.5M. ➕ Its aGDP is partly **subsidised** (Revenue Network, up to $1M/month) |
| ⚠️ | Felix Craft "low-to-mid six figures" | About $125K all-time by Mar 2026, **$50K of it from its own token**. A human founder approves major moves. "$300K/month" claims are unverified |
| ✅ | x402: tens of millions of small payments | 165M transactions / about $50M by Apr 2026. ➕ **About half of early activity was testing or bot farming** |
| ✅ | Congress asked SEC about agentic trading, mid-2026 | 23 Jun 2026, Foster and Sherman, 13 questions |
| ➕ | Polystrat | About 37% of agents profitable, so **about 63% lose**. Supports the zero-sum argument |
| ➕ | — | Magentic Marketplace, DeepMind *Virtual Agent Economies*, Project Vend phase 2 added as prior art |

## Pyramid / legal

| | Claim | Result |
|---|---|---|
| ➕ | — | Koscot test: "rewards unrelated to sale of product to **ultimate users**". This became the core design rule |
| ✏️ | Pyramid collapse is "the least informative" mode | Reframed: it's the **calibration control** for the detectors |

## Hackathon

| | Claim | Result |
|---|---|---|
| ✅ | Deadline 12 Nov 2026 | 2:00 pm PT |
| ✏️ | "Four criteria, equally weighted" | **Five criteria** (Tech, **Design**, Impact, Innovation, **Presentation**). **No weights published** |
| ✏️ | Prize list | Missing from the pasted list: **Best Demo Delivery** and sponsor prizes. Now complete in [06](06-paypal-hackathon.md) |
| ➕ | — | **Competitors already shipping:** Mandat (mandate and budget agent, deployed), callcheck (APIMatic), and others |
| ⚠️ | "Show an agent correcting a failed capture from APIMatic context" | **Rejected.** A build-time tool used at runtime, with an LLM improvising money calls ([S12](stood/S12-hackathon-plan.md)) |

## Sponsors (round 2: "use all of them")

| | Claim | Result |
|---|---|---|
| ✏️ | "Best Use of AG Grid" | AG Grid's own post calls it **Best Use of AG Studio**. The Reviewer file must be an AG Studio dashboard |
| ✅ | Bryntum's brief suggests "a calendar that locks a slot until payment clears" | Confirmed. Also "late payments block workflow phases", which is Stood exactly |
| ⚠️ | "Refuse the tranche if the builder's material price is far from a Channel3 offer" | **Rejected.** Channel3 doesn't support Ghana, Nigeria or Kenya locales, so it would refuse honest builders. Replaced by a fixtures **spec check** (image search → WAIT, never refuse) |
| ✅ | Every sponsor has an agent surface | PayPal Toolkit MCP, APIMatic Context Plugin (skills), ag-mcp + AG Studio agent framework, Bryntum MCP + skills + AI chat, Channel3 MCP, Render MCP |
| ➕ | — | PayPal Agent Toolkit has **no authorise or void tools**, so the money path uses the Server SDK. It also has no human-confirmation gate, and **Stood is that gate** |
| ➕ | — | APIMatic can **generate an MCP server** from Stood's OpenAPI (alpha, by request) |
| ➕ | — | The Context Plugin is a **hackathon preview**, so pin the commit. APIMatic's claimed results: 37% better token efficiency, 83% integration success, about 70% fewer security issues |
| ➕ | — | AG Studio × PayPal workshop, 12 Oct. The PayPal Transaction Search limits (31-day range, page size 500, 10k records, up to 3h lag) shape the dashboard |
| ➕ | — | AG Grid AI Toolkit is **Enterprise-only**. Licensing of commercial components in a public repo is an open question |

## Partners (round 3: "use all ten")

| | Claim | Result |
|---|---|---|
| ✅ | Ten partners: AG Grid, APIMatic, Astropods, Bryntum, Channel3, Elastic, Kernel, Postman, Render, Zapier | Confirmed by PayPal's hackathon blog. **Only five have prize lines** |
| ➕ | — | Every one has an agent surface: Zapier MCP (9k+ apps), Elastic Agent Builder MCP, Postman MCP server and generator, Kernel browser API (Playwright, computer use, live view), Astropods declarative agent spec + Claude plugin |
| ➕ | — | Astropods gives an **infrastructure-level** answer to prompt injection: the evidence agent has no PayPal credentials |
| ➕ | — | Kernel solves a real sandbox gap: buyer approval needs a browser |
| ⚠️ | — | Ten partners in 5.5 weeks is a real risk to finishing. Mitigated by build tiers and a week-3 cut rule ([S13](stood/S13-sponsor-integration.md)) |

## Official brief (round 4)

| | Claim | Result |
|---|---|---|
| ✏️ | 12 Oct AG Studio workshop at "2:00 PM" | Official: **7:00–7:45 am PT** (14:00 UTC / 15:00 BST / 14:00 Ghana) |
| ✏️ | Total prizes "$60,000+" | Devpost: **$69,750 total**. APIMatic winners also get **6 months of a business subscription** |
| ➕ | — | Video must show the project **on the device it was built for** and contain **no third-party trademarks or copyrighted material without permission**. Licence must be visible in the repo's About section |
| ➕ | — | 13 judges. **Elastic and Postman have judges but no prize lines.** Kernel, Astropods and Zapier have neither |
| ⚠️ | Judge links | Karthik Ravi (two candidate profiles), Himraj Singh (possibly left PayPal), Marco Podien (possible role change), Nathaniel Olson (probable match). See [12](12-judges.md) |

## Brand (round 5)

| | Claim | Result |
|---|---|---|
| ⚠️ ➕ | Logo "pin cut by a horizontal rule" | When rendered, it reads as the **♀ Venus symbol**. Redrawn: the stem stands **on** the rule, which is offset right |
| ✏️ | Refuse = stamp "struck through" | Striking through the word hurt legibility. Now a red rule **under** the word |
| ✅ | Full token set | All text pairs AA in Paper and Ledger. A third theme, **Field** (pure white / black), added for Kojo in sunlight |

## PayPal

| | Claim | Result |
|---|---|---|
| ✅ | Chriss out, Lores in | Board acted 2 Feb. Lores CEO from 1 Mar 2026 |
| ✅ | Three-unit reorganisation in April | 29 Apr 2026. ➕ $1.5B savings target |
| ✅ | Cymbio acquired | Announced 22 Jan, closed 5 Feb 2026 |
| ✅ | Muse: Link 8 Sept, Shop Pay 21 Sept, PayPal 22 Sept | Confirmed. ➕ **Amazon blocked Muse on 20–21 Sept** |
| ✅ | Six banks' report on 22 Sept | ASB, BofA, Capital One, CommBank, ING, NatWest |
| ✅ | AP2 under FIDO Alliance | Donated, announced 28 Apr 2026. v0.2 adds human-not-present |
| ➕ | — | **Whisper attacks** on AP2 (arXiv 2609.11757): valid signatures, wrong decisions |
| ✅ | Agent Ready / Store Sync | Live. ➕ Store Sync is Cymbio-based |
| ⚠️ | 57% crawl share, 36M business accounts, Southwest $250M refunds, volume mix | Single-source [U]. Not re-verified |

## Africa / Stood design

| | Claim | Result |
|---|---|---|
| ✅ | Paga link 27 Jan 2026, receive-only | Confirmed |
| ⚠️ | "21-day holds", "Checkout off on Paga's help page" | Holds, closures and linking failures confirmed by reporting. **The exact 21 days and the help-page wording weren't seen directly.** Say "held for weeks" |
| ✅ | Xoom → Nigeria via Flutterwave, July 2026 | 13 Jul 2026 |
| ⚠️ | "Bangladesh built a freelancer ID because PayPal verification was the bottleneck" | The ID exists (Jan 2026) but its aim is broader. PayPal isn't available in Bangladesh |
| ⚠️ ➕ | "Capture a PayPal payout to the inspector" | **Ghana PayPal accounts can't receive.** Redesigned: Kojo is paid on a local rail |
| ⚠️ ➕ | "Escrow in PayPal" | **The AUP requires pre-approval for escrow.** Authorisations last 29 days, delayed disbursement 28 days. Redesigned as **authorise on dispatch, capture on proof** |
| ⚠️ ➕ | "GPS match + EXIF + photo hash" as proof | All trivially faked on their own. Defences added in [S11](stood/S11-evidence-integrity.md) |
| ➕ | Brand colours | **Stamp red and pass green have identical luminance (1.01:1)**, so they can't be told apart by colour-blind users or in greyscale. Words and shapes are now required ([S07](stood/S07-brand-and-design-tokens.md)) |
