import { describe, expect, it, vi } from 'vitest';
import { RULE_SET_VERSION } from '../domain/decision.js';
import {
  advanceTrancheRecord,
  createTrancheRecord,
  restoreTrancheRecord,
  type TrancheCommand,
} from '../domain/tranche-record.js';
import type { StoredTranche, TrancheStore } from '../ports/tranche-store.js';
import { TrancheStoreError } from '../ports/tranche-store.js';
import { executePayment } from './execute-payment.js';

const at = 1790985600000;
const expiry = at + 29 * 86400000;
function fixture(renewal = false) {
  let record = createTrancheRecord({
    id: 'dispatch',
    amount: { minor: 1000, currency: 'GBP' },
    profileId: 'construction.stage@1',
    maxResubmits: 1,
  });
  for (const command of [
    { method: 'dispatch', args: ['auth', 'K7Q', at, expiry] },
    { method: 'startDeciding', args: [] },
    {
      method: 'beginSettlement',
      args: [
        {
          outcome: 'RELEASE',
          effect: 'CAPTURE',
          reason: 'fixture',
          namedField: null,
          detail: null,
          profileId: 'construction.stage@1',
          ruleSetVersion: RULE_SET_VERSION,
        },
        'decision',
        at,
      ],
    },
  ] as TrancheCommand[])
    record = advanceTrancheRecord(record, command);
  if (renewal) {
    const document = JSON.parse(record);
    document.commands = [document.commands[0], { method: 'beginReauthorization', args: [at + 3 * 86400000] }];
    record = JSON.stringify(document);
  }
  const tranche = restoreTrancheRecord(record);
  const operation = tranche.pendingOperation ?? tranche.pendingReauthorization;
  if (!operation) throw new Error('Missing operation');
  let value: StoredTranche = {
    trancheId: 'dispatch',
    record,
    version: 3,
    pending: {
      trancheId: 'dispatch',
      operation,
      status: 'RESERVED',
      providerRequestId: 'persisted_uuid',
      reference: null,
      version: 3,
      reservedFromVersion: 2,
      createdAt: new Date(at).toISOString(),
    },
  };
  const store: TrancheStore = {
    create: async () => value,
    load: async () => value,
    apply: vi.fn(async (_id, version, _commandId, command) => {
      if (version !== value.version) throw new TrancheStoreError('STALE_VERSION');
      const record = advanceTrancheRecord(value.record, command);
      const tranche = restoreTrancheRecord(record);
      value = {
        ...value,
        record,
        version: value.version + 1,
        pending:
          (tranche.pendingOperation ?? tranche.pendingReauthorization)
            ? { ...value.pending!, status: 'AMBIGUOUS', version: value.version + 1 }
            : null,
      };
      return value;
    }),
  };
  return store;
}
describe('Durable payment dispatch', () => {
  it('allows rental cancellation and expiry while blocking automatic model-based deposit returns', async () => {
    for (const method of ['cancel', 'expire'] as const) {
      const store = fixture();
      const before = await store.load('dispatch');
      const doc = JSON.parse(before.record);
      doc.definition.profileId = 'rental.return@1';
      doc.ruleSetVersion = '1.0.0';
      doc.commands = [doc.commands[0], { method, args: [method === 'expire' ? expiry : at] }];
      const record = JSON.stringify(doc);
      const pending = restoreTrancheRecord(record).pendingOperation!;
      const snapshot = { ...before, record, pending: { ...before.pending!, operation: pending } };
      store.load = async () => snapshot;
      store.apply = async () => snapshot;
      const execute = vi.fn(async () => null);
      await executePayment(store, { execute }, 'dispatch', 'worker', () => at);
      expect(execute).toHaveBeenCalledOnce();
    }
  });
  it('never submits a renewal after its safe window has closed', async () => {
    const store = fixture(true);
    const execute = vi.fn(async () => null);
    expect(await executePayment(store, { execute }, 'dispatch', 'worker', () => expiry)).toBe('NOT_SUBMITTED');
    expect(execute).not.toHaveBeenCalled();
    expect(restoreTrancheRecord((await store.load('dispatch')).record).state).toBe('HELD');
  });
  it('records possible submission before calling, preserves its UUID and commits confirmation atomically', async () => {
    const store = fixture();
    const execute = vi.fn(async (snapshot: StoredTranche) => {
      expect((await store.load('dispatch')).pending?.status).toBe('AMBIGUOUS');
      expect(snapshot.pending?.providerRequestId).toBe('persisted_uuid');
      return {
        method: 'confirmSettlement',
        args: [{ effect: 'CAPTURE', authorizationId: 'auth', reference: 'capture' }],
      } as const;
    });
    expect(await executePayment(store, { execute }, 'dispatch', 'worker', () => at)).toBe('RESOLVED');
    expect(restoreTrancheRecord((await store.load('dispatch')).record).state).toBe('RELEASED');
    expect(await executePayment(store, { execute }, 'dispatch', 'next', () => at)).toBe('DONE');
    expect(execute).toHaveBeenCalledTimes(1);
  });
  it('reports a definite declined payment as a resolved failure, never as a confirmed capture', async () => {
    const store = fixture();
    expect(
      await executePayment(
        store,
        {
          execute: async () => ({
            method: 'settlementFailed',
            args: [{ effect: 'CAPTURE', authorizationId: 'auth', kind: 'DECLINED', reference: 'declined' }],
          }),
        },
        'dispatch',
        'worker',
        () => at,
      ),
    ).toBe('RESOLVED');
    expect(restoreTrancheRecord((await store.load('dispatch')).record).state).toBe('WAITING');
  });
  it('keeps pending responses, timeouts and mismatched confirmations unresolved', async () => {
    for (const execute of [
      async () => null,
      async () => {
        throw new Error('Network');
      },
      async () =>
        ({
          method: 'confirmSettlement',
          args: [{ effect: 'VOID', authorizationId: 'auth', reference: 'wrong' }],
        }) as const,
    ]) {
      const store = fixture();
      expect(await executePayment(store, { execute }, 'dispatch', 'worker', () => at)).toBe('WAIT');
      expect((await store.load('dispatch')).pending?.status).toBe('AMBIGUOUS');
    }
  });
  it('never retries ambiguous requests blindly or submits old-rule captures', async () => {
    const store = fixture();
    const execute = vi.fn(async () => null);
    await executePayment(store, { execute }, 'dispatch', 'first', () => at);
    await executePayment(store, { execute }, 'dispatch', 'second', () => at);
    expect(execute).toHaveBeenCalledTimes(1);
    const old = fixture();
    const snapshot = await old.load('dispatch');
    const document = JSON.parse(snapshot.record);
    document.ruleSetVersion = '1.0.0';
    document.commands[2].args[0].ruleSetVersion = '1.0.0';
    old.load = async () => ({ ...snapshot, record: JSON.stringify(document) });
    expect(await executePayment(old, { execute }, 'dispatch', 'old', () => at)).toBe('WAIT');
    expect(execute).toHaveBeenCalledTimes(1);
  });
  it('rejects late capture before submission, but retains uncertainty when the clock moves after reservation', async () => {
    const store = fixture();
    const execute = vi.fn(async () => null);
    expect(await executePayment(store, { execute }, 'dispatch', 'worker', () => expiry - 1)).toBe('NOT_SUBMITTED');
    expect(execute).not.toHaveBeenCalled();
    expect(restoreTrancheRecord((await store.load('dispatch')).record).state).toBe('WAITING');
    const advancing = fixture();
    let calls = 0;
    expect(
      await executePayment(advancing, { execute }, 'dispatch', 'worker', () => (calls++ === 0 ? at : expiry)),
    ).toBe('WAIT');
    expect(execute).not.toHaveBeenCalled();
  });
  it('lets only one worker claim the submission and validates identifiers and clocks', async () => {
    const store = fixture();
    const execute = vi.fn(async () => null);
    await Promise.all([
      executePayment(store, { execute }, 'dispatch', 'a', () => at),
      executePayment(store, { execute }, 'dispatch', 'b', () => at),
    ]);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(await executePayment(fixture(), { execute }, 'dispatch', '', () => at)).toBe('WAIT');
    expect(await executePayment(fixture(), { execute }, 'dispatch', 'worker', () => Number.NaN)).toBe('WAIT');
  });
});
