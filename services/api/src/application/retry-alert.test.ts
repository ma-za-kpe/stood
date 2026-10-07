import { expect, it, vi } from 'vitest';
import { MemoryTranches } from '../../test/fakes/tranche-store.js';
import { type CheckResult, decide, getProfile } from '../domain/decision.js';
import { createTrancheRecord, restoreTrancheRecord } from '../domain/tranche-record.js';
import type { ReconciliationQueue } from '../ports/reconciliation-queue.js';
import { executePayment } from './execute-payment.js';
import { reconciliationTick } from './reconciliation-worker.js';

const at = 1791158400000,
  expiry = at + 29 * 86400000;
async function ambiguousCapture() {
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
  const lost = async () => {
    throw new Error('reply lost');
  };
  await executePayment(store, { execute: lost }, 'retry', 'first', () => at);
  const pending = (await store.load('retry')).pending!;
  const proof = {
    complete: true,
    outcome: 'NOT_CAPTURED',
    operationKey: pending.operation.key,
    authorizationId: 'auth',
    providerRequestId: pending.providerRequestId,
    reference: 'matched-provider-read',
    noCapture: true,
    noRenewal: true,
    capturable: true,
    expiresAt: expiry,
    observedAt: at,
    amount: { minor: 1000, currency: 'USD' },
  };
  const alerts: unknown[] = [];
  const queue: ReconciliationQueue = {
    seed: async () => {},
    claim: vi
      .fn()
      .mockResolvedValueOnce({ trancheId: 'retry', token: 'lease-1' })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ trancheId: 'retry', token: 'lease-2' })
      .mockResolvedValueOnce(null),
    finish: async () => {},
    alert: async (a) => {
      alerts.push(a);
    },
    resolve: async () => {},
  };
  return { store, proof, queue, alerts };
}

it('assigns a consumed but unresolved capture retry to the reviewer with a named reason (T-0158)', async () => {
  const f = await ambiguousCapture();
  // The executor's reply is unusable: the one retry is consumed and the capture stays unresolved.
  const execute = vi.fn(async () => null);
  const options = { owner: 'reviewer', clock: () => at, executor: { execute } };
  const first = await reconciliationTick(f.store, { read: async () => f.proof }, f.queue, options);
  expect(first).toMatchObject({ waiting: 1, failed: 0 });
  expect(execute).toHaveBeenCalledOnce();
  const snapshot = await f.store.load('retry');
  expect(snapshot.pending?.status).toBe('AMBIGUOUS');
  expect(restoreTrancheRecord(snapshot.record).captureRetryClaim).not.toBeNull();
  expect(f.alerts).toContainEqual({
    trancheId: 'retry',
    operationKey: snapshot.pending?.operation.key,
    code: 'CAPTURE_RETRY_CONSUMED',
    owner: 'reviewer',
  });
  // A later tick never replenishes the retry and keeps the reviewer alert open.
  f.alerts.length = 0;
  await reconciliationTick(f.store, { read: async () => f.proof }, f.queue, options);
  expect(execute).toHaveBeenCalledOnce();
  expect(f.alerts).toContainEqual(expect.objectContaining({ code: 'CAPTURE_RETRY_CONSUMED' }));
});

it('does not raise the consumed-retry alert while the retry is still available', async () => {
  const f = await ambiguousCapture();
  const execute = vi.fn(async () => null);
  // Unavailable provider status: no claim is made, so only the generic unknown-outcome alert fires.
  await reconciliationTick(
    f.store,
    {
      read: async () => {
        throw new Error('offline');
      },
    },
    f.queue,
    { owner: 'reviewer', clock: () => at, executor: { execute } },
  );
  expect(execute).not.toHaveBeenCalled();
  expect(f.alerts.map((a) => (a as { code: string }).code)).not.toContain('CAPTURE_RETRY_CONSUMED');
});
