# Project erasure proposal (T-0217)

Status: proposed, 2026-10-12. This is a design for review, not an implemented deletion path. Board project events remain append-only; requests to delete an intake already used by a project still return 409. See [current privacy rules](Y22-privacy-and-data.md), [event storage](Y18-realtime-state-management.md) and [payment ownership](../adr/0027-platform-receipt-then-payout.md).

## The problem

Intake erasure already removes its draft, history, save receipts and Foreman checkpoints. A Board project additionally holds signed terms, claims, submissions, decisions, captures, disputes and payouts. Deleting those events while a payment is unresolved could erase money owed to a buyer or builder. Conversely, retaining the entire project indefinitely because some payment references matter retains more content than the payment audit requires. Operator ids and free text can identify people even when sign-off answers never enter the events.

## Proposed approach

Separate project content from a minimal financial record before enabling project erasure. Keep append-only financial records with the facts needed to reconcile obligations: currency, integer amounts, operation identities, provider references, outcomes and the accepted terms needed to explain each outcome. Give this record its own access policy and retention schedule. The product owner and counsel must review the field inventory, lawful basis and retention periods for the countries served; this proposal does not invent a statutory period.

Store erasable project content under an independent project encryption key: summaries, source references, logs, notices, previews and free text. Store identity resolution separately from financial records, with access restricted to justified reconciliation and dispute work. Stable pseudonyms are still personal data where they can be linked to a person; removing a display name alone is not erasure. Encrypt sensitive signed terms with a separately retained financial key where their retention is required. Destroying the project key must not destroy those records.

Do not rewrite historical payment events or hashes to insert tombstones. Introduce a versioned representation that separates financial facts from encrypted content, retaining integrity checks over the stored ciphertext. Existing plaintext events need a reviewed migration and verification before any claim of cryptographic erasure. A key deletion does nothing to plaintext already present in old rows or backups.

## Request and financial fences

The owning buyer makes an authenticated, idempotent request. Record only an opaque request id, project id, reason category, time and progress. A request marks the project pending erasure and immediately restricts ordinary reads and exports. The restriction must cover builders, public discovery, event streams and background projections, not just the buyer's screen.

A transaction acquires the same project fence used by every command and worker reservation. Once the fence is set, refuse new claims, mandate amendments, uploads, submissions, preview deploys and payout retries. Existing obligations may still reconcile through a narrow financial-only path. Check both reservation and completion so an external operation already in flight cannot restore erased content.

Unresolved funding, authorization, capture, void, refund, payout, dispute or operator review prevents destructive erasure. A paid project is not necessarily terminal: PayPal may later reverse a payout. Define terminal eligibility using the financial ledger, applicable dispute windows and retention policy, rather than the Board's PAID label. A refusal must name the outstanding obligation and next operator step. The buyer receives the request's status even when financial retention prevents full erasure.

## Resumable cleanup

Use a durable sequence: fence the project, reconcile the financial prerequisites, erase external previews and artifacts, erase logs/notices/secrets/Foreman checkpoints and content projections, destroy the project content key, then mark completion. Each step is idempotent and checkpointed. A timeout means pending, not complete; a resource confirmed absent counts as removed. One failing project must not stop other cleanup work.

Completion must not be reported while a recoverable key copy or readable content copy remains in an active store. Keep key destruction outside ordinary database backups; define replication, key-cache invalidation and backup expiry with the storage provider. Restores must apply the erasure register before serving requests or restarting workers. Restored plaintext backups must be quarantined and cleaned, or expire under a documented schedule, before claims of complete erasure.

Exports issued before erasure are independent copies. The UI must explain this limit. Export preparation and download need the project fence and request-time ownership checks so an in-flight export cannot publish content after erasure begins.

## Review and implementation acceptance

Before shipping, inventory every copy: event snapshots and receipts, idempotency responses, intake, plans/checkpoints, evidence objects and upload sessions, previews, logs, notices, reputation projections, credentials, exports, telemetry and backups. Map each field to erase or retain, purpose, owner, location, retention period and deletion mechanism. Inventory Stood's separate financial/evidence records as another controller boundary; deleting Yard content does not silently delete Stood records.

Implement additive schema changes and dual reads first. Migrate and validate old data before switching writes; do not use a blanket event-delete privilege. The deletion worker receives only the narrow privileges required for the reviewed content stores. Rehearse recovery on a copy of sandbox data. Record processor deletion failures without recording the erased content itself.

Required tests include cross-tenant refusal; active payment and dispute refusal; erasure racing a claim, submission, preview and export; completion after a lost cleanup reply; restart at every checkpoint; an external 404; independent progress when one project fails; financial reconciliation after content erasure; and a backup restore that cannot expose erased content. Verify retained records against provider outcomes and verify that deleted content cannot be read with application, worker or export credentials.

The implementation needs a reviewed ADR and legal/product approval of the inventory and retention policy. If the separation cannot preserve both financial integrity and erasure guarantees, keep project erasure unavailable and publish the limitation. Do not weaken append-only financial protection to make deletion appear complete.

## Current storage inventory checked 2026-10-13

The current Yard event adapter writes the same full project snapshot to `yard.projects.data` and a replayable result to `yard.commands.result`; `yard.events.payload` and `yard.events.actor` retain the append-only change history and operator identity. The event table has a database trigger that rejects ordinary update/delete. A deletion design therefore has to cover all three stores under one project fence, and must not leave a readable old snapshot in an idempotency result. Public search and the Board/event-feed projections read the project snapshot/events, so they need the pending-erasure fence as well.

Other project-linked stores include site-log text and actor metadata, encrypted preview secrets and their usage/audit rows, Render preview services and URLs, Foreman checkpoint/thread state, intake/planning source material, upload-session declarations and private R2 photo objects in Stood, submitted code packages and runner evidence, and logs/backups held by the corresponding providers. Handover currently deletes eligible test secrets and previews on their own retention paths; those routines are not a project-erasure transaction. Stood's signed terms, mandate history, financial operations, provider references and evidence are an independent controller boundary and need an explicit retained-versus-erased mapping.

This inventory describes locations and observed code paths, not a complete field-level legal record. Before implementation, the owner and counsel still need to select lawful purposes, access rules, and periods for project content, photos, processor copies, backups and the minimal financial audit. Until that review is recorded, Yard project erasure and completed-photo deletion remain disabled; the existing intake-only expiry is unchanged.
