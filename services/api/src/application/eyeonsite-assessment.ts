import { createPublicKey, type KeyObject, verify } from 'node:crypto';
import { z } from 'zod';

const HASH = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9:_-]{0,199}$/;
const MAX_AGE_MS = 5 * 60_000;
const MAX_FUTURE_MS = 30_000;

const Signal = z
  .object({
    type: z.enum([
      'MOCK_LOCATION',
      'LOW_ACCURACY',
      'GPS_EXIF_MISMATCH',
      'TIMESTAMP_DRIFT',
      'IMPOSSIBLE_TRAVEL',
      'PHASH_DUPLICATE',
      'GPS_OFF_SITE',
      'CONTENT_UNSAFE',
      'ATTESTATION_FAILED',
    ]),
    severity: z.enum(['LOW', 'MEDIUM', 'HIGH']),
    photoId: z.string().regex(ID).optional(),
  })
  .strict();

const Payload = z
  .object({
    schemaVersion: z.literal(1),
    issuer: z.literal('eyeonsite'),
    keyId: z.string().regex(ID),
    evidenceId: z.string().regex(ID),
    taskId: z.string().regex(ID),
    allowanceId: z.string().regex(ID),
    termsVersion: z.number().int().min(1).max(2_147_483_647),
    trancheId: z.string().regex(ID),
    uploadId: z.string().regex(ID),
    nonce: z.string().regex(HASH),
    issuedAt: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    photos: z
      .array(
        z
          .object({
            sha256: z.string().regex(HASH),
            bytes: z
              .number()
              .int()
              .min(1)
              .max(8 * 1024 * 1024),
          })
          .strict(),
      )
      .min(1)
      .max(10),
    assessment: z
      .object({
        qualityScore: z.number().int().min(0).max(100),
        gpsValid: z.boolean(),
        fraudRisk: z.enum(['LOW', 'MEDIUM', 'HIGH']),
        contentRisk: z.enum(['UNKNOWN', 'LOW', 'MEDIUM', 'HIGH']),
        provenanceStatus: z.enum(['UNVERIFIED', 'PASSED', 'FAILED']),
        attestationVerdict: z.enum(['UNKNOWN', 'PASSED', 'FAILED', 'UNAVAILABLE']),
        signals: z.array(Signal).max(100),
      })
      .strict(),
  })
  .strict();

export type EyeOnSiteAssessmentPayload = z.infer<typeof Payload>;
export type EyeOnSiteAssessmentReceipt = Readonly<{
  payload: EyeOnSiteAssessmentPayload;
  signature: string;
}>;
export type EyeOnSiteReceiptExpectation = Readonly<{
  evidenceId: string;
  allowanceId: string;
  termsVersion: number;
  trancheId: string;
  uploadId: string;
  nonce: string;
  photos: readonly Readonly<{ sha256: string; bytes: number }>[];
}>;

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, child]) => [key, sortJson(child)]),
    );
  }
  return value;
}

// This protocol only permits strings, booleans, safe integers, arrays and objects. Sorting every object key
// and retaining array order gives EyeOnSite and Stood the same unambiguous bytes without signing display text.
export function canonicalEyeOnSiteReceipt(payload: EyeOnSiteAssessmentPayload): string {
  const checked = Payload.parse(payload);
  return JSON.stringify(sortJson(checked));
}

export function canonicalEyeOnSiteAssessmentIdentity(payload: EyeOnSiteAssessmentPayload): string {
  const canonical = JSON.parse(canonicalEyeOnSiteReceipt(payload)) as Record<string, unknown>;
  delete canonical.issuedAt;
  return JSON.stringify(canonical);
}

function readReceipt(value: unknown): EyeOnSiteAssessmentReceipt {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid EyeOnSite receipt');
  const row = value as Record<string, unknown>;
  if (Object.keys(row).sort().join(',') !== 'payload,signature' || typeof row.signature !== 'string')
    throw new Error('Invalid EyeOnSite receipt');
  const payload = Payload.parse(row.payload);
  if (!/^[A-Za-z0-9_-]{86}$/.test(row.signature)) throw new Error('Invalid EyeOnSite receipt');
  const hashes = payload.photos.map((photo) => photo.sha256);
  if (
    new Set(hashes).size !== hashes.length ||
    hashes.some((hash, i) => {
      const previous = hashes[i - 1];
      return i > 0 && previous !== undefined && previous >= hash;
    })
  )
    throw new Error('Invalid EyeOnSite receipt');
  return { payload, signature: row.signature };
}

export function verifyEyeOnSiteReceipt(
  value: unknown,
  publicKeys: Readonly<Record<string, string | KeyObject>>,
  expected: EyeOnSiteReceiptExpectation,
  now: number,
): EyeOnSiteAssessmentPayload {
  const receipt = readReceipt(value);
  if (!Number.isSafeInteger(now) || now < 0) throw new Error('Invalid clock');
  const { payload } = receipt;
  if (
    payload.evidenceId !== expected.evidenceId ||
    payload.allowanceId !== expected.allowanceId ||
    payload.termsVersion !== expected.termsVersion ||
    payload.trancheId !== expected.trancheId ||
    payload.uploadId !== expected.uploadId ||
    payload.nonce !== expected.nonce ||
    now - payload.issuedAt > MAX_AGE_MS ||
    payload.issuedAt - now > MAX_FUTURE_MS
  )
    throw new Error('EyeOnSite receipt binding or freshness failed');

  const photos = [...expected.photos].sort((a, b) => (a.sha256 < b.sha256 ? -1 : a.sha256 > b.sha256 ? 1 : 0));
  if (JSON.stringify(payload.photos) !== JSON.stringify(photos)) throw new Error('EyeOnSite photo binding failed');

  const publicKey = publicKeys[payload.keyId];
  if (!publicKey) throw new Error('Unknown EyeOnSite signing key');
  const key = typeof publicKey === 'string' ? createPublicKey(publicKey) : publicKey;
  if (key.asymmetricKeyType !== 'ed25519') throw new Error('Invalid EyeOnSite signing key');
  const valid = verify(
    null,
    Buffer.from(canonicalEyeOnSiteReceipt(payload), 'utf8'),
    key,
    Buffer.from(receipt.signature, 'base64url'),
  );
  if (!valid) throw new Error('Invalid EyeOnSite signature');
  return payload;
}
