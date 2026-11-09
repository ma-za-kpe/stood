import { createHash } from 'node:crypto';
import type { Hono } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import {
  canonicalEyeOnSiteAssessmentIdentity,
  type EyeOnSiteAssessmentPayload,
  verifyEyeOnSiteReceipt,
} from '../application/eyeonsite-assessment.js';
import { completeUpload, uploadPhotos } from '../application/upload-session.js';
import { EvidenceStoreError } from '../ports/evidence-store.js';
import { UploadError, type UploadObjects, type UploadSession, type UploadStore } from '../ports/upload-store.js';

type Config = Readonly<{
  platformId: string;
  clock(): number;
  uploads?: Readonly<{ store: UploadStore; objects: UploadObjects }>;
  eyeOnSiteAssessment?: Readonly<{
    publicKeys: Readonly<Record<string, string>>;
    issue(
      input: Readonly<{
        evidenceId: string;
        allowanceId: string;
        termsVersion: number;
        trancheId: string;
        uploadId: string;
        nonce: string;
      }>,
    ): Promise<unknown>;
  }>;
}>;
type Problem = (status: ContentfulStatusCode, code: string, detail: string) => Response;
// Registered inside the signed, body-limited and rate-limited platform API. Never accepts remote source URLs.
export function uploadRoutes(app: Hono, config: Config, problem: Problem) {
  const uploadObjects = config.uploads?.objects;
  const view = (session: UploadSession) => ({
    ...session,
    uploads:
      uploadObjects && session.status === 'OPEN' && session.expiresAt - config.clock() >= 1000
        ? session.photos.map((photo) => ({
            key: photo.key,
            ...uploadObjects.presignPut(photo, session.expiresAt),
          }))
        : [],
  });
  const guarded = async (write: () => Promise<Response>) => {
    try {
      return await write();
    } catch (error) {
      if (error instanceof UploadError)
        return problem(
          error.code === 'NOT_FOUND' ? 404 : ['CONFLICT', 'EXPIRED'].includes(error.code) ? 409 : 422,
          `upload_${error.code.toLowerCase()}`,
          'The upload session request could not be accepted.',
        );
      if (error instanceof EvidenceStoreError && error.code === 'CONFLICT')
        return problem(422, 'upload_mismatch', 'Uploaded bytes do not match the declared evidence.');
      return problem(503, 'storage_unavailable', 'Upload storage is unavailable. Retry the same request.');
    }
  };
  app.post('/tranches/:id/uploads', (c) =>
    guarded(async () => {
      c.header('Cache-Control', 'private, no-store');
      if (!config.uploads) return problem(503, 'evidence_not_configured', 'Upload storage is not configured.');
      const key = c.req.header('Idempotency-Key') ?? '';
      if (!key.trim() || key.length > 200 || !/^application\/json(?:;|$)/i.test(c.req.header('Content-Type') ?? ''))
        return problem(422, 'validation', 'JSON and an idempotency key are required.');
      const raw = await c.req.text();
      let photos: ReturnType<typeof uploadPhotos>;
      try {
        photos = uploadPhotos(JSON.parse(raw));
      } catch {
        return problem(422, 'validation', 'Photo declarations are invalid.');
      }
      const fingerprint = createHash('sha256')
        .update(JSON.stringify([c.req.method, `/v1${c.req.path}`, raw]))
        .digest('hex');
      const session = await config.uploads.store.reserve(
        config.platformId,
        c.req.param('id'),
        key,
        fingerprint,
        photos,
        config.clock(),
      );
      return c.json(view(session), 201);
    }),
  );
  app.get('/tranches/:id/uploads/:uploadId', (c) =>
    guarded(async () => {
      c.header('Cache-Control', 'private, no-store');
      if (!config.uploads) return problem(503, 'evidence_not_configured', 'Upload storage is not configured.');
      const session = await config.uploads.store.get(config.platformId, c.req.param('id'), c.req.param('uploadId'));
      if (!session) return problem(404, 'upload_not_found', 'Upload session not found.');
      return c.json(view(session));
    }),
  );
  app.post('/tranches/:id/uploads/:uploadId/complete', (c) =>
    guarded(async () => {
      c.header('Cache-Control', 'private, no-store');
      if (!config.uploads) return problem(503, 'evidence_not_configured', 'Upload storage is not configured.');
      const key = c.req.header('Idempotency-Key') ?? '';
      if (!key.trim() || key.length > 200 || !/^application\/json(?:;|$)/i.test(c.req.header('Content-Type') ?? ''))
        return problem(422, 'validation', 'JSON and an idempotency key are required.');
      try {
        const input: unknown = await c.req.json();
        if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length) throw new Error();
      } catch {
        return problem(422, 'validation', 'Complete with an empty JSON object.');
      }
      const complete = await completeUpload(
        config.uploads.store,
        config.uploads.objects,
        config.platformId,
        c.req.param('id'),
        c.req.param('uploadId'),
        config.clock,
      );
      return c.json(view(complete));
    }),
  );
  app.post('/tranches/:id/uploads/:uploadId/assessment', (c) =>
    guarded(async () => {
      c.header('Cache-Control', 'private, no-store');
      if (!config.uploads) return problem(503, 'evidence_not_configured', 'Upload storage is not configured.');
      if (!config.eyeOnSiteAssessment || Object.keys(config.eyeOnSiteAssessment.publicKeys).length === 0)
        return problem(503, 'assessment_not_configured', 'EyeOnSite assessment receipts are not configured.');
      const idempotencyKey = c.req.header('Idempotency-Key') ?? '';
      if (
        !idempotencyKey.trim() ||
        idempotencyKey.length > 200 ||
        !/^application\/json(?:;|$)/i.test(c.req.header('Content-Type') ?? '')
      )
        return problem(422, 'validation', 'JSON and an idempotency key are required.');
      let request: unknown;
      let raw: string;
      try {
        raw = await c.req.text();
        request = JSON.parse(raw);
      } catch {
        return problem(422, 'validation', 'An evidence id is required.');
      }
      if (
        !request ||
        typeof request !== 'object' ||
        Array.isArray(request) ||
        Object.keys(request).sort().join(',') !== 'evidenceId' ||
        typeof (request as { evidenceId?: unknown }).evidenceId !== 'string' ||
        !/^[A-Za-z0-9][A-Za-z0-9:_-]{0,199}$/.test((request as { evidenceId: string }).evidenceId)
      )
        return problem(422, 'validation', 'An evidence id is required.');
      const evidenceId = (request as { evidenceId: string }).evidenceId;
      const trancheId = c.req.param('id');
      const uploadId = c.req.param('uploadId');
      const session = await config.uploads.store.get(config.platformId, trancheId, uploadId);
      if (!session) return problem(404, 'upload_not_found', 'Upload session not found.');
      if (session.status !== 'COMPLETE' || !session.allowanceId || !session.termsVersion || !session.assessmentNonce)
        return problem(409, 'upload_not_ready', 'Only a completed, assessment-bound upload can receive an assessment.');
      const expected = {
        evidenceId,
        allowanceId: session.allowanceId,
        termsVersion: session.termsVersion,
        trancheId,
        uploadId,
        nonce: session.assessmentNonce,
        photos: session.photos.map(({ sha256, bytes }) => ({ sha256, bytes })),
      };
      const requestHash = createHash('sha256')
        .update(JSON.stringify(['POST', `/v1${c.req.path}`, raw]))
        .digest('hex');
      const prior = await config.uploads.store.loadAssessment(
        config.platformId,
        trancheId,
        uploadId,
        idempotencyKey,
        requestHash,
      );
      if (prior) return c.json({ receipt: prior, authority: 'AUDIT_ONLY' as const });
      let receipt: unknown;
      let payload: EyeOnSiteAssessmentPayload;
      try {
        receipt = await config.eyeOnSiteAssessment.issue(expected);
        payload = verifyEyeOnSiteReceipt(receipt, config.eyeOnSiteAssessment.publicKeys, expected, config.clock());
      } catch {
        return problem(
          503,
          'assessment_unavailable',
          'EyeOnSite could not provide a valid signed assessment. Retry later.',
        );
      }
      const row = receipt as { payload: typeof payload; signature: string };
      const receiptHash = createHash('sha256').update(canonicalEyeOnSiteAssessmentIdentity(payload)).digest('hex');
      const saved = await config.uploads.store.recordAssessment(
        config.platformId,
        trancheId,
        uploadId,
        idempotencyKey,
        requestHash,
        { payload, signature: row.signature },
        receiptHash,
        config.clock(),
      );
      return c.json({ receipt: saved, authority: 'AUDIT_ONLY' as const });
    }),
  );
}
