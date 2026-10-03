# T14: Feature breakdown and milestones

Product-level features: [S05](../stood/S05-feature-list.md). Partner tiers: [S13](../stood/S13-sponsor-integration.md#build-tiers-keep-ten-partners-from-sinking-a-55-week-build-c). Timeline: [S12](../stood/S12-hackathon-plan.md). Versions are released by release-please.

## Epics → features → requirements

| Epic | Feature | FRs | Partner | Tier |
|---|---|---|---|---|
| **E1 Allowance** | Create allowance API | FR-01, 03, 04 | — | 1 |
| | PayPal Vault signature + Kernel-driven sandbox approval | FR-02, 64 | PayPal, Kernel | 1 |
| | Allowance screen + Bryntum stage Gantt | FR-55 | Bryntum | 2 |
| | Fixtures spec via Channel3 lookup | FR-05 | Channel3 | 3 |
| **E2 Hold** | Dispatch → AUTHORIZE + nonce | FR-10, 11 | PayPal | 1 |
| | Hold timers (reauthorise / warn / void) | FR-12 | Render Workflows | 1 |
| | Funding-failed path | FR-13 | PayPal | 1 |
| **E3 Evidence** | Package intake + R2 presign + pHash | FR-20–22 | — | 1 |
| | Rules C1–C4 | FR-30, 32 | — | 1 |
| | Near-duplicate C5 | FR-31 | Elastic / pgvector | 2 |
| | Evidence agent: nonce, stage, recapture | FR-33–35 | Astropods, Workers AI | 2 |
| | Fixtures check C9 | FR-36 | Channel3 | 3 |
| **E4 Decision** | Pure decide() + capture / void effects | FR-37, 38 | PayPal | 1 |
| | Reviewer / payer override | FR-39, 40 | — | 1 |
| **E5 Records** | Receipt page | FR-50 | — | 1 |
| | Dispute packet (+ submit where possible) | FR-51, 52 | PayPal | 2 |
| | Reviewer file in AG Studio + reconciliation | FR-53, 54 | AG Studio, PayPal TS | 1 / 2 |
| **E6 Integration** | Outbound webhooks + PayPal inbound | FR-60, 61 | — | 1 |
| | Notifications | FR-62 | Zapier | 2 |
| | OpenAPI → SDK (+ MCP) | FR-63 | APIMatic | 3 |
| | [EyeOnSite](https://github.com/ma-za-kpe/eyeonsite) `stood/` functions + nonce in the inspector app | [T08](T08-eyeonsite-integration.md) | — | 1 (demo path) |
| **E7 Demo / ops** | Fixtures + replay endpoints, Postman workspace and monitors | FR-64 | Postman, Kernel | 1 / 3 |
| | Render Blueprint, deploy on release tag | [T10](T10-deployment.md) | Render | 1 |

## Milestones

| Version | Target date | Scope | Exit evidence |
|---|---|---|---|
| **0.1.0** | 4 Oct | Docs, brand, ways of working (done) | Repo public, pre-commit green |
| **0.2.0** | 16 Oct | E1 (API + Vault), E2 dispatch, E3 rules C1–C4, E4 refuse path, PayPal void in sandbox, deployed on Render | Fixture `wrong-plot` refuses end to end in sandbox, with the void visible in PayPal |
| **0.3.0** | 23 Oct | Release path (capture), evidence agent (nonce + stage), C5 duplicates, receipt, webhooks, [EyeOnSite](https://github.com/ma-za-kpe/eyeonsite) E1–E5 wired | All three outcomes on hosted demo. [EyeOnSite](https://github.com/ma-za-kpe/eyeonsite) Android captures a real package |
| **0.4.0** | 30 Oct | Reviewer file (AG Studio + reconciliation), Gantt + chat, dispute packet, notifications, timers | Judge path E2E 5/5. Reviewer can resolve a WAIT |
| **0.5.0** | 6 Nov | Channel3 fixtures, APIMatic SDK / MCP, Postman workspace, design polish, accessibility | Partner docs pages complete. Greyscale and axe checks pass |
| **1.0.0** | 11 Nov | Submission: video, README, `docs/sponsors/*`, final checklist ([13](../13-submission-checklist.md)) | Submitted. Tagged `v-hackathon-submission` |
