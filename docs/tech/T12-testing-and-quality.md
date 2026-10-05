# T12: Testing strategy and quality gates

Policy: [WoW §4](../WAYS_OF_WORKING.md#4-test-driven-development). This page is the concrete plan.

## Test layers

| Layer | Tool | Scope | Examples |
|---|---|---|---|
| Domain unit | Vitest + fast-check | `domain/**` (pure) | `Money` arithmetic properties, `Geofence.contains`, tranche transitions, `decide()` table |
| Application | Vitest + in-memory port fakes | `application/**` | `submitPackage` → refuse path voids exactly once, retries don't double-capture |
| Adapter contract | Vitest + recorded HTTP (MSW) / Testcontainers | `adapters/**` | PayPal authorise / capture / void / reauthorise, Neon / Drizzle repositories, R2 presign, Elastic and pgvector index parity |
| API | Vitest + Hono test client | `http/**` | HMAC auth, idempotency 409, problem+json, OpenAPI conformance |
| E2E (judge path) | Playwright (local), Kernel (cloud replay) | Hosted or compose stack | The five fixtures, from allowance to receipt |
| Model evaluation | Script + a labelled set | `evidence-agent` | Stage accuracy, nonce OCR accuracy, **false-refusal rate**. Must clear thresholds before REFUSE is enabled on C7 |

## Fixtures (shared by tests, demo, Postman)

| Fixture | Expected | Named field |
|---|---|---|
| `good` | RELEASE | — |
| `wrong-plot` (1.4 km off) | REFUSE | `plot` |
| `recycled` (pHash matches an earlier package) | REFUSE | `reused` |
| `wrong-stage` (blockwork shown for roofing) | REFUSE or WAIT (per the threshold flag) | `stage` |
| `substituted-fitting` | WAIT | `fixtures` |
| `nonce-unreadable` | WAIT | `nonce` |
| `mock-location-signal` | WAIT | — |
| `funding-declined` | WAIT_FUNDING | `funding` |
| `hold-expiry` (clock advanced 29 days) | EXPIRED | `expired` |

Photos in fixtures are **synthetic or public-domain**, with GPS values that are synthetic too.

## Gates

| Gate | Where | Threshold |
|---|---|---|
| Format / lint (Biome), types (strict) | pre-commit + CI | 0 errors |
| Money boundary (dependency-cruiser) | pre-commit + CI | 0 violations |
| Banned words in UI copy | pre-commit + CI | 0 hits |
| Coverage | CI | ≥ 85% branch overall. **100%** on `domain/decision`, `domain/tranche`, `Money` |
| Mutation (Stryker) | Nightly + before release | ≥ 80% on `domain/decision` |
| Contract tests (recorded) | CI | All pass |
| Live sandbox contract tests | Nightly | All pass, or a filed issue |
| E2E judge path | `main` + release | 5 / 5 fixtures |
| OpenAPI diff | PR | No breaking change without `feat!` |
| Secrets (gitleaks), links (lychee) | pre-commit + CI | 0 findings |
| Accessibility (axe via Playwright) | `main` | 0 serious violations. Greyscale screenshot review on the decision screen |

## TDD order for the first slices (milestone 0.2.0)

The implemented Docker hook (`scripts/check-product`) runs unit/domain validation, then starts the pinned Compose Postgres and runs `pnpm test:db`. Database tests use isolated temporary databases and real migrations, never an in-memory substitute. `vitest.config.ts` excludes DB tests/adapters from its unit report; `vitest.db.config.ts` covers them separately with an enforced 85% floor for statements, branches, functions and lines. Domain coverage remains 100%. A missing database is a failing integration run, not a skipped check. Standalone container image builds run `pnpm validate`; local pre-commit and CI additionally require the DB suite.

1. `Money` (properties) → `Geofence` → `Nonce`.
2. `Tranche` state machine (illegal transitions throw; release requires capture).
3. `decide()` table tests from [T03](T03-domain-model.md#checks) (C1–C5 first).
4. `submitPackage` use case with fake `PaymentGateway` (refuse → void exactly once).
5. PayPal adapter contract tests (recorded sandbox) → wire the real adapter.
6. HTTP layer + fixtures `wrong-plot` and `good` end to end.

The ten local demo scenarios are unit-tested fixtures. `funding-declined` and `hold-expiry` expose lifecycle state separately from the assessment outcome; both use outcome WAIT and execute no payment. Expiry advances the explicit domain clock, reserves cancellation, then supplies a simulated provider-expiry proof. It never confirms expiry from elapsed time alone. Hosted/sandbox replay remains separate qualification.

The T-0028 draft slice adds signed HTTP tests and real-Postgres tests for concurrent idempotency, restart response replay, tenant isolation, immutable ownership and final-write rollback. Its HTTP/Postgres scenario creates a DRAFT/PENDING stage, reads it and rejects changed request bytes; it does not qualify sandbox authorisation, evidence uploads or payment execution. Adapter tests use SDK mocks/synthetic bodies and fake-executor crash tests, never recorded provider evidence. Actual qualification remains T-0121.
