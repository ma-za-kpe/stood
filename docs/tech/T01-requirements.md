# T01: Requirements

## Code-milestone requirements (planned unless stated)

Existing FR IDs stay stable; field requirements below are scenario-specific.

| ID | Requirement | Pri |
|---|---|---|
| FR-70 | Freeze signed acceptance-test manifest, hashes and test identities before building; changes require a new buyer-approved contract | M |
| FR-71 | Fetch exact repository/base/new commit with read-only GitHub credentials; detect renamed/reused diffs, path violations and unapproved dependencies; never push/merge | M |
| FR-72 | Run builder code outside the payment service with no network/secrets and bounded time, memory, CPU, processes, disk and output | M |
| FR-73 | Verify signed runner identity/image, exact commit/test hashes, all required tests and zero skips/selective runs; client PASS is insufficient | M |
| FR-74 | Bind mutation scope/threshold to signed contract; missing or weak test quality means WAIT | M |
| FR-75 | Bind operator/payee, USD cap and milestone to buyer mandate; agent chains cannot increase authority | M |
| FR-76 | Usage release requires independent outside-authority proof and any agreed human acceptance, bound to allowance/commit; reject circular or self-attested demand | M |
| FR-77 | Human/agent buyer and builder receive the same verdict for the same authenticated evidence | M |

T-0157 implements the RULE profile only; FR-70–76 require the separately tracked trusted adapters. Local DRAFT metadata is not approval or evidence. Example cap $4,000, build milestone $1,200.

Source specs: [S04 outcomes](../stood/S04-job-story-and-outcomes.md), [S05 features](../stood/S05-feature-list.md), [S06 voice](../stood/S06-voice-and-states.md), [S11 evidence integrity](../stood/S11-evidence-integrity.md). IDs are stable. Tests and PRs reference them (`Refs: FR-12`).

Priority: **M** = must (hackathon), **S** = should (hackathon if time), **L** = later.

## Functional requirements

### Allowance (the payer's agreement)

| ID | Requirement | Pri |
|---|---|---|
| FR-01 | A platform can create an **allowance**: plot (lat/lng + geofence radius), ordered stages (name, amount, currency, required shots, checklist, optional fixtures spec), payee (platform merchant), inspection window, max re-submissions, dispute contact | M |
| FR-02 | Stood returns a PayPal **approval link** (Vault setup token) so the payer signs once. Stood records the allowance as `SIGNED` only after PayPal confirms a payment token | M |
| FR-03 | An allowance is **immutable once signed**. Changes create a new version that needs a new signature | M |
| FR-04 | Total authorised across stages can never exceed the allowance cap (invariant) | M |
| FR-05 | Fixtures spec: a stage may list product URLs. Stood resolves each via Channel3 into attributes and reference images | S |

### Tranche and hold

| ID | Requirement | Pri |
|---|---|---|
| FR-10 | On **dispatch** of a stage, Stood creates a PayPal order with `intent=AUTHORIZE` for that stage amount, using the vaulted token (human not present), and records the tranche as `HELD` | M |
| FR-11 | Stood issues a per-visit **nonce** (short code) on dispatch | M |
| FR-12 | Hold timers: reauthorise from day 4 if still undecided, warn at day 27, void at day 29. **An expiry is never a release** | M |
| FR-13 | If authorisation fails (funding declined), the tranche goes to `WAIT_FUNDING` with a plain sentence. Nothing is dispatched to inspect | M |

### Evidence package

| ID | Requirement | Pri |
|---|---|---|
| FR-20 | A platform submits a **package**: photo references (signed URLs or uploads), per-photo GPS + accuracy + device and server times + mock-location flag, checklist answers, platform findings (for example [EyeOnSite](https://github.com/ma-za-kpe/eyeonsite) fraud signals, App Check verdict, pHash) | M |
| FR-21 | Stood stores photos in object storage and computes its own pHash. Platform-provided values are **inputs to re-check, not trusted verdicts** | M |
| FR-22 | Packages are idempotent per `(tranche, package_ref)`. Re-submission after a refusal creates a new package and keeps the old one | M |

### Checks and decision

| ID | Requirement | Pri |
|---|---|---|
| FR-30 | **Plot check:** every required photo within `geofence radius + accuracy allowance`. Named field `plot` with the distance in metres | M |
| FR-31 | **Reused-photo check:** near-duplicate against all prior packages on all plots and the seeded internet corpus. Named field `reused` with the matched package / date | M |
| FR-32 | **Required-shots check:** every required shot and checklist item present. Named field `missing:<shot>` | M |
| FR-33 | **Nonce check:** the model reads the code in the first photo. Mismatch → refuse (`nonce`). Unreadable → wait | M |
| FR-34 | **Stage recognition:** the model classifies the visible stage. A clear mismatch with high confidence → refuse (`stage`). Low confidence → wait | M |
| FR-35 | **Re-capture detection** (photo of a screen or print) → wait for review | S |
| FR-36 | **Fixtures spec check** (Channel3 image search). Mismatch → **wait**, never refuse | S |
| FR-37 | **Decision** = a pure function of check results: any hard failure → `REFUSE(named field)`. Any uncertain result → `WAIT(reason)`. All pass → `RELEASE`. The order of precedence is fixed and documented in [T03](T03-domain-model.md) | M |
| FR-38 | **Release** captures the authorisation (idempotent). **Refuse** voids it (idempotent). Both write a decision id, allowance id, agent flag and evidence reference onto the PayPal order (`custom_id`, `invoice_id`, note) | M |
| FR-39 | Reviewer override for `WAIT`: release or refuse, with a mandatory one-line reason, recorded as a **human decision** | M |
| FR-40 | Payer acceptance (human present) may release a `WAIT` tranche. Recorded as a payer decision | S |

### Records and disputes

| ID | Requirement | Pri |
|---|---|---|
| FR-50 | **Receipt:** a signed, expiring link that opens without an account. It shows the decision, sentence, amount, time, photos (thumbnails), capture id and a "dispute" link | M |
| FR-51 | **Dispute packet:** the allowance as signed, the package, check results, model findings with confidence, timeline and PayPal ids, as PDF + JSON | M |
| FR-52 | Submit the dispute evidence via the PayPal Disputes API where the sandbox supports it. Otherwise mark it "ready to file". **Never fake success** | S |
| FR-53 | **Reviewer file:** an AG Studio dashboard of all decisions plus a wait queue plus reconciliation | M |
| FR-54 | **Reconciliation:** compare PayPal Transaction Search with Stood decisions. Flag capture-without-release (bypass), release-without-capture after 3h, and authorisations older than 27 days | S |
| FR-55 | **Stage Gantt** (Bryntum) on the allowance and receipt. Bars locked until the predecessor is released. AI chat "why is X blocked?" | S |

### Integration and notifications

| ID | Requirement | Pri |
|---|---|---|
| FR-60 | Outbound **webhooks** to the platform for every domain event, HMAC-signed, retried with backoff, at-least-once, with an idempotent event id | M |
| FR-61 | Inbound PayPal webhooks verified (`verify-webhook-signature`), deduplicated, and reconciled | M |
| FR-62 | Notifications: the one-line sentence to payer / inspector / reviewer via a `Notifier` port (Zapier adapter + email fallback) | S |
| FR-63 | Generated SDK (TypeScript) and OpenAPI spec published. MCP server generated (if APIMatic access is granted) | S |
| FR-64 | Demo **fixtures + replay**: judges trigger each outcome. Kernel drives sandbox buyer approval | M |

## Non-functional requirements

| ID | Category | Requirement |
|---|---|---|
| NFR-01 | Money safety | **No double capture:** every money command has a durable identity per tranche, authorisation attempt and action. Its stable provider request UUID is reused on retries and distinct after redispatch. `PayPal-Request-Id` is set on every mutating call |
| NFR-02 | Money safety | **Fail closed:** unknown, missing or contradictory data → `WAIT`. Never an implicit release |
| NFR-03 | Architecture | Only the payments adapter imports the PayPal SDK. The evidence agent has no PayPal credentials (separate runtime). Enforced in CI ([ADR-0003](../adr/0003-rules-move-money.md)) |
| NFR-04 | Correctness | Money is integer minor units + ISO 4217. No floats |
| NFR-05 | Latency | Decision p95 ≤ 60s after package complete (model calls included), excluding the free-tier cold start (≤ 90s documented) |
| NFR-06 | Availability | Hackathon demo: hosted URL reachable during judging (1 Oct – 21 Dec 2026), uptime monitor every 15 min. Not production SLAs |
| NFR-07 | Cost | **$0/month baseline** on free tiers and partner credits ([T10](T10-deployment.md)). Any paid line item needs an ADR |
| NFR-08 | Security | Secrets only in platform env stores. HMAC on all webhooks. Signed, expiring receipt links. Least-privilege keys per service |
| NFR-09 | Privacy | No real personal data in the repo or fixtures. Photos are stored privately with signed URLs. Retention of 180 days for demo data. Plot coordinates aren't exposed on public receipts (distance only) |
| NFR-10 | Accessibility | WCAG 2.2 AA. Greyscale-safe decisions. Field-scenario screens ≥ 16px with 48px targets ([S15](../stood/S15-design-system.md)) |
| NFR-11 | Auditability | Every decision is reproducible from stored inputs plus the rule version. The decision record stores the rule-set version and model id / version |
| NFR-12 | Portability | Processor-agnostic domain (a `PaymentGateway` port). PayPal is the first adapter |
| NFR-13 | Observability | Structured logs with correlation ids (tranche, package, decision, PayPal debug id). Metrics: decisions by outcome / field, false-refusal rate, hold age, capture failures |
| NFR-14 | Quality | Coverage ≥ 85% branch overall, 100% on decision and money. Mutation score ≥ 80% on decision ([WoW §4](../WAYS_OF_WORKING.md#4-test-driven-development)) |
| NFR-15 | Openness | Every dependency is open source, or free tier / partner-provided with a documented free fallback ([T09](T09-tech-stack.md)) |

## Constraints

- PayPal **sandbox only** (hackathon rules). No live keys anywhere.
- Ghana PayPal accounts can't receive. Stood never pays inspectors or builders. The platform does, on local rails.
- PayPal escrow needs pre-approval, so Stood never holds pooled funds ([ADR-0004](../adr/0004-authorise-on-dispatch-capture-on-proof.md)).
- Authorisations last 29 days, with a 3-day honour period.
