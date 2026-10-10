import { generateKeyPairSync, verify } from 'node:crypto';
import type { UsageReceiptInput } from '@stood/stood-sdk';
import { StoodClientError } from '@stood/stood-sdk';
import { describe, expect, it } from 'vitest';
import { claimedFixture, leaseAt } from '../../test/fakes/board-fixture.js';
import { MemoryEvents } from '../../test/fakes/events.js';
import { USAGE_ROOT, usageSigner } from '../adapters/crypto/usage-signer.js';
import { Board } from './board.js';
import { UsageForwarder, usagePayload } from './usage-forwarder.js';

const keys = generateKeyPairSync('ed25519');
const pem = (k: { export(o: object): string | Buffer }) =>
  Buffer.from(k.export({ type: 'pkcs8', format: 'pem' }).toString()).toString('base64');
const signer = usageSigner('yard-usage-1', pem(keys.privateKey));
const commit = 'e'.repeat(40);
// A project whose final milestone was submitted (Stood holds package pkg_final) and whose use the buyer confirmed.
async function project(over: { usage?: boolean; mandate?: boolean } = {}) {
  const { board: fixture, id } = await claimedFixture(new MemoryEvents(), 'usage-source');
  const d = structuredClone((await fixture.events.load(id)).data) as Record<string, unknown> & {
    orders: Record<string, unknown>;
  };
  d.orders.two = {
    id: 'two',
    milestone: 'two',
    trancheId: 'trn_final',
    postedAt: leaseAt,
    actions: [],
    payment: null,
    submissionIntent: {
      request: { trancheId: 'trn_final', repository: 'buyer/project', baseCommit: 'a'.repeat(40), commit, key: 'k' },
      requestedAt: leaseAt,
      status: 'CONFIRMED',
      packageId: 'pkg_final',
      completedVersion: 2,
    },
    ...(over.usage === false ? {} : { usage: { confirmedAt: leaseAt + 1000 } }),
  };
  if (over.mandate !== false)
    d.mandate = {
      key: 'm',
      request: {},
      reservedVersion: 2,
      status: 'CREATED',
      allowanceId: 'alw_1',
      tranches: { two: 'trn_final' },
    };
  const events = new MemoryEvents();
  await events.create('shop', 'buyer', d, 'create');
  return new Board(events);
}
const stood = (answer: 'accept' | 'refuse' | 'down') => {
  const sent: { trancheId: string; receipt: UsageReceiptInput }[] = [];
  return {
    sent,
    confirmUsage: async (trancheId: string, receipt: UsageReceiptInput) => {
      sent.push({ trancheId, receipt });
      if (answer === 'refuse') throw new StoodClientError('VALIDATION');
      if (answer === 'down') throw new StoodClientError('UNAVAILABLE');
      return { trancheId, commit, acceptedAt: 'now' };
    },
  };
};

// C4 (#77): the buyer's usage confirmation reaches Stood as a receipt Yard signs, exactly once.
describe('UsageForwarder', () => {
  it('signs a receipt bound to the allowance, tranche and submitted commit, and records Stood accepting it', async () => {
    const board = await project();
    const s = stood('accept');
    const forwarder = new UsageForwarder(board, s, signer as never, () => leaseAt + 5000);
    expect(await forwarder.run()).toEqual({ accepted: 1, refused: 0, waiting: 0 });
    const [{ trancheId, receipt }] = s.sent as [{ trancheId: string; receipt: UsageReceiptInput }];
    expect(trancheId).toBe('trn_final');
    expect(receipt).toMatchObject({
      version: 1,
      allowanceId: 'alw_1',
      trancheId: 'trn_final',
      commit,
      authority: { keyId: 'yard-usage-1', root: USAGE_ROOT },
      observedAt: leaseAt + 1000,
    });
    expect(receipt.nonce).toMatch(/^yard-usage-[a-f0-9]{40}$/);
    const { signature, ...unsigned } = receipt;
    expect(verify(null, Buffer.from(usagePayload(unsigned)), keys.publicKey, Buffer.from(signature, 'base64'))).toBe(
      true,
    );
    // Recorded once; nothing is sent again.
    expect(await forwarder.run()).toEqual({ accepted: 0, refused: 0, waiting: 0 });
    expect(s.sent).toHaveLength(1);
    const order = ((await board.events.load('shop')).data as { orders: { two: { usage: unknown } } }).orders.two;
    expect(order.usage).toMatchObject({ forwarded: { status: 'ACCEPTED', reason: null } });
  });

  it('records a refusal, retries the identical receipt while Stood is unavailable, and skips unconfirmed work', async () => {
    const refused = await project();
    expect(await new UsageForwarder(refused, stood('refuse'), signer as never, Date.now).run()).toEqual({
      accepted: 0,
      refused: 1,
      waiting: 0,
    });
    const down = await project();
    const s = stood('down');
    const forwarder = new UsageForwarder(down, s, signer as never, Date.now);
    expect(await forwarder.run()).toEqual({ accepted: 0, refused: 0, waiting: 1 });
    await forwarder.run();
    expect(s.sent[0]?.receipt).toEqual(s.sent[1]?.receipt);
    for (const over of [{ usage: false }, { mandate: false }]) {
      const none = stood('accept');
      await new UsageForwarder(await project(over), none, signer as never, Date.now).run();
      expect(none.sent).toEqual([]);
    }
  });

  it('builds its signing key only from an Ed25519 key with a valid id', () => {
    const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 });
    expect(signer?.keyId).toBe('yard-usage-1');
    expect(usageSigner('bad id!', pem(keys.privateKey))).toBeNull();
    expect(usageSigner('yard-usage-1', pem(rsa.privateKey))).toBeNull();
    expect(usageSigner('yard-usage-1', 'not a key')).toBeNull();
    expect(usageSigner(undefined, undefined)).toBeNull();
  });
});
