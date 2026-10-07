import { expect, it, vi } from 'vitest';
import { MemoryTranches } from '../../test/fakes/tranche-store.js';
import { type CheckResult, decide, getProfile } from '../domain/decision.js';
import { CAPTURE_SAFETY_MARGIN_MS } from '../domain/hold-policy.js';
import { createTrancheRecord, restoreTrancheRecord } from '../domain/tranche-record.js';
import type { PaymentResult } from '../ports/payment-executor.js';
import type { StoredTranche, TrancheStore } from '../ports/tranche-store.js';
import { executePayment } from './execute-payment.js';
import { retryCapture } from './retry-capture.js';

const at = 1791158400000,
  expiry = at + 29 * 86400000;
async function fixture() {
  const store = new MemoryTranches();
  await store.create(
    createTrancheRecord({
      id: 'retry',
      amount: { minor: 1000, currency: 'USD' },
      profileId: 'code.milestone@1',
      maxResubmits: 1,
    }),
  );
  await store.apply('retry', 0, 'dispatch', { method: 'dispatch', args: ['auth', 'K7Q', at, expiry] });
  await store.apply('retry', 1, 'decide', { method: 'startDeciding', args: [] });
  const checks: CheckResult[] = getProfile('code.milestone@1').checks.map((c) => ({
    code: c.code,
    source: 'RULE',
    status: 'PASS',
    reason: 'fixture',
  }));
  await store.apply('retry', 2, 'reserve', {
    method: 'beginSettlement',
    args: [decide('code.milestone@1', checks), 'decision', at],
  });
  await executePayment(
    store,
    {
      execute: async () => {
        throw new Error('not sent');
      },
    },
    'retry',
    'first',
    () => at,
  );
  const snapshot = await store.load('retry');
  const proof = {
    complete: true,
    outcome: 'NOT_CAPTURED',
    operationKey: snapshot.pending!.operation.key,
    authorizationId: 'auth',
    providerRequestId: snapshot.pending!.providerRequestId,
    reference: 'matched-provider-read',
    noCapture: true,
    noRenewal: true,
    capturable: true,
    expiresAt: expiry,
    observedAt: at,
    amount: { minor: 1000, currency: 'USD' },
  };
  return { store, proof, snapshot };
}
const confirmation = {
  method: 'confirmSettlement',
  args: [{ effect: 'CAPTURE', authorizationId: 'auth', reference: 'capture' }],
} as const;
it('persists matching proof and consumes the one retry before calling with the original request ID', async () => {
  const f = await fixture();
  const execute = vi.fn(async (snapshot: StoredTranche) => {
    expect(snapshot.pending?.providerRequestId).toBe(f.snapshot.pending!.providerRequestId);
    const stored = await f.store.load('retry');
    expect(stored.pending?.status).toBe('AMBIGUOUS');
    expect(restoreTrancheRecord(stored.record).captureRetryClaim).toMatchObject({ reference: f.proof.reference });
    return confirmation;
  });
  expect(await retryCapture(f.store, { read: async () => f.proof }, { execute }, 'retry', 'second', () => at)).toBe(
    'RESOLVED',
  );
  expect(restoreTrancheRecord((await f.store.load('retry')).record).state).toBe('RELEASED');
  expect(await retryCapture(f.store, { read: async () => f.proof }, { execute }, 'retry', 'third', () => at)).toBe(
    'DONE',
  );
  expect(execute).toHaveBeenCalledTimes(1);
});
it.each([
  { complete: false },
  { operationKey: 'wrong' },
  { authorizationId: 'wrong' },
  { providerRequestId: 'wrong' },
  { reference: '' },
  { noCapture: false },
  { noRenewal: false },
  { capturable: false },
  { outcome: 'PENDING' },
  { observedAt: at - 5001 },
  { observedAt: at + 1 },
  { expiresAt: expiry - 1 },
  { amount: { minor: 1001, currency: 'USD' } },
  { amount: { minor: 1000, currency: 'EUR' } },
])('rejects incomplete, contradictory or stale proof %j without consuming a retry', async (patch) => {
  const f = await fixture(),
    execute = vi.fn(async () => confirmation);
  expect(
    await retryCapture(
      f.store,
      { read: async () => ({ ...f.proof, ...patch }) },
      { execute },
      'retry',
      'worker',
      () => at,
    ),
  ).toBe('WAIT');
  expect(execute).not.toHaveBeenCalled();
  expect(await f.store.load('retry')).toEqual(f.snapshot);
});
it('serialises racing retries and never replenishes a consumed retry after a timeout or restart', async () => {
  const f = await fixture(),
    execute = vi.fn(async () => {
      throw new Error('unknown outcome');
    });
  const reader = { read: async () => f.proof };
  await Promise.all([
    retryCapture(f.store, reader, { execute }, 'retry', 'a', () => at),
    retryCapture(f.store, reader, { execute }, 'retry', 'b', () => at),
  ]);
  expect(execute).toHaveBeenCalledTimes(1);
  expect(await retryCapture(f.store, reader, { execute }, 'retry', 'restart', () => at)).toBe('WAIT');
  expect(execute).toHaveBeenCalledTimes(1);
});
it('rechecks the margin after claiming and leaves the consumed retry for reconciliation when it closes', async () => {
  const f = await fixture();
  const near = expiry - CAPTURE_SAFETY_MARGIN_MS - 1;
  let calls = 0;
  const clock = () => (++calls <= 2 ? near : near + 1);
  const execute = vi.fn(async () => confirmation);
  expect(
    await retryCapture(
      f.store,
      { read: async () => ({ ...f.proof, observedAt: near }) },
      { execute },
      'retry',
      'worker',
      clock,
    ),
  ).toBe('WAIT');
  expect(execute).not.toHaveBeenCalled();
  expect(restoreTrancheRecord((await f.store.load('retry')).record).captureRetryClaim).not.toBeNull();
});
it('leaves absent, malformed and mismatched execution results pending with a consumed retry', async () => {
  for (const result of [
    null,
    { ...confirmation, args: [{ effect: 'VOID', authorizationId: 'auth', reference: 'wrong' }] },
    { method: 'settlementFailed', args: [{ effect: 'CAPTURE', authorizationId: 'auth', kind: 'AMBIGUOUS' }] },
  ]) {
    const f = await fixture();
    expect(
      await retryCapture(
        f.store,
        { read: async () => f.proof },
        { execute: async () => result as PaymentResult | null },
        'retry',
        'worker',
        () => at,
      ),
    ).toBe('WAIT');
    expect((await f.store.load('retry')).pending).not.toBeNull();
  }
});
it('fails safe before any retry claim on unavailable status, invalid clocks and stale rules', async () => {
  const f = await fixture(),
    execute = vi.fn(async () => confirmation);
  expect(
    await retryCapture(
      f.store,
      {
        read: async () => {
          throw new Error('offline');
        },
      },
      { execute },
      'retry',
      'worker',
      () => at,
    ),
  ).toBe('WAIT');
  for (const now of [NaN, at - 1, expiry - CAPTURE_SAFETY_MARGIN_MS, expiry + 1])
    expect(await retryCapture(f.store, { read: async () => f.proof }, { execute }, 'retry', 'worker', () => now)).toBe(
      'WAIT',
    );
  expect(await retryCapture(f.store, { read: async () => f.proof }, { execute }, 'retry', '', () => at)).toBe('WAIT');
  const original = f.store.load.bind(f.store);
  f.store.load = async (id) => {
    const s = await original(id);
    const doc = JSON.parse(s.record);
    doc.ruleSetVersion = '1.0.0';
    doc.commands.find((c: { method: string }) => c.method === 'beginSettlement').args[0].ruleSetVersion = '1.0.0';
    return { ...s, record: JSON.stringify(doc) };
  };
  expect(await retryCapture(f.store, { read: async () => f.proof }, { execute }, 'retry', 'worker', () => at)).toBe(
    'WAIT',
  );
  expect(execute).not.toHaveBeenCalled();
});
it('does not call the provider after a failed durable claim', async () => {
  const f = await fixture(),
    execute = vi.fn(async () => confirmation);
  const store: TrancheStore = {
    ...f.store,
    create: (r) => f.store.create(r),
    load: (id) => f.store.load(id),
    apply: async () => {
      throw new Error('database unavailable');
    },
  };
  await expect(
    retryCapture(store, { read: async () => f.proof }, { execute }, 'retry', 'worker', () => at),
  ).rejects.toThrow('database unavailable');
  expect(execute).not.toHaveBeenCalled();
});
