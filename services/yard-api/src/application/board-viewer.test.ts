import { expect, it } from 'vitest';
import { claimedFixture, leaseAt, leaseBuilder, leaseBuyer } from '../../test/fakes/board-fixture.js';

const event = (type: string, payload: Record<string, unknown>) => ({ seq: 9, type, actor: 'x', payload, at: '' });
it('lets the owning buyer see every event and a builder only build events for work it holds (T-0194)', async () => {
  const { board, id } = await claimedFixture();
  const buyer = await board.viewer(id, leaseBuyer);
  for (const e of [
    event('secret.added', { name: 'SUPABASE_URL' }),
    event('blueprint.approved', {}),
    event('wo.claimed', { wo: 'one' }),
  ])
    expect(buyer.see(e)).toBe(true);
  const builder = await board.viewer(id, leaseBuilder);
  expect(builder.see(event('wo.claimed', { wo: 'one' }))).toBe(true);
  expect(builder.see(event('stood.refused', { wo: 'one', punchList: [] }))).toBe(true);
  expect(builder.see(event('wo.posted', { wo: 'two' }))).toBe(false);
  expect(builder.see(event('secret.added', { name: 'SUPABASE_URL' }))).toBe(false);
  expect(builder.see(event('blueprint.approved', {}))).toBe(false);
  expect(builder.see(event('blueprint.closed', {}))).toBe(false);
  expect(builder.see(event('wo.claimed', {}))).toBe(false);
  // After clocking out the builder no longer holds the work, so access ends.
  await board.releaseClaim(id, 'one', leaseBuilder, 6, 'out', leaseAt + 1);
  await expect(board.viewer(id, leaseBuilder)).rejects.toThrow('FORBIDDEN');
  await expect(board.viewer(id, { id: 'other', root: 'x', kind: 'BUYER' })).rejects.toThrow('FORBIDDEN');
});
