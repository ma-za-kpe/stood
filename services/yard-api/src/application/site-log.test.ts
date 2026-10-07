import { expect, it, vi } from 'vitest';
import { claimedFixture, leaseAt, leaseBuilder, leaseBuyer } from '../../test/fakes/board-fixture.js';
import type { SiteLogs } from '../ports/site-log.js';
import { SiteLog } from './site-log.js';

const batch = { lines: [{ kind: 'note', message: 'Working on booking routes' }] };
async function setup() {
  const f = await claimedFixture();
  const snapshot = { version: 0, retainedFrom: 1, lines: [], summary: null };
  const append = vi.fn(async (input: Parameters<SiteLogs['append']>[0]) => {
    input.authorize(await f.store.load(f.id));
    return { version: 1, count: 1, accepted: true as const };
  });
  const store: SiteLogs = {
    append,
    bounds: async () => ({ version: 0, retainedFrom: 1 }),
    snapshot: vi.fn(async () => snapshot),
    read: vi.fn(async () => []),
    subscribe: vi.fn(async () => () => {}),
    archive: vi.fn(async () => 0),
  };
  const scanner = { safe: vi.fn(async () => true) };
  return { ...f, store, scanner, log: new SiteLog(store, f.board, scanner) };
}
it('checks the exact current builder before scanning and again inside the store transaction', async () => {
  const f = await setup();
  expect(await f.log.append(f.id, 'one', leaseBuilder, 'first', batch, leaseAt)).toMatchObject({ accepted: true });
  expect(f.store.append).toHaveBeenCalledOnce();
  expect(f.scanner.safe).toHaveBeenCalledWith(JSON.stringify(batch.lines[0]));
  f.scanner.safe.mockImplementation(async () => {
    await f.board.releaseClaim(f.id, 'one', leaseBuilder, 6, 'release', leaseAt);
    return true;
  });
  await expect(f.log.append(f.id, 'one', leaseBuilder, 'race', batch, leaseAt)).rejects.toThrow('FORBIDDEN');
});
it('withholds all log access from foreign identities and root impersonation', async () => {
  const f = await setup();
  for (const actor of [
    { ...leaseBuilder, id: 'foreign' },
    { ...leaseBuilder, root: 'foreign' },
  ]) {
    await expect(f.log.append(f.id, 'one', actor, 'bad', batch, leaseAt)).rejects.toThrow('FORBIDDEN');
    await expect(f.log.snapshot(f.id, 'one', actor, leaseAt)).rejects.toThrow('FORBIDDEN');
  }
  await expect(f.log.append(f.id, 'one', leaseBuyer, 'buyer-write', batch, leaseAt)).rejects.toThrow('INVALID_LOG');
  expect(f.scanner.safe).not.toHaveBeenCalled();
  expect(f.store.append).not.toHaveBeenCalled();
  expect(await f.log.snapshot(f.id, 'one', leaseBuyer, leaseAt)).toMatchObject({ version: 0 });
  await expect(f.log.authorize(f.id, 'one', { ...leaseBuyer, root: 'wrong' }, leaseAt)).rejects.toThrow('FORBIDDEN');
});
it('rejects expired or already-submitted writers and invalid clocks without scanning', async () => {
  const f = await setup();
  for (const now of [leaseAt - 1, leaseAt + 48 * 3600000, NaN])
    await expect(f.log.append(f.id, 'one', leaseBuilder, 'bad', batch, now)).rejects.toThrow();
  await f.board.submit(f.id, 'one', 'a'.repeat(40), 'package', leaseBuilder, 6, 'submit', leaseAt);
  await expect(f.log.append(f.id, 'one', leaseBuilder, 'late', batch, leaseAt)).rejects.toThrow('CONFLICT');
  expect(f.scanner.safe).not.toHaveBeenCalled();
  expect(await f.log.snapshot(f.id, 'one', leaseBuilder, leaseAt)).toMatchObject({ version: 0 });
});
it('rejects secrets, scanner failures and malformed batches with value-free errors and no writes', async () => {
  const f = await setup();
  await expect(
    f.log.append(
      f.id,
      'one',
      leaseBuilder,
      'bad',
      { lines: [{ kind: 'note', message: 'client_secret = synthetic-secret-value' }] },
      leaseAt,
    ),
  ).rejects.toThrow('INVALID_LOG');
  expect(f.scanner.safe).not.toHaveBeenCalled();
  f.scanner.safe.mockResolvedValue(false);
  await expect(f.log.append(f.id, 'one', leaseBuilder, 'bad', batch, leaseAt)).rejects.toThrow('SECRET_IN_LOG');
  f.scanner.safe.mockRejectedValue(new Error('Do not reveal provider details'));
  await expect(f.log.append(f.id, 'one', leaseBuilder, 'bad', batch, leaseAt)).rejects.toThrow('SCAN_UNAVAILABLE');
  expect(f.store.append).not.toHaveBeenCalled();
});
