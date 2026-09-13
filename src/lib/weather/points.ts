// Where and when weather is requested for a route: a few sample points along the profile and a whole-day time window.
import type { ProfilePoint, TerrainProfile, WeatherPoint } from '../types';

/** Weather is requested for at most this many route points (each counts as one call against the provider's budget). */
export const MAX_SAMPLE_POINTS = 12;
/** Spacing of the regular points: L/10, between 2 and 20 km. */
export const SAMPLE_SPACING = { share: 0.1, min: 2000, max: 20000 } as const;
/** An extra point (summit, lowest point, turnaround) is skipped when a point already lies this close along the route and in height. */
export const EXTRA_POINT_NEAR = { alongM: 1000, heightM: 100 } as const;
/** A route whose ends are closer than this is a loop: its finish shares the start's weather. */
export const LOOP_ENDS_M = 1000;
/** Surface states need this much weather before the start (wet ground and snow remember a day or two). */
export const SPIN_UP_S = 48 * 3600;

const DAY_S = 86400;
const EARTH_RADIUS_M = 6371008.8;
const RAD = Math.PI / 180;

const finite = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const round2 = (x: number): number => Math.round(x * 100) / 100;
const round10 = (x: number): number => Math.round(x / 10) * 10;

function haversine(aLon: number, aLat: number, bLon: number, bLat: number): number {
  const dLat = (bLat - aLat) * RAD;
  const dLon = (bLon - aLon) * RAD;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * RAD) * Math.cos(bLat * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(s)));
}

interface Candidate {
  d: number;
  lon: number;
  lat: number;
  ele: number;
  /** Regular points are thinned first; endpoints and extras stay. */
  regular: boolean;
}

/** Position and elevation at distance d, linear between the profile points around it. */
function at(points: ProfilePoint[], d: number): Candidate {
  let lo = 0;
  let hi = points.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (points[mid].d <= d) lo = mid;
    else hi = mid;
  }
  const a = points[lo];
  const b = points[hi];
  const f = b.d > a.d ? Math.min(1, Math.max(0, (d - a.d) / (b.d - a.d))) : 0;
  const ele = (p: ProfilePoint) => (finite(p.ele) ? p.ele : 0);
  return { d, lon: a.lon + (b.lon - a.lon) * f, lat: a.lat + (b.lat - a.lat) * f, ele: ele(a) + (ele(b) - ele(a)) * f, regular: true };
}

/** Points at the start, every `spacing` metres and at the finish (not for loops). */
function regularPoints(points: ProfilePoint[], d0: number, length: number, spacing: number, loop: boolean): Candidate[] {
  const out: Candidate[] = [{ ...at(points, d0), regular: false }];
  for (let k = 1; k * spacing < length - 0.25 * spacing; k++) out.push(at(points, d0 + k * spacing));
  if (!loop && length > 0) out.push({ ...at(points, d0 + length), regular: false });
  return out;
}

/**
 * Sample points along the profile: the start and the finish (only the start for a loop whose ends are under 1 km
 * apart), every clamp(L/10, 2 km, 20 km), plus the highest point, the lowest point and the point farthest from the start
 * when no point lies within 1 km along the route and 100 m in height. At most 12, thinning the regular points first.
 * Longitude and latitude are rounded to 0.01° (about 1 km) and elevation to 10 m, so small route edits keep the same
 * request; d stays the exact profile distance. Sorted by d; a point that rounds onto an earlier one is dropped.
 */
export function weatherSamplePoints(profile: TerrainProfile, opts: { maxPoints?: number } = {}): WeatherPoint[] {
  const max = Math.max(2, Math.floor(opts.maxPoints ?? MAX_SAMPLE_POINTS));
  const pts: ProfilePoint[] = [];
  for (const p of Array.isArray(profile?.points) ? profile.points : []) {
    if (p && finite(p.d) && finite(p.lon) && finite(p.lat) && (pts.length === 0 || p.d >= pts[pts.length - 1].d)) pts.push(p);
  }
  if (pts.length === 0) return [];
  const first = pts[0];
  const last = pts[pts.length - 1];
  const d0 = first.d;
  const length = Math.max(0, last.d - d0);
  const loop = length === 0 || haversine(first.lon, first.lat, last.lon, last.lat) < LOOP_ENDS_M;

  const extras: Candidate[] = [];
  let high = first;
  let low = first;
  let far = first;
  let farDistance = -1;
  for (const p of pts) {
    if (finite(p.ele) && (!finite(high.ele) || p.ele > high.ele)) high = p;
    if (finite(p.ele) && (!finite(low.ele) || p.ele < low.ele)) low = p;
    const r = haversine(first.lon, first.lat, p.lon, p.lat);
    if (r > farDistance) {
      farDistance = r;
      far = p;
    }
  }
  for (const p of [high, low, far]) extras.push({ d: p.d, lon: p.lon, lat: p.lat, ele: finite(p.ele) ? p.ele : 0, regular: false });

  let spacing = Math.min(SAMPLE_SPACING.max, Math.max(SAMPLE_SPACING.min, length * SAMPLE_SPACING.share));
  let chosen: Candidate[] = [];
  for (let attempt = 0; attempt < 40; attempt++) {
    chosen = regularPoints(pts, d0, length, spacing, loop);
    for (const e of extras) {
      const near = chosen.some((c) => Math.abs(c.d - e.d) < EXTRA_POINT_NEAR.alongM && Math.abs(c.ele - e.ele) < EXTRA_POINT_NEAR.heightM);
      if (!near) chosen.push(e);
    }
    if (chosen.length <= max || !chosen.some((c) => c.regular)) break;
    spacing *= 1.25;
  }
  // Endpoints and extras alone can still exceed a very small limit: keep the earliest.
  chosen.sort((a, b) => a.d - b.d);

  const out: WeatherPoint[] = [];
  const seen = new Set<string>();
  for (const c of chosen) {
    const point: WeatherPoint = { d: c.d, lon: round2(c.lon), lat: round2(c.lat), ele: round10(c.ele) };
    const id = `${point.lon},${point.lat},${point.ele}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(point);
  }
  return out.slice(0, max);
}

/**
 * Epoch-second window a simulation needs: from UTC midnight two days before the start day (spin-up for wet ground
 * and snow) to UTC midnight two days after the day the activity is expected to end (the end day plus one full day).
 * Whole days keep the request unchanged while the start time or the target move within a day.
 */
export function weatherWindow(startTimeMs: number, expectedElapsedS: number): { from: number; to: number } {
  const start = Math.floor((finite(startTimeMs) ? startTimeMs : 0) / 1000);
  const end = start + Math.max(0, finite(expectedElapsedS) ? expectedElapsedS : 0);
  const startDay = Math.floor(start / DAY_S) * DAY_S;
  const endDay = Math.floor(end / DAY_S) * DAY_S;
  return { from: startDay - SPIN_UP_S, to: endDay + 2 * DAY_S };
}
