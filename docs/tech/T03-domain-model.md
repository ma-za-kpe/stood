# T03: Domain model and decision rules

Ubiquitous language: [S06](../stood/S06-voice-and-states.md). Practices: [WoW §5–6](../WAYS_OF_WORKING.md#5-domain-driven-design).

## Aggregates

### `Allowance`
| Field | Type | Invariant |
|---|---|---|
| id | `AllowanceId` (ULID) | — |
| platformId | `PlatformId` | — |
| plot | `Geofence` (center `GeoPoint`, radius m) | radius 25–500 m |
| stages | `Stage[]` (ordered) | ≥ 1, names unique |
| cap | `Money` | = Σ stage.amount, single currency |
| payee | `MerchantRef` | platform's PayPal merchant |
| window | `Duration` per stage | ≤ 28 days (inside PayPal auth validity) |
| maxResubmits | int | 0–5 |
| status | `DRAFT \| AWAITING_SIGNATURE \| SIGNED \| CLOSED` | Immutable after SIGNED (a new version requires a new signature) |
| paymentToken | `VaultTokenRef` | Required when SIGNED |
| version | int | Optimistic lock |

### `Stage` (entity in Allowance)
`name`, `amount: Money`, `requiredShots: ShotSpec[]`, `checklist: ChecklistItem[]`, `fixtures?: FixtureSpec[]` (Channel3 product refs), `dependsOn?: StageName`.

### `Tranche`
| Field | Invariant |
|---|---|
| id, allowanceId, stageName | — |
| amount: Money | = stage.amount |
| state | See the state machine ([T02 §5](T02-architecture.md#5-tranche-state-machine)) |
| authorizationId | Required in HELD / DECIDING / WAITING |
| captureId | **Required iff RELEASED** |
| voidRef | Required iff REFUSED / EXPIRED |
| nonce: `Nonce` | Issued on dispatch, single use |
| heldAt | Drives the timers |
| attempts | ≤ allowance.maxResubmits + 1 |

Methods: `dispatch(auth, nonce, at)`, `startDeciding(pkg)`, `release(capture, decision)`, `refuse(void, decision)`, `wait(reason)`, `expire(void)`, `redispatch()`. Each method checks its invariants and emits events.

### `Package`
`id`, `trancheId`, `platformRef` (idempotency), `photos: Photo[]`, `checklistAnswers`, `platformSignals: PlatformSignal[]` (untrusted inputs), `submittedAt`. Immutable once complete.

### `Decision` (immutable record)
`id`, `packageId`, `outcome: RELEASE | REFUSE | WAIT`, `namedField?` (required for REFUSE), `reason` (the sentence key + params), `checks: CheckResult[]`, `findings: Finding[]`, `ruleSetVersion`, `modelRefs` (model id + version), `decidedBy: RULES | REVIEWER | PAYER`, `decidedAt`.

## Value objects

| VO | Notes |
|---|---|
| `Money` | `{ minor: bigint, currency: 'GBP'\|'USD'\|'EUR'\|… }`. add / sub only for the same currency. Never a float. Formatting lives at the UI edge |
| `GeoPoint` | lat [-90, 90], lng [-180, 180] |
| `Geofence` | `contains(point, accuracyM)` uses haversine distance ≤ radius + min(accuracy, 50) |
| `Nonce` | 3 characters from an unambiguous alphabet (no 0 / O / 1 / I), case-insensitive match |
| `PhotoFingerprint` | 64-bit pHash + optional embedding ref. `distance()` = Hamming |
| `NamedField` | `plot \| reused \| missing:<shot> \| nonce \| stage \| funding \| expired` |
| `Confidence` | 0–1. Thresholds come from the rule set, never hard-coded in adapters |
| `RuleSetVersion` | semver string, stored with each decision |

## Domain events

`AllowanceCreated`, `AllowanceSigned`, `TrancheHeld`, `TrancheFundingFailed`, `NonceIssued`, `PackageSubmitted`, `ChecksCompleted`, `TrancheReleased`, `TrancheRefused`, `TrancheWaiting`, `ReviewRequested`, `HoldReauthorized`, `HoldExpiring`, `TrancheExpired`, `DisputeOpened`, `ReconciliationMismatch`.

Each becomes an outbound webhook `<aggregate>.<verb>` ([T04](T04-api-spec.md#webhooks-out)).

## Checks

| # | Check | Kind | Source | Pass | Fail → | Uncertain → |
|---|---|---|---|---|---|---|
| C1 | Package completeness | rule | package | all required shots present | REFUSE `missing:<shot>` | — |
| C2 | Capture window | rule | server times | all photos taken after dispatch and before the window ends | REFUSE `expired` | clock skew > 5 min → WAIT |
| C3 | Plot | rule | GPS + accuracy | every required photo inside the geofence | REFUSE `plot` (distance) | accuracy > 100 m on > half the photos → WAIT |
| C4 | Mock-location / attestation | rule | platform signals (re-checked where possible) | none, or attestation passed | — | flag present → WAIT |
| C5 | Reused photo | rule over index | pHash Hamming ≤ 6, or embedding cosine ≥ 0.95 vs any prior package or seeded corpus | no match | REFUSE `reused` (match ref) | borderline (7–10) → WAIT |
| C6 | Nonce | model finding | photo 1 | text = nonce (conf ≥ 0.8) | REFUSE `nonce` if confidently different (conf ≥ 0.9) | otherwise WAIT |
| C7 | Stage | model finding | all photos | class = stage (conf ≥ 0.75) | REFUSE `stage` if another class with conf ≥ 0.9 | otherwise WAIT |
| C8 | Re-capture | model finding | all photos | none | — | detected → WAIT |
| C9 | Fixtures spec | model + Channel3 | finishes photos | spec product in top-k | — | mismatch → WAIT (never refuse) |

## Decision rule (pure function)

```
decide(checks, findings, ruleSet):
  hard = first failing check in precedence order [C1, C2, C3, C5, C6, C7]
  if hard exists        → REFUSE(hard.namedField)
  if any check/finding uncertain or flagged (C2–C9) → WAIT(first uncertain reason)
  else                  → RELEASE
```

- **Precedence** is fixed so the payer always sees the most fundamental reason first (missing before plot before reused…).
- **Never refuse on model uncertainty.** Never release on missing data.
- The rule set is versioned. Changing a threshold is a `feat(decision)` with an ADR when it loosens safety.

## Invariant tests (property-based)

- `release` is impossible without a capture id. `refuse` is impossible without a void ref.
- Σ captured for an allowance ≤ cap.
- Same inputs + same rule-set version → same decision (determinism).
- WAIT never results from complete, confident, passing inputs. RELEASE never results from any missing input.
- Geofence distance is symmetric and ≥ 0. Money addition across currencies throws.
