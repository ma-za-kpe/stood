import { afterAll, beforeAll, expect, it } from 'vitest';
import { yardDatabase } from '../../../test/database.js';
import { migrateYardEvents } from './events.js';
import { migrateYardNotices, PostgresNoticeLog } from './notices.js';

let f: Awaited<ReturnType<typeof yardDatabase>>;
beforeAll(async () => {
  f = await yardDatabase();
  await migrateYardEvents(f.pool, f.owner);
  await migrateYardNotices(f.pool, f.owner);
  await migrateYardNotices(f.pool, f.owner);
});
afterAll(async () => {
  if (f) await f.close();
});
it('leases each notice key to one worker, retries expired leases, keeps deliveries, and only moves cursors forward', async () => {
  const second = f.connectRuntime();
  const a = new PostgresNoticeLog(f.limited),
    b = new PostgresNoticeLog(second);
  try {
    const claims = await Promise.all([a.claim('p:7:buyer', 1000, 60_000), b.claim('p:7:buyer', 1000, 60_000)]);
    expect(claims.sort()).toEqual(['BUSY', 'CLAIMED']);
    // A failed send releases the lease at once; a crashed worker's lease expires.
    await a.release('p:7:buyer');
    expect(await b.claim('p:7:buyer', 1001, 60_000)).toBe('CLAIMED');
    expect(await a.claim('p:7:buyer', 61_000, 60_000)).toBe('BUSY');
    expect(await a.claim('p:7:buyer', 61_001, 60_000)).toBe('CLAIMED');
    // Only delivery is permanent, and a late release cannot undo it.
    await a.delivered('p:7:buyer', 61_002);
    await b.release('p:7:buyer');
    expect(await b.claim('p:7:buyer', 999_999_999, 60_000)).toBe('DELIVERED');
    await a.advance('p', 9);
    await b.advance('p', 4);
    expect(await a.cursor('p')).toBe(9);
    expect(await a.cursor('other')).toBe(0);
  } finally {
    await second.end();
  }
});
