import { afterAll, beforeAll, expect, it } from 'vitest';
import { yardDatabase } from '../../../test/database.js';
import { claimedFixture, leaseAt, leaseBuilder } from '../../../test/fakes/board-fixture.js';
import { SiteLog } from '../../application/site-log.js';
import { migrateYardEvents, PostgresYardEvents } from './events.js';
import { migrateYardSiteLogs, PostgresSiteLogs } from './site-log.js';

let f: Awaited<ReturnType<typeof yardDatabase>>;
let store: PostgresSiteLogs;
beforeAll(async () => {
  f = await yardDatabase();
  await migrateYardEvents(f.pool, f.owner);
  await migrateYardSiteLogs(f.pool, f.owner);
  store = new PostgresSiteLogs(f.limited);
});
afterAll(async () => {
  if (f) await f.close();
});
const note = { kind: 'note' as const, message: 'Building the booking route' };
async function setup(id: string) {
  const fixture = await claimedFixture(new PostgresYardEvents(f.limited), id);
  return { ...fixture, log: new SiteLog(store, fixture.board, { safe: async () => true }) };
}
it('restores sequence and exact receipts across connections without changing project state', async () => {
  const { board, log, id } = await setup('log-restart');
  expect(await store.bounds(id, 'one')).toEqual({ version: 0, retainedFrom: 1 });
  const before = await board.events.load(id);
  const receipt = await log.append(id, 'one', leaseBuilder, 'first', { lines: [note, note] }, leaseAt);
  expect(receipt).toEqual({ version: 2, count: 2, accepted: true });
  const connection = f.connectRuntime();
  try {
    const resumed = new PostgresSiteLogs(connection);
    expect((await resumed.snapshot(id, 'one')).lines.map((l) => l.seq)).toEqual([1, 2]);
    const retry = new SiteLog(resumed, board, { safe: async () => true });
    expect(await retry.append(id, 'one', leaseBuilder, 'first', { lines: [note, note] }, leaseAt + 1)).toEqual(receipt);
    await expect(retry.append(id, 'one', leaseBuilder, 'first', { lines: [note] }, leaseAt + 1000)).rejects.toThrow(
      'CONFLICT',
    );
    expect(await board.events.load(id)).toEqual(before);
    expect(await board.events.read(id, 0)).toHaveLength(before.version);
  } finally {
    await connection.end();
  }
});
it('serialises competing writes and limits the builder across work orders', async () => {
  const left = await setup('log-rate-left'),
    right = await setup('log-rate-right');
  const now = leaseAt + 1000;
  const result = await Promise.allSettled([
    left.log.append(left.id, 'one', leaseBuilder, 'one', { lines: [note] }, now),
    right.log.append(right.id, 'one', leaseBuilder, 'one', { lines: [note] }, now),
  ]);
  expect(result.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  expect(result.filter((r) => r.status === 'rejected')).toMatchObject([{ reason: { code: 'RATE_LIMITED' } }]);
  const winner = result[0]?.status === 'fulfilled' ? left : right;
  await expect(
    winner.log.append(winner.id, 'one', leaseBuilder, 'early', { lines: [note] }, now + 999),
  ).rejects.toThrow('RATE_LIMITED');
  expect(await winner.log.append(winner.id, 'one', leaseBuilder, 'next', { lines: [note] }, now + 1000)).toMatchObject({
    version: 2,
  });
});
it('rechecks authority under the claim lock and rolls back all log writes on failure', async () => {
  const { id, board } = await setup('log-lock');
  await expect(
    store.append({
      projectId: id,
      workOrderId: 'one',
      actor: 'builder',
      key: 'blocked',
      lines: [note],
      now: leaseAt + 3000,
      authorize: () => {
        throw new Error('Revoked claim');
      },
    }),
  ).rejects.toThrow('Revoked claim');
  expect((await store.snapshot(id, 'one')).version).toBe(0);
  const client = await f.pool.connect();
  try {
    await client.query(`SET ROLE ${f.owner}`);
    await client.query(
      "CREATE FUNCTION yard.test_log_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.project_id='log-lock' THEN RAISE EXCEPTION 'test log insert failed'; END IF; RETURN NEW; END $$; CREATE TRIGGER log_failure BEFORE INSERT ON yard.site_log_lines FOR EACH ROW EXECUTE FUNCTION yard.test_log_failure()",
    );
    const log = new SiteLog(store, board, { safe: async () => true });
    await expect(log.append(id, 'one', leaseBuilder, 'first', { lines: [note] }, leaseAt + 3000)).rejects.toThrow(
      'test log insert failed',
    );
    expect((await store.snapshot(id, 'one')).version).toBe(0);
    await client.query('DROP TRIGGER log_failure ON yard.site_log_lines; DROP FUNCTION yard.test_log_failure()');
    expect(await log.append(id, 'one', leaseBuilder, 'first', { lines: [note] }, leaseAt + 3000)).toMatchObject({
      version: 1,
    });
  } finally {
    await client.query('RESET ROLE');
    client.release();
  }
});
it('archives old lines into value-free counts without resetting the sequence or replay keys', async () => {
  const { id, log } = await setup('log-retention');
  await log.append(id, 'one', leaseBuilder, 'old', { lines: [note] }, leaseAt + 4000);
  const day = 86400000;
  await store.archive(leaseAt + 4000 + 90 * day - 1, 100);
  expect((await store.snapshot(id, 'one')).lines).toHaveLength(1);
  expect(await store.archive(leaseAt + 4000 + 90 * day, 100)).toBeGreaterThan(0);
  const snapshot = await store.snapshot(id, 'one');
  expect(snapshot).toMatchObject({
    version: 1,
    retainedFrom: 2,
    lines: [],
    summary: { through: 1, count: 1, kinds: { note: 1 } },
  });
  expect(await store.bounds(id, 'one')).toEqual({ version: 1, retainedFrom: 2 });
  expect(JSON.stringify(snapshot)).not.toContain(note.message);
  expect(await log.append(id, 'one', leaseBuilder, 'old', { lines: [note] }, leaseAt + 5000)).toMatchObject({
    version: 1,
  });
  expect(await log.append(id, 'one', leaseBuilder, 'new', { lines: [note] }, leaseAt + 5000)).toMatchObject({
    version: 2,
  });
  expect((await store.snapshot(id, 'one')).lines.map((line) => line.seq)).toEqual([2]);
  expect(await store.archive(leaseAt + 5000 + 90 * day, 100)).toBe(1);
  expect((await store.snapshot(id, 'one')).summary).toMatchObject({ count: 2, through: 2, kinds: { note: 2 } });
});
it('bounds cursors and retention and keeps log records immutable', async () => {
  const { id, log } = await setup('log-guards');
  await log.append(id, 'one', leaseBuilder, 'guarded', { lines: [note] }, leaseAt + 6000);
  for (const after of [-1, NaN, 0.5])
    await expect(store.read('log-restart', 'one', after)).rejects.toThrow('INVALID_LOG');
  for (const [now, limit] of [
    [-1, 100],
    [NaN, 100],
    [leaseAt, 0],
    [leaseAt, 1001],
  ])
    await expect(store.archive(now!, limit!)).rejects.toThrow('INVALID_LOG');
  await expect(
    f.limited.query("UPDATE yard.site_log_lines SET message='rewritten' WHERE project_id='log-guards'"),
  ).rejects.toThrow();
  await expect(
    f.limited.query("UPDATE yard.site_log_commands SET key='rewritten' WHERE project_id='log-guards'"),
  ).rejects.toThrow();
});
it('shares the notification connection while keeping log and project wake hints separate', async () => {
  const events = new PostgresYardEvents(f.limited);
  const { board, id } = await claimedFixture(events, 'log-wakes');
  const shared = new PostgresSiteLogs(f.limited, events);
  let projectWakes = 0,
    resolveLog: () => void = () => {};
  const notified = new Promise<void>((resolve) => {
    resolveLog = resolve;
  });
  const closeProject = await events.subscribe(id, () => {
    projectWakes++;
  });
  const closeLog = await shared.subscribe(id, 'one', resolveLog);
  try {
    expect(events.subscriptionCount).toBe(2);
    const log = new SiteLog(shared, board, { safe: async () => true });
    await log.append(id, 'one', leaseBuilder, 'first', { lines: [note] }, leaseAt + 7000);
    await notified;
    expect(projectWakes).toBe(0);
  } finally {
    closeProject();
    closeLog();
  }
  expect(events.subscriptionCount).toBe(0);
});
