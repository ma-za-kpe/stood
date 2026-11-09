# Cloudflare R2: private evidence objects for Stood

Stood uses R2's S3-compatible API for evidence objects and signed runner reports. The bucket is private. Stood creates short-lived, narrowly scoped upload/download URLs and records hashes and object references in Postgres. A stored object is not, by itself, a trusted assessment or payment decision.

## Create the bucket and scoped token

1. In Cloudflare, create a private R2 bucket dedicated to Stood evidence. Do not enable public bucket access.
2. Create an R2 API token with access limited to this bucket and only the read/write permissions needed by the Stood API and reconciler. Keep the access key id and secret in the provider secret store.
3. Set `STOOD_EVIDENCE_S3_ENDPOINT` to the account's S3 endpoint, `STOOD_EVIDENCE_S3_BUCKET` to the bucket name, and `STOOD_EVIDENCE_S3_ACCESS_KEY_ID` / `STOOD_EVIDENCE_S3_SECRET_ACCESS_KEY` on both `stood-api` and `stood-reconciler` in Render.
4. Run `scripts/dev evidence-check`. It writes an object by hash, reads it back, and confirms retry behavior. Run the S3 adapter tests with `corepack pnpm exec vitest run services/api/src/adapters/evidence` before promoting a change.
5. Keep upload cleanup disabled unless an owner has approved the retention policy. The current incomplete-session cleanup setting is off by default and targets only expired open sessions.

Follow Cloudflare's [R2 API token guide](https://developers.cloudflare.com/r2/api/tokens/) and [S3 endpoint documentation](https://developers.cloudflare.com/r2/api/s3/api/). Check current [R2 pricing](https://developers.cloudflare.com/r2/pricing/); storage, operations and internet egress can have different billing rules. Do not assume a free allowance.

## Browser uploads and boundaries

If a browser uploads directly to a presigned URL, configure bucket CORS for only the approved Yard origin, `PUT`, and the exact content/checksum headers used by the signed request. Avoid `*`. The signed URL is a temporary bearer capability; never log it or put it in screenshots. Upload completion checks byte length, declared format and content hash. It does **not** yet prove image authenticity, scene context or a trusted EyeOnSite attestation; those C6 capabilities remain separate work.

If `Uploads off` appears at startup, confirm all four `STOOD_EVIDENCE_S3_*` values exist on the relevant service and that its token can access this bucket. `scripts/dev evidence-check` needs real R2 credentials and writes a disposable object; record its outcome without publishing keys or signed URLs. Tests with fake S3 responses are not live R2 qualification.
