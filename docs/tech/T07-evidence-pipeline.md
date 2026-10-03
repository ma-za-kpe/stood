# T07: Evidence pipeline

Goal: turn a package into **check results + findings** that the pure decision rule ([T03](T03-domain-model.md#decision-rule-pure-function)) can use. Threats: [S11](../stood/S11-evidence-integrity.md).

## Pipeline (one Render Workflow run per package)

```text
1. ingest       copy / validate photos → R2. Compute sha256, pHash (sharp + dHash/pHash), strip nothing
2. rules        C1 completeness · C2 window · C3 plot · C4 platform signals          (stood-api, pure)
3. index        C5 near-duplicate query (EvidenceIndex) → then index this package's photos
4. findings     evidence-agent (Astropods):                                         (no PayPal creds)
                  C6 nonce OCR on the nonce_card shot
                  C7 stage classification over all shots
                  C8 re-capture detection
                  C9 fixtures: Channel3 image search per finishes shot
5. decide       pure rule → RELEASE | REFUSE | WAIT
6. effect       payments adapter capture / void (idempotent) → outbox events → webhooks
```

Steps 2 and 3 run before step 4. **If a hard rule already refuses, the model step is skipped.** That saves free-tier AI quota and keeps refusals deterministic.

## The evidence agent

- **Runtime:** Astropods (`astropods.yml`). Fallback: a separate Render free web service. Either way it has **no PayPal or DB-write credentials**. It receives signed R2 URLs (5-minute TTL) and returns JSON.
- **Model:** `@cf/meta/llama-3.2-11b-vision-instruct` on **Cloudflare Workers AI** (open-weight, free tier of 10k neurons/day). It sits behind a `VisionModel` port, so a different model can be swapped in by config (for example a larger hosted model if the free quota is exhausted during judging).
- **Contract (structured output, validated with Zod; invalid output = uncertain):**

```json
{ "nonce":   { "text": "K7Q", "confidence": 0.93 },
  "stage":   { "label": "foundation", "confidence": 0.86,
               "alternatives": [{ "label": "blockwork", "confidence": 0.08 }] },
  "recapture": { "detected": false, "confidence": 0.9 },
  "fixtures": [{ "shot": "kitchen_tap", "spec_product_id": "c3_…", "matched": true, "rank": 2 }],
  "model": { "id": "llama-3.2-11b-vision-instruct", "provider": "workers-ai", "version": "…" } }
```

- **Prompt-injection stance:** image text is data. The system prompt says so. Outputs are constrained to the schema, and **nothing the model returns can reach a money call except through the pure rule over enumerated labels and numeric confidence.** Free-text model output is never interpreted as instructions.
- **Stage labels (v1):** `site_clearing`, `foundation`, `blockwork`, `lintel_beam`, `roofing`, `plastering`, `finishes`, `unknown`.
- **Evaluation set:** 50+ real photos from [EyeOnSite](https://github.com/ma-za-kpe/eyeonsite) V0 (consented and anonymised) plus public-domain images. Track accuracy and the **false-refusal rate** per label before trusting a refuse threshold. Until measured, stage mismatches go to **WAIT**, not REFUSE (a config flag).

## Near-duplicate search (C5)

- pHash (64-bit) for every photo, plus an optional image embedding.
- Query: Hamming ≤ 6 → **reused** (refuse). 7–10 → WAIT. Searched across **all plots** and the **seed corpus** (public-domain construction images, so "downloaded from the internet" is caught).
- **Adapters:** `index-elastic` (dense_vector + kNN, partner credits, hybrid search for reviewers) and `index-pgvector` (Neon, free and durable). The hackathon runs Elastic while credits last. pgvector is the default after that.
- [EyeOnSite](https://github.com/ma-za-kpe/eyeonsite) already computes its own pHash on device. Stood **recomputes** it server-side and compares (a mismatch means the file was tampered with → WAIT).

## Channel3 fixtures check (C9)

1. At allowance time: `lookup product by URL` → attributes + reference images, stored on the stage.
2. At inspection: `image search` with the finishes photo → top-k products. Pass if the spec product id or the same brand / model family is in the top-k.
3. Mismatch → WAIT ("Fitted tap doesn't look like the one specified"). The GB-locale price is shown as context only. Never a decision input ([S13](../stood/S13-sponsor-integration.md)).

## What Stood reuses from [EyeOnSite](https://github.com/ma-za-kpe/eyeonsite) (don't duplicate)

[EyeOnSite](https://github.com/ma-za-kpe/eyeonsite)'s `onEvidenceSubmitted` already computes these signals:

- `MOCK_LOCATION`, `LOW_ACCURACY`, `GPS_EXIF_MISMATCH`, `TIMESTAMP_DRIFT`, `IMPOSSIBLE_TRAVEL`, `PHASH_DUPLICATE`, `GPS_OFF_SITE`, `CONTENT_UNSAFE`, `ATTESTATION_FAILED`
- a Firebase App Check attestation verdict
- a provenance manifest hash

Stood accepts these as `platform_signals`: **any HIGH-severity signal → WAIT**. Stood independently re-runs the checks it can (plot, window, pHash). [EyeOnSite](https://github.com/ma-za-kpe/eyeonsite) has device attestation, which Stood can't do. Stood has the cross-plot and cross-platform index, which [EyeOnSite](https://github.com/ma-za-kpe/eyeonsite) can't have.
