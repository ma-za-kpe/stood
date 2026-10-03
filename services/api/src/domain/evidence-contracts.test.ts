import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { type CheckResult, decide, getProfile } from './decision.js';
import { checkLocation } from './evidence-checks.js';
import { Geofence, GeoPoint } from './geofence.js';
import { Money } from './money.js';
import { Nonce } from './nonce.js';
import { Tranche } from './tranche.js';

const passing = (): CheckResult[] =>
  getProfile('construction.stage@1').checks.map(
    ({ code }) =>
      ({
        code,
        status: 'PASS',
        reason: 'passed',
        ...(code === 'nonce' || code === 'classifier_label' ? { source: 'MODEL', confidence: 1 } : { source: 'RULE' }),
      }) as CheckResult,
  );
const nonceDecision = (status: 'PASS' | 'FAIL', confidence: number) =>
  decide(
    'construction.stage@1',
    passing().map((c) =>
      c.code === 'nonce' ? ({ ...c, source: 'MODEL', status, confidence, namedField: 'nonce' } as CheckResult) : c,
    ),
  );

describe('Model provenance and confidence (T-0126)', () => {
  it('waits on malformed runtime results without throwing', () => {
    for (const check of [null, 1, { code: 'nonce', source: 'MODEL', status: 'PASS', confidence: 1, reason: 1 }]) {
      expect(decide('construction.stage@1', [check as unknown as CheckResult])).toMatchObject({
        outcome: 'WAIT',
        effect: 'NONE',
      });
    }
  });
  it('enforces nonce pass and refusal thresholds centrally', () => {
    expect(nonceDecision('PASS', 0.8).outcome).toBe('RELEASE');
    expect(nonceDecision('PASS', 0.799).outcome).toBe('WAIT');
    expect(nonceDecision('FAIL', 0.899).outcome).toBe('WAIT');
    expect(nonceDecision('FAIL', 0.9).outcome).toBe('REFUSE');
  });
  it('never refuses on a low-confidence nonce finding', () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 0.899999, noNaN: true }), (confidence) => {
        expect(nonceDecision('FAIL', confidence)).toMatchObject({ outcome: 'WAIT', effect: 'NONE' });
      }),
    );
  });
  it.each([Number.NaN, Number.POSITIVE_INFINITY, -0.1, 1.1, undefined])(
    'waits on malformed model confidence %s',
    (confidence) => {
      expect(nonceDecision('PASS', confidence as number).outcome).toBe('WAIT');
      expect(nonceDecision('FAIL', confidence as number).outcome).toBe('WAIT');
    },
  );
  it('rejects provenance relabelling and missing provenance', () => {
    for (const source of ['RULE', 'UNKNOWN', undefined]) {
      expect(
        decide(
          'construction.stage@1',
          passing().map((c) =>
            c.code === 'nonce'
              ? ({
                  ...c,
                  source,
                  status: 'FAIL',
                  namedField: 'nonce',
                } as CheckResult)
              : c,
          ),
        ).outcome,
      ).toBe('WAIT');
    }
    expect(
      decide(
        'construction.stage@1',
        passing().map((c) => (c.code === 'location' ? ({ ...c, source: 'MODEL', confidence: 1 } as CheckResult) : c)),
      ).outcome,
    ).toBe('WAIT');
  });
  it('does not accept confidence on rules or low-confidence stage passes', () => {
    expect(
      decide(
        'construction.stage@1',
        passing().map((c) => (c.code === 'location' ? ({ ...c, confidence: 1 } as CheckResult) : c)),
      ).outcome,
    ).toBe('WAIT');
    expect(
      decide(
        'construction.stage@1',
        passing().map((c) => (c.code === 'classifier_label' ? ({ ...c, confidence: 0.749 } as CheckResult) : c)),
      ).outcome,
    ).toBe('WAIT');
    expect(
      decide(
        'construction.stage@1',
        passing().map((c) => (c.code === 'classifier_label' ? ({ ...c, confidence: 0.75 } as CheckResult) : c)),
      ).outcome,
    ).toBe('RELEASE');
    expect(
      decide(
        'construction.stage@1',
        passing().map((c) =>
          c.code === 'classifier_label' ? ({ ...c, status: 'FAIL', namedField: 'stage' } as CheckResult) : c,
        ),
      ).outcome,
    ).toBe('WAIT');
  });
});

describe('Structured evidence details (T-0127)', () => {
  it('preserves a nested detail snapshot in tranche decision history', () => {
    const detail = { distance_m: 1400 };
    const tranche = new Tranche('trn_snapshot', new Money(100n, 'GBP'), 'construction.stage@1', 0);
    tranche.dispatch('auth_snapshot', new Nonce('K7Q'), 0, 1000);
    tranche.startDeciding();
    const decision = decide('construction.stage@1', [
      { code: 'location', source: 'RULE', status: 'FAIL', reason: 'wrong_plot', namedField: 'plot', detail },
    ]);
    tranche.beginSettlement({ ...decision, detail }, 'dec_snapshot', 1);
    detail.distance_m = 50;
    expect(tranche.decisions[0]?.decision.detail).toEqual({ distance_m: 1400 });
    expect(Object.isFrozen(tranche.decisions[0]?.decision.detail)).toBe(true);
  });
  it('records distance from the pin for wrong-plot evidence', () => {
    const center = new GeoPoint(5.6037, -0.187);
    const point = new GeoPoint(5.6163, -0.187);
    const result = checkLocation(new Geofence(center, 75), [{ lat: point.lat, lng: point.lng, accuracyM: 8 }]);
    expect(result).toMatchObject({ source: 'RULE', detail: { distance_m: center.distanceTo(point) } });
  });
  it('copies and freezes the selected failure detail', () => {
    const detail = { distance_m: 1400 };
    const decision = decide('construction.stage@1', [
      { code: 'location', source: 'RULE', status: 'FAIL', reason: 'wrong_plot', namedField: 'plot', detail },
    ]);
    detail.distance_m = 20;
    expect(decision.detail).toEqual({ distance_m: 1400 });
    expect(Object.isFrozen(decision.detail)).toBe(true);
    const match = decide('construction.stage@1', [
      {
        code: 'novelty',
        source: 'RULE',
        status: 'FAIL',
        reason: 'reused_evidence',
        namedField: 'reused',
        detail: { matched_package_id: 'pkg_prior' },
      },
    ]);
    expect(match.detail).toEqual({ matched_package_id: 'pkg_prior' });
  });
  it('waits on invalid details and missing required refusal detail', () => {
    for (const detail of [
      { distance_m: -1 },
      { distance_m: Number.NaN },
      { distance_m: '1400' },
      { matched_package_id: '' },
      { matched_package_id: 42 },
      [],
      {},
      null,
      { extra: 1 },
    ]) {
      expect(
        decide('construction.stage@1', [
          {
            code: 'location',
            source: 'RULE',
            status: 'FAIL',
            reason: 'wrong_plot',
            namedField: 'plot',
            detail,
          } as CheckResult,
        ]).outcome,
      ).toBe('WAIT');
    }
    expect(
      decide('construction.stage@1', [
        { code: 'location', source: 'RULE', status: 'FAIL', reason: 'wrong_plot', namedField: 'plot' },
      ]).outcome,
    ).toBe('WAIT');
    expect(
      decide('construction.stage@1', [
        { code: 'novelty', source: 'RULE', status: 'FAIL', reason: 'reused_evidence', namedField: 'reused' },
      ]).outcome,
    ).toBe('WAIT');
  });
});
