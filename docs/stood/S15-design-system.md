# S15: Design system (themes, tokens, type, logo, platform assets)

Extends [S07](S07-brand-and-design-tokens.md), which holds the brand stance and voice-adjacent rules. This doc is the full system. Asset files are in [`docs/brand/`](../brand/).

**One rule over everything:** *the screen decides money.* Big type for the decision, small type for the file, photos uncropped, colour never the only signal.

---

## 1. Themes

| Theme | Name | Use |
|---|---|---|
| Light (default) | **Paper** | Ama's receipt, allowance, decision. The reviewer file by day |
| Dark | **Ledger** | Follows the system theme for Ama and the reviewer |
| High-contrast light | **Field** | **Kojo's capture app, always**: direct sunlight, cheap screens. Pure white background, pure black ink |

The theme is chosen per surface. Kojo's app ignores the system dark mode on purpose: a dark UI in Accra midday sun is unreadable.

---

## 2. Colour tokens

### 2a. Primitives

| Primitive | Hex |
|---|---|
| ink-900 | `#1A1A1A` |
| ink-600 | `#5C574F` |
| paper-50 | `#FBF9F4` |
| paper-100 | `#F4F1EA` |
| paper-200 | `#ECE7DC` |
| rule-200 | `#D9D3C7` |
| rule-500 | `#8F8778` |
| stamp-700 | `#9E2B25` |
| stamp-300 | `#E07A6F` |
| pass-700 | `#2F5D50` |
| pass-300 | `#7FB8A4` |
| caution-700 | `#8A5A00` |
| caution-300 | `#D9A441` |
| night-950 | `#0F0E0D` |
| night-900 | `#161513` |
| night-850 | `#1F1D1A` |
| night-700 | `#3A362F` |
| night-500 | `#6E665A` |
| night-200 | `#A39D90` |
| night-50 | `#ECE7DC` |

### 2b. Semantic tokens (use only these in UI)

| Token | Paper (light) | Ledger (dark) | Field (Kojo) | Use |
|---|---|---|---|---|
| `bg` | `#F4F1EA` | `#161513` | `#FFFFFF` | Page |
| `surface` | `#FBF9F4` | `#1F1D1A` | `#FFFFFF` | Cards, photo mats |
| `sunken` | `#ECE7DC` | `#0F0E0D` | `#F2F2F2` | Wells, code / id blocks |
| `text` | `#1A1A1A` | `#ECE7DC` | `#000000` | Body, **all money amounts** |
| `text-muted` | `#5C574F` | `#A39D90` | `#3D3D3D` | Ids, timestamps, metadata |
| `rule` | `#D9D3C7` | `#3A362F` | `#BDBDBD` | Decorative dividers only |
| `border` | `#8F8778` | `#6E665A` | `#000000` | Meaningful borders, inputs (≥3:1) |
| `refuse` | `#9E2B25` | `#E07A6F` | `#9E2B25` | Refuse, **held amount**. Nothing else |
| `refuse-tint` | `#F3E3E0` | `#3A1E1B` | `#FBE9E7` | Refused row / banner background |
| `release` | `#2F5D50` | `#7FB8A4` | `#2F5D50` | Release, **once per screen** |
| `release-tint` | `#E3ECE8` | `#1C2D28` | `#E6F0EC` | Released banner background |
| `wait` | `#8A5A00` | `#D9A441` | `#8A5A00` | In review / wait (reviewer file only; Ama sees ink) |
| `wait-tint` | `#F5EBD6` | `#33280F` | `#FFF4DC` | Wait row background |
| `focus` | `#1A1A1A` | `#ECE7DC` | `#000000` | 2px outline, 2px offset |

### 2c. Measured contrast (WCAG 2.x)

| Pair | Paper | Ledger |
|---|---|---|
| text / bg | 15.4 | 14.8 |
| text-muted / bg | 6.4 | 6.8 |
| refuse / bg | 6.6 | 6.2 |
| release / bg | 6.6 | 8.1 |
| wait / bg | 5.3 | 8.1 |
| refuse / refuse-tint | 6.0 | 5.2 |
| release / release-tint | 6.2 | 6.4 |
| wait / wait-tint | 5.0 | 6.4 |
| border / bg (non-text, needs ≥3) | 3.2 | 3.2 |
| text / refuse (filled stamp button) | 6.6 (paper on red) | 6.2 (night on red) |

All text pairs pass **AA**. Ink on paper passes **AAA**.

⚠️ **Refuse vs release luminance:** 1.01:1 (Paper) and 1.29:1 (Ledger). They're indistinguishable for red-green colour-blind users and in greyscale. **Every decision carries a word and a shape** (§6).

### 2d. Colour rules

- Money is **ink**. Never colour an amount green.
- Red appears only for **refuse** and the **held amount**.
- Green appears **once per screen**, on the release.
- No gradients, no shadows, no glassmorphism.

---

## 3. Typography

| Family | Role | Source | Fallback stack |
|---|---|---|---|
| **Newsreader** | Decision word, product name, page titles | Google Fonts (OFL) | `'Source Serif 4', Georgia, serif` |
| **Source Sans 3** | Everything else, including numbers | Google Fonts (OFL) | `system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif` |
| **Source Code Pro** (optional) | Ids in the reviewer file | Google Fonts (OFL) | `ui-monospace, Menlo, Consolas, monospace` |

**Banned:** Inter, Space Grotesk, any geometric "startup" sans.

### Type scale

| Token | Size / line height | Family / weight | Use |
|---|---|---|---|
| `display` | 40 / 48 | Newsreader 500 | **Released / Refused / In review** |
| `title` | 28 / 34 | Newsreader 500 | Page titles (Allowance, Receipt) |
| `reason` | 20 / 28 | Source Sans 3 400 | The one-sentence reason |
| `body` | 16 / 24 | Source Sans 3 400 | Body, **Kojo's minimum** |
| `file` | 14 / 20 | Source Sans 3 400 | The file, ids, metadata (not on Kojo's screens) |
| `label` | 12 / 16 | Source Sans 3 600, +0.04em, uppercase | Column headers in the reviewer file only |

- Amounts always use `tabular-nums lining-nums` (`font-variant-numeric`).
- Currency formatting: symbol + amount (`£4,000`), with no decimals for whole amounts.
- Kojo's app (Field) uses the **system font** (Roboto on Android) and loads no web fonts. That saves data and avoids slow first paint.

---

## 4. Space, size, shape

- **Spacing scale (4px base):** 4 · 8 · 12 · 16 · 24 · 32 · 48 · 64.
- **Gutters:** 16 (mobile), 24 (tablet), 32 (desktop). Reading width ≤ 640. Reviewer file ≤ 1280.
- **Radius:** 0 for photos and stamps. 2 for inputs and buttons. 0 for cards (rule-separated, like a printed form).
- **Elevation:** none. Separate with `rule` lines. Modals use a 1px `border` and a dimmed backdrop (`#000` at 40%).
- **Touch targets:** ≥ 48×48. Kojo's capture button is ≥ 64×64.
- **Breakpoints:** 375 (base) · 768 · 1024 · 1280.

---

## 5. Iconography

- **Lucide** (ISC licence), **1.75px stroke**, 20px default, `currentColor`. It matches the mark's line weight.
- Icons are always paired with a text label in the money path. Icon-only buttons are allowed only in the reviewer toolbar, and need `aria-label`.
- No emoji in UI copy.
- No illustrations, no people, no houses.

---

## 6. Core components

| Component | Spec |
|---|---|
| **Decision stamp** | A rectangle with a 4px stroke, 0 radius, word in `display`. **Released:** `release` stroke plus a tick. **Refused:** `refuse` stroke plus a **red rule under the word** (the "red line"). **In review:** a **dashed** `text` stroke. Shape and word carry meaning without colour. Files: `brand/logo/stamp-*.svg` |
| **Reason line** | One sentence in `reason`, directly under the stamp. It always states what happened to the money |
| **Amount** | `text` colour, tabular. The held amount uses `refuse` plus the label "held, not paid" |
| **Evidence photo** | Native aspect ratio, 0 radius, no crop or filter. Metadata *below* (time · distance from pin · hash short id). A refused photo gets a 2px `refuse` rule under it plus the named field |
| **Check list (live)** | Rows: plot · new photos · code read · stage · fixtures. States: ✓ pass / ✗ fail (word plus icon) / … checking |
| **File row** | `file` text, `rule` dividers, ids in mono, copy-to-clipboard |
| **Buttons** | Primary: `text` fill with `bg` text. Secondary: 1px `border`, transparent. **Destructive (Refuse, reviewer only):** `refuse` fill with `bg` text. There is no green button. Release happens through rules, not a big green CTA |
| **Banner** | A tint background plus a 4px left rule in the state colour, with a word prefix: "Refused.", "In review.", "Released." |
| **Stage timeline** | The Bryntum Gantt styled with these tokens. Locked bars use a `sunken` fill plus a lock icon. The hold window is a dashed outline |
| **Reviewer grid** | The AG Studio theme mapped to these tokens (header `label`, rows `file`, refused rows `refuse-tint` plus the rule glyph) |

---

## 7. Motion

- One motion only: **the stamp lands**: scale 1.04 → 1, opacity 0 → 1, 120ms, ease-out.
- Checks tick in sequence at 150ms intervals (the demo moment).
- Respect `prefers-reduced-motion`: no scale, instant.

---

## 8. Logo system

### The mark

**A pin planted on a ledger line.** A ring (the pin head, or a person's head), a vertical stem (the pin's point, or a person standing still), **standing on** a horizontal rule (the ground, or the ledger line) that runs further to the right.

> ⚠️ **Revision [C]:** the first version had the rule **crossing** the stem. Rendered, that reads as the **Venus / female symbol ♀**. It's now redrawn so the stem stops **on** the rule (an inverted-T base, rule offset to the right). Check any future variant at 16px for the ♀ reading.

- **Grid:** 48×48. Ring centre (18, 14), r 8. Stem x = 18, y 22→40. Rule y ≈ 41.75, x 4→46. Stroke 3.5 (favicon 4.5, for small sizes).
- **Clear space:** the ring's diameter on all sides.
- **Minimum size:** 16px for the mark, 64px wide for the wordmark.
- **Colours:** ink on paper. Night-50 on Ledger. Stamp red only on a refused receipt. **Never green, never a gradient, never animated.**

### Wordmark and lockups

- "Stood" in **Newsreader 500**, sentence case, −1% tracking.
- **Horizontal lockup:** mark + wordmark, gap = 0.5 × mark width. **Stacked lockup:** mark above, centred.
- ⚠️ The SVG wordmarks use live `<text>`. **Convert to outlines** (Figma / Inkscape) before production, so they render without Newsreader installed.

### Don'ts

House icons, shields, padlocks, coins, globes, maps of Africa, drop shadows, outlines around the wordmark, all caps, recolouring the mark green.

---

## 9. Platform asset kit

Source SVGs are in `docs/brand/`. Export PNGs from them (Figma, Inkscape, or `rsvg-convert` once installed).

### Web / PWA

| Asset | Size | Source |
|---|---|---|
| Favicon (adapts to light / dark via an internal media query) | SVG | `logo/favicon.svg` |
| Favicon fallback | 32×32, 16×16 ICO / PNG | `logo/favicon.svg` |
| Apple touch icon | 180×180 PNG, no transparency | `app-icons/app-icon-light-1024.svg` |
| PWA icons | 192, 512 PNG | `app-icons/app-icon-light-1024.svg` |
| PWA maskable | 512 PNG (mark inside the 80% safe zone) | `app-icons/maskable-512.svg` |
| `theme-color` | `#F4F1EA` (light) / `#161513` (dark) | — |
| OG / link preview | 1200×630 | `social/og-card-1200x630.svg` |

### iOS

| Asset | Size | Source |
|---|---|---|
| App icon (single-size master; the system rounds the corners) | 1024×1024, no alpha | `app-icons/app-icon-light-1024.svg` |
| Dark appearance variant | 1024×1024 | `app-icons/app-icon-dark-1024.svg` |
| Tinted appearance variant (greyscale, the system tints it) | 1024×1024 | `app-icons/app-icon-tinted-1024.svg` |
| Launch screen | `bg` colour plus the centred mark at 96pt | Mark SVG |

### Android

| Asset | Size | Source |
|---|---|---|
| Adaptive icon foreground | 108dp (432px @xxxhdpi). Mark inside the 66dp safe zone | `app-icons/android-adaptive-foreground-432.svg` |
| Adaptive icon background | 108dp, solid paper | `app-icons/android-adaptive-background-432.svg` |
| Monochrome (themed icons, Android 13+) | 108dp | `app-icons/android-monochrome-432.svg` |
| Play Store icon | 512×512 PNG | `app-icons/app-icon-light-1024.svg` |
| Play feature graphic | 1024×500 | *to make* (reuse the X header layout) |
| Splash (Android 12+ SplashScreen API) | Icon on `bg` | Foreground SVG |

### Socials

| Platform | Asset | Size | Source |
|---|---|---|---|
| X, LinkedIn, GitHub, YouTube, Devpost | Avatar (circle-safe) | 400×400 | `social/avatar-400.svg` / `avatar-dark-400.svg` |
| X | Header | 1500×500 | `social/x-header-1500x500.svg` |
| LinkedIn | Page banner | 1584×396 | `social/linkedin-banner-1584x396.svg` |
| Any link share | OG card | 1200×630 | `social/og-card-1200x630.svg` |
| YouTube | Video thumbnail | 1280×720 | *to make*: a refused stamp beside a site photo, with the title "The money stayed." |
| YouTube | Channel banner | 2560×1440 (safe 1546×423) | *to make* |
| Devpost | Gallery / thumbnail | 3:2, e.g. 1500×1000 | *to make*: the decision screen |

### Stamps (for receipts, video and README)

`logo/stamp-released.svg` · `logo/stamp-refused.svg` · `logo/stamp-in-review.svg`

---

## 10. Accessibility checklist

- [ ] Every screen passes a **greyscale** check (decision readable without hue).
- [ ] All text ≥ 4.5:1. Meaningful borders and icons ≥ 3:1 (tables in §2c).
- [ ] Focus ring visible on every interactive element.
- [ ] `prefers-reduced-motion` respected.
- [ ] Kojo's screens: ≥ 16px text, ≥ 48px targets, the Field theme, works offline.
- [ ] Amounts announced with currency by screen readers ("four thousand pounds, held, not paid").
- [ ] Copy is plain English at roughly a 6th–8th grade reading level ([S06](S06-voice-and-states.md)).
