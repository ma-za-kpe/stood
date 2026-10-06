import { expect, it } from 'vitest';
import { advanceTrancheRecord, createTrancheRecord, restoreTrancheRecord } from './tranche-record.js';

const now = 1791244800000;
const definition = {
  id: 'pending-funding',
  amount: { minor: 1000, currency: 'USD' },
  profileId: 'code.milestone@1',
  maxResubmits: 1,
};
const hold = {
  kind: 'HELD' as const,
  authorizationId: 'AUTH',
  nonce: 'K7Q',
  heldAt: now,
  expiresAt: now + 29 * 86400000,
  reference: 'ORDER:AUTH',
};
const old = () => JSON.stringify({ ...JSON.parse(createTrancheRecord(definition)), ruleSetVersion: '1.0.0' });
it('recovers a hold created before a rule change, permits cancellation and still prohibits capture', () => {
  const record = advanceTrancheRecord(old(), { method: 'confirmFunding', args: [hold] });
  const tranche = restoreTrancheRecord(record);
  expect(tranche.state).toBe('HELD');
  expect(tranche.safeRecovery).toBe(true);
  expect(tranche.currentHold.authorizationId).toBe('AUTH');
  expect(() => tranche.startDeciding()).toThrow('Safe recovery');
  expect(tranche.cancel(now).effect).toBe('VOID');
});
it('can record definite no-hold proof on old rules without granting new funding authority', () => {
  const record = advanceTrancheRecord(old(), {
    method: 'confirmFunding',
    args: [{ kind: 'FAILED', reference: 'provider-debug' }],
  });
  const tranche = restoreTrancheRecord(record);
  expect(tranche.state).toBe('WAIT_FUNDING');
  expect(tranche.safeRecovery).toBe(true);
  expect(() => tranche.fundingFailed()).toThrow('Safe recovery');
});
it('records proven initial-hold expiry after old-rule recovery without reserving a void or granting capture', () => {
  const record = advanceTrancheRecord(old(), {
    method: 'confirmFunding',
    args: [{ ...hold, kind: 'EXPIRED', now: hold.expiresAt }],
  } as never);
  const tranche = restoreTrancheRecord(record);
  expect(tranche.state).toBe('EXPIRED');
  expect(tranche.pendingOperation).toBeNull();
  expect(tranche.settlement).toMatchObject({ effect: 'EXPIRE', reference: hold.reference });
  expect(tranche.safeRecovery).toBe(true);
  for (const at of [hold.expiresAt - 1, NaN, hold.expiresAt + 0.5])
    expect(() =>
      advanceTrancheRecord(old(), { method: 'confirmFunding', args: [{ ...hold, kind: 'EXPIRED', now: at }] } as never),
    ).toThrow();
});
it('requires a valid funding receipt and an unfunded state', () => {
  const record = createTrancheRecord(definition);
  for (const receipt of [
    { ...hold, reference: '' },
    { ...hold, authorizationId: '' },
    { ...hold, nonce: '***' },
    { ...hold, heldAt: now + 0.5 },
    { ...hold, heldAt: -1 },
    { ...hold, expiresAt: now + 0.5 },
    { ...hold, expiresAt: now },
    { ...hold, expiresAt: hold.expiresAt + 1 },
    { kind: 'FAILED', reference: '' },
    { ...hold, kind: 'CAPTURED' },
  ])
    expect(() => advanceTrancheRecord(record, { method: 'confirmFunding', args: [receipt] } as never)).toThrow();
  const held = advanceTrancheRecord(record, { method: 'confirmFunding', args: [hold] });
  expect(restoreTrancheRecord(held).safeRecovery).toBe(false);
  expect(() => advanceTrancheRecord(held, { method: 'confirmFunding', args: [hold] })).toThrow();
});
