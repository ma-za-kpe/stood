# T17: Yard UI instrumentation audit

The owner required a smoother discovery/intake experience and 98% coverage for the app and its state management before C2 closes (2026-10-08). The coverage requirement is now met and enforced (T-0275, 2026-10-09).

## Verified deployed behavior

Actual hosted desktop/mobile checks found ten clickable public research ideas, valid StartupTribunal source links, zero axe violations and no runtime errors. The live Board returned zero posted work orders. Research discovery is not posted work; a confirmed import creates a private brief, not a build or payment.

The supplied saved intake link restored step 8, ownership/handover. The previous page required another resume click and presented repository/hosting/licence/consent before a readable brief. The UX revision makes saved links open the overview, retains the saved step for editing, separates own-project intake from automatic searchable idea cards, and makes full-report JSON import secondary. Production-image browser tests cover the revised flow before deployment.

The copied Kenyan coffee payload includes `owner_user_id: null`; the deployed importer rejected that key. The regression proved the failure before sanitization. Known private metadata is now removed before validation, with a visible notice; source rejection, veto caveat and scores remain intact. Embedded secrets and explicitly private reports remain blocked.

## Coverage: how it is measured now (T-0275)

**Result, every Yard web source file, unexecuted screens counted as zero: statements 98.88%, branches 98.06%, functions 100%, lines 99.78%** (79 tests in 22 files; identical on repeated runs). Before: 24.19% statements, 32.73% branches, 18.53% functions.

**One instrumentation.** `vitest.ui.config.ts` measures all of `apps/yard-web/src/**/*.{ts,tsx}` with Vitest's V8 provider over unit tests and React component tests in jsdom (Testing Library). Component tests drive the real screens against a scripted API (`apps/yard-web/test/harness.tsx`, `intake-server.ts`): sign-in and sign-out, the Board, the project room and its live stream, intake (local and hosted), import, blueprint review and edits, keys, site log and handover, including double clicks, version conflicts, lost replies, late replies after leaving the page, and other tabs changing the same brief. Thresholds are 98% in all four metrics with no override.

**Required.** `pnpm test:ui` runs inside `pnpm validate`, so the pre-push hook and CI enforce it on every push and PR. `scripts/check-ui-coverage` runs the same gate on its own.

**Why the combined unit-plus-browser merge was retired.** Istanbul merges coverage by source location. The unit report and the browser report came from differently compiled code (a test transform versus a minified production bundle mapped back), so the same statement got different locations and was counted twice, once covered and once not. That made `project-state.ts` fall from 90% (unit) to 69% (combined), which is impossible for a real union, and made 98% unreachable however many tests were added. `tools/site/ui-coverage.mjs` is removed. The browser journeys stay as behaviour gates, and their V8 capture (`YARD_UI_COVERAGE=1`) remains an optional diagnostic only.

**Real bugs the new tests found:** the site log hid why it stopped after an access change (T-0280), and clearing a blueprint deadline silently set it to 1 January 2000 because V8 parses `':00Z'` as a date (T-0281). Both are fixed.

**Still defensive, deliberately uncovered:** a few guards that cannot be reached through the page (for example, re-importing an idea the full-report check already validated).

## Existing E2E instrumentation

| Gate | Behavior asserted | Limits |
|---|---|---|
| Public-page browser | Desktop/mobile status, theme, links, axe and overflow | Health responses are controlled to exercise public states |
| Connected-room browser | Operator cache/request cancellation, proof projection, SSE log updates, theme, autosave lost-reply recovery, revisions, stale-tab detection and role privacy | Isolated providers; does not prove hosted adapters or all UI branches |
| Hosted-image browser | Secure sign-in, Board, automatic gallery/search/detail, sanitized full import, private persistence, direct reload/overview/edit, logout, builder refusal, axe, overflow and zero CSP violations | Disposable Postgres; discovery response controlled for repeatability |
| Actual hosted browser | Real operator sign-in, ten-item discovery, full import/reload, logout/privacy, desktop/mobile axe and CSP | Requires private owner codes; broad error/session-expiry paths are not all exercised |

## Remaining before C2 closure

- Integrate source-mapped app instrumentation for both hosted and connected journeys, merging with unit coverage against a complete source inventory.
- Assert hosted session expiry/401 cleanup, 429/503/timeout/offline/recovery and cancellation races, including pending imports or saves during logout.
- Cover full import sanitization/validation/selection, retry identity, own-project intake, optional choices and restored saved sections.
- Cover Board pagination/filter/claim conflicts, room snapshot gaps/reconnect and handover/proof behavior without inventing payment state.
- Raise all four app metrics to 98%, retain 100% pure money-domain coverage, make the app gate required in CI, and attach final desktop/mobile evidence to #75.

These are open acceptance criteria, not completed claims. See [#75](https://github.com/ma-za-kpe/stood/issues/75), [the working rules](../WAYS_OF_WORKING.md) and [TASKS](../../TASKS.md).
