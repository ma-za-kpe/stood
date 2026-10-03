# ADR-0005: Design system v2, "Volt"

- **Status:** accepted. Supersedes the v1 visual direction in S07 / S15 ("Paper, stamp and a red line").
- **Date:** 2026-10-03

## Context and evidence

The product owner judged v1 "dull: not vibrant, young, energetic, stylish". The audience includes young diaspora payers and inspectors, plus hackathon judges, who see dozens of grey fintech demos. v1's accessibility principles (word + shape, AA contrast, uncropped evidence) were sound and are kept.

## Decision

- Adopt **Volt**: Night canvas, Ultra violet brand colour, verdict colours Volt / Flare / Sun as fills with Night text.
- Type: Bricolage Grotesque (display), Geist (body), Geist Mono.
- A kinetic motion system with reduced-motion and no-JS fallbacks.
- A new two-tone mark (stem standing on the ground line) and an outlined wordmark.

See [S15](../stood/S15-design-system.md).

## Alternatives considered

- Keep v1 and add colour accents: rejected. It still read as print, not product.
- A gradient-heavy "AI" look: rejected. It's generic and fights the verdict colours.

## Risks and controls

- Bright colours fail contrast as text on light backgrounds → those pairs are banned in S15 §2.
- Motion becomes noise → product screens get a restricted motion set. Marketing pages get the full set.

## Reversal condition

User testing with payers or inspectors shows the verdict colours confuse, or AA can't be met in the product UI.
