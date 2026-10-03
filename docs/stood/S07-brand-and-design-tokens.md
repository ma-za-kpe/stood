# S07: Brand and design tokens

> ⚠️ **Superseded visual direction (2026-10-03).** Colours, type, logo and motion are now defined by **[S15 v2 "Volt"](S15-design-system.md)** ([ADR-0005](../adr/0005-design-system-v2-volt.md)). This page is kept for history. Its voice and accessibility rules still apply.
>
> The full design system (light / dark / Field themes, complete tokens, type scale, components, logo grid, and web / iOS / Android / social asset kit) is in **[S15](S15-design-system.md)**. Asset files are in `docs/brand/`.

## Stance [U]

**Paper, stamp, and a red line.** Not a fintech gradient, not a marketplace. The interface should feel like **a site report that can move money**.

- Large type for the decision. Small type for ids.
- Photos are evidence. They stay **rectangular and uncropped**.
- No illustrations of happy families. No house icons.

## Brand essence

| | |
|---|---|
| **Name** | Stood |
| **Line** | Money does not move until someone stood there. |
| **Short line** [C] | Paid on proof. |
| **Personality** | A careful site clerk: plain, exact, unhurried, never accusing |
| **Is** | A report, a stamp, a ledger line |
| **Is not** | A wallet, a marketplace, a chatbot, a "fintech" |

> **Naming note [C]:** "Stood" is a common English word. Trademark and domain availability **haven't been checked** (see [S10](S10-sandbox-limits-and-open-questions.md)). In Ghanaian and Nigerian English "stood" reads naturally ("someone stood there"). Test it with Ama-type users before committing.

## Colour [U, plus Claude's audit]

| Token | Hex | Use |
|---|---|---|
| `--ink` | `#1A1A1A` | Text, money amounts, the logo |
| `--paper` | `#F4F1EA` | Background |
| `--stamp` | `#9E2B25` | **Refuse and held amount only** |
| `--pass` | `#2F5D50` | Release. **Once per screen** |
| `--rule` | `#D9D3C7` | Dividers, table lines (decorative only) |
| `--muted` [C] | `#5C574F` | Secondary text, ids, timestamps |
| `--surface` [C] | `#FBF9F4` | Raised cards / photo mats |

Rules [U]: money is ink. Failure is red. No second green for money.

### Contrast audit [C] (WCAG 2.x, measured)

| Pair | Ratio | Verdict |
|---|---|---|
| ink on paper | 15.4:1 | AAA |
| stamp on paper | 6.6:1 | AA for all text, AAA for large text |
| pass on paper | 6.6:1 | AA for all text, AAA for large text |
| paper on stamp (a stamp-filled badge) | 6.6:1 | AA |
| muted on paper | 6.4:1 | AA |
| rule on paper | 1.3:1 | **Decorative only.** Never for text or for a meaningful border |
| **stamp vs pass** | **1.01:1** | ⚠️ **The same luminance.** For about 8% of men (red-green colour blindness) and in greyscale, *release and refuse look identical by colour.* |

**Mandatory fix:** colour is **never** the only signal. Every decision carries:

1. **The word** in 40px Newsreader ("Released" / "Refused" / "In review").
2. **A shape:** release = a solid stamp outline with a tick; refuse = a stamp with a **red rule under the word** (the brand's "red line"; striking *through* the word hurt legibility); wait = a dashed outline.
3. Test every screen in greyscale before shipping.

### Dark theme [C, optional; the inspector app stays light]

Kojo works in sunlight, so his screens are **light only**. Ama's receipt and the reviewer file can follow the system theme:

| Token | Dark hex | Ratio on `#161513` |
|---|---|---|
| `--paper` | `#161513` | — |
| `--ink` | `#ECE7DC` | 14.8:1 |
| `--stamp` | `#E07A6F` | 6.2:1 |
| `--pass` | `#7FB8A4` | 8.1:1 |
| `--muted` | `#A39D90` | 6.8:1 |
| `--rule` | `#3A362F` | decorative |

## Type [U]

| Role | Font | Size | Notes |
|---|---|---|---|
| Decision word, product name | **Newsreader** | 40 | It's a report, not a startup |
| Reason sentence | Source Sans 3 | 20 | One sentence |
| File, ids, metadata | Source Sans 3 | 14 | `font-variant-numeric: tabular-nums` on every amount |

- No Inter, no Space Grotesk.
- [C] Both are free Google Fonts. On **Kojo's phone, use the system sans fallback** (Roboto on Android) and don't download web fonts: it saves data and time-to-first-screen on patchy signal.
- [C] Kojo's minimum body size is 16px, not 14. The 14px level is for the reviewer file only.
- [C] Line height: 1.2 for the decision, 1.45 for body.

## Spacing and layout [C]

- 4px base. Scale: 4, 8, 12, 16, 24, 32, 48, 64.
- Page gutter 16px on mobile, 32px on desktop. Max reading width 640px. The reviewer file can go to 1200px.
- Corner radius: **0 for photos** (evidence is uncropped and unrounded), 2px for controls. Stamps are drawn shapes, not rounded pills.
- No shadows. Separate things with `--rule` lines, like a printed form.
- Touch targets ≥ 48px (Kojo, gloves, sun).

## Logo [U]

- **Mark:** a plot pin whose point is a short vertical stroke, like a person standing still, **standing on a horizontal rule** (the ground line / ledger line).
  - ⚠️ [C] The original "cut by a rule" version reads as the **♀ Venus symbol** when rendered, so it was redrawn ([S15](S15-design-system.md) §8).
- **Wordmark:** "Stood" in Newsreader, sentence case. Never all caps.
- **Colours:** ink on paper. Stamp red on a refused receipt. Never in pass green (green is reserved for one release per screen).
- **Clear space:** the width of the pin.
- **Don't:** use a house icon (it promises you build homes; you don't), add gradients, add a shield or padlock, or animate it.
- [C] Minimum size: 16px for the mark, 64px wide for the wordmark. Favicon is the mark alone.

## Photography and evidence [C]

- Show photos at their native aspect ratio, with no filters, rounding or crop.
- Overlay metadata **below** the photo, never on it: time, distance from the pin, perceptual-hash short id.
- A refused photo gets a red rule under it with the named field. It is never blurred or hidden.

## Motion [C]

Almost none. One exception: the stamp lands (about 120ms scale from 1.04 to 1). Respect `prefers-reduced-motion`.
