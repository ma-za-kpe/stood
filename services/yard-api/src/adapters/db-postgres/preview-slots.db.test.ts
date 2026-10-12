import { afterAll, beforeAll, expect, it } from 'vitest';
import { yardDatabase } from '../../../test/database.js';
import { SLOT_GRACE_MS } from '../../ports/preview-slots.js';
import { migrateYardEvents } from './events.js';
import { migrateYardPreviewSlots, PostgresPreviewSlots } from './preview-slots.js';

let f: Awaited<ReturnType<typeof yardDatabase>>;
beforeAll(async () => {
  f = await yardDatabase();
  await migrateYardEvents(f.pool, f.owner);
  await migrateYardPreviewSlots(f.pool, f.owner);
  await migrateYardPreviewSlots(f.pool, f.owner);
});
afterAll(async () => {
  if (f) await f.close();
});
// Sixth audit (2026-10-11): the global preview cap is reserved atomically, across connections.
it('grants the last slot to exactly one of many racing deploys, then frees it by release or absence', async () => {
  const second = f.connectRuntime();
  const a = new PostgresPreviewSlots(f.limited),
    b = new PostgresPreviewSlots(second);
  try {
    const at = 1_000_000;
    const granted = await Promise.all(
      Array.from({ length: 6 }, (_, i) => (i % 2 ? a : b).reserve(`deploy-${i}`, 1, at)),
    );
    expect(granted.filter(Boolean)).toHaveLength(1);
    const winner = `deploy-${granted.indexOf(true)}`;
    await a.attach(winner, 'srv-live');
    expect(await b.reserve('deploy-late', 1, at + SLOT_GRACE_MS + 1)).toBe(false);
    // The sweep sees the service gone from Render: its slot is free again.
    expect(await a.retain(['srv-other'])).toBe(1);
    expect(await b.reserve('deploy-next', 1, at + 1)).toBe(true);
    // A slot that never got a service stops counting after the grace period.
    expect(await a.reserve('deploy-after', 1, at + 1 + SLOT_GRACE_MS + 1)).toBe(true);
    await a.release({ deployId: 'deploy-after' });
    await a.release({ deployId: 'deploy-next' });
    expect(await b.reserve('deploy-again', 1, at + 2)).toBe(true);
  } finally {
    await second.end();
  }
});
