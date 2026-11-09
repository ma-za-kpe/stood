# Bryntum Gantt: a read-only milestone timeline

Yard uses Bryntum Gantt to show posted work orders against their signed deadlines. The buyer can see what is released and what remains locked. The timeline is a visualization of Yard's room snapshot; it cannot edit scope, dates, milestone states or payments.

## Install and run

1. Use Node 24 and install dependencies with `corepack pnpm install --frozen-lockfile`.
2. Run Yard and open an authorized project room with at least one work order.
3. Choose **Open milestone timeline**. Bryntum loads as a separate lazy chunk only after the buyer opens it.
4. Confirm each work order is shown at its recorded deadline. A `PAID` order is labeled released; every other state is locked.
5. Try the timeline controls. The component receives `readOnly: true`; it has no save callback or write API.
6. Run `corepack pnpm exec vitest run apps/yard-web/src/c5-integrations.test.ts apps/yard-web/src/project-state.test.ts apps/yard-web/src/App.test.tsx` and `corepack pnpm --filter @stood/yard-web build`.

The focused tests prove the adapter maps every room order and deadline, and marks only `PAID` tasks unlocked. They do not replace a visual browser check. This workspace could not capture an in-app browser screenshot in the current tool session; no screenshot is presented as evidence.

## Why this product and what it does

The timeline gives a buyer and builder a shared view of milestone sequence and due dates. It is useful for a milestone plan review or a release-readiness conversation. The final status remains the server's state, and only Stood's verified provider result can release a milestone. The Gantt itself never proves that work passed or payment settled.

The integration uses Bryntum's public npm trial aliases at version 7.3.7 for this prototype. Bryntum documents a [React integration](https://bryntum.com/products/gantt/docs/guide/Gantt/integration/react/guide) and [trial packages](https://bryntum.com/products/gantt/docs/guide/Gantt/npm-repository). Trial packages are not a production license. Obtain and configure an appropriate commercial license before continuing use beyond the trial terms; do not commit a license key. This guide makes no price claim: check the current [Bryntum license page](https://bryntum.com/products/gantt/#pricing).

The measured lazy Gantt bundle is approximately 4.8 MB minified (1.8 MB gzip), plus 224 KB CSS. We tried the documented thin package set; its required Grid, Scheduler, Scheduler Pro and engine dependencies produced a larger bundle in this Vite build, so that change was reverted. The initial Yard page does not download this chunk until the timeline is opened.

## Limits and troubleshooting

- Empty rooms display “No milestones are posted yet” without constructing a Gantt instance.
- The chart is read-only. Never add a callback that writes dates or states back to the Board.
- If dates look wrong, inspect the room's `deadline` epoch values and the UTC legend under the chart. Do not infer a payment from a bar or marker.
- If the component does not load, check the browser console for a failed `MilestoneTimeline` chunk and confirm the release served matching application assets.
- A visible trial notice or watermark indicates licensing needs attention; do not hide it with CSS.

This branch has component tests and a successful optimized build. No live Bryntum license check or interactive browser screenshot was captured.
