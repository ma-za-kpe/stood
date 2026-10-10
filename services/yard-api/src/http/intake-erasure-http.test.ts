import { createHmac } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { MemoryEvents } from '../../test/fakes/events.js';
import { Board } from '../application/board.js';
import { YardError } from '../ports/events.js';
import { createYardApp } from './app.js';

const now = 1791158400000;
// T-0217: the owning buyer deletes an intake over signed HTTP; anyone else, or a draft that is now a project, cannot.
it('erases an intake for its owning buyer and refuses everyone else', async () => {
  const events = new MemoryEvents();
  await events.create('project', 'buyer', { blueprint: {}, buyerRoot: 'r', orders: {} }, 'k');
  const erase = vi.fn(async (id: string, owner: string) => {
    if (owner !== 'buyer') throw new YardError('FORBIDDEN');
    return id === 'gone' ? ('ALREADY' as const) : ('ERASED' as const);
  });
  const forget = vi.fn(async () => undefined);
  const app = createYardApp({
    environment: 'ci',
    board: {
      board: new Board(events),
      clock: async () => now,
      intakes: { load: vi.fn(), read: vi.fn(async () => []), save: vi.fn(), erase, idle: vi.fn(async () => []) },
      foreman: { forget } as never,
      operators: ['buyer', 'foreign', 'builder'].map((id) => ({
        key: `${id}-key`,
        secret: `${id}-secret`,
        actor: { id, root: `${id}-root`, kind: id === 'builder' ? ('BUILDER' as const) : ('BUYER' as const) },
      })),
    },
  });
  const del = (path: string, actor = 'buyer') => {
    const t = String(Math.floor(now / 1000));
    return app.request(path, {
      method: 'DELETE',
      headers: {
        'Yard-Key-Id': `${actor}-key`,
        'Yard-Signature': `t=${t},v2=${createHmac('sha256', `${actor}-secret`)
          .update(
            JSON.stringify([
              'yard.request@2',
              t,
              `${actor}-key`,
              'DELETE',
              path,
              'erase',
              '0',
              'application/json',
              '',
              '',
            ]),
          )
          .digest('hex')}`,
        'Content-Type': 'application/json',
        'If-Match': '0',
        'Idempotency-Key': 'erase',
      },
    });
  };
  const erased = await del('/yard/v1/intakes/idea');
  expect(erased.status).toBe(200);
  expect(await erased.json()).toEqual({ id: 'idea', erased: true, already: false });
  expect(erased.headers.get('Cache-Control')).toBe('private, no-store');
  expect(forget).toHaveBeenCalledWith('idea');
  expect(await (await del('/yard/v1/intakes/gone')).json()).toMatchObject({ already: true });
  expect((await del('/yard/v1/intakes/idea', 'foreign')).status).toBe(403);
  expect((await del('/yard/v1/intakes/idea', 'builder')).status).toBe(403);
  expect((await del('/yard/v1/intakes/project')).status).toBe(409);
  expect((await app.request('/yard/v1/intakes/idea', { method: 'DELETE' })).status).toBe(401);
});
