import { describe, expect, it, vi } from 'vitest';
import {
  advanceTrancheRecord,
  createTrancheRecord,
  restoreTrancheRecord,
  type TrancheCommand,
} from '../domain/tranche-record.js';
import type { StoredTranche, TrancheStore } from '../ports/tranche-store.js';
import { TrancheStoreError } from '../ports/tranche-store.js';
import { reconcile } from './reconcile.js';

const at = 1790985600000;
const expiry = at + 29 * 86400000;
function fixture(effect: 'CAPTURE' | 'VOID' | 'REAUTHORIZE' = 'REAUTHORIZE') {
  let record = createTrancheRecord({
    id: 'renew',
    amount: { minor: 1000, currency: 'GBP' },
    profileId: 'construction.stage@1',
    maxResubmits: 1,
  });
  record = advanceTrancheRecord(record, { method: 'dispatch', args: ['auth', 'K7Q', at, expiry] });
  if (effect === 'REAUTHORIZE')
    record = advanceTrancheRecord(record, { method: 'beginReauthorization', args: [at + 3 * 86400000] });
  else {
    record = advanceTrancheRecord(record, { method: 'startDeciding', args: [] });
    record = advanceTrancheRecord(record, {
      method: 'beginSettlement',
      args: [
        {
          outcome: effect === 'CAPTURE' ? 'RELEASE' : 'REFUSE',
          effect,
          profileId: 'construction.stage@1',
          ruleSetVersion: '1.2.0',
          namedField: effect === 'VOID' ? 'plot' : null,
          reason: 'fixture',
          detail: null,
        },
        'decision',
        at,
      ],
    });
  }
  const tranche = restoreTrancheRecord(record);
  const operation = tranche.pendingOperation ?? tranche.pendingReauthorization;
  if (!operation) throw new Error('Fixture missing renewal');
  let snapshot: StoredTranche = {
    trancheId: 'renew',
    version: 2,
    record,
    pending: {
      trancheId: 'renew',
      operation,
      providerRequestId: 'uuid',
      status: 'AMBIGUOUS',
      reference: null,
      version: 2,
      reservedFromVersion: 1,
      createdAt: new Date(at).toISOString(),
    },
  };
  const store: TrancheStore = {
    create: async () => snapshot,
    load: async () => snapshot,
    apply: vi.fn(async (_id: string, version: number, _key: string, command: TrancheCommand) => {
      if (version !== snapshot.version) throw new TrancheStoreError('STALE_VERSION');
      const next = advanceTrancheRecord(snapshot.record, command);
      const tranche = restoreTrancheRecord(next);
      const pending = tranche.pendingOperation ?? tranche.pendingReauthorization;
      snapshot = {
        ...snapshot,
        record: next,
        version: version + 1,
        pending: pending ? { ...snapshot.pending!, operation: pending } : null,
      };
      return snapshot;
    }),
  };
  const proof = {
    operationKey: operation.key,
    authorizationId: 'auth',
    providerRequestId: 'uuid',
    complete: true,
    reference: 'lookup',
    outcome: 'EXPIRED',
    noCapture: true,
    noRenewal: true,
  };
  return { store, proof };
}
describe('Provider-status reconciliation', () => {
  it('rejects a completed capture or renewal that contradicts its absence flags', async () => {
    const capture = fixture('CAPTURE');
    expect(
      (
        await reconcile(
          capture.store,
          {
            read: async () => ({
              ...capture.proof,
              outcome: 'CAPTURED',
              noCapture: true,
              amount: { minor: 1000, currency: 'GBP' },
            }),
          },
          'renew',
          at,
        )
      ).status,
    ).toBe('WAIT');
    const renewal = fixture();
    expect(
      (
        await reconcile(
          renewal.store,
          {
            read: async () => ({
              ...renewal.proof,
              outcome: 'RENEWED',
              noRenewal: true,
              renewed: { authorizationId: 'new_auth', confirmedAt: at + 3 * 86400000, expiresAt: expiry },
            }),
          },
          'renew',
          expiry,
        )
      ).status,
    ).toBe('WAIT');
  });
  it.each([
    ['CAPTURE', 'CAPTURED', 'RELEASED'],
    ['CAPTURE', 'DECLINED', 'WAITING'],
    ['CAPTURE', 'EXPIRED', 'EXPIRED'],
    ['VOID', 'VOIDED', 'REFUSED'],
    ['VOID', 'EXPIRED', 'EXPIRED'],
  ] as const)('records %s / %s only as its matching outcome', async (effect, outcome, state) => {
    const { store, proof } = fixture(effect);
    const result = await reconcile(
      store,
      {
        read: async () => ({
          ...proof,
          outcome,
          noCapture: outcome !== 'CAPTURED',
          amount: { minor: 1000, currency: 'GBP' },
        }),
      },
      'renew',
      outcome === 'DECLINED' ? at : expiry,
    );
    expect(result.status).toBe('RESOLVED');
    expect(restoreTrancheRecord((await store.load('renew')).record).state).toBe(state);
  });
  it.each([{ minor: 999, currency: 'GBP' }, { minor: 1000, currency: 'USD' }, null])(
    'retains capture with a mismatched amount: %j',
    async (amount) => {
      const { store, proof } = fixture('CAPTURE');
      expect(
        (
          await reconcile(
            store,
            { read: async () => ({ ...proof, outcome: 'CAPTURED', noCapture: false, amount }) },
            'renew',
            expiry,
          )
        ).status,
      ).toBe('WAIT');
    },
  );
  it('never treats conflicting capture or unsupported outcomes as a void', async () => {
    const { store, proof } = fixture('VOID');
    for (const outcome of ['CAPTURED', 'DECLINED', 'PENDING'])
      expect((await reconcile(store, { read: async () => ({ ...proof, outcome }) }, 'renew', expiry)).status).toBe(
        'WAIT',
      );
  });
  it('expires a renewal only with complete matched no-capture/no-renewal proof', async () => {
    const { store, proof } = fixture();
    const reader = { read: vi.fn(async () => proof) };
    expect((await reconcile(store, reader, 'renew', expiry)).status).toBe('RESOLVED');
    expect(restoreTrancheRecord((await store.load('renew')).record).state).toBe('EXPIRED');
    expect((await reconcile(store, reader, 'renew', expiry)).status).toBe('IDLE');
    expect(reader.read).toHaveBeenCalledTimes(1);
  });
  it('adopts a confirmed renewal then expires its actual authorisation, including after a restart between writes', async () => {
    const { store, proof } = fixture();
    const reader = {
      read: async () => ({
        ...proof,
        outcome: 'RENEWED',
        noRenewal: false,
        renewed: { authorizationId: 'new_auth', confirmedAt: at + 3 * 86400000, expiresAt: expiry },
      }),
    };
    expect((await reconcile(store, reader, 'renew', expiry)).status).toBe('RESOLVED');
    expect((await store.load('renew')).pending?.operation).toMatchObject({
      effect: 'VOID',
      authorizationId: 'new_auth',
      target: 'EXPIRED',
    });
    const second = fixture();
    const snapshot = await second.store.load('renew');
    await second.store.apply('renew', snapshot.version, 'renewed', {
      method: 'confirmReauthorization',
      args: [
        {
          ...snapshot.pending!.operation,
          effect: 'REAUTHORIZE',
          previousAuthorizationId: 'auth',
          authorizationId: 'new_auth',
          confirmedAt: at + 3 * 86400000,
          expiresAt: expiry,
        },
      ],
    });
    expect(
      (
        await reconcile(
          second.store,
          {
            read: async () => {
              throw new Error('Must not read');
            },
          },
          'renew',
          expiry,
        )
      ).status,
    ).toBe('EXPIRED_RESERVED');
  });
  it.each([
    null,
    {},
    { complete: false },
    { operationKey: 'wrong' },
    { authorizationId: 'wrong' },
    { providerRequestId: 'wrong' },
    { reference: '' },
    { outcome: 'UNKNOWN' },
    { noCapture: false },
    { noRenewal: false },
    { outcome: 'CAPTURED' },
    { outcome: 'RENEWED', renewed: {} },
  ])('keeps incomplete or contradictory status reserved: %j', async (change) => {
    const { store, proof } = fixture();
    const before = await store.load('renew');
    const result = await reconcile(
      store,
      { read: async () => (change === null || Object.keys(change).length === 0 ? change : { ...proof, ...change }) },
      'renew',
      expiry,
    );
    expect(result.status).toBe('WAIT');
    expect(result.alert).toBe(true);
    expect(await store.load('renew')).toEqual(before);
    expect(store.apply).not.toHaveBeenCalled();
  });
  it('does not infer expiry from a clock, and contains lookup errors or invalid clocks', async () => {
    const { store, proof } = fixture();
    expect((await reconcile(store, { read: async () => proof }, 'renew', expiry - 1)).status).toBe('WAIT');
    expect(
      (
        await reconcile(
          store,
          {
            read: async () => {
              throw new Error('Synthetic network failure');
            },
          },
          'renew',
          expiry,
        )
      ).status,
    ).toBe('WAIT');
    expect((await reconcile(store, { read: async () => proof }, 'renew', Number.NaN)).status).toBe('WAIT');
  });
  it('resolves rejected renewals, treats stale races as retryable and propagates storage faults', async () => {
    const { store, proof } = fixture();
    expect(
      (await reconcile(store, { read: async () => ({ ...proof, outcome: 'NOT_RENEWED' }) }, 'renew', at + 4 * 86400000))
        .status,
    ).toBe('RESOLVED');
    const race = fixture();
    race.store.apply = async () => {
      throw new TrancheStoreError('STALE_VERSION');
    };
    expect((await reconcile(race.store, { read: async () => race.proof }, 'renew', expiry)).status).toBe('RETRY');
    race.store.apply = async () => {
      throw new Error('Database unavailable');
    };
    await expect(reconcile(race.store, { read: async () => race.proof }, 'renew', expiry)).rejects.toThrow(
      'Database unavailable',
    );
  });
});
