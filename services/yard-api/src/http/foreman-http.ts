import type { PlannerIntake } from '@stood/yard-domain';
import type { Context, Hono } from 'hono';
import type { Operator } from '../application/board.js';
import { YardError } from '../ports/events.js';
import type { ForemanPlans } from '../ports/foreman.js';
export function foremanHttp(
  app: Hono,
  config: Readonly<{
    foreman: ForemanPlans;
    request(c: Context): Readonly<{ actor: Operator; body: string; now: number }>;
  }>,
) {
  const actor = (c: Context) => {
    const { actor } = config.request(c);
    if (actor.kind !== 'BUYER') throw new YardError('FORBIDDEN');
    return actor;
  };
  const body = (c: Context, keys: readonly string[]) => {
    const v: unknown = JSON.parse(config.request(c).body);
    if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).some((k) => !keys.includes(k)))
      throw new YardError('INVALID');
    return v as Record<string, unknown>;
  };
  const command = (c: Context) => {
    const key = c.req.header('Idempotency-Key') ?? '',
      version = Number(c.req.header('If-Match'));
    if (!/^[A-Za-z0-9:._-]{1,120}$/.test(key) || !Number.isSafeInteger(version) || version < 1)
      throw new YardError('INVALID');
    return { version, buyer: actor(c).id };
  };
  const invoke = async <T>(work: () => Promise<T>): Promise<T> => {
    try {
      return await work();
    } catch (error) {
      if (
        error instanceof Error &&
        'code' in error &&
        (error.code === 'INVALID' ||
          error.code === 'FORBIDDEN' ||
          error.code === 'CONFLICT' ||
          error.code === 'NOT_FOUND')
      )
        throw new YardError(error.code);
      throw error;
    }
  };
  app.post('/yard/v1/plans', async (c) => {
    const buyer = actor(c).id;
    const key = c.req.header('Idempotency-Key') ?? '';
    if (!/^[A-Za-z0-9:._-]{1,120}$/.test(key)) throw new YardError('INVALID');
    const input = body(c, ['id', 'repository', 'baseCommit', 'description', 'capMinor', 'currency', 'context']);
    return c.json(
      await invoke(() =>
        config.foreman.draft({
          ...input,
          buyerOperatorId: buyer,
          createdAt: config.request(c).now,
        } as PlannerIntake),
      ),
      201,
    );
  });
  app.get('/yard/v1/plans/:id', async (c) => {
    const buyer = actor(c).id;
    const plan = await invoke(() => config.foreman.read(c.req.param('id')));
    if (plan.blueprint.buyerOperatorId !== buyer) throw new YardError('FORBIDDEN');
    return c.json(plan);
  });
  app.post('/yard/v1/plans/:id/review', async (c) => {
    const { version, buyer } = command(c),
      input = body(c, ['decision']);
    if (input.decision !== 'ACCEPT' && input.decision !== 'REVISE') throw new YardError('INVALID');
    const decision = input.decision;
    return c.json(await invoke(() => config.foreman.resume(c.req.param('id'), buyer, version, decision)));
  });
  app.post('/yard/v1/plans/:id/revisions', async (c) => {
    const { version, buyer } = command(c),
      input = body(c, ['feedback']);
    if (typeof input.feedback !== 'string') throw new YardError('INVALID');
    return c.json(
      await invoke(() => config.foreman.revise(c.req.param('id'), buyer, version, input.feedback as string)),
    );
  });
  app.post('/yard/v1/plans/:id/recover', async (c) => {
    const buyer = actor(c).id;
    body(c, []);
    return c.json(await invoke(() => config.foreman.recover(c.req.param('id'), buyer)));
  });
}
