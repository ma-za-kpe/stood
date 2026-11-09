# Site-visit evidence trust and retention proposal (T-0359)

Status: implementation design for owner/counsel review, 2026-10-13, with a disabled receipt-protocol slice added 2026-10-14. This does not qualify an assessment or authorize a payment.

## Current boundary

Stood upload sessions accept 1–10 declared JPEG, HEIC or WebP objects, each no larger than 8 MiB, with a 15-minute upload window. Completion currently checks size, SHA-256 and a short format header, then records `COMPLETE`. It does not fully decode the image, extract trusted metadata, assess site-visit signals, create an attestation, or feed the payment decision. This byte-integrity receipt must remain intake-only.

The EyeOnSite trust flaw from [`af103a4`](https://github.com/ma-za-kpe/eyeonsite/commit/af103a4) was fixed on current `main` at [`d9900c1`](https://github.com/ma-za-kpe/eyeonsite/commit/d9900c1): Firestore client writes are restricted to intake fields, and server processing ignores client assessment fields. The current code adds an optional HMAC-authenticated server endpoint that signs a bounded receipt only after EyeOnSite has processed the evidence, rechecks the matched inspector, and independently hashes canonical Firebase Storage JPEG objects. Stood now binds that signature to a completed upload, the allowance version, tranche, upload id and one-use nonce, then stores an immutable audit receipt. This code is disabled unless operators configure matching keys and has no live qualification. It deliberately signs `UNKNOWN`/`UNVERIFIED` for device provenance because app attestation is not verified server-side. It does not make EyeOnSite's client-supplied GPS/capture metadata authoritative.

## Proposed evidence flow

1. A completed Stood upload remains `INTAKE_ONLY` until a worker claims it using a durable lease. A retry resumes that exact session; it cannot create a second evidence package.
2. The Stood worker fully decodes each bounded image, rejects decompression bombs and unsupported/animated content, recomputes SHA-256 and pHash, extracts available EXIF on the server, and compares all results with the declaration. A hash or decode mismatch yields review, never a pass.
3. An EyeOnSite server produces a bounded Ed25519-signed assessment after verifying its own Firebase/App Check and inspector/task authorization. The signature covers a canonical payload containing issuer/key id, EyeOnSite evidence/task identity, Stood allowance and terms version, tranche, exact image SHA-256 values, capture/server times, nonce, provenance-manifest hash and enumerated signals. Stood verifies the signature against a configured issuer key, freshness, exact image binding and a one-use nonce. Client-provided `PASSED` fields and model claims are never sufficient.
4. Stood independently rechecks what it can: exact bytes and image digest, allowance capture window, plot/location consistency, EXIF consistency and cross-project pHash. A missing or unavailable signal produces `WAIT`; a qualified hard rule may refuse. The vision processor emits only schema-validated labels and confidence; uncertain labels remain `WAIT`. No processor receives PayPal credentials or has a payment-write path.
5. Persist the signed source envelope, recomputed hashes, processor/model versions and bounded findings in an append-only assessment receipt. Keep it separate from raw photos so the final retention policy can delete image bytes without rewriting the financial decision history.

## Safe cleanup and retention fence

Uncompleted `OPEN` sessions are not payment evidence. Stood has an opt-in cleanup worker that targets only their exact `uploads/<session-id>/...` objects one hour after session expiry. It records one append-only receipt per successful object deletion, stores mutable retry scheduling separately, and applies capped exponential backoff after each failure so a repeatedly failing batch does not occupy every later sweep. Each object is retried independently; the worker bounds concurrent deletes and never enumerates or deletes a broad bucket prefix. The `INCOMPLETE_UPLOAD_CLEANUP` switch defaults to `off`; no production cleanup has been enabled or run. Completed sessions are excluded from the query and the object adapter refuses every non-upload key.

Deletion or expiry of completed photos stays disabled pending owner/counsel review. The proposed schedule in [Y22](Y22-project-erasure-proposal.md#recommended-schedule-for-review-not-approved) is 30 days after final assessment and the work-order dispute window for raw photos, with longer retention only for an active hold; a six-year minimum applies only to covered tax/accounting evidence where law requires it, subject to the statutory trigger and any required permission to destroy. A database recovery window containing project content must be no longer than 24 hours unless cryptographic erasure makes those copies unreadable, and restores must apply the erasure register first. These are proposed defaults, not an approved policy. The final policy must specify separate retention for hashes, location/EXIF, signed receipts, model findings, dispute copies, backups and exports. A 90-day upload expiry or a bucket-wide lifecycle rule is not acceptable evidence retention policy.

## Acceptance before trust

- The EyeOnSite client cannot set or update assessment outputs, provenance status or a passed attestation; server processing cannot be bypassed by pre-populating `qualityScore`.
- A server-signed EyeOnSite receipt verifies only for its configured key, fresh nonce, exact evidence/task/tranche/version and exact uploaded image hashes; mutation, replay, wrong issuer and unknown fields fail closed.
- Stood fully decodes each supported image under memory/pixel limits, independently recomputes hashes and pHash, and rejects malformed or decompression-bomb content.
- A lost worker response resumes under the same lease; duplicate submissions do not produce multiple decision receipts; one failed object does not stall another session.
- The janitor removes only expired incomplete objects and resumes safely after a crash. Completed evidence is untouched until an approved retention policy is implemented and tested.
- A consented evaluation set measures false-refusal rate by class before model findings may refuse. Model outage, low confidence or invalid output means `WAIT`.

The current blockers are production qualification, server-verified device attestation, independent image processing and decision policy, and the unapproved completed-photo retention policy. No real buyer photo should enter this disabled assessment path before those are resolved and the whole workflow is qualified. No completed-photo or project deletion is enabled.

## Implemented protocol slice (2026-10-14)

The Stood API accepts only an evidence id, calls EyeOnSite server-to-server over timestamped HMAC, verifies an Ed25519 signature against configured key ids, checks freshness and exact bytes/terms/tranche/upload/nonce, and appends the first semantically identical receipt per upload. Retries can return the stored original even if EyeOnSite reissues the same assessment with a newer timestamp; a changed assessment conflicts. EyeOnSite refuses non-`SUBMITTED` records, unmatched inspectors, duplicate photo ids, missing or oversized image objects, and invalid assessment shapes. Both sides' test suites pass locally. The Render/Firebase production secrets are unset and this path has not been live-qualified. This is authenticated source evidence, not proof the camera captured the scene and not a trusted image classifier.
