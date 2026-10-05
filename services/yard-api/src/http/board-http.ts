import { createHmac, timingSafeEqual } from 'node:crypto';
import type { BlueprintInput, FreezeProof } from '@stood/yard-domain';
import type { Context, Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { Board, Operator, SettlementProof } from '../application/board.js';
import { type PackageGateway, SubmissionBridge } from '../application/submission-bridge.js';
import { YardError } from '../ports/events.js';
import { eventFeed } from './event-feed.js';
export type BoardConfig = Readonly<{
  board: Board;
  clock(): Promise<number>;
  operators: readonly Readonly<{ key: string; secret: string; actor: Operator }>[];
  packages?: PackageGateway;
  stood?: Readonly<{ mode: 'sim'; secret: string; read(trancheId: string): Promise<Omit<SettlementProof, 'eventId'>> }>;
}>;
function signature(value: string | null, body: string, secret: string, now: number, prefix = ''): boolean {
  const match = /^t=(\d{1,12}),v1=([a-f0-9]{64})$/.exec(value ?? '');
  if (!match || !Number.isSafeInteger(now) || Math.abs(now / 1000 - Number(match[1])) > 300) return false;
  const expected = createHmac('sha256', secret).update(`${match[1]}.${prefix}${body}`).digest();
  return timingSafeEqual(expected, Buffer.from(match[2] ?? '', 'hex'));
}
export function boardHttp(app: Hono, config: BoardConfig): void {
  const requests = new WeakMap<Request, { actor: Operator; body: string; now: number }>();
  const request = (c: Context) => {
    const value = requests.get(c.req.raw);
    if (!value) throw new YardError('FORBIDDEN');
    return value;
  };
  if (
    !config.operators.length ||
    new Set(config.operators.map((o) => o.key)).size !== config.operators.length ||
    config.operators.some(
      (o) => ![o.key, o.secret, o.actor.id, o.actor.root].every((v) => typeof v === 'string' && v.trim().length > 0),
    )
  )
    throw new YardError('INVALID');
  const identify = (headers: Headers, method: string, path: string, body: string, now: number): Operator | null => {
    const credential = config.operators.find((o) => o.key === headers.get('Yard-Key-Id'));
    if (!credential || !signature(headers.get('Yard-Signature'), body, credential.secret, now, `${method}.${path}.`))
      return null;
    return credential.actor;
  };
  app.use('/yard/v1/*', bodyLimit({ maxSize: 65536 }));
  app.use('/yard/v1/*', async (c, next) => {
    if (c.req.path === '/yard/v1/webhooks/stood') return next();
    let now: number;
    try {
      now = await config.clock();
    } catch {
      return c.json({ code: 'clock_unavailable' }, 503);
    }
    const raw = await c.req.text();
    const actor = identify(c.req.raw.headers, c.req.method, c.req.path, raw, now);
    if (!actor) return c.json({ code: 'unauthorized' }, 401);
    requests.set(c.req.raw, { actor, body: raw, now });
    return next();
  });
  app.onError((error, c) => {
    if (error instanceof YardError)
      return c.json(
        { code: error.code },
        error.code === 'FORBIDDEN' ? 403 : error.code === 'NOT_FOUND' ? 404 : error.code === 'INVALID' ? 422 : 409,
      );
    if (error instanceof SyntaxError || error instanceof RangeError || error instanceof TypeError)
      return c.json({ code: 'invalid_request' }, 422);
    return c.json({ code: 'yard_unavailable' }, 503);
  });
  const command = (c: Context) => {
    const key = c.req.header('Idempotency-Key') ?? '',
      version = Number(c.req.header('If-Match'));
    if (!/^[A-Za-z0-9:._-]{1,120}$/.test(key) || !Number.isSafeInteger(version) || version < 1)
      throw new YardError('INVALID');
    return { key, version, actor: request(c).actor, now: request(c).now };
  };
  const body = (c: Context, keys: readonly string[]): Record<string, unknown> => {
    const value: unknown = JSON.parse(request(c).body);
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      Object.keys(value).some((k) => !keys.includes(k))
    )
      throw new YardError('INVALID');
    return value as Record<string, unknown>;
  };
  const ack = (snapshot: { id: string; version: number }) => ({
    id: snapshot.id,
    version: snapshot.version,
    accepted: true,
    simulated: true,
  });
  app.get('/yard/v1/board', async (c) =>
    c.json({ ...(await config.board.discoverPage(c.req.query('after'))), simulated: true }),
  );
  app.post('/yard/v1/blueprints', async (c) => {
    const key = c.req.header('Idempotency-Key') ?? '';
    if (!/^[A-Za-z0-9:._-]{1,120}$/.test(key)) throw new YardError('INVALID');
    const input = body(c, [
      'id',
      'buyerOperatorId',
      'repository',
      'baseCommit',
      'summary',
      'capMinor',
      'currency',
      'milestones',
    ]);
    return c.json(
      ack(await config.board.create({ ...input, createdAt: request(c).now } as BlueprintInput, request(c).actor, key)),
      201,
    );
  });
  app.get('/yard/v1/blueprints/:id', async (c) => c.json(await config.board.read(c.req.param('id'), request(c).actor)));
  app.get('/yard/v1/blueprints/:id/room', async (c) =>
    c.json(await config.board.room(c.req.param('id'), request(c).actor)),
  );
  app.post('/yard/v1/blueprints/:id/approve', async (c) => {
    const { key, version, actor } = command(c);
    const proof = body(c, ['version', 'buyerOperatorId', 'approvalReference', 'baselines']);
    return c.json(ack(await config.board.freeze(c.req.param('id'), proof as FreezeProof, actor, version, key)));
  });
  app.post('/yard/v1/blueprints/:id/work-orders', async (c) => {
    const { key, version, actor, now } = command(c),
      input = body(c, ['milestone', 'trancheId']);
    if (typeof input.milestone !== 'string' || typeof input.trancheId !== 'string') throw new YardError('INVALID');
    return c.json(
      ack(await config.board.post(c.req.param('id'), input.milestone, input.trancheId, actor, version, key, now)),
    );
  });
  app.get('/yard/v1/blueprints/:id/work-orders/:wo', async (c) =>
    c.json(await config.board.view(c.req.param('id'), c.req.param('wo'), request(c).actor)),
  );
  for (const action of ['claim', 'build', 'submit'] as const)
    app.post(`/yard/v1/blueprints/:id/work-orders/:wo/${action}`, async (c) => {
      const { key, version, actor, now } = command(c),
        id = c.req.param('id'),
        wo = c.req.param('wo');
      const input = body(c, action === 'submit' ? ['commit', 'packageId'] : []);
      if (action === 'submit') {
        if (typeof input.commit !== 'string' || !/^[a-f0-9]{40}$/.test(input.commit)) throw new YardError('INVALID');
        if (config.packages) {
          if (input.packageId !== undefined) throw new YardError('INVALID');
          return c.json(
            ack(
              await new SubmissionBridge(config.board, config.packages).submit(
                id,
                wo,
                input.commit,
                actor,
                version,
                key,
                now,
              ),
            ),
          );
        }
        if (typeof input.packageId !== 'string') throw new YardError('INVALID');
        return c.json(ack(await config.board.submit(id, wo, input.commit, input.packageId, actor, version, key, now)));
      }
      return c.json(ack(await config.board[action](id, wo, actor, version, key, now)));
    });
  eventFeed(app, {
    store: config.board.events,
    authorize: async (headers, id) => {
      const actor = identify(headers, 'GET', `/yard/v1/blueprints/${id}/events`, '', await config.clock());
      if (!actor) return false;
      try {
        await config.board.read(id, actor);
        return true;
      } catch {
        return false;
      }
    },
  });
  app.post('/yard/v1/webhooks/stood', async (c) => {
    if (!config.stood) return c.json({ code: 'webhooks_not_configured' }, 503);
    const raw = await c.req.text();
    const now = await config.clock();
    if (!signature(c.req.header('Stood-Signature') ?? null, raw, config.stood.secret, now))
      return c.json({ code: 'unauthorized' }, 401);
    const input: unknown = JSON.parse(raw);
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new YardError('INVALID');
    const e = input as Record<string, unknown>;
    if (
      e.simulated !== true ||
      e.type !== 'stood.released' ||
      !['id', 'projectId', 'wo', 'trancheId', 'packageId', 'reference'].every(
        (k) => typeof e[k] === 'string' && String(e[k]).length > 0 && String(e[k]).length <= 200,
      )
    )
      throw new YardError('INVALID');
    const proof = await config.stood.read(String(e.trancheId));
    if (
      proof.trancheId !== e.trancheId ||
      proof.packageId !== e.packageId ||
      proof.reference !== e.reference ||
      proof.simulated !== true ||
      proof.effect !== 'CAPTURE'
    )
      throw new YardError('INVALID');
    const snapshot = await config.board.events.load(String(e.projectId));
    return c.json(
      ack(
        await config.board.settlement(
          String(e.projectId),
          String(e.wo),
          { ...proof, eventId: String(e.id) },
          snapshot.version,
        ),
      ),
    );
  });
}
