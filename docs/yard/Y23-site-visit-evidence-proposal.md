# Site-visit evidence trust and retention proposal (T-0359)

Status: design for implementation and owner/counsel review, 2026-10-13. This proposal does not qualify an assessment or authorize a payment.

## Current boundary

Stood upload sessions accept 1–10 declared JPEG, HEIC or WebP objects, each no larger than 8 MiB, with a 15-minute upload window. Completion currently checks size, SHA-256 and a short format header, then records `COMPLETE`. It does not fully decode the image, extract trusted metadata, assess site-visit signals, create an attestation, or feed the payment decision. This byte-integrity receipt must remain intake-only.

The EyeOnSite trust flaw from [`af103a4`](https://github.com/ma-za-kpe/eyeonsite/commit/af103a4) was fixed on current `main` at [`d9900c1`](https://github.com/ma-za-kpe/eyeonsite/commit/d9900c1): Android now reports `UNKNOWN` until server attestation is configured, Firestore client writes are restricted to intake fields, and `onEvidenceSubmitted` ignores client assessment fields and no longer skips processing when `qualityScore` is present. That closes the client-writable assessment bypass. It still does not produce a signed per-evidence receipt that Stood can verify, and Stood must continue treating the EyeOnSite assessment as untrusted until a cross-service receipt is designed and qualified.

## Proposed evidence flow

1. A completed Stood upload remains `INTAKE_ONLY` until a worker claims it using a durable lease. A retry resumes that exact session; it cannot create a second evidence package.
2. The Stood worker fully decodes each bounded image, rejects decompression bombs and unsupported/animated content, recomputes SHA-256 and pHash, extracts available EXIF on the server, and compares all results with the declaration. A hash or decode mismatch yields review, never a pass.
3. An EyeOnSite server produces a bounded Ed25519-signed assessment after verifying its own Firebase/App Check and inspector/task authorization. The signature covers a canonical payload containing issuer/key id, EyeOnSite evidence/task identity, Stood allowance and terms version, tranche, exact image SHA-256 values, capture/server times, nonce, provenance-manifest hash and enumerated signals. Stood verifies the signature against a configured issuer key, freshness, exact image binding and a one-use nonce. Client-provided `PASSED` fields and model claims are never sufficient.
4. Stood independently rechecks what it can: exact bytes and image digest, allowance capture window, plot/location consistency, EXIF consistency and cross-project pHash. A missing or unavailable signal produces `WAIT`; a qualified hard rule may refuse. The vision processor emits only schema-validated labels and confidence; uncertain labels remain `WAIT`. No processor receives PayPal credentials or has a payment-write path.
5. Persist the signed source envelope, recomputed hashes, processor/model versions and bounded findings in an append-only assessment receipt. Keep it separate from raw photos so the final retention policy can delete image bytes without rewriting the financial decision history.

## Safe cleanup and retention fence

Uncompleted `OPEN` sessions are not payment evidence. Stood now has an opt-in cleanup worker that targets only their exact `uploads/<session-id>/...` objects one hour after session expiry. It records one append-only receipt per object, resumes at the first object without a receipt, bounds concurrent deletes, and isolates failures. It never enumerates or deletes a broad bucket prefix. The `INCOMPLETE_UPLOAD_CLEANUP` switch defaults to `off`; no production cleanup has been enabled or run. Completed sessions are excluded from the query and the object adapter refuses every non-upload key.

Deletion or expiry of completed photos stays disabled pending owner/counsel review. The approved policy must specify the purpose and retention duration for raw images, derived hashes, location/EXIF, EyeOnSite receipts, model findings, dispute copies, backups and exports, and define which fields remain in the financial audit. A 90-day upload expiry or a bucket-wide lifecycle rule is not acceptable evidence retention policy.

## Acceptance before trust

- The EyeOnSite client cannot set or update assessment outputs, provenance status or a passed attestation; server processing cannot be bypassed by pre-populating `qualityScore`.
- A server-signed EyeOnSite receipt verifies only for its configured key, fresh nonce, exact evidence/task/tranche/version and exact uploaded image hashes; mutation, replay, wrong issuer and unknown fields fail closed.
- Stood fully decodes each supported image under memory/pixel limits, independently recomputes hashes and pHash, and rejects malformed or decompression-bomb content.
- A lost worker response resumes under the same lease; duplicate submissions do not produce multiple decision receipts; one failed object does not stall another session.
- The janitor removes only expired incomplete objects and resumes safely after a crash. Completed evidence is untouched until an approved retention policy is implemented and tested.
- A consented evaluation set measures false-refusal rate by class before model findings may refuse. Model outage, low confidence or invalid output means `WAIT`.

The current blocker is the missing authenticated EyeOnSite server receipt and the unapproved completed-photo retention policy. No real buyer photo should enter the assessment path before both are resolved and the whole workflow is qualified.
