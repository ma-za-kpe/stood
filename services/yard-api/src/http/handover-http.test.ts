import { createHmac, randomBytes } from 'node:crypto';
import { BUYER_HANDOVER_ITEMS } from '@stood/yard-contracts';
import { expect, it } from 'vitest';
import { confirmHold } from '../../test/fakes/board-fixture.js';
import { MemoryEvents } from '../../test/fakes/events.js';
import { MemorySecretRows } from '../../test/fakes/secrets.js';
import { LocalKeyWrapper } from '../adapters/crypto/local-key-wrapper.js';
import { Board } from '../application/board.js';
import { SecretVault } from '../application/secret-vault.js';
import { createYardApp } from './app.js';

const now = 1791158400000;
const buyer = { id: 'buyer', root: 'buyer-root', kind: 'BUYER' as const };
const builder = { id: 'builder', root: 'builder-root', kind: 'BUILDER' as const };
async function harness() {
  const events = new MemoryEvents();
  const board = new Board(events);
  const rows = new MemorySecretRows();
  const vault = new SecretVault(rows, new LocalKeyWrapper({ k1: randomBytes(32).toString('base64') }, 'k1'));
  const app = createYardApp({
    environment: 'ci',
    board: {
      board,
      clock: async () => now,
      secrets: vault,
      operators: [
        { key: 'buyer-key', secret: 'buyer-secret', actor: buyer },
        { key: 'other-key', secret: 'other-secret', actor: { id: 'other', root: 'other-root', kind: 'BUYER' } },
      ],
    },
  });
  const request = async (path: string, method = 'GET', value?: unknown, version = 1, key = 'r', who = 'buyer') => {
    const raw = value === undefined ? '' : JSON.stringify(value),
      t = String(now / 1000);
    return app.request(path, {
      method,
      ...(raw ? { body: raw } : {}),
      headers: {
        'Yard-Key-Id': `${who}-key`,
        'Yard-Signature': `t=${t},v2=${createHmac('sha256', `${who}-secret`)
          .update(
            JSON.stringify([
              'yard.request@2',
              t,
              `${who}-key`,
              method,
              path,
              key,
              String(version),
              'application/json',
              '',
              raw,
            ]),
          )
          .digest('hex')}`,
        'Idempotency-Key': key,
        'Content-Type': 'application/json',
        'If-Match': String(version),
      },
    });
  };
  const milestones = ['one', 'two'].map((id, i) => ({
    id,
    name: id,
    budgetMinor: 1000,
    deadline: now + 86400000,
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
      summary: 'Booking app',
      createdAt: now,
      capMinor: 2000,
      currency: 'USD',
      milestones,
    },
    buyer,
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
    buyer,
    1,
    'freeze',
  );
  const version = async () => (await events.load('p')).version;
  const pay = async (wo: string) => {
    await board.post('p', wo, `tranche-${wo}`, buyer, await version(), `post-${wo}`, now);
    await board.claim('p', wo, builder, await version(), `claim-${wo}`, now);
    await confirmHold(board, 'p', wo, now);
    await board.build('p', wo, builder, await version(), `build-${wo}`, now);
    await board.submit('p', wo, 'd'.repeat(40), `pkg-${wo}`, builder, await version(), `submit-${wo}`, now);
    await board.settlement(
      'p',
      wo,
      {
        eventId: `paid-${wo}`,
        trancheId: `tranche-${wo}`,
        packageId: `pkg-${wo}`,
        reference: `capture-${wo}`,
        effect: 'CAPTURE',
        minor: 1000,
        currency: 'USD',
        simulated: true,
      },
      await version(),
    );
  };
  await vault.put({
    blueprintId: 'p',
    owner: 'buyer',
    provider: 'resend',
    name: 'RESEND_API_KEY',
    environment: 'TEST',
    value: 're_test_value',
    key: 'k',
    now,
  });
  return { rows, request, version, pay };
}
const confirmation = { confirmed: [...BUYER_HANDOVER_ITEMS] };

it('closes the project only after every milestone is paid and every buyer item is confirmed (T-0207)', async () => {
  const h = await harness();
  const path = '/yard/v1/blueprints/p/handover';
  await h.pay('one');
  // Final milestone not paid yet: hygiene cannot close a project with money outstanding.
  expect((await h.request(path, 'POST', confirmation, await h.version(), 'early')).status).toBe(409);
  await h.pay('two');
  const v = await h.version();
  expect((await h.request(path, 'POST', confirmation, v, 'other', 'other')).status).toBe(403);
  const partial = { confirmed: BUYER_HANDOVER_ITEMS.slice(1) };
  expect((await h.request(path, 'POST', partial, v, 'partial')).status).toBe(422);
  const closed = await h.request(path, 'POST', confirmation, v, 'close');
  expect(closed.status).toBe(200);
  expect(await closed.json()).toMatchObject({ accepted: true, keysDeletedBy: now + 7 * 86400000 });
  expect((await h.request(path, 'POST', confirmation, v, 'close')).status).toBe(200);
  const room = await (await h.request('/yard/v1/blueprints/p/room')).json();
  expect(room.handover).toEqual({ status: 'CLOSED', closedAt: now, confirmed: [...BUYER_HANDOVER_ITEMS].sort() });
  expect(room.orders.map((o: { state: string }) => o.state)).toEqual(['PAID', 'PAID']);
  // Yard's own item: stored test keys are scheduled for deletion, not kept.
  expect(h.rows.dump().every((r) => r.deleteAt === now + 7 * 86400000)).toBe(true);
  expect((await h.request(path, 'POST', confirmation, await h.version(), 'again')).status).toBe(409);
});
