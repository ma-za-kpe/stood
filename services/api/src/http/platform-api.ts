import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { allowanceDraft } from '../application/allowance-draft.js';
import { trancheSentences } from '../domain/recipient-sentences.js';
import { restoreTrancheRecord } from '../domain/tranche-record.js';
import { type PlatformApiStore, PlatformApiStoreError } from '../ports/platform-api-store.js';

export type PlatformApiConfig = Readonly<{
  store: PlatformApiStore;
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
    const signature = /^t=(\d{1,12}),v1=([a-f0-9]{64})$/.exec(c.req.header('Stood-Signature') ?? '');
    const token = c.req.header('Authorization') ?? '';
    if (
      !Number.isFinite(now) ||
      !timingSafeEqual(digest(token), digest(`Bearer ${config.key}`)) ||
      !signature ||
      Math.abs(now / 1000 - Number(signature[1])) > 300
    )
      return problem(401, 'unauthorized', 'A valid platform key and signature are required.');
    const body = await c.req.text();
    const expected = createHmac('sha256', config.secret).update(`${signature[1]}.${body}`).digest();
    if (!timingSafeEqual(expected, Buffer.from(signature[2]!, 'hex')))
      return problem(401, 'unauthorized', 'A valid platform key and signature are required.');
    await next();
  });
  app.onError((error) =>
    error instanceof PlatformApiStoreError
      ? problem(409, 'idempotency_conflict', 'This key was used for a different request.')
      : problem(503, 'storage_unavailable', 'Storage is unavailable. Retry with the same idempotency key.'),
  );
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
