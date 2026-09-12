// Route geometry in the distance domain: sanitised profile arrays, interpolation and corner speed caps.
import type { TerrainProfile } from '../types';

export const EARTH_RADIUS = 6371008.8;
export const DEG = Math.PI / 180;
/** Metres per degree of latitude. */
export const M_PER_DEG = EARTH_RADIUS * DEG;

export interface Track {
  n: number;
  d: Float64Array;
  lon: Float64Array;
  lat: Float64Array;
  ele: Float64Array;
  grade: Float64Array;
  total: number;
}

const finite = (x: number): boolean => typeof x === 'number' && Number.isFinite(x);

/** Drops invalid points, forces strictly increasing distance from 0, fills missing elevation, clamps grade. */
export function buildTrack(profile: TerrainProfile, gradeLimit: number): Track {
  const pts = Array.isArray(profile?.points) ? profile.points : [];
  const keep: number[] = [];
  let lastD = -Infinity;
  for (let k = 0; k < pts.length; k++) {
    const p = pts[k];
    if (!p || !finite(p.d) || !finite(p.lon) || !finite(p.lat)) continue;
    if (keep.length > 0 && p.d <= lastD + 1e-6) continue;
    keep.push(k);
    lastD = p.d;
  }
  const n = keep.length;
  const d = new Float64Array(n);
  const lon = new Float64Array(n);
  const lat = new Float64Array(n);
  const ele = new Float64Array(n);
  const grade = new Float64Array(n);
  const d0 = n > 0 ? pts[keep[0]].d : 0;
  for (let q = 0; q < n; q++) {
    const p = pts[keep[q]];
    d[q] = p.d - d0;
    lon[q] = p.lon;
    lat[q] = p.lat;
    ele[q] = finite(p.ele) ? p.ele : NaN;
    grade[q] = finite(p.grade) ? Math.max(-gradeLimit, Math.min(gradeLimit, p.grade)) : NaN;
  }
  fillGaps(ele, d, 0);
  fillGaps(grade, d, 0);
  return { n, d, lon, lat, ele, grade, total: n > 0 ? d[n - 1] : 0 };
}

/** Linear interpolation over NaN runs; constant extension at the ends; `fallback` when all NaN. */
function fillGaps(a: Float64Array, d: Float64Array, fallback: number): void {
  const n = a.length;
  let prev = -1;
  for (let i = 0; i < n; i++) {
    if (Number.isNaN(a[i])) continue;
    if (prev === -1) {
      for (let k = 0; k < i; k++) a[k] = a[i];
    } else if (i - prev > 1) {
      const span = d[i] - d[prev];
      for (let k = prev + 1; k < i; k++) a[k] = a[prev] + ((a[i] - a[prev]) * (d[k] - d[prev])) / span;
    }
    prev = i;
  }
  if (prev === -1) a.fill(fallback);
  else for (let k = prev + 1; k < n; k++) a[k] = a[prev];
}

/**
 * Forward-only cursor for monotonic distance queries. After `seek(s)`, `j` is the segment index and
 * `f` the fraction within it; `lerp(arr)` interpolates any per-point array.
 */
export class Cursor {
  j = 0;
  f = 0;
  constructor(private readonly t: Track) {}

  seek(s: number): void {
    const { d, n } = this.t;
    if (n < 2) {
      this.j = 0;
      this.f = 0;
      return;
    }
    let j = this.j;
    if (s < d[j]) j = 0;
    while (j < n - 2 && d[j + 1] <= s) j++;
    this.j = j;
    const seg = d[j + 1] - d[j];
    const f = seg > 0 ? (s - d[j]) / seg : 0;
    this.f = f < 0 ? 0 : f > 1 ? 1 : f;
  }

  lerp(arr: Float64Array): number {
    if (this.t.n < 2) return arr.length > 0 ? arr[0] : 0;
    const a = arr[this.j];
    return a + (arr[this.j + 1] - a) * this.f;
  }
}

/** Per-point speed multiplier array from a grade function. */
export function mapGrade(t: Track, fn: (g: number) => number): Float64Array {
  const out = new Float64Array(t.n);
  for (let i = 0; i < t.n; i++) out[i] = fn(t.grade[i]);
  return out;
}

const MAX_CAP = 100;

/**
 * Corner speed caps v ≤ √(a_lat·R) with R from the heading change over ±5 m (three points on a circle:
 * R = ℓ / (2·sin(Δθ/2))), then a backward pass so braking (aDec) starts before the corner and, when
 * aAcc > 0, a forward pass limiting acceleration out of it.
 */
export function cornerCaps(t: Track, aLat: number, aDec: number, aAcc: number, vMax: number): Float64Array {
  const { n, d, lon, lat } = t;
  const cap = new Float64Array(n).fill(Math.min(vMax, MAX_CAP));
  if (n < 3) return cap;
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  const lon0 = lon[0];
  const lat0 = lat[0];
  for (let i = 0; i < n; i++) {
    x[i] = (lon[i] - lon0) * M_PER_DEG * Math.cos(lat[i] * DEG);
    y[i] = (lat[i] - lat0) * M_PER_DEG;
  }
  const spacing = d[n - 1] / (n - 1);
  const m = Math.max(1, Math.round(5 / Math.max(spacing, 0.1)));
  for (let i = m; i < n - m; i++) {
    const ax = x[i] - x[i - m];
    const ay = y[i] - y[i - m];
    const bx = x[i + m] - x[i];
    const by = y[i + m] - y[i];
    const la = Math.hypot(ax, ay);
    const lb = Math.hypot(bx, by);
    if (la < 1e-3 || lb < 1e-3) continue;
    const cos = Math.max(-1, Math.min(1, (ax * bx + ay * by) / (la * lb)));
    const turn = Math.acos(cos);
    if (turn < 1e-4) continue;
    const radius = (0.5 * (la + lb)) / (2 * Math.sin(turn / 2));
    const c = Math.sqrt(aLat * radius);
    if (c < cap[i]) cap[i] = c;
  }
  for (let i = n - 2; i >= 0; i--) {
    const lim = Math.sqrt(cap[i + 1] * cap[i + 1] + 2 * aDec * (d[i + 1] - d[i]));
    if (lim < cap[i]) cap[i] = lim;
  }
  if (aAcc > 0) {
    for (let i = 1; i < n; i++) {
      const lim = Math.sqrt(cap[i - 1] * cap[i - 1] + 2 * aAcc * (d[i] - d[i - 1]));
      if (lim < cap[i]) cap[i] = lim;
    }
  }
  return cap;
}
