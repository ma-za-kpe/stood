import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { advanceTrancheRecord, restoreTrancheRecord } from '../domain/tranche-record.js';
import type { ReconciliationQueue } from '../ports/reconciliation-queue.js';
import type { StoredTranche, TrancheStore } from '../ports/tranche-store.js';
import { reconciliationTick } from './reconciliation-worker.js';

const at = 1790985600000;
function fixture(input?: string) {
  const initial = input ?? readFileSync(new URL('../domain/fixtures/old-rule-held.json', import.meta.url), 'utf8');
  const first = restoreTrancheRecord(initial);
  let snapshot: StoredTranche = {
    trancheId: first.id,
    version: 0,
    record: initial,
    pending: first.pendingOperation
      ? {
          trancheId: first.id,
          operation: first.pendingOperation,
          status: 'AMBIGUOUS',
          providerRequestId: 'fixture_uuid',
          reference: null,
          version: 0,
          reservedFromVersion: 0,
          createdAt: new Date(at).toISOString(),
        }
      : null,
  };
  const store: TrancheStore = {
    create: async () => snapshot,
    load: async () => snapshot,
    apply: async (_id, version, _key, command) => {
      const record = advanceTrancheRecord(snapshot.record, command);
      const tranche = restoreTrancheRecord(record);
      const operation = tranche.pendingOperation ?? tranche.pendingReauthorization;
      snapshot = {
        ...snapshot,
        record,
        version: version + 1,
        pending: operation
          ? {
              trancheId: first.id,
              operation,
              status: 'RESERVED',
              providerRequestId: 'fixture_uuid',
              reference: null,
              version: version + 1,
              reservedFromVersion: version,
              createdAt: new Date(at).toISOString(),
            }
          : null,
      };
      return snapshot;
    },
  };
  let claimed = false;
  const queue: ReconciliationQueue = {
    seed: vi.fn(async () => {}),
    claim: vi.fn(async () => {
      if (claimed) return null;
      claimed = true;
      return { trancheId: first.id, token: 'lease' };
    }),
    finish: vi.fn(async () => {}),
    alert: vi.fn(async () => {}),
    resolve: vi.fn(async () => {}),
  };
  return { store, queue };
}
describe('Owned reconciliation scheduling', () => {
  it('automatically reserves cancellation of an old-rule hold and assigns blocked outcomes to the reviewer', async () => {
    const { store, queue } = fixture();
    expect(
      await reconciliationTick(store, { read: async () => null }, queue, {
        owner: 'local-reviewer',
        clock: () => at + 4 * 3600000,
      }),
    ).toMatchObject({ processed: 1, waiting: 1, failed: 0 });
    expect((await store.load('trn_old')).pending?.operation).toMatchObject({ effect: 'VOID', target: 'CANCELLED' });
    expect(queue.alert).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'SAFE_CANCEL_REQUESTED', owner: 'local-reviewer' }),
    );
    expect(queue.alert).toHaveBeenCalledWith(expect.objectContaining({ code: 'UNRESOLVED_3H' }));
    expect(queue.finish).toHaveBeenCalledTimes(1);
  });
  it('resolves complete matching cancellations and clears only the open alert state', async () => {
    const { store, queue } = fixture();
    const reader = {
      read: async () => {
        const pending = (await store.load('trn_old')).pending;
        return {
          complete: true,
          operationKey: pending?.operation.key,
          authorizationId: 'auth_old',
          providerRequestId: 'fixture_uuid',
          reference: 'fixture_cancel',
          outcome: 'VOIDED',
          noCapture: true,
          noRenewal: true,
        };
      },
    };
    expect((await reconciliationTick(store, reader, queue, { owner: 'reviewer', clock: () => at })).waiting).toBe(0);
    expect(restoreTrancheRecord((await store.load('trn_old')).record).state).toBe('CANCELLED');
    expect(queue.resolve).toHaveBeenCalledWith('trn_old');
  });
  it('reserves safe cancellation immediately after an old capture is proved declined', async () => {
    const doc = JSON.parse(readFileSync(new URL('../domain/fixtures/old-rule-held.json', import.meta.url), 'utf8'));
    doc.commands.push(
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
            ruleSetVersion: '1.0.0',
          },
          'decision_old',
          at,
        ],
      },
    );
    const { store, queue } = fixture(JSON.stringify(doc));
    const pending = (await store.load('trn_old')).pending!;
    await reconciliationTick(
      store,
      {
        read: async () => ({
          complete: true,
          operationKey: pending.operation.key,
          authorizationId: 'auth_old',
          providerRequestId: 'fixture_uuid',
          reference: 'fixture_decline',
          outcome: 'DECLINED',
          noCapture: true,
          noRenewal: true,
        }),
      },
      queue,
      { owner: 'reviewer', clock: () => at },
    );
    expect((await store.load('trn_old')).pending?.operation).toMatchObject({ effect: 'VOID', target: 'CANCELLED' });
    expect(queue.alert).toHaveBeenCalledWith(expect.objectContaining({ code: 'SAFE_CANCEL_REQUESTED' }));
  });
  it('uses the durable dispatch guard when a qualified executor is supplied', async () => {
    const { store, queue } = fixture();
    const execute = vi.fn(
      async () =>
        ({
          method: 'confirmSettlement',
          args: [{ effect: 'VOID', authorizationId: 'auth_old', reference: 'fixture_void' }],
        }) as const,
    );
    const result = await reconciliationTick(store, { read: async () => null }, queue, {
      owner: 'reviewer',
      clock: () => at,
      executor: { execute },
    });
    expect(result).toMatchObject({ waiting: 0, failed: 0 });
    expect(execute).toHaveBeenCalledOnce();
    expect(restoreTrancheRecord((await store.load('trn_old')).record).state).toBe('CANCELLED');
  });
  it('contains state failures without exposing raw error text and keeps the lease scheduled', async () => {
    const { store, queue } = fixture();
    store.load = async () => {
      throw new Error('private fixture data');
    };
    expect(
      (await reconciliationTick(store, { read: async () => null }, queue, { owner: 'reviewer', clock: () => at }))
        .failed,
    ).toBe(1);
    expect(queue.alert).toHaveBeenCalledWith({
      trancheId: 'trn_old',
      operationKey: null,
      code: 'WORKER_FAILURE',
      owner: 'reviewer',
    });
    expect(queue.finish).toHaveBeenCalledTimes(1);
  });
  it('validates ownership, clock and limits before claiming jobs', async () => {
    const { store, queue } = fixture();
    for (const options of [
      { owner: '', clock: () => at },
      { owner: 'reviewer', clock: () => Number.NaN },
    ])
      await expect(reconciliationTick(store, { read: async () => null }, queue, options)).rejects.toThrow();
    await expect(
      reconciliationTick(store, { read: async () => null }, queue, { owner: 'reviewer', clock: () => at }, 0),
    ).rejects.toThrow();
    expect(queue.claim).not.toHaveBeenCalled();
  });
});
