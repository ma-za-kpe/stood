import { createHash } from 'node:crypto';
import type { Hono } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { completeUpload, uploadPhotos } from '../application/upload-session.js';
import { EvidenceStoreError } from '../ports/evidence-store.js';
import { UploadError, type UploadObjects, type UploadSession, type UploadStore } from '../ports/upload-store.js';

type Config = Readonly<{
  platformId: string;
  clock(): number;
  uploads?: Readonly<{ store: UploadStore; objects: UploadObjects }>;
}>;
type Problem = (status: ContentfulStatusCode, code: string, detail: string) => Response;
// Registered inside the signed, body-limited and rate-limited platform API. Never accepts remote source URLs.
export function uploadRoutes(app: Hono, config: Config, problem: Problem) {
  const view = (session: UploadSession) => ({
    ...session,
    uploads:
      session.status === 'OPEN' && session.expiresAt - config.clock() >= 1000
        ? session.photos.map((photo) => ({
            key: photo.key,
            ...config.uploads!.objects.presignPut(photo, session.expiresAt),
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
}
