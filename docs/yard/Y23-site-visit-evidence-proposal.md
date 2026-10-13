# Site-visit evidence trust and retention proposal (T-0359)

Status: design for implementation and owner/counsel review, 2026-10-13. This proposal does not qualify an assessment or authorize a payment.

## Current boundary

Stood upload sessions accept 1–10 declared JPEG, HEIC or WebP objects, each no larger than 8 MiB, with a 15-minute upload window. Completion currently checks size, SHA-256 and a short format header, then records `COMPLETE`. It does not fully decode the image, extract trusted metadata, assess site-visit signals, create an attestation, or feed the payment decision. This byte-integrity receipt must remain intake-only.

The EyeOnSite `main` source reviewed at commit [`af103a4`](https://github.com/ma-za-kpe/eyeonsite/commit/af103a4) is not currently a trusted attestation producer for Stood. Its Android `AppCheckAttestationService` returns `PASSED` locally; the Firestore evidence create rule requires identity/task/photos fields but does not whitelist server-computed assessment fields; and `onEvidenceSubmitted` trusts the stored `attestationVerdict` and returns early when a numeric `qualityScore` is already present. Stood must refuse to infer trust from these client-writable values. EyeOnSite needs a server-authenticated assessment receipt before it can feed this integration.

## Proposed evidence flow

1. A completed Stood upload remains `INTAKE_ONLY` until a worker claims it using a durable lease. A retry resumes that exact session; it cannot create a second evidence package.
2. The Stood worker fully decodes each bounded image, rejects decompression bombs and unsupported/animated content, recomputes SHA-256 and pHash, extracts available EXIF on the server, and compares all results with the declaration. A hash or decode mismatch yields review, never a pass.
3. An EyeOnSite server produces a bounded Ed25519-signed assessment after verifying its own Firebase/App Check and inspector/task authorization. The signature covers a canonical payload containing issuer/key id, EyeOnSite evidence/task identity, Stood allowance and terms version, tranche, exact image SHA-256 values, capture/server times, nonce, provenance-manifest hash and enumerated signals. Stood verifies the signature against a configured issuer key, freshness, exact image binding and a one-use nonce. Client-provided `PASSED` fields and model claims are never sufficient.
4. Stood independently rechecks what it can: exact bytes and image digest, allowance capture window, plot/location consistency, EXIF consistency and cross-project pHash. A missing or unavailable signal produces `WAIT`; a qualified hard rule may refuse. The vision processor emits only schema-validated labels and confidence; uncertain labels remain `WAIT`. No processor receives PayPal credentials or has a payment-write path.
5. Persist the signed source envelope, recomputed hashes, processor/model versions and bounded findings in an append-only assessment receipt. Keep it separate from raw photos so the final retention policy can delete image bytes without rewriting the financial decision history.

## Safe cleanup and retention fence

Uncompleted `OPEN` sessions are not payment evidence. A cleanup worker may delete only their exact `uploads/<session-id>/...` objects after the session expiry plus a short operational grace period, recording one idempotent cleanup receipt per object. It must isolate failures, treat confirmed 404 as removed, and never enumerate or delete a broad bucket prefix. A completed session is excluded from this janitor.

Deletion or expiry of completed photos stays disabled pending owner/counsel review. The approved policy must specify the purpose and retention duration for raw images, derived hashes, location/EXIF, EyeOnSite receipts, model findings, dispute copies, backups and exports, and define which fields remain in the financial audit. A 90-day upload expiry or a bucket-wide lifecycle rule is not acceptable evidence retention policy.

## Acceptance before trust

- The EyeOnSite client cannot set or update assessment outputs, provenance status or a passed attestation; server processing cannot be bypassed by pre-populating `qualityScore`.
- A server-signed EyeOnSite receipt verifies only for its configured key, fresh nonce, exact evidence/task/tranche/version and exact uploaded image hashes; mutation, replay, wrong issuer and unknown fields fail closed.
- Stood fully decodes each supported image under memory/pixel limits, independently recomputes hashes and pHash, and rejects malformed or decompression-bomb content.
- A lost worker response resumes under the same lease; duplicate submissions do not produce multiple decision receipts; one failed object does not stall another session.
- The janitor removes only expired incomplete objects and resumes safely after a crash. Completed evidence is untouched until an approved retention policy is implemented and tested.
- A consented evaluation set measures false-refusal rate by class before model findings may refuse. Model outage, low confidence or invalid output means `WAIT`.

The current blocker is the missing authenticated EyeOnSite server receipt and the unapproved completed-photo retention policy. No real buyer photo should enter the assessment path before both are resolved and the whole workflow is qualified.
