import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { Geofence, GeoPoint } from './geofence.js';

describe('Geofence (FR-30)', () => {
  it.each([
    [91, 0],
    [-91, 0],
    [0, 181],
    [0, -181],
    [Number.NaN, 0],
    [0, Number.POSITIVE_INFINITY],
  ])('rejects invalid point %s,%s', (lat, lng) => {
    expect(() => new GeoPoint(lat, lng)).toThrow();
  });
  it('accepts boundary coordinates and freezes points', () => {
    expect(new GeoPoint(90, 180).lat).toBe(90);
    expect(new GeoPoint(-90, -180).lng).toBe(-180);
    expect(Object.isFrozen(new GeoPoint(0, 0))).toBe(true);
  });
  it.each([24, 501, Number.NaN, Number.POSITIVE_INFINITY])('rejects radius %s', (radius) => {
    expect(() => new Geofence(new GeoPoint(0, 0), radius)).toThrow();
  });
  it('includes the center and excludes the wrong plot', () => {
    const center = new GeoPoint(5.6037, -0.187);
    const fence = new Geofence(center, 75);
    expect(fence.contains(center, 0)).toBe(true);
    expect(fence.contains(new GeoPoint(5.6163, -0.187), 8)).toBe(false);
    expect(Object.isFrozen(fence)).toBe(true);
  });
  it('caps the accuracy allowance at 50 metres', () => {
    const center = new GeoPoint(0, 0);
    const roughly100m = new GeoPoint(0.0009, 0);
    const fence = new Geofence(center, 75);
    expect(fence.contains(roughly100m, 0)).toBe(false);
    expect(fence.contains(roughly100m, 30)).toBe(true);
    expect(fence.contains(new GeoPoint(0.002, 0), 10000)).toBe(false);
  });
  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY])('rejects accuracy %s', (accuracy) => {
    expect(() => new Geofence(new GeoPoint(0, 0), 25).contains(new GeoPoint(0, 0), accuracy)).toThrow();
  });
  it('has finite, symmetric, nonnegative distance, including poles and antipodes', () => {
    const point = fc.tuple(
      fc.double({ min: -90, max: 90, noNaN: true }),
      fc.double({ min: -180, max: 180, noNaN: true }),
    );
    fc.assert(
      fc.property(point, point, ([aLat, aLng], [bLat, bLng]) => {
        const a = new GeoPoint(aLat, aLng);
        const b = new GeoPoint(bLat, bLng);
        expect(a.distanceTo(b)).toBeGreaterThanOrEqual(0);
        expect(Number.isFinite(a.distanceTo(b))).toBe(true);
        expect(a.distanceTo(b)).toBeCloseTo(b.distanceTo(a), 7);
        expect(a.distanceTo(a)).toBe(0);
      }),
    );
    expect(new GeoPoint(0, 0).distanceTo(new GeoPoint(0, 180))).toBeCloseTo(Math.PI * 6371000, 3);
  });
});
