# Y17: Design system v1, "Hi-vis Blueprint"

**Status:** current (2026-10-05). Builds out the direction in [Y09](Y09-brand-and-design-system.md) into tokens, components and states. Asset files: [`docs/brand/yard/`](../brand/yard/). Every wordmark and label in the kit is **outlined** Big Shoulders Display 800, so the SVGs render with no font installed.

Stood's system is [S15 "Volt"](../stood/S15-design-system.md). The two systems share **rules**, not looks.

## 1. Direction

> **The yard at work.** Yard is where the thing gets built. It feels like a **live job site seen on a blueprint**: navy paper, a drafting grid, hi-vis signals for work in progress, and steel for everything quiet. Yard is the busiest screen in the family, so the system is built for **many things changing at once without shouting**.

| Is | Isn't |
|---|---|
| Condensed signage type, uppercase labels | Rounded "friendly AI" type, gradients, sparkles |
| A grid you can feel behind every surface | Flat empty dark mode |
| Hi-vis only where work is happening right now | Amber everywhere, used as decoration |
| Every state is a word + an icon + a colour | Colour-only status, spinners without words |
| Live, but calm: things slide, ink in, tick | Flashing, bouncing, toasts piling up |
| Stood's verdict in **Stood's** chip | A Yard-styled "Paid" that looks like Yard decided |

Rules inherited from Stood: **the screen never decides money**, status is never colour alone, amounts are never coloured to celebrate, content is readable without JS, and reduced motion is respected.

## 2. Colour

### Brand palette

| Token | Hex | Role |
|---|---|---|
| `--y-navy` | `#071A33` | Canvas (dark-first) |
| `--y-navy-2` | `#0C2547` | Cards, panels, inputs |
| `--y-grid` | `#16355F` | Grid lines, dividers, borders (decorative only: 1.4:1) |
| `--y-blueprint` | `#3FD0FF` | Primary accent: links, focus, the Foreman, selection |
| `--y-hivis` | `#FFB000` | Primary CTA, "work happening now", leases, the mark's ground line |
| `--y-weld` | `#7CF5C4` | Done in Yard's own terms (milestone merged, handover ready) |
| `--y-rebar` | `#FF6B3D` | Punch-list items, blockers, destructive actions |
| `--y-steel` | `#8FA3BF` | Secondary text, idle states |
| `--y-chalk` | `#F4F8FC` | Primary text on navy |
| `--y-paper` | `#EEF4FA` | Light canvas (the "blueprint print" theme, docs, PDFs) |
| `--y-blueprint-ink` / `--y-hivis-ink` / `--y-steel-ink` | `#0B5C8A` / `#7A4A00` / `#4A5B73` | Accent colours **as text** on paper |
| `--y-rebar-ink` | `#A8361A` | Rebar as text on paper |

### Semantic tokens

| Semantic | Dark (default) | Light (paper) |
|---|---|---|
| `--bg` | navy | paper |
| `--surface` | navy-2 | `#FFFFFF` |
| `--border` | grid | `#C9D6E6` |
| `--text` | chalk | navy |
| `--text-muted` | steel | steel-ink |
| `--accent` | blueprint | blueprint-ink |
| `--cta-bg` / `--cta-fg` | hivis / navy | hivis / navy |
| `--focus` | blueprint, 2px + 2px offset | blueprint-ink |
| `--live` | hivis | hivis-ink |
| `--done` | weld | `#1C7A55` (text) |
| `--blocker` | rebar | rebar-ink |

The light theme exists for printouts, the blueprint PDF export, and users who set `prefers-color-scheme: light`. The marketing page and the app default to dark.

### Measured contrast (WCAG 2.x, computed)

| Foreground | on navy | on navy-2 |
|---|---|---|
| chalk | 16.3 | 14.4 |
| weld | 13.0 | 11.5 |
| blueprint | 9.7 | 8.5 |
| hivis | 9.5 | 8.4 |
| steel | 6.8 | 6.0 |
| rebar | 6.2 | 5.4 |

- **Navy text on fills:** on hivis 9.5, on weld 13.0, on rebar 6.2, on blueprint 9.7. Every filled chip uses **navy** text.
- **On paper:** navy 15.7, blueprint-ink 6.5, hivis-ink 6.8, steel-ink 6.2, rebar-ink 5.9.
- **Never** as text on paper: blueprint, hivis, weld, steel (steel is 2.3:1).
- `grid` fails as text on purpose. It's decoration only and is never the only edge of an interactive control (inputs get a steel border too).

## 3. Typography

| Role | Font (OFL) | Size / line | Notes |
|---|---|---|---|
| Display XL (hero) | Big Shoulders Display 800 | `clamp(48px, 9vw, 112px)` / 0.92 | Uppercase, tracking +1% |
| Display L (section) | Big Shoulders Display 800 | `clamp(36px, 5vw, 64px)` / 0.95 | |
| Signage (labels, chips, column headers) | Big Shoulders Display 800 | 14–18px / 1 | Uppercase, tracking +4% |
| Title | IBM Plex Sans 600 | 20px / 1.3 | Card titles, milestone names |
| Body | IBM Plex Sans 400 | 16px / 1.55 | Never below 16px for reading text |
| Small | IBM Plex Sans 400 | 14px / 1.45 | Metadata |
| Data | IBM Plex Mono 400/500 | 13–14px / 1.5 | Site log, SHAs, work-order ids, amounts in tables |
| Amount (hero) | IBM Plex Mono 600 | 28–40px | `font-variant-numeric: tabular-nums` |

- Fonts load from Google Fonts with `display=swap`. The page must be readable on the system fallback (`Impact, "Arial Narrow", sans-serif` for display; `system-ui` for body; `ui-monospace` for data).
- **Big Shoulders is never used for sentences.** Headlines up to 8 words, labels up to 3.
- Amounts always use tabular numerals, so live-updating numbers don't jitter.

## 4. Shape, space, depth

| Token | Value |
|---|---|
| Spacing scale `--s-1…--s-8` | 4, 8, 12, 16, 24, 32, 48, 72px (multiples of the 12px blueprint minor grid line up at 24 and 48) |
| Radius | `--r-chip: 999px` · `--r-card: 10px` · `--r-input: 6px` · `--r-block: 2px` (crane blocks, progress segments) |
| Border | 1px `--border`. Active cards get a 2px left **hi-vis rail** |
| Depth | No drop shadows on navy. Elevation = a lighter surface + a border. Popovers get `0 12px 32px rgb(0 0 0 / .45)` |
| Grid texture | `patterns/blueprint-grid.svg`: 48px major, 12px minor, at 100% on hero and Board backgrounds, 40% elsewhere, **never** behind body text blocks |
| Max width | Reading 68ch. App shell 1440px. The Board is full-bleed |

## 5. Components

Each component lists the states it **must** design for. State is driven by the store in [Y18](Y18-realtime-state-management.md), never by local guesses.

| Component | Anatomy | States |
|---|---|---|
| **Button** | Signage label, optional icon. Primary = hivis fill, navy text. Secondary = blueprint outline. Danger = rebar outline | default, hover, focus-visible, pressed, disabled, **pending** (label stays, a 3-dot tick replaces the icon, no layout shift) |
| **Status chip** | Icon + uppercase word, pill. Kit in `chips/` | `POSTED` (blueprint outline) · `CLOCKED IN` (hivis fill) · `BUILDING` (hazard-tape border, animated) · `CHECKING` (steel outline) · `PUNCH LIST` (rebar fill) · `HANDOVER` (weld fill) · `STALE` (dashed steel, see Y18) |
| **Stood verdict chip** | **Imported from Stood's kit** (`docs/brand/logo/stamp-*.svg`), labelled "Stood" | released, refused, in review. Yard never restyles it |
| **Work-order card** | Id (mono), milestone name, status chip, budget with a **dimension line**, lease timer, builder avatar, last event time | posted, claimed, building, submitted, checking, paid, rework, lease-expired, abandoned, **optimistic** (dashed border while a command is in flight), **stale** |
| **Milestone row (blueprint)** | Index block, name, goal, test count, budget, deadline | drafting (dashed outline), inked (solid), edited (blueprint left rail), locked (after signing, padlock icon) |
| **Lease timer** | Hazard bar + remaining time (mono) | running, < 2h (rebar text), expired |
| **Progress rail** | Segmented: one block per milestone | empty, held (hivis outline), building (hazard fill), paid (weld fill + Stood chip on hover), refused attempt (rebar tick under the block) |
| **Site log** | Mono lines: time, actor, kind icon, message. Sticky "jump to live" | streaming, paused (user scrolled up), replaying (after reconnect), ended |
| **Connection pill** | Top-right in the app bar | live (weld dot), reconnecting (hivis, "Reconnecting… last update 12s ago"), offline (rebar), replaying (blueprint) |
| **Secret field** | See [Y19](Y19-intake-form.md). Write-only input, eye toggle off by default, "Stored encrypted. You can replace it, never read it back." | empty, entered (masked, last 4), validating, valid, invalid, revoked |
| **Foreman message** | Crane-Y avatar, chalk text on navy-2, short | thinking (grid shimmer, respects reduced motion), question, ready |
| **Punch list** | Checklist of named failed checks from Stood | open item, fixed in a later attempt (struck through with the attempt number) |
| **Empty state** | Line drawing on the grid + one sentence + one action | |

### Dimension lines

Amounts and deadlines on cards sit on a thin blueprint line with end ticks (`|——$1,200——|`). They're decorative: the amount is also plain text for screen readers.

## 6. Motion: "things get built"

| Token | Value | Use |
|---|---|---|
| `--m-fast` | 120ms `cubic-bezier(.2,.8,.2,1)` | Hover, focus, chip swaps |
| `--m-slide` | 320ms `cubic-bezier(.16,1,.3,1)` | Cards moving between Board columns |
| `--m-ink` | 600ms linear | Dashed → solid outline when the Foreman finishes a milestone |
| `--m-lift` | 700ms `cubic-bezier(.34,1.3,.64,1)` | The crane block lowering onto a milestone (once per paid milestone) |
| `--m-tape` | 1.6s linear infinite | Hazard-tape crawl on `BUILDING` |

Rules for a busy, live screen:

1. **One motion per event.** If 20 events arrive in a burst (replay after reconnect), apply them **without** animation and show one summary line: "Caught up: 20 updates."
2. A card animates only if it's on screen. Off-screen changes update silently and badge the column count.
3. Stood's verdict chip uses **Stood's** landing motion. Yard doesn't add confetti.
4. `prefers-reduced-motion`: no intro, no tape crawl, no slide (instant swap + 1s highlight outline), no typewriter in the site log.

## 7. Logo

| File | Use |
|---|---|
| `logo/yard-mark.svg` · `yard-mark-on-dark.svg` · `yard-mark-mono.svg` | The crane-Y on the ground line. The block is the milestone being lifted |
| `logo/yard-wordmark.svg` · `-on-dark` | `YARD`, outlined Big Shoulders 800 |
| `logo/yard-lockup.svg` · `-on-dark` | Mark + wordmark |
| `logo/family-lockup-on-dark.svg` | **"Yard builds. Stood pays."** Crane and pin stand on **one shared ground line**: hi-vis under Yard, volt under Stood |
| `logo/favicon.svg` | Adapts to the browser's colour scheme |

- Clear space: the height of the block (one-sixth of the mark) on every side.
- Minimum size: mark 16px (favicon only), lockup 96px wide.
- The ground line is always hi-vis on dark, navy on paper. Never rotate the mark, never remove the ground line, never put the block on the left arm.

## 8. Asset kit (`docs/brand/yard/`)

| Folder | Files |
|---|---|
| `logo/` | 9 files: marks, wordmarks, lockups, the family lockup, favicon |
| `app-icons/` | `yard-app-icon-1024.svg` (iOS / store), `-tinted-1024` (iOS tinted), Android adaptive foreground + background (432), `yard-maskable-512.svg` (PWA) |
| `social/` | `yard-og-card-1200x630.svg` ("Describe it. Sign it once. Get it built."), `yard-avatar-400.svg` |
| `chips/` | `posted`, `clocked-in`, `building`, `checking`, `punch-list`, `handover` |
| `patterns/` | `blueprint-grid.svg` (96px tile), `hazard-tape.svg` (32px tile) |

PNG exports for stores and social are generated at release time (Chrome headless), not committed, the same as Stood.

## 9. CSS tokens (copy into `site/yard/` and `apps/yard-web`)

```css
:root {
  --y-navy: #071a33; --y-navy-2: #0c2547; --y-grid: #16355f;
  --y-blueprint: #3fd0ff; --y-hivis: #ffb000; --y-weld: #7cf5c4;
  --y-rebar: #ff6b3d; --y-steel: #8fa3bf; --y-chalk: #f4f8fc; --y-paper: #eef4fa;
  --y-blueprint-ink: #0b5c8a; --y-hivis-ink: #7a4a00; --y-steel-ink: #4a5b73; --y-rebar-ink: #a8361a;
  --bg: var(--y-navy); --surface: var(--y-navy-2); --border: var(--y-grid);
  --text: var(--y-chalk); --text-muted: var(--y-steel); --accent: var(--y-blueprint);
  --live: var(--y-hivis); --done: var(--y-weld); --blocker: var(--y-rebar);
  --font-display: "Big Shoulders Display", Impact, "Arial Narrow", sans-serif;
  --font-body: "IBM Plex Sans", system-ui, sans-serif;
  --font-mono: "IBM Plex Mono", ui-monospace, monospace;
  --r-chip: 999px; --r-card: 10px; --r-input: 6px; --r-block: 2px;
  --m-fast: 120ms cubic-bezier(.2,.8,.2,1); --m-slide: 320ms cubic-bezier(.16,1,.3,1);
}
@media (prefers-color-scheme: light) {
  :root:not([data-theme="dark"]) {
    --bg: var(--y-paper); --surface: #fff; --border: #c9d6e6;
    --text: var(--y-navy); --text-muted: var(--y-steel-ink); --accent: var(--y-blueprint-ink);
    --live: var(--y-hivis-ink); --done: #1c7a55; --blocker: var(--y-rebar-ink);
  }
}
```

## 10. Accessibility checklist

- [ ] Every state has a word + icon + colour. Test in greyscale.
- [ ] Live regions: the connection pill and money events use `aria-live="polite"`. The site log is **not** a live region (too noisy). It has a "Read latest" button instead.
- [ ] A burst of updates produces **one** announcement ("3 work orders updated"), not 20.
- [ ] Focus is never stolen by a live update. A card the user has focused doesn't move until focus leaves (it shows "moved to Checking" inline).
- [ ] Secret fields: `autocomplete="off"`, `spellcheck="false"`, never echoed into the DOM after submit.
- [ ] Hit targets 44px minimum. The Board works by keyboard (arrow keys across columns, Enter opens).
- [ ] Contrast numbers in §2 re-checked whenever a token changes.

Implementation evidence: `site/yard/tokens.css` is the shared token source for the Yard landing page and `apps/yard-web`. Its automated contrast check recalculates the documented dark ratios and the paper foreground ratios. Font fallbacks work without downloaded fonts.

Connected mock checks now run [axe-core for Playwright](https://github.com/dequelabs/axe-core-npm/blob/develop/packages/playwright/README.md) against dark/paper rooms and the paper Board on desktop/mobile. The checks retain contrast rules and scan the complete rendered page. Automated scans supplement visual and keyboard review; the full planned component kit remains unfinished.
