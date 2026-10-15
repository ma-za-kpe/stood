# AG Studio: a read-only reviewer file in Yard

This guide documents Stood's buyer-side project review panel. Yard supplies two independently checked data sources to AG Studio: the project's work orders and a reconciliation between Yard's payment ledger and its Stood capture proof. AG Studio renders the dashboard; it does not decide whether work is accepted or money moves. Its commercial license is optional for the demo: when the key is missing, expired, invalid or unavailable, Yard renders the same checked data as plain tables.

## What it solves and where it fits

The project room already shows each milestone. The reviewer file lets a buyer compare amounts, milestone state, deadlines and capture evidence in one place. Yard fetches its project data from its authenticated service, validates that every ledger row belongs to the displayed room, and passes only those rows to the browser component. The buyer must be signed in. The panel is view-only, and the API exposes no payment or edit action through AG Studio.

AG Studio is an embedded analytics component, not an LLM or model host. The dashboard in this branch is therefore not described as an AI assistant. Its data stays in the browser after Yard returns it; Stood continues to own payment decisions. See the [AG Studio React overview](https://www.ag-grid.com/studio/react/overview/), [data-source guide](https://www.ag-grid.com/studio/react/data/) and [license/pricing page](https://www.ag-grid.com/studio/license-pricing/).

## Try it locally

1. Use Node 24 and install the lockfile: `corepack pnpm install --frozen-lockfile`.
2. Start the normal local Yard/API stack from the repository's [setup guide](../SETUP.md). Do not put a license key in source, a screenshot or browser storage.
3. Sign in to Yard as a buyer and open a project room containing posted work orders.
4. Expand **Open reviewer reconciliation file**. The page makes separate requests for the license state and the room's ledger. The dashboard appears only when the response passes the project-room checks.
5. Repeat with no license configured. The plain milestone and reconciliation tables should still render; they must not display an AG Studio watermark, a false match, or a private project summary.

Focused checks: `corepack pnpm exec vitest run apps/yard-web/src/c5-integrations.test.ts apps/yard-web/src/ReviewerPanel.test.tsx services/yard-api/src/http/browser-session.test.ts` and `corepack pnpm --filter @stood/yard-web build`.

## License setup and lifecycle

The license is supplied at service runtime, never at Vite build time. Set `AG_STUDIO_LICENSE` and the exact UTC ISO expiry `AG_STUDIO_LICENSE_EXPIRES_AT` in the Yard service's secret environment settings. The buyer-authenticated `/app/api/ag-studio-license` route returns the key only while active, warns inside the 14-day window, and omits the key when missing, invalid or expired. It uses `private, no-store`; operator secrets and the server's other environment values are never returned. Redeploy/restart after changing the environment values.

AG Studio is a commercial product. The repository includes its npm packages, but this is not a grant to use the product commercially or to continue after a trial expires. Verify the license covers the public repository and hosted demo with AG Grid before enabling the dashboard. Do not use AG Grid Enterprise-only features unless separately licensed. The trial recorded in the project setup expires on 24 November 2026; renew it for judging or leave the plain tables enabled. Package payloads are lazy-loaded only when the reviewer panel opens; the current minified AG Studio chunk is about 5.3 MB (1.47 MB gzip), so expect a noticeable first-open download.

## Boundaries and recovery

- The endpoint is buyer-session-only. A missing/expired license does not block the tables.
- Yard verifies the ledger rows against the current project id, currency, work-order ids and amounts before rendering a `MATCHED` state.
- If either source is unavailable or mismatched, the panel shows an error and does not claim reconciliation.
- Never put the license key in a GitHub issue, a public screenshot, or `.env.example`; only the variable names belong there.
- The component has no authority to sign, fund, capture, void or edit the project.

| Symptom | Check |
| --- | --- |
| Plain tables appear | Confirm the license expiry and key in the Yard runtime environment; this is the expected fallback. |
| License says unavailable | Check authenticated `/app/api/ag-studio-license` response and the Yard service logs without printing environment values. |
| Reconciliation does not load | Reload the project room; the ledger route must return one matching row per work order. |
| First-open delay | The optional vendor chunk loads only after expanding the reviewer file. |

No AG Studio account API call or provider-side trial validation was performed in this code change. The covered evidence is local route/component tests and a production bundle build, not a live licensed dashboard session.
