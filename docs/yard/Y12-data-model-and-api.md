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

**Auth:** buyers and humans through the app session. Builders and agents through an operator key + signed requests (the same HMAC scheme as Stood).

## A2A (planned)

- `/.well-known/agent.json`: the Yard Board agent card (skills: `post-work-order`, `claim-work-order`, `submit-work`, `create-blueprint`).
- A2A task ↔ work order (claim / submit / status). Punch lists arrive as task messages.

## Calls Yard makes to Stood (SDK)

`createAllowance` · `getAllowance` · `dispatchTranche` · `submitPackage` (repo, SHA, test-bundle hash) · `getTranche` · webhook verification. **Nothing else.**

## Implemented foundation boundary

`packages/yard-domain` implements immutable, versioned Blueprint terms. Only the final milestone uses `code.final@1`. A local FROZEN terms record is not a funded or signed Stood allowance; approval and red-baseline references must come from qualified authority adapters before runtime activation. Persistence, HTTP blueprint commands and the remaining API above are planned.

The WorkOrder domain implements pre-payment claims, build/submission/checking, fixed 48-hour leases and explicit expiry/repost. It retains unresolved submitted/checking work instead of making it claimable. It cannot project PAID or a refusal: qualified signed Stood projections remain T-0189. Claims are still in-memory domain records; concurrent durable claims and funding coordination remain T-0186/T-0187.

T-0176 supplies operator-only `provisionYard` for an existing NOLOGIN migration owner and a restricted LOGIN runtime role. It creates the separate `yard` schema and migration record transactionally, checks for existing cross-role/public privileges, and sets future table/sequence defaults. Runtime has no schema CREATE, migration write or Stood table grants. Real-Postgres tests use disposable databases and random roles. Domain table migrations, connection wiring, deployment provisioning and periodic permission-drift auditing are still planned. Do not call provisioning using runtime credentials.

The server-side Stood SDK implements only DRAFT creation/read and QUEUED package-reference submission/read. It cannot dispatch or decide payments. Yard web uses Yard API rather than embedding platform credentials. The broader calls listed above require the full qualified Stood API; current contracts are tested against the local router with fake storage.

## Durable local Board slice

An explicitly configured Board now persists checked Blueprint terms and replayable WorkOrder actions in the restricted `yard` schema. Posting requires frozen terms. Signed operator commands bind the method, path and body; operator identity/root comes from server configuration. Claims serialize under the project row lock, last exactly 48 hours and replay without extending the lease. Submit enters CHECKING, never PAID.

This local slice uses `/yard/v1/blueprints/{project}/work-orders/{milestone}` for read/claim/build/submit, and POST `/yard/v1/blueprints/{project}/work-orders` to post. Commands require `Idempotency-Key` and `If-Match` (the project event version). Responses acknowledge `{id, version, accepted, simulated}`; snapshots and numbered SSE events carry state. Discovery exposes work terms rather than the full private project.

The optional simulated Stood notification receiver verifies HMAC, obtains a matching Stood read proof, then checks the tranche, package, capture effect, reference, currency and amount against the submitted work. Duplicate event IDs replay; conflicting outcomes cannot rewrite a paid projection. Every such projection remains labelled simulated. It is not qualified live webhook processing. Operator registration/payees, automatic funding on claim, expiry/repost orchestration, refusal/rework, reputation and production authentication remain planned. The default unconfigured server still exposes the shell.

Board discovery uses project keyset pages: `GET /yard/v1/board?after=<nextCursor>`. Always follow a non-null `nextCursor`, even when a page has no open work. Public cards omit repository, base commit and buyer identity; an authenticated claimed builder retrieves these through the scoped project read.
