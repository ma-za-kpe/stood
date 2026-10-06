import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { allowanceDraft } from '../application/allowance-draft.js';
import { commitPackage } from '../application/commit-package.js';
import { trancheSentences } from '../domain/recipient-sentences.js';
import { restoreTrancheRecord } from '../domain/tranche-record.js';
import { CommitPackageError, type CommitPackageStore } from '../ports/commit-package-store.js';
import { type PlatformApiStore, PlatformApiStoreError } from '../ports/platform-api-store.js';

export type PlatformApiConfig = Readonly<{
  store: PlatformApiStore;
  packages?: CommitPackageStore;
  platformId: string;
  key: string;
  secret: string;
  clock(): number;
}>;
function problem(status: ContentfulStatusCode, code: string, detail: string): Response {
  return new Response(JSON.stringify({ type: `urn:stood:problem:${code}`, title: detail, status, code, detail }), {
    status,
    headers: { 'Content-Type': 'application/problem+json' },
  });
}
const digest = (value: string) => createHash('sha256').update(value).digest();
export function platformApi(config: PlatformApiConfig): Hono {
  if (![config.platformId, config.key, config.secret].every((value) => value.trim()))
    throw new RangeError('Invalid platform API configuration');
  const app = new Hono();
  app.use(
    '*',
    bodyLimit({ maxSize: 65536, onError: () => problem(413, 'payload_too_large', 'Request exceeds 64 KiB.') }),
  );
  app.use('*', async (c, next) => {
    const now = config.clock();
    const signature = /^t=(\d{1,12}),v2=([a-f0-9]{64})$/.exec(c.req.header('Stood-Signature') ?? '');
    const token = c.req.header('Authorization') ?? '';
    if (
      !Number.isSafeInteger(now) ||
      now < 0 ||
      !timingSafeEqual(digest(token), digest(`Bearer ${config.key}`)) ||
      !signature ||
      Math.abs(now / 1000 - Number(signature[1])) > 300
    )
      return problem(401, 'unauthorized', 'A valid platform key and signature are required.');
    const body = await c.req.text();
    const url = new URL(c.req.url);
    const expected = createHmac('sha256', config.secret)
      .update(
        JSON.stringify([
          'stood.request@2',
          signature[1],
          c.req.method,
          `/v1${url.pathname}${url.search}`,
          c.req.header('Idempotency-Key') ?? '',
          c.req.header('If-Match') ?? '',
          c.req.header('Content-Type') ?? '',
          body,
        ]),
      )
      .digest();
    if (!timingSafeEqual(expected, Buffer.from(signature[2]!, 'hex')))
      return problem(401, 'unauthorized', 'A valid platform key and signature are required.');
    await next();
  });
  app.onError((error) =>
    error instanceof CommitPackageError
      ? problem(
          error.code === 'NOT_FOUND' ? 404 : error.code === 'CONFLICT' ? 409 : 422,
          error.code.toLowerCase(),
          'Package request cannot be accepted.',
        )
      : error instanceof PlatformApiStoreError
        ? problem(409, 'idempotency_conflict', 'This key was used for a different request.')
        : problem(503, 'storage_unavailable', 'Storage is unavailable. Retry with the same idempotency key.'),
  );
  app.post('/tranches/:id/packages', async (c) => {
    if (!config.packages) return problem(503, 'evidence_not_configured', 'Evidence storage is not configured.');
    const key = c.req.header('Idempotency-Key') ?? '';
    if (!key.trim() || key.length > 200 || !/^application\/json(?:;|$)/i.test(c.req.header('Content-Type') ?? ''))
      return problem(422, 'validation', 'JSON and an idempotency key are required.');
    const body = await c.req.text();
    let input: ReturnType<typeof commitPackage>;
    try {
      input = commitPackage(JSON.parse(body));
    } catch {
      return problem(422, 'validation', 'The commit package references are invalid.');
    }
    const fingerprint = createHash('sha256')
      .update(JSON.stringify([c.req.method, `/v1${c.req.path}`, body]))
      .digest('hex');
    return c.json(await config.packages.submit(config.platformId, c.req.param('id'), key, fingerprint, input), 202);
  });
  app.get('/tranches/:id/packages/:packageId', async (c) => {
    if (!config.packages) return problem(503, 'evidence_not_configured', 'Evidence storage is not configured.');
    const value = await config.packages.get(config.platformId, c.req.param('id'), c.req.param('packageId'));
    return value ? c.json(value) : problem(404, 'not_found', 'Package not found.');
  });
  app.post('/allowances', async (c) => {
    const key = c.req.header('Idempotency-Key') ?? '';
    if (!key.trim() || key.length > 200 || !/^application\/json(?:;|$)/i.test(c.req.header('Content-Type') ?? ''))
      return problem(422, 'validation', 'JSON and an idempotency key are required.');
    const body = await c.req.text();
    let input: ReturnType<typeof allowanceDraft>;
    try {
      input = allowanceDraft(JSON.parse(body));
    } catch {
      return problem(422, 'validation', 'The allowance draft is invalid.');
    }
    const fingerprint = createHash('sha256')
      .update(JSON.stringify([c.req.method, `/v1${c.req.path}`, body]))
      .digest('hex');
    return c.json(await config.store.create(config.platformId, key, fingerprint, input), 201);
  });
  app.get('/allowances/:id', async (c) => {
    const value = await config.store.allowance(config.platformId, c.req.param('id'));
    return value ? c.json(value) : problem(404, 'not_found', 'Allowance not found.');
  });
  app.get('/tranches/:id', async (c) => {
    const snapshot = await config.store.tranche(config.platformId, c.req.param('id'));
    if (!snapshot) return problem(404, 'not_found', 'Tranche not found.');
    const tranche = restoreTrancheRecord(snapshot.record);
    return c.json({
      id: tranche.id,
      state: tranche.state,
      version: snapshot.version,
      profile: tranche.profileId,
      amount: tranche.amount.toJSON(),
      decision: tranche.decisions.at(-1)?.decision ?? null,
      hold: tranche.attempts.length
        ? {
            age_seconds: Math.max(0, Math.floor((config.clock() - tranche.currentHold.heldAt) / 1000)),
            expires_at: new Date(tranche.currentHold.expiresAt).toISOString(),
          }
        : null,
      settlement: tranche.settlement,
      safe_recovery: tranche.safeRecovery,
      pending: snapshot.pending
        ? {
            effect: snapshot.pending.operation.effect,
            status: snapshot.pending.status,
            created_at: snapshot.pending.createdAt,
          }
        : null,
      sentences: trancheSentences(tranche, config.clock()),
    });
  });
  return app;
}
