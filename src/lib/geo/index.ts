// Geodesy helpers. Coordinates are [lon, lat].
import type { LngLat } from '../types';

/** IUGG mean Earth radius, metres. */
export const EARTH_RADIUS_M = 6371008.8;

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

/** Great-circle distance in metres. */
export function haversine(a: LngLat, b: LngLat): number {
  const dLat = (b[1] - a[1]) * RAD;
  const dLon = (b[0] - a[0]) * RAD;
  const s =
    Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * RAD) * Math.cos(b[1] * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Initial bearing a→b in degrees [0, 360). */
export function bearing(a: LngLat, b: LngLat): number {
  const φ1 = a[1] * RAD;
  const φ2 = b[1] * RAD;
  const dλ = (b[0] - a[0]) * RAD;
  const y = Math.sin(dλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(dλ);
  const deg = Math.atan2(y, x) * DEG;
  return (deg + 360) % 360;
}

/** Cumulative distances (metres), same length as coords, starting at 0. */
export function cumulativeDistances(coords: LngLat[]): number[] {
  const out = new Array<number>(coords.length);
  let acc = 0;
  for (let i = 0; i < coords.length; i++) {
    if (i > 0) acc += haversine(coords[i - 1], coords[i]);
    out[i] = acc;
  }
  return out;
}

export function polylineLength(coords: LngLat[]): number {
  let acc = 0;
  for (let i = 1; i < coords.length; i++) acc += haversine(coords[i - 1], coords[i]);
  return acc;
}

/** Largest index i with cum[i] <= d (clamped to [0, n-2] so i+1 exists when n >= 2). */
function segmentIndex(cum: number[], d: number): number {
  let lo = 0;
  let hi = cum.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= d) lo = mid;
    else hi = mid;
  }
  return lo;
}

function lerpPoint(a: LngLat, b: LngLat, t: number): LngLat {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

/**
 * Point at distance d along a line with precomputed cumulative distances.
 * d is clamped to [0, total]. Linear interpolation in lon/lat is accurate to
 * centimetres for the segment lengths routers return.
 */
export function interpolateAlong(coords: LngLat[], cum: number[], d: number): LngLat {
  const n = coords.length;
  if (n === 0) throw new Error('interpolateAlong: empty line');
  if (n === 1 || d <= 0) return [coords[0][0], coords[0][1]];
  const total = cum[n - 1];
  if (d >= total) return [coords[n - 1][0], coords[n - 1][1]];
  const i = segmentIndex(cum, d);
  const len = cum[i + 1] - cum[i];
  const t = len > 0 ? (d - cum[i]) / len : 0;
  return lerpPoint(coords[i], coords[i + 1], t);
}

/** Resample at a fixed spacing (last point always included). */
export function resampleLine(coords: LngLat[], spacing: number): { coords: LngLat[]; d: number[] } {
  if (!(spacing > 0)) throw new Error('resampleLine: spacing must be > 0');
  if (coords.length === 0) return { coords: [], d: [] };
  const cum = cumulativeDistances(coords);
  const total = cum[cum.length - 1];
  const first: LngLat = [coords[0][0], coords[0][1]];
  if (total === 0) return { coords: [first], d: [0] };

  // Tolerance so a total that is an exact multiple of spacing (up to float error) does not add a sliver.
  const eps = Math.max(1e-6, spacing * 1e-9);
  const steps = Math.floor(total / spacing + 1e-9);
  const outCoords: LngLat[] = [];
  const outD: number[] = [];
  let seg = 0;
  for (let k = 0; k <= steps; k++) {
    const d = Math.min(k * spacing, total);
    while (seg < cum.length - 2 && cum[seg + 1] <= d) seg++;
    const len = cum[seg + 1] - cum[seg];
    const t = len > 0 ? Math.min(1, Math.max(0, (d - cum[seg]) / len)) : 0;
    outCoords.push(lerpPoint(coords[seg], coords[seg + 1], t));
    outD.push(d);
  }
  if (total - outD[outD.length - 1] > eps) {
    const last = coords[coords.length - 1];
    outCoords.push([last[0], last[1]]);
    outD.push(total);
  } else {
    const last = coords[coords.length - 1];
    outCoords[outCoords.length - 1] = [last[0], last[1]];
    outD[outD.length - 1] = total;
  }
  return { coords: outCoords, d: outD };
}

/** Move a point by metres east/north (local tangent plane; fine below ~100 km). */
export function offsetMeters(p: LngLat, east: number, north: number): LngLat {
  const lat = p[1] + (north / EARTH_RADIUS_M) * DEG;
  const midLat = ((p[1] + lat) / 2) * RAD;
  const lon = p[0] + (east / (EARTH_RADIUS_M * Math.cos(midLat))) * DEG;
  return [lon, lat];
}

/** [minLon, minLat, maxLon, maxLat]. Empty input yields [Infinity, Infinity, -Infinity, -Infinity]. Antimeridian is not handled. */
export function bbox(coords: LngLat[]): [minLon: number, minLat: number, maxLon: number, maxLat: number] {
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;
  for (const [lon, lat] of coords) {
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  return [minLon, minLat, maxLon, maxLat];
}

// Round half away from zero, as the reference implementation does (Math.round rounds -0.5 up).
function roundHalfAway(v: number): number {
  return Math.sign(v) * Math.floor(Math.abs(v) + 0.5);
}

function encodeSigned(value: number): string {
  let v = value < 0 ? ~(value << 1) : value << 1;
  let out = '';
  while (v >= 0x20) {
    out += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
    v >>>= 5;
  }
  return out + String.fromCharCode(v + 63);
}

/**
 * Google encoded polyline (https://developers.google.com/maps/documentation/utilities/polylinealgorithm).
 * The wire format is lat,lng; our coords are [lon, lat].
 */
export function encodePolyline(coords: LngLat[], precision = 5): string {
  const factor = 10 ** precision;
  let prevLat = 0;
  let prevLon = 0;
  let out = '';
  for (const [lon, lat] of coords) {
    const iLat = roundHalfAway(lat * factor);
    const iLon = roundHalfAway(lon * factor);
    out += encodeSigned(iLat - prevLat) + encodeSigned(iLon - prevLon);
    prevLat = iLat;
    prevLon = iLon;
  }
  return out;
}

export function decodePolyline(str: string, precision = 5): LngLat[] {
  const factor = 10 ** precision;
  const out: LngLat[] = [];
  let index = 0;
  let lat = 0;
  let lon = 0;
  const next = (): number => {
    let result = 0;
    let shift = 0;
    let byte: number;
    do {
      if (index >= str.length) throw new Error('decodePolyline: truncated input');
      byte = str.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  while (index < str.length) {
    lat += next();
    lon += next();
    out.push([lon / factor, lat / factor]);
  }
  return out;
}
