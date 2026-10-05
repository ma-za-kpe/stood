import fc from 'fast-check';
import { expect, it } from 'vitest';
import { type CheckResult, decide, getProfile } from './decision.js';
import { CAPTURE_SAFETY_MARGIN_MS } from './hold-policy.js';
import { Money } from './money.js';
import { Nonce } from './nonce.js';
import { Tranche } from './tranche.js';

const at = 1791158400000,
  expiry = at + 29 * 86400000;
const ready = () => {
  const t = new Tranche('retry', new Money(1000n, 'USD'), 'code.milestone@1', 1);
  t.dispatch('auth', new Nonce('K7Q'), at, expiry);
  t.startDeciding();
  const checks: CheckResult[] = getProfile(t.profileId).checks.map((c) => ({
    code: c.code,
    source: 'RULE',
    status: 'PASS',
    reason: 'fixture',
  }));
  t.beginSettlement(decide(t.profileId, checks), 'decision', at);
  return t;
};
const proof = (t: Tranche) => ({
  claimId: 'fixture-claim',
  effect: 'CAPTURE' as const,
  authorizationId: 'auth',
  operationKey: t.pendingOperation!.key,
  providerRequestId: 'persisted-request',
  reference: 'matched-lookup',
  observedAt: at,
  now: at,
});
it('consumes exactly one retry without changing operation identity and retains that claim across ambiguous failures', () => {
  const t = ready(),
    original = t.pendingOperation;
  expect(t.captureRetryClaim).toBeNull();
  ambiguous(t);
  t.claimCaptureRetry(proof(t));
  expect(t.captureRetryClaim).toEqual(proof(t));
  expect(t.pendingOperation).toEqual(original);
  ambiguous(t);
  expect(() => t.claimCaptureRetry(proof(t))).toThrow();
  expect(t.state).toBe('CAPTURE_PENDING');
});
function ambiguous(t: Tranche) {
  t.settlementFailed({ effect: 'CAPTURE', authorizationId: 'auth', kind: 'AMBIGUOUS' });
}
it('rejects a retry on an unsent reservation and preserves all state on invalid proof', () => {
  const reserved = ready();
  expect(() => reserved.claimCaptureRetry(proof(reserved))).toThrow();
  const patches = [
    { effect: 'VOID' },
    { claimId: '' },
    { claimId: null },
    { authorizationId: 'other' },
    { operationKey: 'other' },
    { providerRequestId: '' },
    { providerRequestId: 42 },
    { reference: '' },
    { reference: null },
    { observedAt: NaN },
    { now: NaN },
    { observedAt: at - 1 },
    { observedAt: at + 1 },
    { now: at + 5001 },
    { observedAt: expiry - CAPTURE_SAFETY_MARGIN_MS, now: expiry - CAPTURE_SAFETY_MARGIN_MS },
  ];
  for (const patch of patches) {
    const t = ready();
    ambiguous(t);
    expect(() => t.claimCaptureRetry({ ...proof(t), ...patch } as never)).toThrow();
    expect(t.captureRetryClaim).toBeNull();
    expect(t.state).toBe('CAPTURE_PENDING');
  }
});
it('allows a fresh proof at the freshness boundary and resets consumption only for a new operation after definite failure', () => {
  const t = ready();
  ambiguous(t);
  t.claimCaptureRetry({ ...proof(t), now: at + 5000 });
  const old = t.pendingOperation;
  t.settlementFailed({ effect: 'CAPTURE', authorizationId: 'auth', kind: 'DECLINED' });
  const decision = t.decisions[0]!.decision;
  t.beginSettlement(decision, 'new-decision', at + 5001);
  expect(t.pendingOperation?.key).not.toBe(old?.key);
  expect(t.captureRetryClaim).toBeNull();
  expect(() => t.claimCaptureRetry({ ...proof(t), observedAt: at + 5001, now: at + 5001 })).toThrow();
});
it('never consumes a capture retry at or beyond the expiry margin over random clocks', () => {
  fc.assert(
    fc.property(fc.integer({ min: expiry - CAPTURE_SAFETY_MARGIN_MS, max: expiry + 86400000 }), (now) => {
      const t = ready();
      ambiguous(t);
      expect(() => t.claimCaptureRetry({ ...proof(t), observedAt: now, now })).toThrow();
      expect(t.captureRetryClaim).toBeNull();
    }),
    { numRuns: 500 },
  );
});
