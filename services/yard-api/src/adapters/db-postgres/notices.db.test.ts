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
it('claims each notice key once across racing workers and only moves cursors forward (T-0213)', async () => {
  const second = f.connectRuntime();
  const a = new PostgresNoticeLog(f.limited),
    b = new PostgresNoticeLog(second);
  try {
    const claims = await Promise.all([a.claim('p:7:buyer'), b.claim('p:7:buyer')]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    await a.release('p:7:buyer');
    expect(await b.claim('p:7:buyer')).toBe(true);
    await a.advance('p', 9);
    await b.advance('p', 4);
    expect(await a.cursor('p')).toBe(9);
    expect(await a.cursor('other')).toBe(0);
  } finally {
    await second.end();
  }
});
