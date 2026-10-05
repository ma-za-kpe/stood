const radians = (degrees: number): number => (degrees * Math.PI) / 180;

export class GeoPoint {
  constructor(
    readonly lat: number,
    readonly lng: number,
  ) {
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      throw new RangeError('Invalid coordinates');
    }
    Object.freeze(this);
  }

  distanceTo(other: GeoPoint): number {
    const latDelta = radians(other.lat - this.lat);
    const lngDelta = radians(other.lng - this.lng);
    const a =
      Math.sin(latDelta / 2) ** 2 +
      Math.cos(radians(this.lat)) * Math.cos(radians(other.lat)) * Math.sin(lngDelta / 2) ** 2;
    return 2 * 6371000 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, a))));
  }
}

export class Geofence {
  constructor(
    readonly center: GeoPoint,
    readonly radiusM: number,
  ) {
    if (!Number.isFinite(radiusM) || radiusM < 25 || radiusM > 500)
      throw new RangeError('Radius must be 25–500 metres');
    Object.freeze(this);
  }

  contains(point: GeoPoint, accuracyM: number): boolean {
    if (!Number.isFinite(accuracyM) || accuracyM < 0) throw new RangeError('Invalid GPS accuracy');
    return this.center.distanceTo(point) <= this.radiusM + Math.min(accuracyM, 50);
  }
}
