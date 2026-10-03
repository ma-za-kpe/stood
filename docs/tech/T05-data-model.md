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
- Migrations use **Drizzle Kit**, forward-only, checked in, and run on deploy before traffic switches.

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
