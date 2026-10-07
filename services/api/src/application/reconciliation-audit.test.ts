import { expect, it } from 'vitest';
import { auditCaptures } from './reconciliation-audit.js';

const ledger = [{ trancheId: 't1', operationKey: 'op1', reference: 'CAP-1', minor: 1000, currency: 'USD' }];
const capture = { id: 'CAP-1', invoiceId: 'op1', minor: 1000, currency: 'USD', status: 'COMPLETED' as const };
it('finds nothing when every confirmed release matches exactly one provider capture (T-0155)', () => {
  expect(auditCaptures(ledger, [capture])).toEqual([]);
  expect(auditCaptures([], [{ ...capture, status: 'DECLINED' }])).toEqual([]);
});
it('flags captures Stood never released, releases with no capture, mismatched amounts and duplicates', () => {
  expect(auditCaptures([], [capture])).toEqual([
    { kind: 'CAPTURE_WITHOUT_RELEASE', trancheId: null, providerId: 'CAP-1', operationKey: 'op1' },
  ]);
  expect(auditCaptures([], [{ ...capture, invoiceId: null }])[0]).toMatchObject({ kind: 'CAPTURE_WITHOUT_RELEASE' });
  expect(auditCaptures(ledger, [])).toEqual([
    { kind: 'RELEASE_WITHOUT_CAPTURE', trancheId: 't1', providerId: null, operationKey: 'op1' },
  ]);
  expect(auditCaptures(ledger, [{ ...capture, minor: 999 }])[0]).toMatchObject({ kind: 'AMOUNT_MISMATCH' });
  expect(auditCaptures(ledger, [{ ...capture, currency: 'EUR' }])[0]).toMatchObject({ kind: 'AMOUNT_MISMATCH' });
  expect(auditCaptures(ledger, [capture, { ...capture, id: 'CAP-2', status: 'PENDING' }])).toEqual([
    { kind: 'DUPLICATE_CAPTURE', trancheId: 't1', providerId: 'CAP-2', operationKey: 'op1' },
  ]);
  // A refund is not a live capture: the ledger's capture is then missing and must be looked at.
  expect(auditCaptures(ledger, [{ ...capture, status: 'REFUNDED' }])[0]).toMatchObject({
    kind: 'RELEASE_WITHOUT_CAPTURE',
  });
});
