import { intakeChecked } from '@stood/yard-contracts';
import type { Context, Hono } from 'hono';
import type { Operator } from '../application/board.js';
import type { IntakePlanner } from '../application/intake-planner.js';
import { YardError } from '../ports/events.js';
import type { IntakeStore } from '../ports/intakes.js';
import { eventFeed } from './event-feed.js';
export function intakeHttp(
  app: Hono,
  config: Readonly<{
    store: IntakeStore;
    planner?: Pick<IntakePlanner, 'create'>;
    request(c: Context): Readonly<{ actor: Operator; body: string; now: number }>;
    authorize(headers: Headers, id: string, target: string): Promise<boolean>;
  }>,
) {
  const buyer = (c: Context) => {
    const actor = config.request(c).actor;
    if (actor.kind !== 'BUYER') throw new YardError('FORBIDDEN');
    return actor.id;
  };
  const save = async (c: Context, initial: boolean) => {
    const owner = buyer(c);
    const value: unknown = JSON.parse(config.request(c).body);
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      Object.keys(value).some((k) => !(initial ? ['id', 'step', 'draft'] : ['step', 'draft']).includes(k))
    )
      throw new YardError('INVALID');
    const input = value as Record<string, unknown>;
    const id = initial ? input.id : c.req.param('id'),
      rawVersion = c.req.header('If-Match') ?? '',
      key = c.req.header('Idempotency-Key') ?? '';
    if (
      typeof id !== 'string' ||
      !/^[A-Za-z0-9_-]{1,100}$/.test(id) ||
      !/^(0|[1-9]\d{0,9})$/.test(rawVersion) ||
      !/^[A-Za-z0-9:._-]{1,120}$/.test(key) ||
      typeof input.step !== 'number' ||
      !Number.isSafeInteger(input.step) ||
      input.step < 0 ||
      input.step > 7
    )
      throw new YardError('INVALID');
    const expectedVersion = Number(rawVersion);
    if ((initial && expectedVersion !== 0) || (!initial && expectedVersion < 1)) throw new YardError('INVALID');
    const draft = intakeChecked(input.draft);
    return c.json(
      await config.store.save({ id, owner, key, expectedVersion, step: input.step, draft, now: config.request(c).now }),
      initial ? 201 : 200,
    );
  };
  if (config.planner)
    app.post('/yard/v1/intakes/:id/plan', async (c) => {
      const owner = buyer(c),
        rawVersion = c.req.header('If-Match') ?? '',
        key = c.req.header('Idempotency-Key') ?? '';
      const value: unknown = JSON.parse(config.request(c).body);
      if (
        !/^[1-9]\d{0,9}$/.test(rawVersion) ||
        !/^[A-Za-z0-9:._-]{1,120}$/.test(key) ||
        !value ||
        typeof value !== 'object' ||
        Array.isArray(value) ||
        Object.keys(value).length
      )
        throw new YardError('INVALID');
      try {
        const plan = await config.planner!.create(c.req.param('id'), owner, Number(rawVersion), config.request(c).now);
        c.header('Cache-Control', 'private, no-store');
        return c.json(plan, 201);
      } catch (error) {
        if (
          error instanceof Error &&
          'code' in error &&
          ['INVALID', 'FORBIDDEN', 'CONFLICT', 'NOT_FOUND'].includes(String(error.code))
        )
          throw new YardError(error.code as 'INVALID' | 'FORBIDDEN' | 'CONFLICT' | 'NOT_FOUND');
        throw error;
      }
    });
  app.post('/yard/v1/intakes', (c) => save(c, true));
  app.put('/yard/v1/intakes/:id', (c) => save(c, false));
  app.get('/yard/v1/intakes/:id', async (c) => {
    const owner = buyer(c),
      record = await config.store.load(c.req.param('id'));
    if (record.owner !== owner) throw new YardError('FORBIDDEN');
    c.header('Cache-Control', 'private, no-store');
    return c.json(record);
  });
  eventFeed(app, { store: config.store, route: '/yard/v1/intakes/:id/events', authorize: config.authorize });
}
