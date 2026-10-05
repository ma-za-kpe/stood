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
