import { expect, it } from 'vitest';
import { claimedFixture, leaseAt, leaseBuilder, leaseBuyer } from '../../test/fakes/board-fixture.js';
import { MemoryNoticeLog } from '../../test/fakes/notices.js';
import type { Notice } from '../ports/notifications.js';
import { notifyAll } from './notifications.js';

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
