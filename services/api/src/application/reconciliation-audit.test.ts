import { expect, it } from 'vitest';
import { auditCaptures, auditSettled } from './reconciliation-audit.js';

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

it('waits three hours before calling a capture missing, because Transaction Search lags (T-0155)', () => {
  const now = Date.parse('2026-10-08T12:00:00Z');
  const hour = 3600000;
  const fresh = { ...ledger[0]!, at: now - hour };
  const settled = { ...ledger[0]!, at: now - 4 * hour };
  // A release confirmed an hour ago may simply not be searchable yet: no finding.
  expect(auditSettled([fresh], [], now)).toEqual([]);
  expect(auditSettled([settled], [], now)).toEqual([
    { kind: 'RELEASE_WITHOUT_CAPTURE', trancheId: 't1', providerId: null, operationKey: 'op1' },
  ]);
  // A PayPal capture Stood never released: reported once it is three hours old, or at once if its time is unknown.
  expect(auditSettled([], [{ ...capture, at: now - hour }], now)).toEqual([]);
  expect(auditSettled([], [{ ...capture, at: now - 4 * hour }], now)[0]).toMatchObject({
    kind: 'CAPTURE_WITHOUT_RELEASE',
  });
  expect(auditSettled([], [{ ...capture, at: null }], now)[0]).toMatchObject({ kind: 'CAPTURE_WITHOUT_RELEASE' });
  // Wrong amounts and duplicates are never a matter of delay.
  expect(auditSettled([fresh], [{ ...capture, minor: 1, at: now }], now)[0]).toMatchObject({ kind: 'AMOUNT_MISMATCH' });
  expect(
    auditSettled(
      [fresh],
      [
        { ...capture, at: now },
        { ...capture, id: 'CAP-2', at: now },
      ],
      now,
    )[0],
  ).toMatchObject({ kind: 'DUPLICATE_CAPTURE' });
});

// T-0259: the operator run tool and the nightly sandbox job capture real sandbox money outside Stood's ledger,
// on purpose. Their keys are marked at source; a real Stood operation key always contains ':' so never matches.
it('sets aside captures made by the sandbox run tool, and nothing that only looks similar', () => {
  const capture = (id: string, invoiceId: string) =>
    ({ id, invoiceId, minor: 1000, currency: 'USD', status: 'COMPLETED' }) as const;
  const findings = auditCaptures(
    [],
    [
      capture('RUN-1', 'sandbox-release-2026-10-08T02-01-38-901Z-settle'),
      capture('RUN-2', 'sandbox-vault-release-2026-10-08T10-51-03-742Z-settle'),
      capture('REAL', 'sandbox-release:0:CAPTURE:1'),
      capture('ODD', 'sandbox-release-2026-10-08T02-01-38-901Z-settle-extra'),
    ],
  );
  expect(findings.map((f) => f.providerId)).toEqual(['REAL', 'ODD']);
});
