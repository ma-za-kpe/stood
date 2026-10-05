import { afterAll, beforeAll, expect, it } from 'vitest';
import { yardDatabase } from '../../../test/database.js';
import { migrateYardEvents, PostgresYardEvents } from './events.js';

let fixture: Awaited<ReturnType<typeof yardDatabase>>;
let store: PostgresYardEvents;
beforeAll(async () => {
  fixture = await yardDatabase();
  await migrateYardEvents(fixture.pool, fixture.owner);
  store = new PostgresYardEvents(fixture.limited);
});
afterAll(async () => {
  if (fixture) await fixture.close();
});
it('serialises writes with consecutive events and exact retries, and rolls back a failed event', async () => {
  await store.create('project', 'buyer', { count: 0 }, 'create');
  const mutation = (data: unknown) => ({
    data: { count: (data as { count: number }).count + 1 },
    type: 'wo.claimed',
    payload: { wo: 'one' },
  });
  const results = await Promise.allSettled([
    store.mutate('project', 1, 'buyer', 'a', 'a', mutation),
    store.mutate('project', 1, 'buyer', 'b', 'b', mutation),
  ]);
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  const winner = results[0]?.status === 'fulfilled' ? 'a' : 'b';
  const snap = await store.load('project');
  expect(snap).toMatchObject({ version: 2, data: { count: 1 } });
  expect(await store.mutate('project', 1, 'buyer', winner, winner, mutation)).toEqual(snap);
  await expect(store.mutate('project', 2, 'buyer', winner, 'changed', mutation)).rejects.toThrow('CONFLICT');
  await expect(
    store.mutate('project', 2, 'buyer', 'bad-event', 'bad', () => ({ data: { count: 999 }, type: '', payload: {} })),
  ).rejects.toThrow();
  expect(await store.load('project')).toEqual(snap);
  const events = await store.read('project', 0);
  expect(events.map((e) => e.seq)).toEqual([1, 2]);
  expect(await store.read('project', 1)).toEqual([events[1]]);
  await expect(fixture.limited.query("UPDATE yard.events SET type='changed'")).rejects.toThrow();
  await expect(fixture.limited.query('DELETE FROM yard.events')).rejects.toThrow();
});

it('timestamps durable events from the shared server-controlled mock clock', async () => {
  let now = 1791158400000;
  const controlled = new PostgresYardEvents(fixture.limited, async () => now);
  await controlled.create('timed', 'buyer', {}, 'create');
  now += 86400000;
  await controlled.mutate('timed', 1, 'buyer', 'next', 'next', () => ({ data: {}, type: 'next', payload: {} }));
  expect((await controlled.read('timed', 0)).map((e) => e.at)).toEqual([
    '2026-10-05T00:00:00.000Z',
    '2026-10-06T00:00:00.000Z',
  ]);
});

it('shares one database listener and wakes only matching committed projects', async () => {
  const woken: string[] = [];
  const a = await store.subscribe('notify', () => woken.push('a'));
  const b = await store.subscribe('notify', () => woken.push('b'));
  const other = await store.subscribe('other-notify', () => woken.push('other'));
  await store.create('notify', 'buyer', {}, 'create');
  await expect.poll(() => woken).toEqual(['a', 'b']);
  await expect(
    store.mutate('notify', 1, 'buyer', 'bad', 'bad', () => ({ data: {}, type: '', payload: {} })),
  ).rejects.toThrow();
  expect(woken).toHaveLength(2);
  a();
  b();
  other();
  expect(store.subscriptionCount).toBe(0);
});
it('cleans the replacement listener when its last original viewer disconnects', async () => {
  let resolveLost = () => {};
  const lost = new Promise<void>((resolve) => {
    resolveLost = resolve;
  });
  const first = await store.subscribe('reconnect', resolveLost);
  const backend = await fixture.pool.query(
    "SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND query='LISTEN yard_events' AND state='idle'",
  );
  expect(backend.rows).toHaveLength(1);
  await fixture.pool.query('SELECT pg_terminate_backend($1)', [backend.rows[0].pid]);
  await lost;
  const second = await store.subscribe('reconnect', () => {});
  second();
  first();
  expect(store.subscriptionCount).toBe(0);
  await expect
    .poll(
      async () =>
        (
          await fixture.pool.query(
            "SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND query='LISTEN yard_events' AND state='idle'",
          )
        ).rows.length,
    )
    .toBe(0);
});
