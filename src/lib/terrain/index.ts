import type { ActivityType, LngLat, ProfilePoint, TerrainProfile } from '../types';
import type { ElevationSampler } from '../services/elevation';
import { haversine, resampleLine } from '../geo';

export interface TerrainOptions {
  spacing?: number; // default 5 m
  activity?: ActivityType;
  signal?: AbortSignal;
}

export const DEFAULT_SPACING_M = 5;
/** ~25 m at 5 m spacing: removes single-pixel artefacts (buildings in DSM-like data, water edges, voids). */
export const DESPIKE_WINDOW = 5;
export const GRADE_BASELINE_M = 40;
export const ASCENT_HYSTERESIS_M = 3;

/** Narrower kernel for Mapterhorn's lidar-grade tiles, wider for 30–90 m DEMs. */
export function smoothingSigma(source: TerrainProfile['elevationSource']): number {
  return source === 'mapterhorn' ? 15 : 25;
}

/** ±45 % on foot (steep trails exist), ±25 % on a bike. */
export function gradeLimit(activity: ActivityType): number {
  return activity === 'ride' ? 0.25 : 0.45;
}

/**
 * Distances for coordinates produced by resampleLine at `spacing`: i·spacing, with the final (shorter)
 * step measured. Used when computeProfile is called without explicit distances.
 */
export function evenDistances(coords: LngLat[], spacing: number): Float64Array {
  const n = coords.length;
  const d = new Float64Array(n);
  for (let i = 1; i < n; i++) d[i] = i * spacing;
  if (n >= 2) d[n - 1] = (n - 2) * spacing + Math.min(spacing, haversine(coords[n - 2], coords[n - 1]));
  return d;
}

/** Linear interpolation of non-finite values by distance; edges take the nearest valid value. Null if nothing is valid. */
export function fillGaps(values: ArrayLike<number>, d: ArrayLike<number>): Float64Array | null {
  const n = values.length;
  const out = new Float64Array(n);
  let prev = -1;
  for (let i = 0; i < n; i++) {
    const v = values[i];
    if (!Number.isFinite(v)) continue;
    out[i] = v;
    if (prev === -1) {
      for (let k = 0; k < i; k++) out[k] = v;
    } else if (i - prev > 1) {
      const d0 = d[prev];
      const span = d[i] - d0;
      const v0 = out[prev];
      for (let k = prev + 1; k < i; k++) out[k] = span > 0 ? v0 + ((v - v0) * (d[k] - d0)) / span : v0;
    }
    prev = i;
  }
  if (prev === -1) return null;
  for (let k = prev + 1; k < n; k++) out[k] = out[prev];
  return out;
}

/** Running median with edge replication. */
export function medianFilter(values: ArrayLike<number>, window = DESPIKE_WINDOW): Float64Array {
  const n = values.length;
  const half = Math.floor(window / 2);
  const out = new Float64Array(n);
  const buf = new Float64Array(2 * half + 1);
  for (let i = 0; i < n; i++) {
    for (let k = -half; k <= half; k++) buf[k + half] = values[Math.min(n - 1, Math.max(0, i + k))];
    buf.sort();
    out[i] = buf[half];
  }
  return out;
}

/**
 * Gaussian kernel smoothing over distance (kernel truncated at 3σ). Each point is a Gaussian-weighted
 * local linear fit: identical to a plain Gaussian mean where the window is symmetric, but without the
 * bias a one-sided window would put on the start and end of a climb.
 */
export function gaussianSmooth(values: ArrayLike<number>, d: ArrayLike<number>, sigma: number): Float64Array {
  const n = values.length;
  const out = Float64Array.from(values);
  if (!(sigma > 0) || n < 3) return out;
  const reach = 3 * sigma;
  const inv2s2 = 1 / (2 * sigma * sigma);
  let lo = 0;
  let hi = 0;
  for (let i = 0; i < n; i++) {
    const di = d[i];
    while (d[lo] < di - reach) lo++;
    while (hi + 1 < n && d[hi + 1] <= di + reach) hi++;
    let s0 = 0;
    let s1 = 0;
    let s2 = 0;
    let t0 = 0;
    let t1 = 0;
    for (let j = lo; j <= hi; j++) {
      const x = d[j] - di;
      const w = Math.exp(-x * x * inv2s2);
      const v = values[j];
      s0 += w;
      s1 += w * x;
      s2 += w * x * x;
      t0 += w * v;
      t1 += w * x * v;
    }
    const det = s0 * s2 - s1 * s1;
    out[i] = det > 1e-12 * s0 * s2 ? (s2 * t0 - s1 * t1) / det : t0 / s0;
  }
  return out;
}

function valueAt(values: ArrayLike<number>, d: ArrayLike<number>, x: number): number {
  const n = values.length;
  if (x <= d[0]) return values[0];
  if (x >= d[n - 1]) return values[n - 1];
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (d[mid] <= x) lo = mid;
    else hi = mid;
  }
  const span = d[hi] - d[lo];
  return span > 0 ? values[lo] + ((values[hi] - values[lo]) * (x - d[lo])) / span : values[lo];
}

/** Rise over run across a centred baseline (one-sided within baseline/2 of either end), clamped to ±limit. */
export function centredGrade(ele: ArrayLike<number>, d: ArrayLike<number>, baseline: number, limit: number): Float64Array {
  const n = ele.length;
  const out = new Float64Array(n);
  if (n < 2) return out;
  const total = d[n - 1];
  if (!(total > 0)) return out;
  const half = baseline / 2;
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, d[i] - half);
    const b = Math.min(total, d[i] + half);
    if (b <= a) continue;
    const g = (valueAt(ele, d, b) - valueAt(ele, d, a)) / (b - a);
    out[i] = Math.max(-limit, Math.min(limit, g));
  }
  return out;
}

/**
 * Total ascent/descent counting only swings of at least `threshold` metres between confirmed turning
 * points, in the spirit of BRouter's "filtered ascend" and barometric watch counters.
 */
export function ascentDescent(ele: ArrayLike<number>, threshold = ASCENT_HYSTERESIS_M): { ascent: number; descent: number } {
  const n = ele.length;
  let ascent = 0;
  let descent = 0;
  if (n < 2) return { ascent, descent };
  let dir = 0;
  let ref = ele[0];
  let ext = ele[0];
  let lo = ele[0];
  let hi = ele[0];
  for (let i = 1; i < n; i++) {
    const v = ele[i];
    if (dir === 0) {
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
      if (v - lo >= threshold) {
        dir = 1;
        ref = lo;
        ext = v;
      } else if (hi - v >= threshold) {
        dir = -1;
        ref = hi;
        ext = v;
      }
    } else if (dir === 1) {
      if (v > ext) ext = v;
      else if (ext - v >= threshold) {
        ascent += ext - ref;
        ref = ext;
        ext = v;
        dir = -1;
      }
    } else {
      if (v < ext) ext = v;
      else if (v - ext >= threshold) {
        descent += ref - ext;
        ref = ext;
        ext = v;
        dir = 1;
      }
    }
  }
  if (dir === 1) ascent += ext - ref;
  else if (dir === -1) descent += ref - ext;
  return { ascent, descent };
}

/**
 * Pure: resampled coords + raw DEM samples → smoothed profile with grade and ascent. NaNs are interpolated.
 * `distances` (e.g. from resampleLine) overrides the even-spacing assumption.
 */
export function computeProfile(
  coords: LngLat[],
  rawEle: ArrayLike<number>,
  spacing: number,
  activity: ActivityType,
  source: TerrainProfile['elevationSource'],
  distances?: ArrayLike<number>,
): TerrainProfile {
  const n = coords.length;
  if (rawEle.length !== n) throw new Error(`computeProfile: ${rawEle.length} elevations for ${n} coordinates`);
  if (distances && distances.length !== n) throw new Error(`computeProfile: ${distances.length} distances for ${n} coordinates`);
  if (n === 0) {
    return { points: [], spacing, totalDistance: 0, ascent: 0, descent: 0, minEle: 0, maxEle: 0, elevationSource: 'none' };
  }

  const d = distances ? Float64Array.from(distances) : evenDistances(coords, spacing);
  const filled = fillGaps(rawEle, d);
  const elevationSource = filled ? source : 'none';
  const ele = filled ? gaussianSmooth(medianFilter(filled, DESPIKE_WINDOW), d, smoothingSigma(elevationSource)) : new Float64Array(n);
  const grade = centredGrade(ele, d, GRADE_BASELINE_M, gradeLimit(activity));
  const { ascent, descent } = ascentDescent(ele, ASCENT_HYSTERESIS_M);

  let minEle = Infinity;
  let maxEle = -Infinity;
  const points: ProfilePoint[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const e = ele[i];
    if (e < minEle) minEle = e;
    if (e > maxEle) maxEle = e;
    points[i] = { d: d[i], lon: coords[i][0], lat: coords[i][1], ele: e, grade: grade[i] };
  }
  return { points, spacing, totalDistance: d[n - 1], ascent, descent, minEle, maxEle, elevationSource };
}

/** Resample route, sample DEM, compute profile. */
export async function buildTerrainProfile(route: LngLat[], sampler: ElevationSampler, opts?: TerrainOptions): Promise<TerrainProfile> {
  const spacing = opts?.spacing ?? DEFAULT_SPACING_M;
  const activity = opts?.activity ?? 'run';
  const { coords, d } = resampleLine(route, spacing);
  if (coords.length === 0) return computeProfile([], [], spacing, activity, 'none');
  const { ele, source } = await sampler(coords, opts?.signal);
  return computeProfile(coords, ele, spacing, activity, source, d);
}
