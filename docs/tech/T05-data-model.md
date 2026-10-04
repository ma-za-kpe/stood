# T05: Data model and storage

## Stores

| Store | What | Why this store |
|---|---|---|
| **Postgres** (Neon free tier, 1 GB) | Aggregates, decisions, events (outbox), idempotency keys, webhook deliveries, audit log | Transactions, constraints, open source. Neon free doesn't expire (Render's free Postgres expires after 30 days) |
| **Cloudflare R2** (10 GB free, zero egress) | Photos (originals + thumbnails), dispute packets (PDF / JSON), seeded internet-photo corpus | S3-compatible, free egress for receipts and the reviewer view |
| **Evidence index** | Photo fingerprints / embeddings for near-duplicate search | **Elastic** (partner credits, kNN + hybrid search) or **pgvector** in Neon (free fallback). Same `EvidenceIndex` port |

## Postgres schema (logical)

```text
platforms            (id, name, webhook_url, key_hash, hmac_secret_ref, created_at)
allowances           (id, platform_id, platform_ref UNIQUE(platform_id, platform_ref), status,
                      plot_lat, plot_lng, radius_m, currency, cap_minor, payee_ref,
                      vault_token_ref, window_days, max_resubmits, version, created_at, signed_at)
stages               (allowance_id, idx, name, amount_minor, required_shots jsonb, checklist jsonb,
                      fixtures jsonb, depends_on, PRIMARY KEY(allowance_id, idx))
tranches             (id, allowance_id, stage_idx, state, amount_minor, currency,
                      paypal_order_id, authorization_id, capture_id, void_ref, settlement_effect, settlement_ref,
                      nonce_hash, held_at, attempts, version, updated_at,
                      CHECK (state NOT IN ('RELEASED','REFUSED','EXPIRED','DISPUTED') OR
                             (settlement_ref IS NOT NULL AND settlement_effect IS NOT NULL)),
                      CHECK (state <> 'RELEASED' OR settlement_effect IN ('CAPTURE','VOID')),
                      CHECK (state <> 'REFUSED' OR settlement_effect = 'VOID'),
                      CHECK (state <> 'EXPIRED' OR settlement_effect IN ('VOID','EXPIRE')),
                      CHECK (state <> 'DISPUTED' OR settlement_effect IN ('CAPTURE','VOID')))
packages             (id, tranche_id, platform_ref, status, submitted_at, completed_at,
                      platform_signals jsonb, UNIQUE(tranche_id, platform_ref))
photos               (id, package_id, shot, r2_key, sha256, phash, lat, lng, accuracy_m,
                      captured_at_device, received_at_server, mock_location, exif jsonb)
check_results        (package_id, check_code, source RULE|MODEL, confidence nullable, status, detail jsonb,
                      PRIMARY KEY(package_id, check_code))
findings             (id, package_id, kind, value jsonb, confidence, model_id, model_version, latency_ms)
decisions            (id, package_id, supersedes_decision_id, tranche_id, outcome, effect, named_field, reason_key, reason_params jsonb,
                      rule_set_version, decided_by, actor_ref, decided_at)
paypal_calls         (id, tranche_id, action, request_id UNIQUE, status, paypal_debug_id, http_status, at)
outbox_events        (id, type, aggregate_id, payload jsonb, created_at, published_at)
webhook_deliveries   (event_id, platform_id, attempt, status, response_code, next_attempt_at)
paypal_webhooks_in   (event_id PRIMARY KEY, type, verified, received_at, processed_at)
idempotency_keys     (platform_id, key, request_hash, response jsonb, created_at, PRIMARY KEY(platform_id, key))
reviewers            (id, github_login, role, created_at)
audit_log            (id, actor, action, target, detail jsonb, at)   -- append-only
```

Notes:

- **The CHECK constraints mirror the domain invariants**, as a second line of defence.
- `nonce_hash` stores a hash of the nonce, not the nonce itself. The nonce is returned once, at dispatch.
- `paypal_calls.request_id` = the `PayPal-Request-Id`. Its uniqueness prevents duplicate mutations.
- Money columns are `bigint` minor units. Money never uses floating-point columns.
- Confidence and measured distances are non-money numeric values. Model confidence is required in [0,1]; rule confidence is NULL. Check details include `distance_m` and `matched_package_id`; the selected detail is copied into the immutable decision record (`reason_params`) for audit and sentence generation.
- Decisions form an immutable history, including WAIT followed by a later rules or human decision ([ADR-0009](../adr/0009-assessment-and-payment-confirmation.md)). Hold attempts and payment-operation reservations need their own durable records before money endpoints are enabled; the schema above remains a logical draft, not an applied migration.
- T-0132 must persist original hold attempts separately from renewals (prior/new authorisation ids, completion time, expiry, operation key, visit attempt), plus the current authorisation/honour clock, original deadline, pending renewal's prior state and independent retry counters. All capture/void/renewal reservations share one aggregate concurrency guard; an unresolved renewal blocks settlement. The in-memory domain history is not durable evidence.
- Migrations use **Drizzle Kit**, forward-only, checked in, and run on deploy before traffic switches.

## Implemented payment schema (T-0139)

`services/api/drizzle/` contains forward Drizzle migrations for `payment_streams`, `payment_operations` and `payment_operation_events`. The schema persists operation intent, stable provider UUID, reservation/current versions and outcome reference. A partial unique index excludes competing RESERVED/AMBIGUOUS operations; triggers protect identity, resolved rows and append-only events. See [ADR-0010](../adr/0010-durable-payment-operation-ledger.md).

The migration is integration-tested on local Postgres, including fresh connections and replay. It has not been deployed. `./scripts/dev test:db` creates and removes a randomly named test database on the fixed Compose `db` service; it does not use arbitrary DATABASE_URL. `docker compose run --rm app pnpm db:migrate` explicitly applies the checked-in migrations to the configured local database. No HTTP route invokes them or enables payments.

The T-0140 transaction store locks the stream row, checks its expected version and commits the operation, stable provider request UUID, stream version and event atomically before returning. Reusing a key requires the same tranche, original reservation version and canonical intent; JSONB field order is irrelevant. Definite resolution permits a fresh operation key/UUID, while ambiguous outcomes block it. Immutable timestamp strings survive reload. No HTTP/PayPal executor is wired.

This store does not persist/rehydrate a tranche, original holds, renewal history or domain retry counters. T-0132 stays open until those writes and operation reservation/confirmation share one transaction. Ledger versions are not yet aggregate versions, and a ledger outcome alone must never authorise a financial effect.

Operation updates require increasing versions. RESERVED can become AMBIGUOUS, CONFIRMED or FAILED; AMBIGUOUS can receive further ambiguous observations or become CONFIRMED/FAILED. Resolved rows reject every update. Idempotent callers must return the stored result without rewriting it. Events accept only these four statuses, positive versions, and nonblank references for resolved outcomes.

New operations and each operation's first event must be RESERVED with a null reference, enforced by insert triggers. First-event checks lock the operation row to serialise concurrent inserts. AMBIGUOUS-to-AMBIGUOUS updates intentionally record further unresolved observations with a higher version; identical outcome/reference retries return the existing record without another event. Event order uses stream versions; wall-clock timestamps support the timeline but are not a uniqueness or ordering guarantee.

`created_at` on operations and `recorded_at` on events are immutable `timestamptz` values set by the database clock on insert, overriding any caller-supplied value. The store port exposes them as strings. An ambiguous operation's age can be measured from its first AMBIGUOUS event; provider event time is a separate future field. Existing rows acquire migration-time timestamps when these columns are added, not reconstructed historical times. The reviewer timeline and three-hour unresolved alert remain T-0142 work.

## Tranche recovery record (T-0144)

The pure codec in `domain/tranche-record.ts` creates, advances and restores version-1 JSON records. Each contains the immutable definition, current rule-set version and ordered accepted commands with recorded arguments. Replaying validated domain methods recovers private retry counters, hold/renewal history, decisions, pending operations and terminal settlements; it never reruns evidence checks or processor calls. Unknown/incompatible records and illegal sequences fail closed. See [ADR-0011](../adr/0011-tranche-recovery-record.md).

This format is unit-tested and not yet stored in Postgres. T-0145 must persist immutable prior history and couple each new state change with the operation reservation/outcome under one transaction. T-0132 stays open. Compatibility migrations must precede replay-semantic or rule-version changes (T-0148).

### Safe recovery across decision-rule versions (T-0148)

Older rule versions in the same transition format restore in safe mode, retaining the original decision versions and effects. Future/malformed versions still fail. New captures, assessments, authorisations and renewals are blocked; expiry and a matched cancellation remain available. A cancellation reaches `CANCELLED` only after VOID confirmation. Existing capture/renewal reservations remain for reconciliation and cannot be submitted or raced by another effect. A confirmation of an already-completed capture records a fact, not a new payment. See [ADR-0012](../adr/0012-safe-recovery-across-rule-changes.md).

Dispatch must check `canSubmitPendingOperation` and the unresolved ledger status. Ordinary aggregate writes must preserve the original rule header and prior transitions. T-0145 and T-0056 must honour this restriction before deployment.

## R2 layout

```text
stood-evidence/
  pkg/{package_id}/{photo_id}.jpg          originals (private)
  pkg/{package_id}/{photo_id}.thumb.webp   thumbnails (private, signed URLs)
  packets/{tranche_id}/{decision_id}.pdf   dispute packets
  corpus/seed/{sha256}.jpg                 public-domain construction photos for reused-image checks
```

Every object is private. Access is through signed URLs with a 15-minute TTL (receipts and the reviewer view) or a 5-minute TTL (evidence agent reads).

## Evidence index document

```json
{ "photo_id": "…", "package_id": "…", "plot_cell": "h3:8a2…", "stage": "foundation",
  "phash_bits": [0,1,1,…],        // 64-dim dense_vector (or bit vector) for Hamming / L2
  "embedding": [ … ],             // optional image embedding when available
  "captured_at": "…", "source": "package|seed" }
```

`plot_cell` is a coarse H3 cell (resolution 8), so we never store precise coordinates in the index. It allows "same photo, different plot" queries.

## Retention (demo)

| Data | Retention |
|---|---|
| Photos, packages | 180 days, then deleted (R2 lifecycle rule) |
| Decisions, audit log, PayPal call log | Kept (no personal data beyond refs) |
| Idempotency keys | 24h |
| Webhook deliveries | 30 days |

**Real personal data never enters fixtures or the repo** ([WoW §11](../WAYS_OF_WORKING.md#11-security-and-secrets-open-source-edition)).
