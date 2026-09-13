import type { ActivityType, LngLat, ProfilePoint, TerrainProfile, WaySpan } from '../types';
import type { ElevationSampler } from '../services/elevation';
import { ASCENT_THRESHOLD_M, ascentDescent, cumulativeDistances, haversine, resampleLine } from '../geo';
import { validWays } from '../route/ways';
import { wayTraits, type WayTraits } from './surface';

export { ascentDescent } from '../geo';
export { STEEP, WAY_TAG_RULES, wayTraits, type WayTagRule, type WayTraits } from './surface';

export interface TerrainOptions {
  spacing?: number; // default 5 m
  activity?: ActivityType;
  signal?: AbortSignal;
  /** Way tags along `route` (see joinLegs): surface, technicality, bridges and tunnels, plausible grades. */
  ways?: WaySpan[];
}

export const DEFAULT_SPACING_M = 5;
/** ~25 m at 5 m spacing: removes single-pixel artefacts (buildings in DSM-like data, water edges, voids). */
export const DESPIKE_WINDOW = 5;
export const GRADE_BASELINE_M = 40;
export const ASCENT_HYSTERESIS_M = ASCENT_THRESHOLD_M;

/*
 * Surface models (Copernicus GLO-30 behind the coarser tiles) contain tree canopy and roofs. At 30 m pixels their edges
 * become steps of 5–20 m over one or two pixels, and the valley under an untagged bridge does the same downwards. On
 * the profile such a patch is a short grade excursion away from the terrain's own slope that comes back within a few
 * hundred metres, which roads and paths do not do. The constants below bound what counts as one.
 */
/** Longest edge of a patch: two 30 m pixels. */
export const PATCH_EDGE_MAX_M = 60;
/** Smallest step that opens a patch, metres. */
export const PATCH_MIN_STEP_M = ASCENT_THRESHOLD_M;
/** Widest patch removed: tree stands and building blocks along a street, gullies under short bridges. */
export const PATCH_MAX_WIDTH_M = 350;
/** A patch closes once its level is back within this many metres, or this share of its height, of where it opened. */
export const PATCH_CLOSE_M = 2.5;
export const PATCH_CLOSE_SHARE = 0.35;
/** Half-width of the running median of grade that stands for the terrain's own slope; wide enough that edges are a minority. */
export const TREND_HALF_WIDTH_M = 75;
/** A patch edge departs from that median by more than this share of the way's plausible grade… */
export const EDGE_GRADE_SHARE = 0.6;
/**
 * …taking the plausible grade as at most this when spotting edges. Steep ways (steps, alpine paths, scree) have no grade
 * clamp, but canopy and roofs stand beside them too; their real relief keeps its ascent because a patch must come back
 * to the level it opened at, which a climb, however steep or zigzagging, does not.
 */
export const EDGE_PLAUSIBLE_CAP = 0.3;
/** …and extends over neighbouring intervals that depart by more than this share of that, for up to EDGE_EXTEND_M either side. */
export const EDGE_WEAK_SHARE = 0.3;
export const EDGE_EXTEND_M = 30;
/** Metres within which a profile point without tags (a joint between legs) takes its nearest tagged neighbour's. */
export const TAG_FILL_M = 10;

/** Narrower kernel for Mapterhorn's lidar-grade tiles, wider for 30–90 m DEMs. */
export function smoothingSigma(source: TerrainProfile['elevationSource']): number {
  return source === 'mapterhorn' ? 15 : 25;
}

/**
 * The steepest grade any profile carries, and the limit the engine applies. ±45 % on foot: the range over which Minetti
 * et al. (2002) measured the energy cost of walking and running. ±35 % on a bike: the steepest paved streets (Baldwin
 * Street, Ffordd Pen Llech) are about that steep, and mountain bikes ride short ramps of it.
 */
export function gradeLimit(activity: ActivityType): number {
  return activity === 'ride' ? 0.35 : 0.45;
}

/** Plausible grade where no way tags are known: road-like, or path-like on a hike or ascent. Used to spot DEM patches, never to clamp. */
export function untaggedGradeLimit(activity: ActivityType): number {
  return activity === 'hike' || activity === 'alpine' ? 0.45 : 0.25;
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

/** Running median over index windows of ±half, truncated at the ends (a sorted window, O(n·half)). */
function runningMedian(values: Float64Array, half: number): Float64Array {
  const n = values.length;
  const out = new Float64Array(n);
  const win = new Float64Array(2 * half + 1);
  let size = 0;
  const lowerBound = (v: number) => {
    let lo = 0;
    let hi = size;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (win[mid] < v) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  let added = 0;
  for (let i = 0; i < n; i++) {
    const drop = i - half - 1;
    if (drop >= 0) {
      const at = lowerBound(values[drop]);
      win.copyWithin(at, at + 1, size);
      size--;
    }
    for (const last = Math.min(n - 1, i + half); added <= last; added++) {
      const at = lowerBound(values[added]);
      win.copyWithin(at + 1, at, size);
      win[at] = values[added];
      size++;
    }
    out[i] = size % 2 ? win[size >> 1] : (win[size / 2 - 1] + win[size / 2]) / 2;
  }
  return out;
}

/**
 * Removes raised and sunken DEM patches (canopy, roofs, the gully under an untagged bridge) while leaving real relief.
 * The terrain's own slope is the running median of grade over ±TREND_HALF_WIDTH_M: it follows ramps of any length and
 * steepness but ignores short excursions. An edge is a run of at most PATCH_EDGE_MAX_M whose grade departs from that
 * median by more than `edgeGrade` (per point, the smaller of an interval's two ends), plus up to EDGE_EXTEND_M either
 * side that departs by more than EDGE_WEAK_SHARE of it. An edge of at least
 * PATCH_MIN_STEP_M opens a patch, which closes when the summed edge steps come back to its opening level within
 * PATCH_MAX_WIDTH_M; the patch's edge steps are then subtracted, so whatever the ground does underneath survives.
 * A closing edge that overshoots is split, and its remainder may open the next patch.
 */
export function removeDemPatches(ele: ArrayLike<number>, d: ArrayLike<number>, edgeGrade: number | ArrayLike<number>): Float64Array {
  const n = ele.length;
  const out = Float64Array.from(ele);
  if (n < 3 || !(d[n - 1] > d[0])) return out;
  const m = n - 1;
  const len = new Float64Array(m);
  const grade = new Float64Array(m);
  for (let i = 0; i < m; i++) {
    len[i] = d[i + 1] - d[i];
    grade[i] = len[i] > 0 ? (ele[i + 1] - ele[i]) / len[i] : 0;
  }
  const trend = runningMedian(grade, Math.max(1, Math.round(TREND_HALF_WIDTH_M / ((d[n - 1] - d[0]) / m))));
  const threshold = (i: number) => (typeof edgeGrade === 'number' ? edgeGrade : Math.min(edgeGrade[i], edgeGrade[i + 1]));

  // step[i]: rise of interval i beyond the local slope, on edges only; runEnd[i]: last interval of i's edge.
  const step = new Float64Array(m);
  const runEnd = new Int32Array(m).fill(-1);
  const residual = (k: number) => grade[k] - trend[k];
  let free = 0;
  for (let i = 0; i < m; ) {
    const r = residual(i);
    if (!(Math.abs(r) > threshold(i))) {
      i++;
      continue;
    }
    const sign = Math.sign(r);
    let a = i;
    let b = i;
    let core = 0;
    while (b < m && sign * residual(b) > threshold(b)) core += len[b++];
    if (core > PATCH_EDGE_MAX_M) {
      i = free = b;
      continue;
    }
    // A pixel straddling the patch boundary splits the edge into a steep and a gentler part: take the gentler part too.
    for (let ext = 0; a > free && sign * residual(a - 1) > EDGE_WEAK_SHARE * threshold(a - 1) && ext + len[a - 1] <= EDGE_EXTEND_M; ) ext += len[--a];
    for (let ext = 0; b < m && sign * residual(b) > EDGE_WEAK_SHARE * threshold(b) && ext + len[b] <= EDGE_EXTEND_M; ) ext += len[b++];
    for (let k = a; k < b; k++) {
      step[k] = residual(k) * len[k];
      runEnd[k] = b - 1;
    }
    i = free = b;
  }

  const removed = new Float64Array(m);
  for (let i = 0; i < m; ) {
    if (runEnd[i] < 0) {
      i++;
      continue;
    }
    const openEnd = runEnd[i];
    let level = 0;
    for (let k = i; k <= openEnd; k++) level += step[k];
    if (Math.abs(level) < PATCH_MIN_STEP_M) {
      i = openEnd + 1;
      continue;
    }
    const sign = Math.sign(level);
    let peak = sign * level;
    let close = -1;
    let split = false;
    for (let k = openEnd + 1; k < m && d[k + 1] - d[i] <= PATCH_MAX_WIDTH_M; k++) {
      if (runEnd[k] < 0) continue;
      const tolerance = Math.max(PATCH_CLOSE_M, PATCH_CLOSE_SHARE * peak);
      const next = level + step[k];
      if (sign * next < -tolerance) {
        close = k;
        split = true;
        break;
      }
      level = next;
      peak = Math.max(peak, sign * level);
      if (runEnd[k] === k && Math.abs(level) <= tolerance) {
        close = k;
        break;
      }
    }
    if (close < 0) {
      i = openEnd + 1;
    } else if (split) {
      // Remove exactly back to the opening level; the rest of the closing edge stays and is looked at again.
      for (let k = i; k < close; k++) removed[k] += step[k];
      removed[close] -= level;
      step[close] += level;
      i = close;
    } else {
      // The small residual level is spread over the patch so the far side keeps its elevation.
      const span = d[close + 1] - d[i];
      for (let k = i; k <= close; k++) removed[k] += step[k] - (level * len[k]) / span;
      i = close + 1;
    }
  }

  for (let i = 0; i < m; i++) out[i + 1] = out[i] + (ele[i + 1] - ele[i]) - removed[i];
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

/** Rise over run across a centred baseline (one-sided within baseline/2 of either end), clamped to ±limit (a number, or one per point). */
export function centredGrade(ele: ArrayLike<number>, d: ArrayLike<number>, baseline: number, limit: number | ArrayLike<number> = Infinity): Float64Array {
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
    const lim = typeof limit === 'number' ? limit : limit[i];
    out[i] = Math.max(-lim, Math.min(lim, g));
  }
  return out;
}

/** Elevation with bridge and tunnel points blanked, so gap filling carries the way straight across from the structure's ends. */
function acrossStructures(rawEle: ArrayLike<number>, ways: ReadonlyArray<WayTraits | undefined>): ArrayLike<number> {
  let ground = false;
  for (let i = 0; i < rawEle.length && !ground; i++) ground = !ways[i]?.structure && Number.isFinite(rawEle[i]);
  return ground ? Float64Array.from(rawEle, (v, i) => (ways[i]?.structure ? NaN : v)) : rawEle;
}

/**
 * Way traits at each resampled distance `d` along `route`: those of the span holding the segment the point lies on (a
 * point on a vertex takes the segment after it). Points without tags take the nearest tagged point's within TAG_FILL_M.
 * Null when the spans do not describe `route`.
 */
export function traitsAlong(route: LngLat[], ways: readonly WaySpan[], d: ArrayLike<number>): Array<WayTraits | undefined> | null {
  if (route.length < 2 || !validWays(ways, route.length)) return null;
  const cum = cumulativeDistances(route);
  const spanTraits = ways.map((w) => wayTraits(w.tags));
  const n = d.length;
  const out = new Array<WayTraits | undefined>(n);
  let seg = 0;
  let span = 0;
  for (let k = 0; k < n; k++) {
    while (seg < route.length - 2 && cum[seg + 1] <= d[k]) seg++;
    while (span < ways.length - 1 && ways[span].end <= seg) span++;
    out[k] = spanTraits[span];
  }
  const nearest = new Int32Array(n).fill(-1);
  for (let k = 0, last = -1; k < n; k++) {
    if (out[k]) last = k;
    else if (last >= 0 && d[k] - d[last] <= TAG_FILL_M) nearest[k] = last;
  }
  for (let k = n - 1, next = -1; k >= 0; k--) {
    if (out[k]) next = k;
    else if (next >= 0 && d[next] - d[k] <= TAG_FILL_M && (nearest[k] < 0 || d[next] - d[k] < d[k] - d[nearest[k]])) nearest[k] = next;
  }
  for (let k = 0; k < n; k++) if (!out[k] && nearest[k] >= 0) out[k] = out[nearest[k]];
  return out;
}

/**
 * Pure: resampled coords + raw DEM samples → smoothed profile with grade and ascent. NaNs are interpolated.
 * `distances` (e.g. from resampleLine) overrides the even-spacing assumption; `ways` (see traitsAlong) adds surfaces,
 * bridges and tunnels, and per-way grade limits.
 */
export function computeProfile(
  coords: LngLat[],
  rawEle: ArrayLike<number>,
  spacing: number,
  activity: ActivityType,
  source: TerrainProfile['elevationSource'],
  distances?: ArrayLike<number>,
  ways?: ReadonlyArray<WayTraits | undefined>,
): TerrainProfile {
  const n = coords.length;
  if (rawEle.length !== n) throw new Error(`computeProfile: ${rawEle.length} elevations for ${n} coordinates`);
  if (distances && distances.length !== n) throw new Error(`computeProfile: ${distances.length} distances for ${n} coordinates`);
  if (ways && ways.length !== n) throw new Error(`computeProfile: ${ways.length} way traits for ${n} coordinates`);
  if (n === 0) {
    return { points: [], spacing, totalDistance: 0, ascent: 0, descent: 0, minEle: 0, maxEle: 0, elevationSource: 'none', gradeClampedM: 0 };
  }

  const d = distances ? Float64Array.from(distances) : evenDistances(coords, spacing);
  const filled = fillGaps(ways ? acrossStructures(rawEle, ways) : rawEle, d);
  const elevationSource = filled ? source : 'none';

  const hardLimit = gradeLimit(activity);
  const untagged = untaggedGradeLimit(activity);
  const edgeGrade = new Float64Array(n);
  const limit = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const plausible = ways?.[i]?.gradeLimit;
    edgeGrade[i] = EDGE_GRADE_SHARE * Math.min(plausible ?? untagged, EDGE_PLAUSIBLE_CAP);
    limit[i] = Math.min(hardLimit, plausible ?? Infinity);
  }

  const ele = filled
    ? gaussianSmooth(removeDemPatches(medianFilter(filled, DESPIKE_WINDOW), d, edgeGrade), d, smoothingSigma(elevationSource))
    : new Float64Array(n);
  const steepest = centredGrade(ele, d, GRADE_BASELINE_M);
  const { ascent, descent } = ascentDescent(ele, ASCENT_HYSTERESIS_M);

  let minEle = Infinity;
  let maxEle = -Infinity;
  let gradeClampedM = 0;
  const points: ProfilePoint[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const e = ele[i];
    if (e < minEle) minEle = e;
    if (e > maxEle) maxEle = e;
    let grade = steepest[i];
    if (Math.abs(grade) > limit[i]) {
      grade = Math.sign(grade) * limit[i];
      gradeClampedM += (d[Math.min(n - 1, i + 1)] - d[Math.max(0, i - 1)]) / 2;
    }
    const point: ProfilePoint = { d: d[i], lon: coords[i][0], lat: coords[i][1], ele: e, grade };
    const traits = ways?.[i];
    if (traits) {
      if (traits.surface) point.surface = traits.surface;
      point.technicality = traits.technicality;
    }
    points[i] = point;
  }
  return { points, spacing, totalDistance: d[n - 1], ascent, descent, minEle, maxEle, elevationSource, gradeClampedM };
}

/** Resample route, sample DEM, compute profile. */
export async function buildTerrainProfile(route: LngLat[], sampler: ElevationSampler, opts?: TerrainOptions): Promise<TerrainProfile> {
  const spacing = opts?.spacing ?? DEFAULT_SPACING_M;
  const activity = opts?.activity ?? 'run';
  const { coords, d } = resampleLine(route, spacing);
  if (coords.length === 0) return computeProfile([], [], spacing, activity, 'none');
  const ways = opts?.ways ? traitsAlong(route, opts.ways, d) : null;
  const { ele, source } = await sampler(coords, opts?.signal);
  return computeProfile(coords, ele, spacing, activity, source, d, ways ?? undefined);
}
