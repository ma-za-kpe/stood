import { expect, it } from 'vitest';
import { claimedFixture, leaseAt, leaseBuyer } from '../../test/fakes/board-fixture.js';
import { MemoryEvents } from '../../test/fakes/events.js';

it('searches open work by public milestone names only, never by private project text (T-0211)', async () => {
  const store = new MemoryEvents();
  const { board } = await claimedFixture(store, 'booking');
  await board.post('booking', 'two', 'trn-2', leaseBuyer, 6, 'post-2', leaseAt);
  const all = await board.discoverPage('', leaseAt);
  expect(all.orders.map((o) => o.name)).toEqual(['two']);
  expect((await board.discoverPage('', leaseAt, 'two')).orders).toHaveLength(1);
  expect((await board.discoverPage('', leaseAt, 'TWO')).orders).toHaveLength(1);
  expect((await board.discoverPage('', leaseAt, 'nothing-like-this')).orders).toHaveLength(0);
  // The project summary and repository are private: they never match a search.
  expect((await board.discoverPage('', leaseAt, 'Booking')).orders).toHaveLength(0);
  expect((await board.discoverPage('', leaseAt, 'buyer/project')).orders).toHaveLength(0);
  await expect(board.discoverPage('', leaseAt, 'x'.repeat(101))).rejects.toThrow('INVALID');
});

it('streams the public Board snapshot without buyer identity (T-0211)', async () => {
  const { createHmac } = await import('node:crypto');
  const { createYardApp } = await import('../http/app.js');
  const { board } = await claimedFixture(new MemoryEvents(), 'streamed');
  await board.post('streamed', 'two', 'trn-2', leaseBuyer, 6, 'post-2', leaseAt);
  const app = createYardApp({
    environment: 'ci',
    board: {
      board,
      clock: async () => leaseAt,
      boardStreamMs: 10,
      operators: [
        { key: 'builder-key', secret: 'builder-secret', actor: { id: 'b', root: 'b-root', kind: 'BUILDER' } },
      ],
    },
  });
  const t = String(leaseAt / 1000),
    path = '/yard/v1/board/events';
  const abort = new AbortController();
  const response = await app.request(path, {
    signal: abort.signal,
    headers: {
      'Yard-Key-Id': 'builder-key',
      'Yard-Signature': `t=${t},v2=${createHmac('sha256', 'builder-secret')
        .update(JSON.stringify(['yard.request@2', t, 'builder-key', 'GET', path, '', '', '', '', '']))
        .digest('hex')}`,
    },
  });
  expect(response.headers.get('content-type')).toContain('text/event-stream');
  const reader = response.body!.getReader();
  let text = '';
  while (!text.includes('event: heartbeat')) text += new TextDecoder().decode((await reader.read()).value);
  abort.abort();
  await reader.cancel();
  expect(text).toContain('event: board.snapshot');
  expect(text).toContain('"workOrderId":"two"');
  for (const secret of ['buyer/project', 'buyer-root', 'Booking', 'repository']) expect(text).not.toContain(secret);
  expect((await app.request(path)).status).toBe(401);
});
