import { createHmac, timingSafeEqual } from 'node:crypto';
import { expect, it } from 'vitest';
import { leaseAt, leaseBuilder, leaseBuyer } from '../../test/fakes/board-fixture.js';
import { MemoryEvents } from '../../test/fakes/events.js';
import { Board } from '../application/board.js';
import { createYardApp } from './app.js';

function harness(nudge?: (request: Request) => Promise<Response>) {
  const board = new Board(new MemoryEvents());
  const nudges: { headers: Headers; body: string }[] = [];
  const app = createYardApp({
    environment: 'ci',
    board: {
      board,
      clock: async () => leaseAt,
      operators: [
        { key: 'buyer-key', secret: 'buyer-secret', actor: leaseBuyer },
        { key: 'builder-key', secret: 'builder-secret', actor: leaseBuilder },
      ],
      nudges: {
        boardUrl: 'http://yard-sim/yard/v1',
        endpoints: [{ url: 'http://crew:8081/crew/v1/nudges', keyId: 'sim-crew-key', secret: 'sim-crew-secret' }],
        transport:
          nudge ??
          (async (request) => {
            nudges.push({ headers: request.headers, body: await request.text() });
            return new Response('{}', { status: 202 });
          }),
      },
    },
  });
  const rpc = async (who: string, method: string, params: unknown, key = 'rpc') => {
    const raw = JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      t = String(leaseAt / 1000),
      path = '/yard/v1/a2a';
    const response = await app.request(path, {
      method: 'POST',
      body: raw,
      headers: {
        'Yard-Key-Id': `${who}-key`,
        'Yard-Signature': `t=${t},v2=${createHmac('sha256', `${who}-secret`)
          .update(
            JSON.stringify(['yard.request@2', t, `${who}-key`, 'POST', path, key, '', 'application/json', '', raw]),
          )
          .digest('hex')}`,
        'Idempotency-Key': key,
        'Content-Type': 'application/json',
      },
    });
    return { status: response.status, body: (await response.json()) as Record<string, any> };
  };
  const send = (who: string, data: Record<string, unknown>, messageId: string) =>
    rpc(who, 'message/send', { message: { role: 'user', messageId, parts: [{ kind: 'data', data }] } }, messageId);
  return { board, app, rpc, send, nudges };
}
async function signed(board: Board) {
  const milestones = ['one', 'two'].map((m, i) => ({
    id: m,
    name: m,
    budgetMinor: 1000,
    deadline: leaseAt + 7 * 86400000,
    profileId: (i ? 'code.final@1' : 'code.milestone@1') as 'code.final@1' | 'code.milestone@1',
    testBundleHash: 'b'.repeat(64),
    manifestHash: 'c'.repeat(64),
    testIds: ['works'],
  }));
  await board.create(
    {
      id: 'p',
      buyerOperatorId: 'buyer',
      repository: 'buyer/project',
      baseCommit: 'a'.repeat(40),
      summary: 'Booking',
      createdAt: leaseAt,
      capMinor: 2000,
      currency: 'USD',
      milestones,
    },
    leaseBuyer,
    'create',
  );
  await board.freeze(
    'p',
    {
      version: 1,
      buyerOperatorId: 'buyer',
      approvalReference: 'sim',
      baselines: milestones.map((m) => ({
        milestoneId: m.id,
        testBundleHash: m.testBundleHash,
        manifestHash: m.manifestHash,
        failedTestIds: m.testIds,
        reference: 'sim-red',
      })),
    },
    leaseBuyer,
    1,
    'freeze',
  );
}

it('publishes an honest A2A-shaped agent card without authentication (T-0210)', async () => {
  const { app } = harness();
  const response = await app.request('/.well-known/agent.json');
  expect(response.status).toBe(200);
  const card = await response.json();
  expect(card).toMatchObject({
    name: 'Yard Board',
    url: '/yard/v1/a2a',
    capabilities: { streaming: false, pushNotifications: false },
    simulated: true,
    certification: 'none',
  });
  expect(card.skills.map((s: { id: string }) => s.id)).toEqual([
    'discover-work',
    'post-work-order',
    'claim-work-order',
    'submit-work',
  ]);
  expect(card.securitySchemes.yardHmac).toMatchObject({ type: 'apiKey', in: 'header', name: 'Yard-Signature' });
});

it('maps message/send skills onto the same signed Board commands and reports work-order tasks (T-0210)', async () => {
  const h = harness();
  await signed(h.board);
  const posted = await h.send(
    'buyer',
    { skill: 'post-work-order', projectId: 'p', milestone: 'one', trancheId: 't1', version: 2 },
    'post-1',
  );
  expect(posted.body.result).toMatchObject({
    kind: 'task',
    id: 'wo:p:one',
    contextId: 'p',
    status: { state: 'completed' },
    metadata: { simulated: true },
  });
  // A signed nudge reached the registered operator endpoint; the Board never depends on it.
  expect(h.nudges).toHaveLength(1);
  const nudge = h.nudges[0]!;
  const sig = /^t=(\d+),v1=([a-f0-9]{64})$/.exec(nudge.headers.get('Crew-Signature') ?? '');
  expect(nudge.headers.get('Crew-Key-Id')).toBe('sim-crew-key');
  expect(
    !!sig &&
      timingSafeEqual(
        createHmac('sha256', 'sim-crew-secret').update(`${sig[1]}.${nudge.body}`).digest(),
        Buffer.from(sig[2] ?? '', 'hex'),
      ),
  ).toBe(true);
  expect(JSON.parse(nudge.body)).toMatchObject({
    board_url: 'http://yard-sim/yard/v1',
    work_order_ids: [expect.stringMatching(/^[a-f0-9]{64}$/)],
  });
  const discovered = await h.send('builder', { skill: 'discover-work' }, 'discover-1');
  expect(discovered.body.result.artifacts[0].parts[0].data.orders).toHaveLength(1);
  // The buyer cannot claim; the builder can, and replay is idempotent.
  const forbidden = await h.send(
    'buyer',
    { skill: 'claim-work-order', projectId: 'p', workOrderId: 'one', version: 3 },
    'claim-x',
  );
  expect(forbidden.body.error).toMatchObject({ code: -32003 });
  const claimed = await h.send(
    'builder',
    { skill: 'claim-work-order', projectId: 'p', workOrderId: 'one', version: 3 },
    'claim-1',
  );
  expect(claimed.body.result.status.state).toBe('completed');
  expect(
    (await h.send('builder', { skill: 'claim-work-order', projectId: 'p', workOrderId: 'one', version: 3 }, 'claim-1'))
      .body.result.status.state,
  ).toBe('completed');
  // tasks/get reports the live work-order state as an A2A task state.
  expect((await h.rpc('builder', 'tasks/get', { id: 'wo:p:one' }, 'get-1')).body.result.status.state).toBe('working');
  expect((await h.rpc('builder', 'tasks/get', { id: 'wo:p:missing' }, 'get-2')).body.error).toMatchObject({
    code: -32001,
  });
  // Malformed requests get JSON-RPC errors, never internals.
  expect((await h.rpc('builder', 'tasks/cancel', { id: 'wo:p:one' }, 'c')).body.error).toMatchObject({ code: -32601 });
  expect((await h.send('builder', { skill: 'pay-me', amount: 1 }, 'bad')).body.error).toMatchObject({ code: -32602 });
  expect((await h.rpc('builder', 'message/send', { message: { parts: [] } }, 'bad-2')).body.error).toMatchObject({
    code: -32602,
  });
});

it('keeps posting work when a nudge endpoint is down', async () => {
  const h = harness(async () => {
    throw new Error('crew down');
  });
  await signed(h.board);
  const posted = await h.send(
    'buyer',
    { skill: 'post-work-order', projectId: 'p', milestone: 'one', trancheId: 't1', version: 2 },
    'post-1',
  );
  expect(posted.body.result.status.state).toBe('completed');
});
