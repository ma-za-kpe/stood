import { describe, expect, it } from 'vitest';
import {
  advanceTrancheRecord,
  createTrancheRecord,
  restoreTrancheRecord,
  type TrancheCommand,
} from './tranche-record.js';

const at = 1790985600000;
const expiry = at + 29 * 86400000;
const advance = (record: string, method: TrancheCommand['method'], args: unknown[]) =>
  advanceTrancheRecord(record, { method, args } as unknown as TrancheCommand);
const pending = () => {
  let record = createTrancheRecord({
    id: 'renewal_expiry',
    amount: { minor: 1000, currency: 'GBP' },
    profileId: 'construction.stage@1',
    maxResubmits: 1,
  });
  record = advance(record, 'dispatch', ['auth_original', 'K7Q', at, expiry]);
  return advance(record, 'beginReauthorization', [at + 3 * 86400000]);
};
describe('Renewal reconciliation at expiry', () => {
  it('records verified no-renewal expiry and is recoverable without inventing a void', () => {
    const record = pending();
    const operation = restoreTrancheRecord(record).pendingReauthorization;
    const next = advance(record, 'confirmNoRenewalExpiry', [
      { ...operation, kind: 'NO_RENEWAL_EXPIRED', reference: 'provider_lookup', now: expiry },
    ]);
    const tranche = restoreTrancheRecord(next);
    expect(tranche.state).toBe('EXPIRED');
    expect(tranche.pendingReauthorization).toBeNull();
    expect(tranche.settlement).toMatchObject({ effect: 'EXPIRE', reference: 'provider_lookup' });
    expect(() =>
      advance(next, 'confirmNoRenewalExpiry', [
        { ...operation, kind: 'NO_RENEWAL_EXPIRED', reference: 'provider_lookup', now: expiry },
      ]),
    ).toThrow();
  });
  it('retains the reservation for missing, premature or mismatched proof', () => {
    const record = pending();
    const operation = restoreTrancheRecord(record).pendingReauthorization;
    const proof = { ...operation, kind: 'NO_RENEWAL_EXPIRED', reference: 'provider_lookup', now: expiry };
    for (const change of [
      { now: expiry - 1 },
      { now: Number.NaN },
      { reference: '' },
      { kind: 'UNKNOWN' },
      { key: 'wrong' },
      { authorizationId: 'wrong' },
    ])
      expect(() => advance(record, 'confirmNoRenewalExpiry', [{ ...proof, ...change }])).toThrow();
    expect(restoreTrancheRecord(record).state).toBe('REAUTHORIZE_PENDING');
  });
  it('adopts a late-discovered renewal then reserves expiry against the renewed authorisation', () => {
    let record = pending();
    const operation = restoreTrancheRecord(record).pendingReauthorization;
    record = advance(record, 'confirmReauthorization', [
      {
        ...operation,
        previousAuthorizationId: 'auth_original',
        authorizationId: 'auth_renewed',
        confirmedAt: at + 3 * 86400000,
        expiresAt: expiry,
      },
    ]);
    record = advance(record, 'expire', [expiry]);
    expect(restoreTrancheRecord(record).pendingOperation).toMatchObject({
      effect: 'VOID',
      authorizationId: 'auth_renewed',
      target: 'EXPIRED',
    });
  });
});
