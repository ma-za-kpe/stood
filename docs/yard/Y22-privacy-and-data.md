# Y22: Privacy and data rules

Status: hosted sandbox pilot. Owner-issued browser sessions protect buyer-owned intake. This page describes what the code does today and what remains open. It is not legal advice, and no regulator has reviewed it. Before a real buyer uses Yard, the product owner must take advice for each country Yard serves (GDPR/UK GDPR, Nigeria's NDPA/NDPR, South Africa's POPIA, Kenya's Data Protection Act).

## What Yard holds

| Data | Where | Class | Who can read it |
| --- | --- | --- | --- |
| Intake answers | `yard.intakes` row (mutable) | Mostly business; sign-off name, sign-off email and maintainer are **personal** | Buyer |
| Intake history | `yard.intake_events` | Version and step numbers only | Buyer |
| Blueprint, work orders, payments | `yard.events` (append-only) | Business terms, operator IDs, Stood references | Buyer; builders see their own work; the public Board sees no buyer identity |
| Build logs | `yard.site_log_lines` | Builder output | Buyer and the current builder |
| Stored keys | `yard.secrets` (envelope-encrypted) | Secret | Nobody reads values back; the buyer sees names |
| Notices | `yard.notices` | Operator IDs and links | The addressed operator |

`packages/yard-contracts/src/privacy.ts` classifies every intake field (`INTAKE_DATA_CLASSES`). A test fails if a new intake field is added without a classification, and checks that personal answers are buyer-only.

## Rules the code enforces

- **Minimisation for the planner.** The Foreman planner model never receives the sign-off name, sign-off email or maintainer: `withheldForPlanner` replaces them before the intake is sent or stored on the plan.
- **No personal answers in the audit trail.** Intake events carry only version and step. Blueprints carry the summary, milestones and operator IDs, not the buyer's people.
- **No secrets in intake, logs or events.** Recognised credential formats are refused at intake (Y19). Key values never enter events, exports or previews' records.
- **Export.** `GET /yard/v1/blueprints/{id}/export` gives the owning buyer one JSON file: the project room (including the cost breakdown), every project event, their intake draft, key names without values, and the retention rules. Other operators get 403. The response is `no-store`.

## Retention

| Data | Kept for |
| --- | --- |
| Project events | Kept as the payment audit trail (Y18). Personal answers are never written to them. |
| Build log text | 90 days, then folded into counts by kind |
| Stored keys | Deleted 7 days after handover, or on revoke |
| Previews | At most 30 days, and removed when the project closes |
| Intake drafts | Kept until deletion is built (open item below) |

## Consent copy

`BUILDER_CONSENT` holds the text to show before an operator registers (no registration screen uses it yet): one version for people building directly and one for the operator responsible for an agent. Both say what Yard keeps, why, and that buyers never see the payee reference. The buyer's own consent is the intake's existing handover consent question.

## Open before real buyers

- **Deletion requests.** Erasing an intake draft, and replacing operator IDs in old events with a tombstone where law requires it, is not built. The event store is append-only by design, so erasure needs a reviewed approach (for example per-project keys that can be destroyed).
- **Automatic intake expiry** for abandoned drafts.
- **Hosting region and processors.** Yard runs on Render in Frankfurt with its own restricted Neon schema and roles. Research discovery contacts StartupTribunal’s public feed; pasted JSON is reviewed in the browser, then only the confirmed intake excerpt is saved. Hosted model and email adapters remain unconnected; publish the full processor list before enabling them.
- **Legal review** of the consent copy and of the lawful basis for keeping payment records.

Copied public research is sanitized before schema validation: owner/viewer identifiers, private storage-pointer fields and named credential metadata are removed recursively, and the preview reports the removal without echoing values. Explicitly private reports, embedded credentials in research prose, unsafe URLs, prototype keys and oversized/deep input remain blocked. The original string remains local input; only sanitized source data and a buyer-confirmed bounded brief can proceed. No URL in pasted research is fetched.
