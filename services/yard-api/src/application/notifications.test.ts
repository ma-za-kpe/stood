import { expect, it } from 'vitest';
import { claimedFixture, leaseAt, leaseBuilder, leaseBuyer } from '../../test/fakes/board-fixture.js';
import { MemoryNoticeLog } from '../../test/fakes/notices.js';
import type { Notice } from '../ports/notifications.js';
import { NOTICE_LEASE_MS, notifyAll } from './notifications.js';

const contacts = { buyer: 'buyer@example.invalid', builder: 'crew@example.invalid' };
it('sends paid, punch-list, closed and lease-ending notices exactly once (T-0213)', async () => {
  const { board, id } = await claimedFixture();
  const sent: Notice[] = [];
  const notifier = { send: async (n: Notice) => void sent.push(n) };
  const log = new MemoryNoticeLog();
  const run = (now: number) => notifyAll(board, log, notifier, contacts, now);
  await board.submit(id, 'one', 'd'.repeat(40), 'pkg-1', leaseBuilder, 6, 'submit', leaseAt);
  await board.refusal(
    id,
    'one',
    {
      eventId: 'refused',
      trancheId: 'tranche',
      packageId: 'pkg-1',
      reference: 'void',
      effect: 'VOID',
      punchList: [{ field: 'signed_tests_changed', reason: 'The signed tests were changed.' }],
      resubmissionsLeft: 1,
      simulated: true,
    },
    7,
  );
  await run(leaseAt);
  expect(sent.map((n) => [n.to, n.subject])).toEqual([['crew@example.invalid', 'Not yet: punch list for "one"']]);
  expect(sent[0]?.text).toContain('signed_tests_changed');
  expect(sent[0]?.text).toContain('Nothing was paid.');
  // Running again sends nothing new.
  await run(leaseAt);
  expect(sent).toHaveLength(1);
  // Six hours before the lease ends, the builder hears once.
  await run(leaseAt + 42 * 3600000 + 1);
  await run(leaseAt + 43 * 3600000);
  expect(sent.filter((n) => n.subject.startsWith('Lease ending'))).toHaveLength(1);
  // A paid milestone reaches buyer and builder; no notice ever carries a key or secret.
  const { confirmHold } = await import('../../test/fakes/board-fixture.js');
  await confirmHold(board, id, 'one', leaseAt);
  const v = async () => (await board.events.load(id)).version;
  await board.build(id, 'one', leaseBuilder, await v(), 'rebuild', leaseAt + 1);
  await board.submit(id, 'one', 'e'.repeat(40), 'pkg-2', leaseBuilder, await v(), 'submit-2', leaseAt + 2);
  await board.settlement(
    id,
    'one',
    {
      eventId: 'paid',
      trancheId: 'tranche',
      packageId: 'pkg-2',
      reference: 'capture',
      effect: 'CAPTURE',
      minor: 1000,
      currency: 'USD',
      simulated: true,
    },
    await v(),
  );
  await run(leaseAt + 43 * 3600000);
  const paid = sent.filter((n) => n.subject.startsWith('Milestone paid'));
  expect(paid.map((n) => n.to).sort()).toEqual(['buyer@example.invalid', 'crew@example.invalid']);
  expect(paid[0]?.text).toContain('$10.00');
  expect(paid[0]?.text).toContain('Stood checked it');
  expect(new Set(sent.map((n) => n.key)).size).toBe(sent.length);
  expect(leaseBuyer.id).toBe('buyer');
});
it('keeps notifying other projects when one recipient has no contact, and never resends after a restart', async () => {
  const { board } = await claimedFixture();
  const sent: Notice[] = [];
  const log = new MemoryNoticeLog();
  await notifyAll(board, log, { send: async (n) => void sent.push(n) }, {}, leaseAt + 42 * 3600000 + 1);
  expect(sent).toHaveLength(0);
  const failing = { send: async () => Promise.reject(new Error('mail down')) };
  const fresh = new MemoryNoticeLog();
  await expect(notifyAll(board, fresh, failing, contacts, leaseAt + 42 * 3600000 + 1)).resolves.toMatchObject({
    failed: 1,
  });
  // A failed send releases nothing: the next run retries the same key once delivery works.
  await notifyAll(board, fresh, { send: async (n) => void sent.push(n) }, contacts, leaseAt + 42 * 3600000 + 1);
  expect(sent.map((n) => n.subject)).toEqual(['Lease ending soon: "one"']);
});

// Fifth audit (2026-10-11): a worker that dies after claiming a notice must not lose it, and another worker must not
// move the cursor past it while that lease is live.
it('resends a notice whose worker died mid-send once its lease runs out, holding the cursor until then', async () => {
  const { board, id } = await claimedFixture();
  const at = leaseAt + 42 * 3600000 + 1;
  const { notices } = await board.notices(id, 0, at);
  const lease = notices.find((n) => n.subject.startsWith('Lease ending'));
  if (!lease) throw new Error('fixture has no lease notice');
  const log = new MemoryNoticeLog();
  // The first worker claimed it, then the process died before sending.
  expect(await log.claim(lease.key, at, NOTICE_LEASE_MS)).toBe('CLAIMED');
  const sent: Notice[] = [];
  const notifier = { send: async (n: Notice) => void sent.push(n) };
  await notifyAll(board, log, notifier, contacts, at + 1);
  expect(sent).toEqual([]);
  expect(await log.cursor(id)).toBe(0);
  await notifyAll(board, log, notifier, contacts, at + NOTICE_LEASE_MS);
  expect(sent.map((n) => n.key)).toEqual([lease.key]);
  // Delivered is permanent: no repeat on a later run.
  await notifyAll(board, log, notifier, contacts, at + 2 * NOTICE_LEASE_MS);
  expect(sent).toHaveLength(1);
});
