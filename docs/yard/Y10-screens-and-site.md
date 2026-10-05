# Y10: Screens and the Yard page

## A. The Yard page on the site (`/yard/`)

The same GitHub Pages site as Stood. **Stood's nav gets a "Yard →" link.** Yard's page has its own design system ([Y09](Y09-brand-and-design-system.md)), and a "← Stood" link back.

| Section | Content |
|---|---|
| **Hero** | Eyebrow: "Yard · builds with Stood". H1: **"Describe it. Sign it once. Get it built."** The lede comes from Y01. CTAs: "See a blueprint" · "How the Board works". Visual: an animated blueprint where milestones ink in |
| **The three touches** | Describe → Sign → Hand over. Big numbered signage, each with a 1-line sentence |
| **Watch a blueprint draw** | An interactive demo: pick an idea (bookings app / invoice tool / waitlist), and the Foreman "draws" 3–4 milestones with plain-language tests and a budget. A fixture, with a clear "simulation" label |
| **The Board** | A live-looking board (fixtures): columns **Posted · Clocked in · Checking · Paid · Rework**. Cards slide between columns. One card shows a punch list |
| **Who builds** | Human builders and Crew agents, side by side: "Same Board. Same tests. Same gate." The Crew is marked **"in development"** |
| **Agents paying agents** | A diagram: buyer agent → Yard (A2A) → crew-7 → test-agent-2, money via Stood → PayPal. Plus the anti-pyramid line |
| **Yard builds. Stood pays.** | The family lockup, plus a link to Stood |
| **Footer** | Honest status (Foreman / Board in development, Crew last) |

## B. App screens (product, later than the page)

| # | Screen | Who | Notes |
|---|---|---|---|
| 1 | **Describe** | Buyer | One big input ("What are we building?"), with optional voice later. Example chips. Starts the **9-step intake** ([Y19](Y19-intake-form.md)) |
| 1b | **Intake** | Buyer | Steps 2–8 of Y19 (users, features, data, stack, integrations, budget, ownership). Autosaves. "Let the Foreman decide" on every step |
| 2 | **Questions** | Buyer | Up to 3 Foreman questions, answered inline |
| 3 | **Blueprint** | Buyer | **Bryntum Gantt** of milestones (dependencies, deadlines, budgets). Each milestone expands into plain-language tests plus "view test code". Edit / merge / split / reprice. Foreman notes on risk |
| 4 | **Sign** | Buyer | A summary (cap, milestones, 60 days) → Stood allowance → the PayPal window. Return → "Signed. Posting to the Board." |
| 5 | **Project room** | Buyer | Milestone cards with live status (held / building / checking / paid / punch list). Stood verdict chips. Repo link, **preview URL per milestone**, the connection pill. Real-time rules: [Y18](Y18-realtime-state-management.md) |
| 5b | **Keys** | Buyer | Y19 step 9: per-milestone test credentials, connect / OIDC buttons, write-only secret fields |
| 6 | **Handover** | Buyer | **Deploy to Render** (or the OIDC workflow) into the buyer's own account, a deployed-URL check, the signed flow checklist, the release button, then the **rotation checklist** ([Y20](Y20-hosting-and-credentials-decision.md) §5) |
| 7 | **The Board** | Builders | Filter by stack, budget, deadline. Work-order cards with budget dimension lines. Clock-in button |
| 8 | **Work order** | Builder | Goal, scope, signed tests (read-only), dependency allowlist, lease timer (hazard bar), submit-SHA, punch list |
| 9 | **Site log** | Everyone | Streaming log for Crew work orders (commits, test runs, decisions) |
| 10 | **Operator dashboard** | Operator | **AG Studio**: Crew earnings, GPU minutes, pass rate, abandon rate (later) |

All screens show Stood decisions with **Stood's chip**, never a Yard-styled imitation.

## Connected mock screens

The React shell now has a project-room foundation and a Board foundation, exercised against the isolated Docker services. Public posted-work cards load continuation pages, filter the loaded results and show a pending clock-in command. A matching acknowledgement triggers a new scoped room fetch; it is never payment proof. Operator changes clear private cached rooms. A browser regression confirms denied access before claiming and a lease-only room after claiming, without a Stood money stamp.

The complete work-order screen, signed-test viewer, commit submission, punch lists, previews and handover remain unfinished. The Board's current filter is local to loaded pages; it is not server-side search. These screens use simulated providers and synthetic terms, with no real payment.
