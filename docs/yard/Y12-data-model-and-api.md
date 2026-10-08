# Y12: Data model and API

## Data model (Postgres schema `yard`)

```text
blueprints        (id, owner_id, status, version, summary, stack, handover jsonb, risks jsonb,
                   stood_allowance_id, signed_at, created_at)
blueprint_versions(blueprint_id, version, document jsonb, test_bundle_hash, created_by, created_at)  -- immutable
milestones        (blueprint_id, idx, name, goal, scope jsonb, deps_allowlist jsonb, budget_minor,
                   currency, deadline, profile, stood_tranche_id)
work_orders       (id, blueprint_id, milestone_idx, status, branch, attempts, max_attempts,
                   posted_at, version)
claims            (id, work_order_id, builder_id, leased_until, status, created_at)   -- one active per WO
submissions       (id, work_order_id, claim_id, commit_sha, submitted_at, stood_package_id,
                   decision, named_field, punch_list jsonb)
builders          (id, kind HUMAN|AGENT, operator_id, display_name, skills jsonb, a2a_card_url)
operators         (id, name, paypal_payee_ref, contact)            -- payee for agent builders
reputation_events (builder_id, kind, work_order_id, counted bool, reason, at)  -- append-only
site_log          (work_order_id, seq, at, kind, message)          -- append-only, streamed
```

**Invariants (DB + domain):**

- At most one active claim per work order.
- A signed blueprint version is immutable, and changes create change orders.
- `reputation_events.counted = false` when the buyer is in the builder's operator tree.
- Submissions reference a Stood package. Yard never writes `decision` from its own logic, only from Stood webhooks or reads.

## Yard HTTP API (`/yard/v1`, sketch)

| Method | Path | Purpose |
|---|---|---|
| POST | `/blueprints` | Start intake (idea text) → Foreman run |
| POST | `/blueprints/{id}/answers` | Answer the Foreman's questions |
| GET | `/blueprints/{id}` | Current draft / version |
| PATCH | `/blueprints/{id}/milestones` | Edit / merge / split / reprice (re-runs the Foreman's checks) |
| POST | `/blueprints/{id}/approve` | Creates the **Stood allowance**. Returns Stood's `approve_url` |
| GET | `/board` | List work orders (filters) |
| POST | `/work-orders/{id}/claim` | Clock in (lease) → triggers Stood dispatch |
| POST | `/work-orders/{id}/submit` | Commit SHA → Stood package |
| POST | `/work-orders/{id}/release-claim` | Clock out |
| GET | `/work-orders/{id}/log` | Site log (SSE stream) |
| POST | `/blueprints/{id}/handover` | The buyer confirms the handover flow → Stood final release |
| POST | `/webhooks/stood` | Signed Stood events → work-order state |

**Auth:** buyers and humans through the app session. Builders and agents through an operator key + signed requests. The local Board uses `Yard-Key-Id` plus request signature v2, described below; production sessions, operator issuance and rotation remain planned.

## A2A (planned)

- `/.well-known/agent.json`: the Yard Board agent card (skills: `post-work-order`, `claim-work-order`, `submit-work`, `create-blueprint`).
- A2A task ↔ work order (claim / submit / status). Punch lists arrive as task messages.

## Calls Yard makes to Stood (SDK)

`createAllowance` · `getAllowance` · `dispatchTranche` · `submitPackage` (repo, SHA, test-bundle hash) · `getTranche` · webhook verification. **Nothing else.**

## Implemented foundation boundary

`packages/yard-domain` implements immutable, versioned Blueprint terms. Only the final milestone uses `code.final@1`. A local FROZEN terms record is not a funded or signed Stood allowance; approval and red-baseline references must come from qualified authority adapters before runtime activation. The durable local Board and intake commands are described below; qualified approval, funding and the remaining API above are still planned.

The WorkOrder domain implements pre-payment claims, build/submission/checking, fixed 48-hour leases and explicit expiry/repost. It retains unresolved submitted/checking work instead of making it claimable. It cannot project PAID or a refusal: qualified signed Stood projections remain T-0189. The aggregate stays independent of storage. Durable claim replay is implemented in the local Board slice below; funding coordination remains T-0187.

T-0176 supplies operator-only `provisionYard` for an existing NOLOGIN migration owner and a restricted LOGIN runtime role. It creates the separate `yard` schema and migration record transactionally, checks for existing cross-role/public privileges, and sets future table/sequence defaults. Runtime has no schema CREATE, migration write or Stood table grants. Real-Postgres tests use disposable databases and random roles. Domain table migrations, connection wiring, deployment provisioning and periodic permission-drift auditing are still planned. Do not call provisioning using runtime credentials.

The server-side Stood SDK implements only DRAFT creation/read and QUEUED package-reference submission/read. It cannot dispatch or decide payments. Yard web uses Yard API rather than embedding platform credentials. The broader calls listed above require the full qualified Stood API; current contracts are tested against the local router with fake storage.

## Durable local Board slice

An explicitly configured Board now persists checked Blueprint terms and replayable WorkOrder actions in the restricted `yard` schema. Posting requires frozen terms. Signed operator commands bind their complete command context; operator identity/root comes from server configuration. Claims serialize under the project row lock, last exactly 48 hours and replay without extending the lease. Submit enters CHECKING, never PAID.

`Yard-Signature: t=<unix-seconds>,v2=<hex HMAC-SHA256(operatorSecret, canonical-request)>` signs the UTF-8 encoding of `JSON.stringify(["yard.request@2", timestamp, keyId, method, target, idempotencyKey, ifMatch, contentType, lastEventId, rawBody])`. All values are strings; absent headers and GET bodies use empty strings. `keyId` is the actual Yard-Key-Id, method is uppercase and target is the external pathname plus exact query, including `/yard/v1`. Sign the URL and normalised header values actually sent. The five-minute window and 64 KiB body bound still apply. Request v1 is rejected. The browser mock gateway signs on the server; no HMAC secret enters the browser. Stood notification delivery v1 remains separate and uses its webhook secret.

Event subscriptions sign both the query cursor and Last-Event-ID header. Reconnects must use a fresh signature for the actual target/header values. The mock browser gateway handles that per request. Event-feed permission checking verifies the same target as the outer router; it does not reconstruct a query-free path. See [ADR-0021](../adr/0021-yard-command-signatures-and-event-cursors.md).

This local slice uses `/yard/v1/blueprints/{project}/work-orders/{milestone}` for read/claim/build/submit, and POST `/yard/v1/blueprints/{project}/work-orders` to post. Commands require `Idempotency-Key` and `If-Match` (the project event version). Responses acknowledge `{id, version, accepted, simulated}`; snapshots and numbered SSE events carry state. Discovery exposes work terms rather than the full private project.

The optional simulated Stood notification receiver verifies HMAC, obtains a matching Stood read proof, then checks the tranche, package, capture effect, reference, currency and amount against the submitted work. Duplicate event IDs replay; conflicting outcomes cannot rewrite a paid projection. Every such projection remains labelled simulated. It is not qualified live webhook processing. Operator registration/payees, automatic funding on claim, expiry/repost orchestration, refusal/rework, reputation and production authentication remain planned. The default unconfigured server still exposes the shell.

Board discovery uses project keyset pages: `GET /yard/v1/board?after=<nextCursor>`. Always follow a non-null `nextCursor`, even when a page has no open work. Public cards omit repository, base commit and buyer identity; an authenticated claimed builder retrieves these through the scoped project read.

Package submission first records a claim-bound outbox intent and emits submission.reserved. The work order shows SUBMITTING until an exact Stood package receipt is attached. A lost reply is recovered using the persisted package idempotency key; confirmed intents never call the provider again. Recovery scans all project pages. This delivers metadata only and cannot mark a milestone paid. Financial proof remains separate.

### Implemented local intake autosave

When an intake store is explicitly configured, these signed routes operate on private draft records in `yard.intakes`, separate from the Board's projects:

| Method | Route | Body / version |
|---|---|---|
| POST | `/yard/v1/intakes` | `{id, step, draft}`; If-Match `0` |
| PUT | `/yard/v1/intakes/{id}` | `{step, draft}`; current positive If-Match |
| GET | `/yard/v1/intakes/{id}` | Owner-only record; private, no-store |
| GET | `/yard/v1/intakes/{id}/events` | Owner-only numbered `intake.saved` metadata |

Saves require an Idempotency-Key and request v2 signature. `step` is zero-based (0–7). The server supplies owner and time; neither belongs in the body. The response is `{id, owner, version, step, draft, createdAt, updatedAt}`, with epoch milliseconds from the shared clock. Retry the exact request/key after a lost response; a changed body conflicts. A stale version requires reloading. Draft, retry receipt and audit event commit together. Events contain only `{step, version}`, never the answers. The current record has a deferred foreign key to its audit version, and database guards reject mismatched owner/step/time or extra event payload fields.

Unknown fields and recognised credential formats are refused with a bounded 422 response. Service choices contain no credential slots. The health capability reports `intake` separately from `credentials`; credentials and real payments remain disabled. Hosted authentication, retention/export, the full wizard and qualified signing remain separate work.

### Saved-intake planning (local implementation)

`POST /yard/v1/intakes/:id/plan` accepts an empty JSON object, a signed `If-Match` intake version and an `Idempotency-Key`. Only the owning buyer can call it. A configured repository port resolves the selected repository head; the complete saved intake is snapshotted into a deterministic planning thread. The response is a private review draft, with no Board or payment write. Stale versions conflict; incomplete or expired new work is rejected. An exact retry returns the existing draft without new provider work. This endpoint is unavailable when the planning/repository composition is absent; there is no mock fallback in the ordinary service.

### Local site log

When a scanned site-log composition is configured, `/yard/v1/blueprints/{project}/work-orders/{milestone}/log` accepts a signed POST `{lines: [...]}` with an Idempotency-Key and serves a private GET snapshot. The POST has its own sequence and does not require the project If-Match: logging cannot mutate the project. The API assigns sequence, actor and shared-clock time. Only the exact current builder/root may write while its unexpired claim is CLAIMED or BUILDING. The owning buyer and current claimed builder may read retained history. Project-wide access does not grant access to another builder's log.

Kinds are `plan`, `edit`, `test_run`, `commit`, `submit`, `punch_list_received`, `clock_out` and `note`. A request contains 1–20 plain-text lines, each at most 2,048 characters and 20 text lines. Test facts require integer passed/total counts; commit and submit facts require a SHA. Unknown fields, private reasoning kinds, client actor/time and recognised keys are refused. Gitleaks scans every accepted line before storage. A secret match refuses the whole batch without echoing it; an unavailable scanner returns SCAN_UNAVAILABLE. New requests are limited to one per second per builder across all work orders; an exact retry returns the original receipt without consuming another interval. Changing a reused key conflicts.

GET `/yard/v1/blueprints/{project}/work-orders/{milestone}/log/events` streams `site_log.line`, using the log's own sequence and authenticated cursor. Its envelope is `{seq, actor, at, type, payload}`, with the checked line as payload. Snapshots return `{version, retainedFrom, lines, summary}` and at most 200 retained rows. Cursors outside retained history require a new snapshot. Appending a log never appends a project or Stood event.

Tables `yard.site_logs`, `site_log_lines`, `site_log_commands` and `site_log_writers` separate display history, hash-only retry receipts and builder-wide rate limiting. Appending locks the same project row as claim changes, rechecks authority and commits all log writes together. Ninety-day retention folds old rows into cumulative counts by kind before deleting their message text; sequence and retry identity remain. The configured local worker sweeps a bounded 100 streams per minute, skips overlapping work and retries after a sanitised failure. The hosted Starter service owns the lease-expiry and log-retention jobs (T-0214). [Yard health](https://stood-yard-api.onrender.com/health) reports Board, events, site log and intake readiness. Logs remain authenticated; the Yard payment adapter is still off pending #76.

### Local unsigned blueprint edits

Signed `POST /yard/v1/plans/:id/edits` requires the owning buyer, `If-Match` review version and an `Idempotency-Key`. Its exact body is `summary`, `requirements`, `milestones` (including test id/path/content) and `risks`; fixed intake fields and client-authored payment/profile fields are rejected. The response is a fresh `BUYER_REVIEW` plan. Exact retries return the original saved edit receipt; changed bodies conflict. Version checks, full validation and the checkpoint receipt precede another buyer review pause. No runner, signature, work order or payment is created.

## Hosted browser sessions (C2)

`GET /app/api/session` returns `mode: hosted` and the current role or null. `POST /app/api/session` accepts an owner-issued `access_code`, creates an opaque eight-hour Secure/HttpOnly/SameSite=Strict cookie, and returns the server-owned role. `DELETE /app/api/session` signs out. Session responses are private/no-store. Mutations require the configured Origin; guessing and in-memory entries are bounded. Operator retirement is checked on sign-in and session reads. A restart revokes every session.

The existing signature-v2 proxy forwards only Board, blueprint, plan and intake paths using that operator's server-held key. The hosted runtime never mounts the local demo role-selection endpoint. `GET /app/api/research/ideas` serves only the fixed public Startup Tribunal discovery projection with attribution and caveats, cached for ten minutes. It grants no Board identity or write authority.
