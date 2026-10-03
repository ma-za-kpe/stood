# T08: [EyeOnSite](https://github.com/ma-za-kpe/eyeonsite) integration: where it calls Stood, and how payments change

Repo: **[EyeOnSite](https://github.com/ma-za-kpe/eyeonsite)** (Kotlin Multiplatform app + Firebase Cloud Functions in TypeScript, region `africa-south1`). Read on 2026-10-03 at `main`: `functions/src/{escrow,evidence,payments,review}`, `app/shared/.../domain/{EscrowContracts,EvidencePackage,TaskStatus}.kt`, `docs/EOS-08-ESCROW-AND-PAYMENTS.md`.

## 1. How [EyeOnSite](https://github.com/ma-za-kpe/eyeonsite) handles money today

| Step | Today | Problem Stood solves |
|---|---|---|
| Client funds a task | Stripe PaymentIntent **captured immediately** (`createPaymentIntent`) → a Firestore `escrow_transactions` ledger with status `HELD` (`fundTask`) | The money has already left the client. "Escrow" is a ledger label inside the platform's Stripe balance, which raises the same escrow / licensing question as PayPal's AUP |
| Evidence submitted | `onEvidenceSubmitted` computes the quality score and fraud signals | Good signals, but nothing binds them to the release |
| Release | Client taps Accept → `releaseEscrow` → ledger `RELEASED` → Flutterwave payout to the inspector | — |
| Auto-accept | **Planned `checkAutoAcceptTimers`: 48h after submission, auto-ACCEPT and release** | ⚠️ **A timer releases money without proof.** That's fail-*open*, exactly what Stood exists to prevent |
| Dispute | `DISPUTED` freezes the ledger, and the platform mediates | No packet, so a dispute is an argument |
| Scope | Pays for **the inspection** (for example GHS 60) | **Doesn't touch the build money** (for example £4,000), which still goes by blind transfer |

## 2. How payments are redefined with Stood

Stood changes [EyeOnSite](https://github.com/ma-za-kpe/eyeonsite) from "escrow the inspection fee" to **"hold the build money at PayPal until an inspection proves the stage"**:

1. **A new product flow: staged project payments.** A client creates a **project** (one plot, several stages). Each stage is a Stood **tranche**, and each tranche's proof is an **[EyeOnSite](https://github.com/ma-za-kpe/eyeonsite) inspection task**. The inspection becomes the *gate*, not just the product.
2. **Inspection fees move from capture-now to hold-then-capture.** The inspection fee can be a small tranche of its own, or bundled into the stage tranche. It's authorised at dispatch and captured only when Stood releases.
3. **"Escrow" disappears from the money path.** The client's money stays **authorised at PayPal** (a hold on the payer's PayPal funding) until release. [EyeOnSite](https://github.com/ma-za-kpe/eyeonsite) never pools it. Firestore keeps a *mirror* of the state, not the money.
4. **Auto-accept by timer is removed.** Expiry → **void** ("The hold ended. Nothing was paid."). Release happens only by rules (Stood), a reviewer decision, or an explicit payer acceptance, and all of these are recorded.
5. **Local payouts stay with [EyeOnSite](https://github.com/ma-za-kpe/eyeonsite).** After `tranche.released`, [EyeOnSite](https://github.com/ma-za-kpe/eyeonsite) pays the **inspector fee** and the **builder draw** in GHS / UGX / KES / NGN via its existing `initiateInspectorPayout` (Flutterwave), extended with a builder payout.
6. **Stripe stays as a legacy rail** for plain inspection tasks (`MoneyProvider.STRIPE`). Stood's `PaymentGateway` port means a Stripe manual-capture adapter is possible later (Stripe auth holds are shorter: 7 days for cards).

## 3. Call sites ([EyeOnSite](https://github.com/ma-za-kpe/eyeonsite) → Stood)

| # | [EyeOnSite](https://github.com/ma-za-kpe/eyeonsite) location (existing or new) | Calls Stood | When |
|---|---|---|---|
| E1 | **New** callable `createProject` (`functions/src/stood/createProject.ts`) | `POST /v1/allowances` → returns `approve_url` | Client finishes the new "Project" form (plot pin, stages, amounts) |
| E2 | Client app opens `approve_url` (Custom Tab / ASWebAuthenticationSession / browser) | — (PayPal) | Same screen |
| E3 | **New** HTTPS function `stoodWebhook` (`functions/src/stood/webhook.ts`) | Receives Stood webhooks (HMAC-verified) | Every Stood event |
| E4 | **Changed** `fundTask` → `dispatchStage` | `POST /v1/tranches/{id}/dispatch` → `{state: HELD, nonce}` | Client (or schedule) says the stage is ready. The task becomes visible to inspectors **only after HELD** |
| E5 | **Changed** `onEvidenceSubmitted` (end of the function) | `POST /v1/tranches/{id}/packages` with photo `source_url`s (Firebase Storage signed URLs) + metadata + the existing `EvidenceTrustAnalysis` as `platform_signals` → `.../complete` | After [EyeOnSite](https://github.com/ma-za-kpe/eyeonsite)'s own trust analysis completes |
| E6 | **Changed** `releaseEscrow` (client "Accept") | `POST /v1/tranches/{id}/decisions/override` with `decided_by: PAYER` | Only valid while Stood says `WAITING`. A rules release needs no click |
| E7 | **Changed** `onTaskReviewed` → `DISPUTED` | `POST /v1/tranches/{id}/disputes` | Client disputes |
| E8 | **Removed** `checkAutoAcceptTimers` | — | Replaced by Stood hold timers |
| E9 | Inspector app | Shows the **nonce** on the capture screen ("Write K7Q on paper and include it in the first photo"), plus a new `nonce_card` required shot | Capture flow |

## 4. Webhook handling in [EyeOnSite](https://github.com/ma-za-kpe/eyeonsite) (`stoodWebhook`)

| Stood event | [EyeOnSite](https://github.com/ma-za-kpe/eyeonsite) task status | Action |
|---|---|---|
| `allowance.signed` | project `ACTIVE` | Enable stage dispatch |
| `tranche.held` | `ESCROW_FUNDED` → *rename to `HELD`* | Start matching (`onTaskCreated`) |
| `tranche.funding_failed` | `POSTED` (blocked) | Show the sentence to the client. No matching |
| `tranche.released` | `ACCEPTED` | `initiateInspectorPayout` (fee) + **new** `initiateBuilderDraw`. Ledger entries `PAYOUT`. FCM to inspector and client with the sentence |
| `tranche.refused` | `REVISION_REQUESTED` (reuses the existing revision flow!) | Show the named field and redo instruction to the inspector. Fee not paid for this visit |
| `tranche.waiting` | `UNDER_REVIEW` | Notify. The reviewer acts in Stood |
| `tranche.hold_expiring` / `expired` | `EXPIRED` | Notify the client |
| `dispute.opened` | `DISPUTED` | Link the packet in the admin view |

## 5. Data and type changes in [EyeOnSite](https://github.com/ma-za-kpe/eyeonsite)

- `MoneyProvider`: add `PAYPAL`.
- `EscrowStatus` mapping: `HELD` = PayPal authorised · `RELEASED` = captured · `REFUNDED` → split into `VOIDED` (never captured) / `REFUNDED` (captured, then refunded) · `FROZEN` stays for disputes.
- `TaskStatus`: `AUTO_ACCEPTED` is deprecated (no timer releases). Add `EXPIRED` handling via Stood.
- Firestore `tasks/{id}` gains `stood: { allowanceId, trancheId, state, nonceShownAt, decisionId, namedField, receiptUrl }`. `projects/{id}` (new) mirrors the allowance and stages.
- Kotlin `EvidencePackage.isTrustedForAutoAccept()` stays as a **client-side hint only**. The authoritative decision is Stood's.
- Copy and brand: replace "escrow-backed" with "**held by PayPal until the evidence passes**" (legal accuracy; see [ADR-0004](../adr/0004-authorise-on-dispatch-capture-on-proof.md)).

## 6. SDK and auth

- [EyeOnSite](https://github.com/ma-za-kpe/eyeonsite) Cloud Functions use the **Stood TypeScript SDK** (APIMatic-generated from `openapi/stood.yaml`), pinned by version.
- Secrets: `STOOD_API_KEY`, `STOOD_HMAC_SECRET`, `STOOD_WEBHOOK_SECRET` in **Google Secret Manager** ([EyeOnSite](https://github.com/ma-za-kpe/eyeonsite)'s existing secret store).
- Kotlin apps never call Stood directly. Everything goes server-to-server through Cloud Functions, so no Stood keys sit on devices.

## 7. Migration plan

| Step | Change | Risk control |
|---|---|---|
| 1 | Add the `stood/` functions folder, the SDK and the webhook, behind the feature flag `stoodPayments` | Off by default |
| 2 | New "Project" flow (client app) using Stood. Existing single-inspection tasks unchanged | No change for current users |
| 3 | Inspector app: show the nonce + `nonce_card` shot when `task.stood` is present | Harmless when absent |
| 4 | Wire E5 (`onEvidenceSubmitted` → Stood) | Idempotent package ref = [EyeOnSite](https://github.com/ma-za-kpe/eyeonsite) evidence doc id |
| 5 | Remove the planned auto-accept timer. Document the change in [EyeOnSite](https://github.com/ma-za-kpe/eyeonsite)'s EOS-08 | — |
| 6 | Later: move plain inspection tasks onto Stood too (fee-only tranche) | Per-task flag |

## 8. What the hackathon demo uses

- **Kojo's capture:** the real [EyeOnSite](https://github.com/ma-za-kpe/eyeonsite) **Android app** on a low-end phone. This meets the rule "show the project working on the device it was built for".
- **Ama:** [EyeOnSite](https://github.com/ma-za-kpe/eyeonsite) client web or app for the project form, PayPal sandbox approval (Kernel-driven in replays), and Stood's receipt page.
- **Judges without the app:** Stood's `/demo/scenarios/*` fixtures replay the same flow server-side ([T04](T04-api-spec.md#demo-hackathon-only-behind-a-demo_mode-flag)).
