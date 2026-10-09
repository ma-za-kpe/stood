# T17: Yard UI instrumentation audit

C2 remains open. The owner requires a smoother discovery/intake experience and 98% coverage for the app and its state management before closure (2026-10-08).

## Verified deployed behavior

Actual hosted desktop/mobile checks found ten clickable public research ideas, valid StartupTribunal source links, zero axe violations and no runtime errors. The live Board returned zero posted work orders. Research discovery is not posted work; a confirmed import creates a private brief, not a build or payment.

The supplied saved intake link restored step 8, ownership/handover. The previous page required another resume click and presented repository/hosting/licence/consent before a readable brief. The UX revision makes saved links open the overview, retains the saved step for editing, separates own-project intake from automatic searchable idea cards, and makes full-report JSON import secondary. Production-image browser tests cover the revised flow before deployment.

The copied Kenyan coffee payload includes `owner_user_id: null`; the deployed importer rejected that key. The regression proved the failure before sanitization. Known private metadata is now removed before validation, with a visible notice; source rejection, veto caveat and scores remain intact. Embedded secrets and explicitly private reports remain blocked.

## Coverage diagnosis

The standard unit report's 91.36% overall branch result includes only `project-state.ts` from Yard web. It excludes React screens, HTTP/session helpers and most other app helpers. That percentage does not describe full app coverage.

A separate full-source app unit audit includes every `apps/yard-web/src/**/*.{ts,tsx}` file and excludes only tests. Before the UX revision it measured 32.73% branches, 24.19% lines/statements and 18.53% functions. React components and `http.ts` had no unit instrumentation; helper gaps included intake conversion, session notice paths, claim retry keys and project snapshot validation. Browser journeys exercise many of these components, but those executions were not merged into source coverage. Zero unit instrumentation does not mean a component never ran in a browser.

`scripts/check-ui-coverage` now collects the full unit inventory, builds an audit-only source-mapped production image, runs desktop/mobile hosted browser journeys, converts their V8 results using the exact converter already pinned by Vitest, merges app-owned source coverage and enforces 98% in all four metrics. Dependencies do not enter the app summary. Empty instrumentation, missing source files or missing app source maps fail the gate. Reports go to `artifacts/ui-audit/`; browser records go to `artifacts/hosted-yard/`.

The combined gate currently fails the 98% requirement; this is recorded evidence, not a disabled threshold. Production Render builds keep source maps off; only the audit image uses `YARD_UI_COVERAGE=1`. Integration of connected-room browser source coverage, raising the remaining metrics and making this a required CI app gate remain T-0275. Existing CI and money-domain gates cannot waive the C2 closure requirement.

Live Chromium V8 records were also captured in `artifacts/live-yard/yard-live-v8-{desktop,mobile}.json`. Those live bundles include dependencies and have no source maps; do not quote their byte percentages as app coverage.

## Existing E2E instrumentation

| Gate | Behavior asserted | Limits |
|---|---|---|
| Public-page browser | Desktop/mobile status, theme, links, axe and overflow | Health responses are controlled to exercise public states |
| Connected-room browser | Operator cache/request cancellation, proof projection, SSE log updates, theme, autosave lost-reply recovery, revisions, stale-tab detection and role privacy | Isolated providers; does not prove hosted adapters or all UI branches |
| Hosted-image browser | Secure sign-in, Board, automatic gallery/search/detail, sanitized full import, private persistence, direct reload/overview/edit, logout, builder refusal, axe, overflow and zero CSP violations | Disposable Postgres; discovery response controlled for repeatability |
| Actual hosted browser | Real operator sign-in, ten-item discovery, full import/reload, logout/privacy, desktop/mobile axe and CSP | Requires private owner codes; broad error/session-expiry paths are not all exercised |

## Work required before C2 closure

- Integrate source-mapped app instrumentation for both hosted and connected journeys, merging with unit coverage against a complete source inventory.
- Assert hosted session expiry/401 cleanup, 429/503/timeout/offline/recovery and cancellation races, including pending imports or saves during logout.
- Cover full import sanitization/validation/selection, retry identity, own-project intake, optional choices and restored saved sections.
- Cover Board pagination/filter/claim conflicts, room snapshot gaps/reconnect and handover/proof behavior without inventing payment state.
- Raise all four app metrics to 98%, retain 100% pure money-domain coverage, make the app gate required in CI, and attach final desktop/mobile evidence to #75.

These are open acceptance criteria, not completed claims. See [#75](https://github.com/ma-za-kpe/stood/issues/75), [the working rules](../WAYS_OF_WORKING.md) and [TASKS](../../TASKS.md).
