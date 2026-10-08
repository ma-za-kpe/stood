import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { allowanceDraft } from '../application/allowance-draft.js';
import { commitPackage } from '../application/commit-package.js';
import { mandateTermsHash } from '../application/mandate-terms.js';
import { trancheSentences } from '../domain/recipient-sentences.js';
import { restoreTrancheRecord } from '../domain/tranche-record.js';
import { CommitPackageError, type CommitPackageStore } from '../ports/commit-package-store.js';
import { type FundingStore, FundingStoreError } from '../ports/funding-store.js';
import { type MandateStore, MandateStoreError } from '../ports/mandate-store.js';
import { type PlatformApiStore, PlatformApiStoreError } from '../ports/platform-api-store.js';

export type PlatformApiConfig = Readonly<{
  store: PlatformApiStore;
  packages?: CommitPackageStore;
  platformId: string;
  key: string;
  secret: string;
  clock(): number;
  // T-0260: saved-PayPal mandates and tranche funding. HTTP records intent; the worker makes the PayPal calls.
  signing?: Readonly<{
    mode: 'sim' | 'live';
    mandates: Pick<MandateStore, 'reserve' | 'load'>;
    funding: Pick<FundingStore, 'reserve' | 'load'>;
  }>;
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
      : error instanceof MandateStoreError || error instanceof FundingStoreError
        ? error.code === 'NOT_FOUND'
          ? problem(404, 'not_found', 'Not found.')
          : error.code === 'INVALID'
            ? problem(422, 'validation', 'The request is invalid.')
            : error.code === 'STALE_VERSION'
              ? problem(409, 'stale_version', 'The tranche changed. Read it again and retry with its version.')
              : error.code === 'IDENTITY_CONFLICT'
                ? problem(409, 'idempotency_conflict', 'This key was used for a different request.')
                : problem(409, 'conflict', 'Another signature or funding is already in progress.')
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
  const idempotency = (c: { req: { header(name: string): string | undefined } }) => {
    const key = c.req.header('Idempotency-Key') ?? '';
    return key.trim() && key.length <= 200 && /^application\/json(?:;|$)/i.test(c.req.header('Content-Type') ?? '')
      ? key
      : null;
  };
  // Status and the buyer's approval link only: never tokens, setup, customer, order or authorization ids.
  const mandateView = (m: Awaited<ReturnType<MandateStore['load']>>) => ({
    key: m.key,
    status: m.status,
    approve_url: m.status === 'AWAITING_APPROVAL' ? m.approvalUrl : null,
    expires_at: m.expiresAt,
  });
  const fundingView = (f: Awaited<ReturnType<FundingStore['load']>>) => ({
    key: f.key,
    status: f.status,
    approve_url: f.status === 'AWAITING_APPROVAL' ? f.approvalUrl : null,
    hold_expires_at: f.status === 'HELD' ? (f.hold?.expiresAt ?? null) : null,
  });
  app.post('/allowances/:id/mandate', async (c) => {
    if (!config.signing) return problem(503, 'signing_not_configured', 'Saved-PayPal signing is not configured.');
    const key = idempotency(c);
    if (!key) return problem(422, 'validation', 'JSON and an idempotency key are required.');
    const allowance = await config.store.allowance(config.platformId, c.req.param('id'));
    if (!allowance) return problem(404, 'not_found', 'Allowance not found.');
    const reserved = await config.signing.mandates.reserve({
      key,
      platformId: config.platformId,
      allowanceId: allowance.id,
      termsVersion: 1,
      termsHash: mandateTermsHash(allowance),
      mode: config.signing.mode,
      acceptedAt: config.clock(),
    });
    return c.json(mandateView(reserved), 202);
  });
  app.get('/allowances/:id/mandate/:key', async (c) => {
    if (!config.signing) return problem(503, 'signing_not_configured', 'Saved-PayPal signing is not configured.');
    const m = await config.signing.mandates.load(c.req.param('key'));
    if (m.platformId !== config.platformId || m.allowanceId !== c.req.param('id'))
      return problem(404, 'not_found', 'Not found.');
    return c.json(mandateView(m));
  });
  app.post('/tranches/:id/funding', async (c) => {
    if (!config.signing) return problem(503, 'signing_not_configured', 'Funding is not configured.');
    const key = idempotency(c);
    if (!key) return problem(422, 'validation', 'JSON and an idempotency key are required.');
    let input: { expected_version?: unknown; nonce?: unknown };
    try {
      input = JSON.parse(await c.req.text());
    } catch {
      return problem(422, 'validation', 'The funding request is invalid.');
    }
    if (
      !Number.isSafeInteger(input?.expected_version) ||
      (input.expected_version as number) < 0 ||
      typeof input.nonce !== 'string' ||
      !/^[A-HJ-NP-Z2-9]{3}$/.test(input.nonce)
    )
      return problem(422, 'validation', 'expected_version and a three-character nonce are required.');
    const reserved = await config.signing.funding.reserve({
      key,
      trancheId: c.req.param('id'),
      platformId: config.platformId,
      expectedVersion: input.expected_version as number,
      nonce: input.nonce,
      mode: config.signing.mode,
    });
    return c.json(fundingView(reserved), 202);
  });
  app.get('/tranches/:id/funding/:key', async (c) => {
    if (!config.signing) return problem(503, 'signing_not_configured', 'Funding is not configured.');
    const f = await config.signing.funding.load(c.req.param('key'));
    if (f.instruction.platformId !== config.platformId || f.trancheId !== c.req.param('id'))
      return problem(404, 'not_found', 'Not found.');
    return c.json(fundingView(f));
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
