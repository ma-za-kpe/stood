import { createHmac, timingSafeEqual } from 'node:crypto';
import { handoverConfirmation, IntakeError, RETENTION } from '@stood/yard-contracts';
import type { BlueprintInput, FreezeProof } from '@stood/yard-domain';
import type { Context, Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { streamSSE } from 'hono/streaming';
import {
  type Board,
  type HoldProof,
  type Operator,
  offerId,
  type RefusalProof,
  type SettlementProof,
  type StoodProof,
} from '../application/board.js';
import type { IntakePlanner } from '../application/intake-planner.js';
import { type DraftGateway, MandateBridge } from '../application/mandate-bridge.js';
import { type NudgeConfig, Nudges } from '../application/nudges.js';
import type { Previews } from '../application/previews.js';
import type { SecretVault } from '../application/secret-vault.js';
import type { SiteLog } from '../application/site-log.js';
import { type PackageGateway, SubmissionBridge } from '../application/submission-bridge.js';
import { YardError } from '../ports/events.js';
import type { ForemanPlans } from '../ports/foreman.js';
import type { IntakeStore } from '../ports/intakes.js';
import { SecretError } from '../ports/secrets.js';
import { SiteLogError } from '../ports/site-log.js';
import { eventFeed } from './event-feed.js';
import { foremanHttp } from './foreman-http.js';
import { intakeHttp } from './intake-http.js';
import { siteLogHttp } from './site-log-http.js';
export type BoardConfig = Readonly<{
  board: Board;
  clock(): Promise<number>;
  // A key may be retired at notAfter (rotation overlaps old and new keys). payeeRef is a PayPal email or
  // payer id only: payouts reach the operator's own PayPal account; Yard holds no PayPal credentials.
  operators: readonly Readonly<{
    key: string;
    secret: string;
    actor: Operator;
    notAfter?: number;
    payeeRef?: string;
    // T-0266: a code the owner gives this operator for signing in on the hosted page (24+ characters).
    accessCode?: string;
  }>[];
  packages?: PackageGateway;
  siteLog?: SiteLog;
  foreman?: ForemanPlans;
  intakes?: IntakeStore;
  intakePlanner?: Pick<IntakePlanner, 'create'>;
  secrets?: SecretVault;
  mandates?: DraftGateway;
  // T-0196: buyer-requested previews of a submitted milestone (Render, test keys only, expiring).
  previews?: Pick<Previews, 'deploy'>;
  nudges?: NudgeConfig;
  boardStreamMs?: number;
  stood?: Readonly<{ mode: 'sim'; secret: string; read(trancheId: string): Promise<StoodProof> }>;
}>;
function signature(value: string | null, body: string, secret: string, now: number): boolean {
  const match = /^t=(\d{1,12}),v1=([a-f0-9]{64})$/.exec(value ?? '');
  if (!match || !Number.isSafeInteger(now) || Math.abs(now / 1000 - Number(match[1])) > 300) return false;
  const expected = createHmac('sha256', secret).update(`${match[1]}.${body}`).digest();
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
      (o) =>
        ![o.key, o.secret, o.actor.id, o.actor.root].every((v) => typeof v === 'string' && v.trim().length > 0) ||
        (o.notAfter !== undefined && (!Number.isSafeInteger(o.notAfter) || o.notAfter < 0)) ||
        (o.payeeRef !== undefined &&
          !/^[^\s@]{1,64}@[^\s@]{1,190}\.[A-Za-z]{2,24}$/.test(o.payeeRef) &&
          !/^[A-Z0-9]{13}$/.test(o.payeeRef)),
    )
  )
    throw new YardError('INVALID');
  const identify = (headers: Headers, method: string, path: string, body: string, now: number): Operator | null => {
    const credential = config.operators.find(
      (o) => o.key === headers.get('Yard-Key-Id') && (o.notAfter === undefined || now < o.notAfter),
    );
    const match = /^t=(\d{1,12}),v2=([a-f0-9]{64})$/.exec(headers.get('Yard-Signature') ?? '');
    if (!credential || !match || !Number.isSafeInteger(now) || now < 0 || Math.abs(now / 1000 - Number(match[1])) > 300)
      return null;
    const expected = createHmac('sha256', credential.secret)
      .update(
        JSON.stringify([
          'yard.request@2',
          match[1],
          credential.key,
          method,
          path,
          headers.get('Idempotency-Key') ?? '',
          headers.get('If-Match') ?? '',
          headers.get('Content-Type') ?? '',
          headers.get('Last-Event-ID') ?? '',
          body,
        ]),
      )
      .digest();
    if (!timingSafeEqual(expected, Buffer.from(match[2]!, 'hex'))) return null;
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
    const url = new URL(c.req.url);
    const actor = identify(c.req.raw.headers, c.req.method, `${url.pathname}${url.search}`, raw, now);
    if (!actor) return c.json({ code: 'unauthorized' }, 401);
    requests.set(c.req.raw, { actor, body: raw, now });
    return next();
  });
  app.onError((error, c) => {
    if (error instanceof SiteLogError)
      return c.json(
        { code: error.code },
        error.code === 'RATE_LIMITED' ? 429 : error.code === 'SCAN_UNAVAILABLE' ? 503 : 422,
      );
    if (error instanceof IntakeError) return c.json({ code: error.code }, 422);
    // Fixed codes only: a secret error never echoes the submitted value.
    if (error instanceof SecretError)
      return error.code === 'LIVE_KEY'
        ? c.json({ code: 'live_key_refused' }, 422)
        : c.json(
            { code: error.code },
            ({ INVALID: 422, FORBIDDEN: 403, NOT_FOUND: 404, CONFLICT: 409, UNAVAILABLE: 503 } as const)[error.code],
          );
    if (error instanceof YardError)
      return c.json(
        { code: error.code },
        error.code === 'FORBIDDEN' ? 403 : error.code === 'NOT_FOUND' ? 404 : error.code === 'INVALID' ? 422 : 409,
      );
    if (error instanceof SyntaxError || error instanceof RangeError || error instanceof TypeError)
      return c.json({ code: 'invalid_request' }, 422);
    return c.json({ code: 'yard_unavailable' }, 503);
  });
  if (config.foreman) foremanHttp(app, { foreman: config.foreman, request });
  if (config.intakes) {
    const store = config.intakes;
    intakeHttp(app, {
      store,
      ...(config.intakePlanner ? { planner: config.intakePlanner } : {}),
      request,
      authorize: async (headers, id, target) => {
        const actor = identify(headers, 'GET', target, '', await config.clock());
        if (!actor || actor.kind !== 'BUYER') return false;
        try {
          return (await store.load(id)).owner === actor.id;
        } catch {
          return false;
        }
      },
    });
  }
  if (config.siteLog) {
    const log = config.siteLog;
    siteLogHttp(app, {
      log,
      request,
      authorize: async (headers, project, wo, target) => {
        const now = await config.clock(),
          actor = identify(headers, 'GET', target, '', now);
        if (!actor) return false;
        try {
          await log.authorize(project, wo, actor, now);
          return true;
        } catch {
          return false;
        }
      },
    });
  }
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
    c.json({
      ...(await config.board.discoverPage(c.req.query('after'), request(c).now, c.req.query('q'))),
      simulated: true,
    }),
  );
  // T-0211: the public Board as a live stream of open work. Public fields only; no buyer identity.
  app.get('/yard/v1/board/events', (c) => {
    const interval = config.boardStreamMs ?? 2000;
    c.header('Cache-Control', 'no-store');
    return streamSSE(c, async (stream) => {
      let last = '';
      let stopped = false;
      stream.onAbort(() => {
        stopped = true;
      });
      while (!stopped && !stream.aborted) {
        const page = await config.board.discoverPage('', await config.clock());
        const raw = JSON.stringify({ orders: page.orders, nextCursor: page.nextCursor, simulated: true });
        if (raw !== last) {
          await stream.writeSSE({ event: 'board.snapshot', data: raw });
          last = raw;
        } else await stream.writeSSE({ event: 'heartbeat', data: '{}' });
        await stream.sleep(interval);
      }
    });
  });
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
      'costLines',
    ]);
    return c.json(
      ack(await config.board.create({ ...input, createdAt: request(c).now } as BlueprintInput, request(c).actor, key)),
      201,
    );
  });
  app.get('/yard/v1/blueprints/:id', async (c) => c.json(await config.board.read(c.req.param('id'), request(c).actor)));
  app.get('/yard/v1/blueprints/:id/export', async (c) => {
    const { actor, now } = request(c),
      id = c.req.param('id');
    const { room, events } = await config.board.exportFor(id, actor, now);
    let intake: unknown = null;
    if (config.intakes)
      try {
        const record = await config.intakes.load(id);
        if (record.owner === actor.id) intake = { version: record.version, step: record.step, draft: record.draft };
      } catch {
        intake = null;
      }
    // Key values are never exported: only names, providers and dates.
    const secrets = config.secrets ? await config.secrets.list(id, actor.id).catch(() => []) : [];
    c.header('Content-Disposition', `attachment; filename="yard-${id.replace(/[^A-Za-z0-9_-]/g, '_')}.json"`);
    c.header('Cache-Control', 'no-store');
    return c.json({
      format: 'yard.export@1',
      exportedAt: now,
      project: room,
      events,
      intake,
      secrets,
      retention: RETENTION,
      simulated: true,
    });
  });
  app.get('/yard/v1/blueprints/:id/room', async (c) =>
    c.json(await config.board.room(c.req.param('id'), request(c).actor, request(c).now)),
  );
  app.post('/yard/v1/blueprints/:id/approve', async (c) => {
    const { key, version, actor } = command(c);
    const proof = body(c, ['version', 'buyerOperatorId', 'approvalReference', 'baselines']);
    return c.json(ack(await config.board.freeze(c.req.param('id'), proof as FreezeProof, actor, version, key)));
  });
  app.post('/yard/v1/blueprints/:id/work-orders', async (c) => {
    const { key, version, actor, now } = command(c),
      input = body(c, ['milestone', 'trancheId']);
    const posted = async (result: { id: string; version: number }) => {
      if (nudges) void nudges.posted([offerId(c.req.param('id'), String(input.milestone))], now).catch(() => 0);
      return result;
    };
    if (typeof input.milestone !== 'string' || (input.trancheId !== undefined && typeof input.trancheId !== 'string'))
      throw new YardError('INVALID');
    return c.json(
      ack(
        await posted(
          await config.board.post(
            c.req.param('id'),
            input.milestone,
            input.trancheId as string | undefined,
            actor,
            version,
            key,
            now,
          ),
        ),
      ),
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
  for (const [route, method] of [
    ['expire', 'expireLease'],
    ['release', 'releaseClaim'],
    ['repost', 'repost'],
  ] as const)
    app.post(`/yard/v1/blueprints/:id/work-orders/:wo/${route}`, async (c) => {
      const { key, version, actor, now } = command(c);
      body(c, []);
      return c.json(ack(await config.board[method](c.req.param('id'), c.req.param('wo'), actor, version, key, now)));
    });
  app.post('/yard/v1/blueprints/:id/work-orders/:wo/preview', async (c) => {
    if (!config.previews) return c.json({ code: 'previews_not_configured' }, 503);
    const { actor, now } = command(c),
      id = c.req.param('id');
    const input = body(c, ['image']);
    // The preview receives the buyer's TEST keys, so only that buyer chooses what runs with them.
    const snapshot = await config.board.read(id, actor);
    if (actor.kind !== 'BUYER' || snapshot.owner !== actor.id) throw new YardError('FORBIDDEN');
    if (typeof input.image !== 'string') throw new YardError('INVALID');
    return c.json(await config.previews.deploy(id, c.req.param('wo'), input.image, now));
  });
  app.get('/yard/v1/operators/:root/reputation', async (c) =>
    c.json({ ...(await config.board.reputation(c.req.param('root'))), simulated: true }),
  );
  app.post('/yard/v1/blueprints/:id/work-orders/:wo/usage', async (c) => {
    const { key, version, actor, now } = command(c);
    body(c, []);
    return c.json(ack(await config.board.confirmUsage(c.req.param('id'), actor, version, key, now, c.req.param('wo'))));
  });
  app.post('/yard/v1/blueprints/:id/changes', async (c) => {
    const { key, version, actor, now } = command(c),
      input = body(c, ['changes']);
    if (!Array.isArray(input.changes)) throw new YardError('INVALID');
    return c.json(
      ack(await config.board.proposeChange(c.req.param('id'), actor, version, key, now, input.changes as never)),
    );
  });
  app.post('/yard/v1/blueprints/:id/changes/:change/approve', async (c) => {
    const { key, version, actor } = command(c);
    body(c, []);
    return c.json(ack(await config.board.approveChange(c.req.param('id'), actor, version, key, c.req.param('change'))));
  });
  app.post('/yard/v1/blueprints/:id/mandate', async (c) => {
    if (!config.mandates) throw new YardError('CONFLICT');
    const { key, version, actor, now } = command(c);
    body(c, []);
    const result = await new MandateBridge(config.board, config.mandates).create(
      c.req.param('id'),
      actor,
      version,
      key,
      now,
    );
    return c.json({ ...result, status: 'DRAFT', simulated: true });
  });
  app.post('/yard/v1/blueprints/:id/handover', async (c) => {
    const { key, version, actor, now } = command(c),
      id = c.req.param('id');
    let confirmed: readonly string[];
    try {
      confirmed = handoverConfirmation(body(c, ['confirmed']));
    } catch (error) {
      if (error instanceof YardError) throw error;
      throw new YardError('INVALID');
    }
    const result = await config.board.closeHandover(id, actor, version, key, now, confirmed);
    // Yard's own checklist item: stored test keys are deleted within seven days of handover.
    const keysDeletedBy = now + 7 * 86400000;
    if (config.secrets) await config.secrets.scheduleDeletion(id, actor.id, keysDeletedBy);
    return c.json({ ...ack(result), keysDeletedBy });
  });
  const nudges = config.nudges ? new Nudges(config.nudges) : null;
  // T-0210: an A2A-shaped surface over the same signed Board commands. Not certified; no new authority.
  app.get('/.well-known/agent.json', (c) =>
    c.json({
      name: 'Yard Board',
      description: 'Post, discover, claim and submit fixed-price, test-defined work orders. Stood decides payment.',
      url: '/yard/v1/a2a',
      version: '0.1.0',
      capabilities: { streaming: false, pushNotifications: false },
      defaultInputModes: ['application/json'],
      defaultOutputModes: ['application/json'],
      skills: [
        { id: 'discover-work', name: 'Discover work', description: 'Page through open work orders.', tags: ['board'] },
        {
          id: 'post-work-order',
          name: 'Post a work order',
          description: 'Buyer posts a signed milestone.',
          tags: ['board'],
        },
        { id: 'claim-work-order', name: 'Clock in', description: 'Builder claims a 48-hour lease.', tags: ['lease'] },
        {
          id: 'submit-work',
          name: 'Submit work',
          description: 'Builder submits a commit for Stood to check.',
          tags: ['stood'],
        },
      ],
      securitySchemes: {
        yardHmac: {
          type: 'apiKey',
          in: 'header',
          name: 'Yard-Signature',
          description:
            'yard.request@2 HMAC over key id, method, target, command headers and body; Yard-Key-Id names the key.',
        },
      },
      security: [{ yardHmac: [] }],
      simulated: true,
      certification: 'none',
    }),
  );
  app.post('/yard/v1/a2a', async (c) => {
    const { actor, now, body: raw } = request(c);
    let message: Record<string, unknown>;
    let rpcId: unknown = null;
    const rpcError = (code: number, text: string) =>
      c.json({ jsonrpc: '2.0', id: rpcId, error: { code, message: text } });
    try {
      message = JSON.parse(raw);
      rpcId = message.id ?? null;
    } catch {
      return rpcError(-32700, 'Parse error');
    }
    const params = (message.params ?? {}) as Record<string, unknown>;
    const task = (id: string, context: string, state: string, data?: unknown) =>
      c.json({
        jsonrpc: '2.0',
        id: rpcId,
        result: {
          kind: 'task',
          id,
          contextId: context,
          status: { state, timestamp: new Date(now).toISOString() },
          artifacts: data === undefined ? [] : [{ artifactId: `${id}:result`, parts: [{ kind: 'data', data }] }],
          metadata: { simulated: true },
        },
      });
    const states: Record<string, string> = {
      POSTED: 'submitted',
      CLAIMED: 'working',
      BUILDING: 'working',
      SUBMITTING: 'working',
      SUBMITTED: 'working',
      CHECKING: 'working',
      REWORK: 'input-required',
      PAID: 'completed',
      REFUSED: 'failed',
      LEASE_EXPIRED: 'failed',
      ABANDONED: 'failed',
    };
    try {
      if (message.jsonrpc !== '2.0') return rpcError(-32600, 'Invalid request');
      if (message.method === 'tasks/get') {
        const match = /^wo:([A-Za-z0-9_-]{1,100}):([A-Za-z0-9_-]{1,100})$/.exec(String(params.id ?? ''));
        if (!match) return rpcError(-32602, 'Invalid params');
        const view = await config.board.view(match[1] as string, match[2] as string, actor);
        return task(String(params.id), match[1] as string, states[view.state] ?? 'unknown');
      }
      if (message.method !== 'message/send') return rpcError(-32601, 'Method not found');
      const m = params.message as { messageId?: unknown; parts?: unknown } | undefined;
      const part = Array.isArray(m?.parts) && m.parts.length === 1 ? (m.parts[0] as Record<string, unknown>) : null;
      const data = part?.kind === 'data' ? (part.data as Record<string, unknown>) : null;
      const key = typeof m?.messageId === 'string' ? m.messageId : '';
      if (!data || !/^[A-Za-z0-9:._-]{1,120}$/.test(key)) return rpcError(-32602, 'Invalid params');
      const text = (k: string) => {
        if (typeof data[k] !== 'string') throw new YardError('INVALID');
        return data[k] as string;
      };
      const version = () => {
        if (!Number.isSafeInteger(data.version)) throw new YardError('INVALID');
        return data.version as number;
      };
      switch (data.skill) {
        case 'discover-work':
          return task(
            `discover:${key}`,
            'board',
            'completed',
            await config.board.discoverPage(typeof data.after === 'string' ? data.after : '', now),
          );
        case 'post-work-order': {
          const project = text('projectId'),
            milestone = text('milestone');
          const result = await config.board.post(
            project,
            milestone,
            typeof data.trancheId === 'string' ? data.trancheId : undefined,
            actor,
            version(),
            key,
            now,
          );
          if (nudges) void nudges.posted([offerId(project, milestone)], now).catch(() => 0);
          return task(`wo:${project}:${milestone}`, project, 'completed', ack(result));
        }
        case 'claim-work-order': {
          const project = text('projectId'),
            wo = text('workOrderId');
          const result = await config.board.claim(project, wo, actor, version(), key, now);
          return task(`wo:${project}:${wo}`, project, 'completed', ack(result));
        }
        case 'submit-work': {
          const project = text('projectId'),
            wo = text('workOrderId'),
            commit = text('commit');
          if (!config.packages || !/^[a-f0-9]{40}$/.test(commit)) throw new YardError('INVALID');
          const result = await new SubmissionBridge(config.board, config.packages).submit(
            project,
            wo,
            commit,
            actor,
            version(),
            key,
            now,
          );
          return task(`wo:${project}:${wo}`, project, 'completed', result);
        }
        default:
          return rpcError(-32602, 'Invalid params');
      }
    } catch (error) {
      if (error instanceof YardError)
        return rpcError(
          { FORBIDDEN: -32003, NOT_FOUND: -32001, INVALID: -32602 }[error.code as string] ?? -32009,
          error.code,
        );
      return rpcError(-32603, 'Yard is unavailable');
    }
  });
  if (config.secrets) {
    const vault = config.secrets;
    const name = (c: Context) => {
      const value = c.req.param('name') ?? '';
      if (!/^[A-Z][A-Z0-9_]{0,63}$/.test(value)) throw new YardError('INVALID');
      return value;
    };
    app.get('/yard/v1/blueprints/:id/secrets', async (c) => {
      const { actor } = request(c);
      await config.board.secretScope(c.req.param('id'), actor);
      return c.json({ secrets: await vault.list(c.req.param('id'), actor.id), simulated: true });
    });
    app.put('/yard/v1/blueprints/:id/secrets/:name', async (c) => {
      const { key, actor, now } = command(c),
        id = c.req.param('id'),
        input = body(c, ['provider', 'environment', 'value']);
      if (
        typeof input.provider !== 'string' ||
        typeof input.environment !== 'string' ||
        typeof input.value !== 'string'
      )
        throw new YardError('INVALID');
      await config.board.secretScope(id, actor);
      const meta = await vault.put({
        blueprintId: id,
        owner: actor.id,
        provider: input.provider,
        name: name(c),
        environment: input.environment as 'TEST' | 'DEV',
        value: input.value,
        key,
        now,
      });
      await config.board.secretEvent(id, actor, key, 'secret.added', {
        name: meta.name,
        provider: meta.provider,
        environment: meta.environment,
        version: meta.version,
      });
      return c.json({ ...meta, simulated: true }, 201);
    });
    app.post('/yard/v1/blueprints/:id/secrets/:name/revoke', async (c) => {
      const { actor, now } = command(c),
        id = c.req.param('id');
      body(c, []);
      await config.board.secretScope(id, actor);
      const { key } = command(c);
      await vault.revoke(id, actor.id, name(c), now);
      await config.board.secretEvent(id, actor, key, 'secret.revoked', { name: name(c) });
      return c.json({ revoked: true, simulated: true });
    });
  }
  eventFeed(app, {
    store: config.board.events,
    authorize: async (headers, id, target) => {
      const actor = identify(headers, 'GET', target, '', await config.clock());
      if (!actor) return false;
      try {
        return await config.board.viewer(id, actor);
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
    const settled = e.type === 'stood.released' || e.type === 'stood.refused';
    if (
      e.simulated !== true ||
      (!settled && e.type !== 'stood.held') ||
      !['id', 'projectId', 'wo', 'trancheId', ...(settled ? ['packageId', 'reference'] : [])].every(
        (k) => typeof e[k] === 'string' && String(e[k]).length > 0 && String(e[k]).length <= 200,
      )
    )
      throw new YardError('INVALID');
    // The notification is only a hint: the decision comes from a fresh signed Stood read.
    const proof = await config.stood.read(String(e.trancheId));
    const expected = { 'stood.released': 'CAPTURE', 'stood.refused': 'VOID', 'stood.held': 'HOLD' }[String(e.type)];
    if (
      !proof ||
      proof.trancheId !== e.trancheId ||
      proof.simulated !== true ||
      proof.effect !== expected ||
      (proof.effect !== 'HOLD' && (proof.packageId !== e.packageId || proof.reference !== e.reference))
    )
      throw new YardError('INVALID');
    const snapshot = await config.board.events.load(String(e.projectId));
    const eventId = String(e.id),
      project = String(e.projectId),
      wo = String(e.wo);
    return c.json(
      ack(
        proof.effect === 'CAPTURE'
          ? await config.board.settlement(
              project,
              wo,
              { ...(proof as Omit<SettlementProof, 'eventId'>), eventId },
              snapshot.version,
            )
          : proof.effect === 'VOID'
            ? await config.board.refusal(
                project,
                wo,
                { ...(proof as Omit<RefusalProof, 'eventId'>), eventId },
                snapshot.version,
              )
            : await config.board.holdConfirmed(
                project,
                wo,
                { ...(proof as Omit<HoldProof, 'eventId'>), eventId },
                snapshot.version,
              ),
      ),
    );
  });
}
