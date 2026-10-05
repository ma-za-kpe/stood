import { describe, expect, it, vi } from 'vitest';
import { FaultController } from '../../../../simulators/src/faults.js';
import { simulatorHarness } from '../../../test/contracts/paypal-simulator.js';
import { executePayment } from '../../application/execute-payment.js';
import { reconcile } from '../../application/reconcile.js';
import { RULE_SET_VERSION } from '../../domain/decision.js';
import { advanceTrancheRecord, createTrancheRecord, restoreTrancheRecord } from '../../domain/tranche-record.js';
import { type StoredTranche, type TrancheStore, TrancheStoreError } from '../../ports/tranche-store.js';
import { PayPalAdapter } from './adapter.js';

describe('Domain recovery through actual simulator HTTP', () => {
  it.each(['CAPTURE', 'VOID'] as const)('reconciles a lost %s response without submitting again', async (effect) => {
    const path = `/v2/payments/authorizations/SIM-AUTH-3/${effect === 'CAPTURE' ? 'capture' : 'void'}`;
    const faults = new FaultController([{ method: 'POST', path, kind: 'LOST_RESPONSE' }]);
    const h = await simulatorHarness(faults);
    try {
      const at = Date.parse('2026-10-05T00:00:00Z');
      let record = createTrancheRecord({
        id: 'fixture-tranche',
        amount: { minor: 1000, currency: 'USD' },
        profileId: 'code.milestone@1',
        maxResubmits: 1,
      });
      record = advanceTrancheRecord(record, {
        method: 'dispatch',
        args: [h.input.authorizationId, 'K7Q', at, at + 29 * 86400000],
      });
      record = advanceTrancheRecord(record, { method: 'startDeciding', args: [] });
      record = advanceTrancheRecord(record, {
        method: 'beginSettlement',
        args: [
          {
            outcome: effect === 'CAPTURE' ? 'RELEASE' : 'REFUSE',
            effect,
            reason: 'synthetic_contract',
            namedField: effect === 'VOID' ? 'signed_tests_changed' : null,
            detail: null,
            profileId: 'code.milestone@1',
            ruleSetVersion: RULE_SET_VERSION,
          },
          'decision',
          at,
        ],
      });
      const operation = restoreTrancheRecord(record).pendingOperation;
      if (!operation) throw new Error('Missing reserved operation');
      let value: StoredTranche = {
        trancheId: 'fixture-tranche',
        version: 3,
        record,
        pending: {
          trancheId: 'fixture-tranche',
          operation,
          status: 'RESERVED',
          providerRequestId: 'persistent-request',
          reference: null,
          version: 3,
          reservedFromVersion: 2,
          createdAt: new Date(at).toISOString(),
        },
      };
      const store: TrancheStore = {
        create: async () => value,
        load: async () => value,
        apply: async (_id, version, _commandId, command) => {
          if (version !== value.version) throw new TrancheStoreError('STALE_VERSION');
          const record = advanceTrancheRecord(value.record, command);
          const pending = restoreTrancheRecord(record).pendingOperation;
          value = {
            ...value,
            record,
            version: value.version + 1,
            pending:
              pending && value.pending
                ? { ...value.pending, operation: pending, status: 'AMBIGUOUS', version: value.version + 1 }
                : null,
          };
          return value;
        },
      };
      const call = vi.spyOn(h.transport, 'call');
      const adapter = new PayPalAdapter(h.transport, store);
      expect(await executePayment(store, adapter, value.trancheId, 'worker1', () => at)).toBe('WAIT');
      expect(value.pending?.status).toBe('AMBIGUOUS');
      expect(await executePayment(store, adapter, value.trancheId, 'worker2', () => at)).toBe('WAIT');
      expect(call.mock.calls.filter(([action]) => action === effect)).toHaveLength(1);
      expect(await reconcile(store, adapter, value.trancheId, at + 1)).toEqual({ status: 'RESOLVED' });
      expect(restoreTrancheRecord(value.record).state).toBe(effect === 'CAPTURE' ? 'RELEASED' : 'REFUSED');
      expect(value.pending).toBeNull();
      expect(call.mock.calls.filter(([action]) => action === effect)).toHaveLength(1);
      expect(await reconcile(store, adapter, value.trancheId, at + 2)).toEqual({ status: 'IDLE' });
    } finally {
      await h.close();
    }
  });
});
