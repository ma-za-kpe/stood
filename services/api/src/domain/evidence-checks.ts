import type { CheckResult } from './decision.js';
import { type Geofence, GeoPoint } from './geofence.js';

export function checkRequiredItems(
  required: readonly string[],
  received: readonly string[],
  completed: boolean,
): CheckResult {
  if (!completed) return { code: 'required_items', status: 'UNCERTAIN', reason: 'upload_incomplete' };
  if (
    !required.length ||
    required.some((item) => !item.trim()) ||
    received.some((item) => !item.trim()) ||
    new Set(required).size !== required.length ||
    new Set(received).size !== received.length
  ) {
    return { code: 'required_items', status: 'UNCERTAIN', reason: 'ambiguous_required_items' };
  }
  const missing = required.find((item) => !received.includes(item));
  if (missing)
    return {
      code: 'required_items',
      status: 'FAIL',
      namedField: `missing:${missing}`,
      reason: 'missing_required_item',
    };
  return { code: 'required_items', status: 'PASS', reason: 'required_items_present' };
}

type LocationReading = Readonly<{ lat: number; lng: number; accuracyM: number }>;

export function checkLocation(fence: Geofence, readings: readonly (LocationReading | null)[]): CheckResult {
  const uncertain: CheckResult = { code: 'location', status: 'UNCERTAIN', reason: 'location_needs_review' };
  if (!readings.length || readings.some((r) => r === null)) return uncertain;
  let poorAccuracy = 0;
  const outside: boolean[] = [];
  try {
    for (const value of readings) {
      const reading = value as LocationReading;
      if (reading.accuracyM > 100) poorAccuracy++;
      outside.push(!fence.contains(new GeoPoint(reading.lat, reading.lng), reading.accuracyM));
    }
  } catch {
    return uncertain;
  }
  if (poorAccuracy > readings.length / 2) return uncertain;
  if (outside.some(Boolean)) return { code: 'location', status: 'FAIL', namedField: 'plot', reason: 'wrong_plot' };
  return { code: 'location', status: 'PASS', reason: 'within_location' };
}

export class PhotoFingerprint {
  constructor(readonly bits: bigint) {
    if (bits < 0n || bits >= 1n << 64n) throw new RangeError('Fingerprint must be 64 bits');
    Object.freeze(this);
  }

  distance(other: PhotoFingerprint): number {
    let difference = this.bits ^ other.bits;
    let count = 0;
    while (difference) {
      difference &= difference - 1n;
      count++;
    }
    return count;
  }
}
