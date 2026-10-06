import { expect, it, vi } from 'vitest';
import { MemoryTranches } from '../../test/fakes/tranche-store.js';
import { createTrancheRecord, restoreTrancheRecord } from '../domain/tranche-record.js';
import type { FundingAuthority, FundingProvider } from '../ports/funding-provider.js';
import { type FundingOperation, type FundingStore, FundingStoreError } from '../ports/funding-store.js';
import { advanceFunding } from './funding.js';

const now = 1791244800000;
async function harness() {
  const tranches = new MemoryTranches();
  await tranches.create(
    createTrancheRecord({
      id: 'tranche',
      amount: { minor: 1000, currency: 'USD' },
      profileId: 'code.milestone@1',
      maxResubmits: 1,
    }),
  );
  let row: FundingOperation = {
    key: 'funding',
    trancheId: 'tranche',
    version: 0,
    status: 'RESERVED',
    createRequestId: 'create-id',
    authorizeRequestId: 'authorize-id',
    orderId: null,
    approvalUrl: null,
    hold: null,
    reference: null,
    createdAt: new Date(now).toISOString(),
    instruction: {
      key: 'funding',
      trancheId: 'tranche',
      platformId: 'buyer',
      expectedVersion: 0,
      nonce: 'K7Q',
      mode: 'sim',
      allowanceId: 'allowance',
      payeeRef: 'sandbox-payee',
      amount: { minor: 1000, currency: 'USD' },
    },
  };
  const change = (status: FundingOperation['status'], extra: Partial<FundingOperation> = {}) => {
    row = { ...row, ...extra, version: row.version + 1, status };
    return structuredClone(row);
  };
  const store: FundingStore = {
    reserve: async () => structuredClone(row),
    load: async () => structuredClone(row),
    beginCreate: async (_key, version) => {
      if (row.status !== 'RESERVED' || version !== row.version) throw new FundingStoreError('CONFLICT');
      return change('CREATING');
    },
    orderCreated: async (_key, order) => change('AWAITING_APPROVAL', order),
    beginAuthorize: async (_key, version) => {
      if (row.status !== 'AWAITING_APPROVAL' || version !== row.version) throw new FundingStoreError('CONFLICT');
      return change('AUTHORIZING');
    },
    confirm: async (_key, hold) => {
      await tranches.apply('tranche', 0, 'hold', {
        method: 'confirmFunding',
        args: [
          {
            kind: 'HELD',
            authorizationId: hold.authorizationId,
            nonce: 'K7Q',
            heldAt: hold.heldAt,
            expiresAt: hold.expiresAt,
            reference: hold.reference,
          },
        ],
      });
      return change('HELD', { hold, reference: hold.reference });
    },
    fail: async (_key, reference) => {
      await tranches.apply('tranche', 0, 'failed', { method: 'confirmFunding', args: [{ kind: 'FAILED', reference }] });
      return change('FAILED', { reference });
    },
    expire: async (_key, hold, now) => {
      await tranches.apply('tranche', 0, 'expired', {
        method: 'confirmFunding',
        args: [
          {
            kind: 'EXPIRED',
            authorizationId: hold.authorizationId,
            nonce: 'K7Q',
            heldAt: hold.heldAt,
            expiresAt: hold.expiresAt,
            reference: hold.reference,
            now,
          },
        ],
      });
      return change('EXPIRED', { hold: { ...hold, now }, reference: hold.reference });
    },
  };
  const proof = (outcome: string, extra: Record<string, unknown> = {}) => ({
    complete: true,
    key: row.key,
    trancheId: row.trancheId,
    createRequestId: row.createRequestId,
    authorizeRequestId: row.authorizeRequestId,
    outcome,
    orderId: 'ORDER',
    approvalUrl: 'http://paypal-sim:8080/__sim/approve/ORDER',
    ...extra,
  });
  const hold = {
    orderId: 'ORDER',
    authorizationId: 'AUTH',
    heldAt: now,
    expiresAt: now + 29 * 86400000,
    reference: 'ORDER:AUTH',
  };
  const provider: FundingProvider = {
    create: vi.fn(async () => {
      expect(row.status).toBe('CREATING');
      return proof('CREATED');
    }),
    read: vi.fn(async () => proof('APPROVED')),
    authorize: vi.fn(async () => {
      expect(row.status).toBe('AUTHORIZING');
      return proof('HELD', { hold });
    }),
  };
  const authority: FundingAuthority = { canFund: vi.fn(async () => true) };
  const run = () => advanceFunding(store, tranches, provider, authority, 'funding', () => now);
  return { store, tranches, provider, authority, proof, hold, run, row: () => structuredClone(row) };
}
it('records possible submission before each call and attaches a hold only after approved matching proof', async () => {
  const h = await harness();
  expect(await h.run()).toBe('AWAITING_APPROVAL');
  expect(h.row().status).toBe('AWAITING_APPROVAL');
  expect(restoreTrancheRecord((await h.tranches.load('tranche')).record).state).toBe('PENDING');
  expect(await h.run()).toBe('HELD');
  expect(h.row().status).toBe('HELD');
  expect(await h.run()).toBe('HELD');
  expect(h.provider.create).toHaveBeenCalledTimes(1);
  expect(h.provider.authorize).toHaveBeenCalledTimes(1);
});
it('does not contact the provider without an approved mandate, a current tranche or a valid server clock', async () => {
  const h = await harness();
  h.authority.canFund = vi.fn(async () => false);
  expect(await h.run()).toBe('WAIT');
  h.authority.canFund = vi.fn(async () => true);
  expect(await advanceFunding(h.store, h.tranches, h.provider, h.authority, 'funding', () => NaN)).toBe('WAIT');
  await h.tranches.apply('tranche', 0, 'changed', { method: 'fundingFailed', args: [] });
  expect(await h.run()).toBe('WAIT');
  expect(h.provider.create).not.toHaveBeenCalled();
  expect(h.row().status).toBe('RESERVED');
});
it('retains an uncertain creation and never resends it blindly', async () => {
  const h = await harness();
  h.provider.create = vi.fn(async () => {
    throw new Error('lost response');
  });
  h.provider.read = vi.fn(async () => ({ complete: false }));
  expect(await h.run()).toBe('WAIT');
  expect(await h.run()).toBe('WAIT');
  expect(h.row()).toMatchObject({
    status: 'CREATING',
    createRequestId: 'create-id',
    authorizeRequestId: 'authorize-id',
  });
  expect(h.provider.create).toHaveBeenCalledTimes(1);
});
it('reconciles a lost authorisation response by reading matching proof without a second write', async () => {
  const h = await harness();
  await h.run();
  h.provider.authorize = vi.fn(async () => {
    throw new Error('lost reply');
  });
  expect(await h.run()).toBe('WAIT');
  h.provider.read = vi.fn(async () => h.proof('HELD', { hold: h.hold }));
  h.authority.canFund = vi.fn(async () => false); // revocation must block writes, not recovery
  expect(await h.run()).toBe('HELD');
  expect(h.provider.authorize).toHaveBeenCalledTimes(1);
});
it.each([
  { complete: false },
  { key: 'foreign' },
  { trancheId: 'foreign' },
  { authorizeRequestId: 'foreign' },
  { orderId: 'foreign' },
  { outcome: 'PENDING' },
  { hold: { authorizationId: 'invented' } },
])('waits on partial or mismatched approval/authorisation proof: %j', async (patch) => {
  const h = await harness();
  await h.run();
  h.provider.read = vi.fn(async () => h.proof('APPROVED', patch));
  if (
    !['orderId', 'outcome', 'complete', 'key', 'trancheId', 'authorizeRequestId'].some((k) => Object.hasOwn(patch, k))
  ) {
    h.provider.read = vi.fn(async () => h.proof('APPROVED'));
    h.provider.authorize = vi.fn(async () => h.proof('HELD', patch));
  }
  expect(await h.run()).toBe('WAIT');
  expect(restoreTrancheRecord((await h.tranches.load('tranche')).record).state).toBe('PENDING');
});
it('serialises concurrent create and authorise invocations even with the same caller', async () => {
  const h = await harness();
  await Promise.all([h.run(), h.run()]);
  expect(h.provider.create).toHaveBeenCalledTimes(1);
  await Promise.all([h.run(), h.run()]);
  expect(h.provider.authorize).toHaveBeenCalledTimes(1);
});
it('records only a complete matching definite refusal as WAIT_FUNDING', async () => {
  const h = await harness();
  await h.run();
  h.provider.authorize = vi.fn(async () => h.proof('DECLINED', { reference: 'provider-debug' }));
  expect(await h.run()).toBe('FAILED');
  expect(await h.run()).toBe('FAILED');
  expect(restoreTrancheRecord((await h.tranches.load('tranche')).record).state).toBe('WAIT_FUNDING');
});

it('recovers an uncertain creation only from a provider-checked candidate, without creating another order', async () => {
  const h = await harness();
  h.provider.create = vi.fn(async () => ({ complete: false }));
  expect(await h.run()).toBe('WAIT');
  h.provider.read = vi.fn(async (_operation, candidate) =>
    candidate === 'ORDER' ? h.proof('CREATED') : { complete: false },
  );
  expect(await h.run()).toBe('WAIT');
  expect(await advanceFunding(h.store, h.tranches, h.provider, h.authority, 'funding', () => now, 'ORDER')).toBe(
    'AWAITING_APPROVAL',
  );
  expect(h.provider.create).toHaveBeenCalledTimes(1);
  expect(h.row().orderId).toBe('ORDER');
});

it('does not authorize an unapproved order or one whose mandate was revoked after creation', async () => {
  const h = await harness();
  await h.run();
  h.provider.read = vi.fn(async () => h.proof('CREATED'));
  expect(await h.run()).toBe('AWAITING_APPROVAL');
  h.provider.read = vi.fn(async () => h.proof('APPROVED'));
  h.authority.canFund = vi.fn(async () => false);
  expect(await h.run()).toBe('WAIT');
  expect(h.row().status).toBe('AWAITING_APPROVAL');
  expect(h.provider.authorize).not.toHaveBeenCalled();
});
it('records an expired initial hold from matching lookup without retrying authorisation', async () => {
  const h = await harness();
  await h.run();
  h.provider.authorize = vi.fn(async () => ({ complete: false }));
  expect(await h.run()).toBe('WAIT');
  h.provider.read = vi.fn(async () => h.proof('EXPIRED', { hold: h.hold }));
  h.store.expire = vi.fn(h.store.expire);
  expect(await h.run()).toBe('WAIT'); // provider status alone cannot contradict the server deadline
  expect(await advanceFunding(h.store, h.tranches, h.provider, h.authority, 'funding', () => h.hold.expiresAt)).toBe(
    'EXPIRED',
  );
  expect(await h.run()).toBe('EXPIRED');
  expect(h.store.expire).toHaveBeenCalledTimes(1);
  expect(h.provider.authorize).toHaveBeenCalledTimes(1);
  expect(restoreTrancheRecord((await h.tranches.load('tranche')).record).state).toBe('EXPIRED');
});

it.each([
  { heldAt: now + 1 },
  { heldAt: now + 0.5 },
  { expiresAt: now },
  { expiresAt: now + 30 * 86400000 },
  { reference: '' },
  { orderId: 'foreign' },
])('does not attach malformed, future or expired hold proof: %j', async (patch) => {
  const h = await harness();
  await h.run();
  h.provider.authorize = vi.fn(async () => h.proof('HELD', { hold: { ...h.hold, ...patch } }));
  expect(await h.run()).toBe('WAIT');
  expect(h.row().status).toBe('AUTHORIZING');
  expect(restoreTrancheRecord((await h.tranches.load('tranche')).record).state).toBe('PENDING');
});
