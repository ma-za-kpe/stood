# S15: Design system v2, "Volt"

## Current lockup and social copy

Use **Agents pay agents. Only when the work stands.** The social preview cards were regenerated in PR #24. Code evidence displays a test report and diff summary; the field theme and uncropped-photo requirements below are for the EyeOnSite scenario. Yard and the runner remain planned.

**Status:** current (2026-10-03). Supersedes the v1 "Paper, stamp and a red line" system ([ADR-0005](../adr/0005-design-system-v2-volt.md)). Asset files: [`docs/brand/`](../brand/). Live reference: the landing page (`site/`), published to GitHub Pages.

## 1. Direction

> **Young, electric, certain.** Stood is the moment money moves, or doesn't. The interface feels like a **live signal**: deep night, one electric violet, and three verdict colours that hit like stage lights.

| Is | Isn't |
|---|---|
| Bold grotesque type, huge and tight | Corporate fintech blue |
| Night canvas with one glowing accent | Gradient soup, glassmorphism everywhere |
| Verdicts as bright pills with icons | Colour-only status |
| Kinetic: things drop, sweep, tick, land | Motion for its own sake, or motion that blocks |
| Plain, human sentences | Jargon, "something went wrong" |

The v1 principles that stay: **the screen decides money**, every decision has a **word + icon + colour**, photos stay uncropped, and money amounts are never coloured green to celebrate.

## 2. Colour

### Brand palette

| Name | Hex | Role |
|---|---|---|
| **Night** | `#0D0A1E` | Primary canvas (dark-first brand) |
| Night 2 / 3 | `#18142E` / `#241E40` | Raised surfaces, cards |
| **Cream** | `#FFF7EC` | Text on night. Light canvas |
| Cream 2 | `#F6ECDD` | Light surfaces |
| **Ultra** (violet) | `#6C4DFF` | The brand colour: app icon, glows, step markers, focus accents |
| Ultra ink / Ultra on dark | `#4B2EE8` / `#9580FF` | Violet *text* on cream / on night |
| **Volt** (lime) | `#C8FF3D` | **Released**, primary CTA, the ground line of the mark |
| **Flare** (coral-red) | `#FF5533` | **Refused**, the held amount |
| **Sun** (marigold) | `#FFC53D` | **In review / wait** |
| Volt ink / Flare ink / Sun ink | `#3F6B00` / `#C8321A` / `#8A5300` | Verdict colours as *text* on cream |
| Mute (dark / light) | `#A7A2C2` / `#5E5873` | Secondary text |
| Line (dark / light) | `#3A3360` / `#E2D7C6` | Dividers |

### Semantic tokens

| Token | Night theme (default) | Cream theme | Field (the site-visit inspector’s phone, always) |
|---|---|---|---|
| `bg` | Night | Cream | `#FFFFFF` |
| `surface` | Night 2 | Cream 2 | `#F4F4F6` |
| `text` | Cream | Night | `#000000` |
| `text-muted` | Mute dark | Mute light | `#3D3D3D` |
| `accent` | Ultra (on-dark `#9580FF` for text) | Ultra ink | Ultra ink |
| `release` | Volt fill + Night text | Volt fill + Night text (Volt ink for text) | Volt ink |
| `refuse` | Flare fill + Night text | Flare fill (Flare ink for text) | Flare ink |
| `wait` | Sun fill + Night text | Sun fill (Sun ink for text) | Sun ink |
| `focus` | 3px Volt outline, 3px offset | 3px Ultra ink | 3px black |

### Measured contrast (WCAG 2.x)

| Pair | Ratio | |
|---|---|---|
| Cream on Night | 18.3 | AAA |
| Volt on Night / Night on Volt | 16.5 | AAA |
| Sun on Night | 12.3 | AAA |
| Flare on Night / Night on Flare | 6.1 | AA |
| Ultra-on-dark `#9580FF` on Night | 6.3 | AA |
| Mute dark on Night | 8.0 | AAA |
| Ultra ink on Cream | 6.9 | AA |
| Volt ink / Sun ink on Cream | 6.0 | AA |
| Flare ink on Cream | 5.0 | AA |
| Mute light on Cream | 6.3 | AA |
| ⚠️ Volt **text** on Cream | 1.1 | **Never.** On cream, Volt is only a fill behind Night text |
| ⚠️ Ultra `#6C4DFF` text on Night | 4.46 | Large text only. Use `#9580FF` for body |

**Colour-blind safety:** Volt vs Flare differ in luminance (2.7:1 on night). Every verdict *also* carries an icon (✓ / ✕ / clock) and a word. The rule from v1 stands.

## 3. Typography

| Role | Family | Settings | Licence |
|---|---|---|---|
| **Display**: headlines, verdict words, wordmark | **Bricolage Grotesque** | 800 weight, `wdth` 90–96, tracking −0.028 to −0.035em, leading 0.95–1.0 | OFL |
| **Body / UI** | **Geist** | 400–600, 1.55 leading | OFL |
| **Mono**: ids, amounts in the file, code, kickers | **Geist Mono** | 400 / 600, uppercase kickers at +0.12em | OFL |

| Token | Size (clamp) | Use |
|---|---|---|
| `display` | 42 → 96 px | Hero headlines |
| `h2` | 32 → 60 px | Section titles |
| `verdict` | 20–40 px, Bricolage 800 | Released / Refused / In review |
| `reason` | 19 → 24 px, Geist 600 | The one sentence |
| `body` | 17 px | Body (the site-visit inspector minimum 16 px) |
| `mono` | 13–15 px | Ids, amounts in the reviewer file, kickers |

Amounts use `tabular-nums`. The **wordmark is outlined** (paths from Bricolage Grotesque 800 / `wdth` 90), so it renders identically everywhere.

## 4. Shape, space, depth

- **Radius:** 10 (inputs) · 18 (cards) · 28 (panels) · pill (verdict chips, buttons). **Photos: 0** (evidence is never rounded or cropped).
- **Spacing:** 4-pt base. Section padding clamps from 64 to 128 px. Gutter 16 → 48 px.
- **Depth:** night surfaces get a 1px line plus a soft long shadow and a subtle top highlight. One **violet glow** per view, maximum.
- **Texture:** a 6% film-grain overlay on marketing pages only (never in the product's evidence views).

## 5. Motion

Motion is the brand. It must **feel quick and land with certainty**: ease `cubic-bezier(.2,.8,.2,1)`, 120–900 ms.

| Moment | Motion |
|---|---|
| **Intro** (first visit, once per session) | The pin **drops** onto the line with a small overshoot. The volt line **sweeps** out. The curtain lifts (≈ 1.3s total) |
| Hero headline | Words **rise** from a mask, staggered 70 ms. The "stood" underline **draws** left → right |
| Verdict chip | **Pops** in (scale 1.12 → 1). Refused adds a short **shake** |
| Checks | Each row **ticks** in sequence (150–380 ms apart) |
| Scroll | Sections **fade-rise**. Groups stagger 90 ms. The steps line **draws** in volt |
| Pointer | Cursor **spotlight** in the hero, **3D tilt** on the decision card, **magnetic** primary buttons |
| Ambient | Slow violet glow drift. Ticker marquee of (synthetic) decisions |

Rules:

- `prefers-reduced-motion` → **no intro, no grain, no movement**. Everything is shown in its final state.
- Content never depends on animation to be visible. There's a no-JS fallback, plus a 3.8s failsafe that settles everything.
- **Product screens** (allowance, decision, receipt, reviewer) use only the verdict pop, the check ticks and fades. No grain, tilt or marquee where money is decided.

## 6. Components

| Component | v2 spec |
|---|---|
| **Verdict chip** | Pill, fill = verdict colour, Night text in Bricolage 800, leading icon (✓ / ✕ / clock). Files: `brand/logo/stamp-*.svg` |
| **Decision card** | Night-3 → Night-2 gradient panel. Chip, reason sentence, check rows (mono values, ✓ / ✕ / ? prefixes), PayPal state line in mono |
| **Buttons** | Primary: Volt fill, Night text, pill, 48px min height. Ghost: 1.5px line, cream text. Destructive (reviewer only): Flare fill. Only one Volt button per view |
| **Kicker** | Mono uppercase, +0.12em, Ultra (cream sections) or Volt (night sections) |
| **Tiles** | 28 radius, Cream 2 on cream sections, Night 2 on night sections. Hover lifts 4 px |
| **Code block** | `#07051A`, mono 14 px, keys Ultra-on-dark, strings Volt, comments Mute |
| **Evidence photo** | Unchanged from v1: native ratio, no rounding, metadata below |
| **Reviewer grid (AG Studio)** | Theme from tokens: Night canvas, Night-2 rows, verdict cells as mini-chips |
| **Gantt (Bryntum)** | Bars: Ultra (held), Volt (released), Flare (refused), Sun (wait). Locked bars show a lock icon |

## 7. Logo

**The mark:** a pin head and stem **standing on** a ground line, like a person standing on the plot, or a lever on a gate. Two-tone: the figure in Night or Cream, the ground line in **Ultra** (on light) or **Volt** (on dark).

- **Grid:** 64 × 64. Head r 11 at (22, 17). Stem 8 wide from y 22 to 50. Ground 52 × 8, rounded, from x 6. The stem **stands on** the line and never crosses it (that avoids the ♀ reading found in v1).
- **Wordmark:** "stood", lowercase, Bricolage Grotesque 800, outlined paths.
- **Lockups:** horizontal (mark + wordmark, gap = 0.2× mark), stacked.
- **App icon:** Ultra background, Cream figure, Volt ground. Dark variant on Night. Tinted (mono) for iOS 18+.
- **Don't:** recolour the figure Volt, rotate the mark, add a house, a shield or a coin, or put the Ultra ground on Night (too little contrast). Use Volt there.

## 8. Asset kit

Unchanged paths, regenerated for v2 in [`docs/brand/`](../brand/):

- `logo/`: mark (light / dark / mono / refused), wordmark, lockups, favicon (adapts to the colour scheme), verdict chips.
- `app-icons/`: iOS light / dark / tinted 1024, Android adaptive fg / bg / monochrome, PWA maskable.
- `social/`: avatar (light / dark), OG card 1200×630, X header, LinkedIn banner.
- `site/assets/og-card.png`: the PNG render of the OG card for link previews.

The generator script (fontTools) lives in the scratch workflow for now. Moving it to `tools/brand/` is a follow-up task.

## 9. Accessibility checklist

- [ ] Every verdict has a word + icon. The greyscale check passes.
- [ ] Text pairs meet AA or better (table above). Volt and Sun are never used as text on cream.
- [ ] Focus ring visible (Volt on night, Ultra ink on cream).
- [ ] Reduced motion respected. Content visible without JS.
- [ ] Touch targets ≥ 48 px. the site-visit inspector’s capture button ≥ 64 px. The Field theme is on his phone.
