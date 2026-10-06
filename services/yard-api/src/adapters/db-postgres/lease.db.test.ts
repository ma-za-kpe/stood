import { LEASE_MS } from '@stood/yard-domain';
import { expect, it } from 'vitest';
import { yardDatabase } from '../../../test/database.js';
import { claimedFixture, leaseAt, leaseBuilder, leaseBuyer } from '../../../test/fakes/board-fixture.js';
import { Board } from '../../application/board.js';
import { migrateYardEvents, PostgresYardEvents } from './events.js';

it('commits one expiry under racing writers and restores repost/claim history through a new connection', async () => {
  const f = await yardDatabase();
  try {
    await migrateYardEvents(f.pool, f.owner);
    const store = new PostgresYardEvents(f.limited);
    const { board, id } = await claimedFixture(store);
    const end = leaseAt + LEASE_MS;
    const results = await Promise.allSettled([
      board.expireLease(id, 'one', leaseBuyer, 5, 'expire-a', end),
      board.expireLease(id, 'one', leaseBuyer, 5, 'expire-b', end),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect((await store.read(id, 0)).filter((e) => e.type === 'wo.lease_expired')).toHaveLength(1);
    const pool = f.connectRuntime();
    try {
      const restored = new Board(new PostgresYardEvents(pool));
      expect((await restored.view(id, 'one', leaseBuyer)).state).toBe('LEASE_EXPIRED');
      await expect(restored.read(id, leaseBuilder)).rejects.toThrow('FORBIDDEN');
      await restored.repost(id, 'one', leaseBuyer, 6, 'repost', end);
      const next = { id: 'next', root: 'next-root', kind: 'BUILDER' as const };
      await restored.claim(id, 'one', next, 7, 'claim-next', end);
      expect((await restored.view(id, 'one', next)).currentClaim?.builderId).toBe(next.id);
      expect((await restored.view(id, 'one', leaseBuyer)).payment).toBeNull();
      expect((await new PostgresYardEvents(pool).read(id, 0)).map((e) => e.seq)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    } finally {
      await pool.end();
    }
  } finally {
    await f.close();
  }
});
