# Y09: Brand and design system, "Hi-vis Blueprint"

> The full system (tokens, components with their live states, motion tokens, the asset kit) is in [Y17](Y17-design-system.md). Assets: [`docs/brand/yard/`](../brand/yard/).

Yard is a **different character** from Stood, but the same family. **Stood is the clerk at night. Yard is the yard at work:** blueprint navy, a drafting grid, hi-vis signals, steel, and things being *built*.

## Brand architecture

| | Stood | Yard |
|---|---|---|
| Mark | A pin **standing on** a ground line | A crane-**Y** **standing on** the same ground line |
| Accent line | Volt (lime) | Hi-vis (amber) |
| Canvas | Night violet `#0D0A1E` | Blueprint navy `#071A33` |
| Display type | Bricolage Grotesque | **Big Shoulders Display** (industrial signage) |
| Mood | Verdicts, certainty | Construction, momentum |

Both marks stand on a ground line. That's the family signature. **When Yard shows a Stood verdict, it uses Stood's own chip** (labelled "Stood"), so users always know who decided the money.

## Colour

| Token | Hex | Use |
|---|---|---|
| `navy` | `#071A33` | Canvas |
| `navy-2` | `#0C2547` | Surfaces, cards |
| `grid` | `#16355F` | Blueprint grid lines, dividers |
| `blueprint` | `#3FD0FF` | Primary accent: lines, links, active states, the Foreman |
| `hivis` | `#FFB000` | Primary CTA, "in progress", leases, the ground line of the mark |
| `weld` | `#7CF5C4` | Done / paid (in Yard's own UI) |
| `rebar` | `#FF6B3D` | Punch-list items, blockers |
| `steel` | `#8FA3BF` | Muted text |
| `chalk` | `#F4F8FC` | Text on navy |
| `paper` | `#EEF4FA` | Light surfaces (blueprint print) |
| `*-ink` | blueprint `#0B5C8A` · hivis `#7A4A00` · steel `#4A5B73` | Colour **as text** on paper |

**Measured contrast on navy:**

- chalk 16.3
- weld 13.1
- blueprint 9.7
- hivis 9.5
- steel 6.8
- rebar 6.2

All AA or better.

**Measured contrast of the inks on paper:**

- blueprint-ink 6.5
- hivis-ink 6.8
- steel-ink 6.3

**Never use** blueprint, hivis or weld *as text* on paper (all 1.2–1.7:1). Every status carries an **icon and a word**, never colour alone (inherited from Stood).

## Type

| Role | Font (OFL) | Notes |
|---|---|---|
| Display / signage | **Big Shoulders Display** 800, uppercase for labels, sentence case for headlines | Industrial and condensed: yard signage |
| Body / UI | **IBM Plex Sans** | Engineering heritage, very legible |
| Data / logs / ids | **IBM Plex Mono** | Site logs, SHAs, work-order ids |

## Logo

- **The mark:** a **crane shaped like a Y**. The mast is the stem, the jib and counter-jib are the arms, and a small block hangs from the jib (the milestone being lifted). It stands on the hi-vis ground line, the same 64-grid and line weight as Stood's pin.
- **The wordmark:** `YARD` in Big Shoulders Display 800, uppercase, with tracking +2%.
- **Lockup:** "Yard builds. Stood pays." with both marks side by side on one shared ground line (the brand-architecture lockup).
- **Don't:** use hammers, wrenches, emoji hard hats, or robot faces.

## Texture and pattern

- **A blueprint grid** (48px major / 12px minor lines in `grid`) behind the hero and the Board.
- **Hazard tape** (`hivis` / `navy` diagonal stripes) **only** for in-progress bars and active leases. It animates slowly. It means "work happening", never "danger".
- **Dimension lines** (thin blueprint lines with end ticks) to annotate amounts and deadlines on cards.

## Motion: "things get built"

| Moment | Motion |
|---|---|
| Intro (once per session) | The grid draws in. The crane-Y rises. A block is lowered onto the ground line |
| Blueprint generation | Milestones are **drafted** as dashed outlines, then "inked" solid as the Foreman finishes each one |
| Posting to the Board | Work-order cards **slide onto** the board like magnet cards |
| Clock in | A hi-vis "CLOCKED IN" stamp, and the hazard-tape progress bar starts |
| Site log | Monospace lines stream in (typewriter, respecting reduced motion) |
| Paid | Stood's verdict chip lands (Stood's motion), then the card moves to the "Paid" column |
| Punch list | Items drop in as a checklist. The card returns to "Rework" |

`prefers-reduced-motion` means no intro, no stripes, no streaming. Content is visible without JS (the same rules as Stood).

## Voice: the Foreman

Direct, warm and competent. Short sentences, construction words, no jargon about AI.

| Situation | Copy |
|---|---|
| Start | "What are we building?" |
| Clarify | "Three questions before I draw this up." |
| Blueprint ready | "Blueprint's ready: 4 milestones, $4,000, about 5 weeks. Read the tests. They're your contract." |
| Posted | "On the Board. You'll hear from me when a milestone's paid." |
| Clocked in | "crew-7 clocked in on Deposit payments. Money's held, not paid." |
| Punch list | "Not yet. 3 signed tests were skipped. Back to the crew." |
| Paid | "Milestone 2 paid. $1,200 released. Stood checked it." |
| Handover | "Your turn. Open the app, book a slot, then release the last payment." |

**Banned in Yard copy** (in addition to Stood's list): "magic", "instantly", "AI-powered", "10x". Yard ships work. It doesn't do hype.
