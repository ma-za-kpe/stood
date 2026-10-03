import { describe, expect, it } from 'vitest';
import { checkLocation, checkRequiredItems, PhotoFingerprint } from './evidence-checks.js';
import { Geofence, GeoPoint } from './geofence.js';

describe('Deterministic evidence checks (FR-30–32)', () => {
  it('waits for an incomplete upload and refuses a completed missing item', () => {
    expect(checkRequiredItems(['overview'], [], false).status).toBe('UNCERTAIN');
    expect(checkRequiredItems(['overview'], [], true)).toMatchObject({
      status: 'FAIL',
      namedField: 'missing:overview',
    });
    expect(checkRequiredItems(['overview'], ['overview'], true).status).toBe('PASS');
  });
  it('does not accept empty or ambiguous item requirements', () => {
    expect(checkRequiredItems([], [], true).status).toBe('UNCERTAIN');
    expect(checkRequiredItems([''], [], true).status).toBe('UNCERTAIN');
    expect(checkRequiredItems([' '], [], true).status).toBe('UNCERTAIN');
    expect(checkRequiredItems(['overview'], [''], true).status).toBe('UNCERTAIN');
    expect(checkRequiredItems(['overview', 'overview'], ['overview'], true).status).toBe('UNCERTAIN');
    expect(checkRequiredItems(['overview'], ['overview', 'overview'], true).status).toBe('UNCERTAIN');
  });
  it('passes fresh positions on the synthetic plot and refuses the wrong plot', () => {
    const fence = new Geofence(new GeoPoint(5.6037, -0.187), 75);
    expect(checkLocation(fence, [{ lat: 5.60371, lng: -0.187, accuracyM: 8 }]).status).toBe('PASS');
    expect(checkLocation(fence, [{ lat: 5.6163, lng: -0.187, accuracyM: 8 }])).toMatchObject({
      status: 'FAIL',
      namedField: 'plot',
    });
  });
  it('waits on absent coordinates, bad accuracy and poor-quality GPS', () => {
    const fence = new Geofence(new GeoPoint(0, 0), 75);
    for (const readings of [
      [],
      [null],
      [{ lat: 91, lng: 0, accuracyM: 0 }],
      [{ lat: 0, lng: 0, accuracyM: -1 }],
      [{ lat: 0, lng: 0, accuracyM: Number.NaN }],
      [{ lat: 0, lng: 0, accuracyM: 101 }],
    ]) {
      expect(checkLocation(fence, readings).status).toBe('UNCERTAIN');
    }
    expect(
      checkLocation(fence, [
        { lat: 0, lng: 0, accuracyM: 101 },
        { lat: 0, lng: 0, accuracyM: 8 },
      ]).status,
    ).toBe('PASS');
  });
  it('compares all 64 bits of a perceptual fingerprint', () => {
    expect(new PhotoFingerprint(0n).distance(new PhotoFingerprint(0n))).toBe(0);
    expect(new PhotoFingerprint(0n).distance(new PhotoFingerprint(0xffffffffffffffffn))).toBe(64);
    expect(new PhotoFingerprint(0b1010n).distance(new PhotoFingerprint(0b0101n))).toBe(4);
    expect(Object.isFrozen(new PhotoFingerprint(0n))).toBe(true);
  });
  it.each([-1n, 1n << 64n])('rejects invalid fingerprint %s', (bits) => {
    expect(() => new PhotoFingerprint(bits)).toThrow();
  });
});
