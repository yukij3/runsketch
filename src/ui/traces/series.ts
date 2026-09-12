// Width-independent derived series for the traces: display-unit channels, robust y domains,
// grade bands, stops, and the runs where heart-rate response lags demand.
import { FEET_PER_METER, METERS_PER_MILE } from '../../lib/format';
import type { ActivityStreams, ActivityType, SimulationResult, Units } from '../../lib/types';

/** Inclusive index range. */
export interface IndexRun {
  i0: number;
  i1: number;
}

export interface GradeBand extends IndexRun {
  kind: 'up' | 'down';
}

export interface Domain {
  lo: number;
  hi: number;
}

export type SpeedKind = 'pace' | 'speed';

export interface Averages {
  elapsed: number;
  distance: number;
  /** m/s, moving. */
  speed: number;
  hr: number;
  demand: number;
  cadence: number;
  /** Metres. */
  ascent: number;
  /** Metres, recorded elevation. */
  eleMin: number;
  eleMax: number;
}

export interface TraceModel {
  streams: ActivityStreams;
  n: number;
  kind: SpeedKind;
  cadenceUnit: 'spm' | 'rpm';
  units: Units;
  totalTime: number;
  totalDistance: number;
  /** m/s; 15 s centred mean over moving samples; NaN (pace) or 0 (speed) while stopped. */
  smoothSpeed: Float64Array;
  /** Elevation in display units (m or ft). */
  ele: Float64Array;
  eleDomain: Domain;
  gradeBands: GradeBand[];
  /** Pace in s per km/mi, or speed in km/h / mph. NaN = gap. */
  speedRaw: Float64Array;
  speedSmooth: Float64Array;
  /** For pace, lo is the fastest value and is drawn at the top. */
  speedDomain: Domain;
  hrDomain: Domain;
  lagRuns: IndexRun[];
  /** NaN while stopped (and for foot sports whenever cadence is 0). */
  cadence: Float64Array;
  cadenceDomain: Domain;
  stops: IndexRun[];
  averages: Averages;
}

export const SMOOTH_WINDOW_S = 15;
/** Response and demand closer than this (bpm, after light smoothing) are "in step". */
export const LAG_THRESHOLD_BPM = 5;
const LAG_SMOOTH_S = 9;
const LAG_MIN_S = 12;
const LAG_MERGE_S = 5;
const GRADE_ENTER = 0.03;
const GRADE_EXIT = 0.015;
const GRADE_MIN_S = 20;
/** Slower than this is standing, not a pace worth plotting (s/km). */
const SLOWEST_PACE_S_PER_KM = 30 * 60;

export function isFootSport(activity: ActivityType): boolean {
  return activity !== 'ride';
}

/** Centred mean over `window` samples, counting only finite samples where mask ≠ 0. NaN when none qualify. */
export function maskedMean(values: ArrayLike<number>, mask: ArrayLike<number> | null, window: number): Float64Array {
  const n = values.length;
  const half = Math.floor(Math.max(1, window) / 2);
  const sum = new Float64Array(n + 1);
  const count = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) {
    const ok = (mask === null || mask[i] !== 0) && Number.isFinite(values[i]);
    sum[i + 1] = sum[i] + (ok ? values[i] : 0);
    count[i + 1] = count[i] + (ok ? 1 : 0);
  }
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const lo = Math.max(0, i - half);
    const hi = Math.min(n, i + half + 1);
    const c = count[hi] - count[lo];
    out[i] = c > 0 ? (sum[hi] - sum[lo]) / c : Number.NaN;
  }
  return out;
}

/** Maximal runs where test(i) holds; runs separated by ≤ mergeGap samples merge; shorter than minLen dropped. */
export function runsWhere(n: number, test: (i: number) => boolean, minLen = 1, mergeGap = 0): IndexRun[] {
  const raw: IndexRun[] = [];
  let start = -1;
  for (let i = 0; i < n; i++) {
    if (test(i)) {
      if (start < 0) start = i;
    } else if (start >= 0) {
      raw.push({ i0: start, i1: i - 1 });
      start = -1;
    }
  }
  if (start >= 0) raw.push({ i0: start, i1: n - 1 });

  const merged: IndexRun[] = [];
  for (const run of raw) {
    const prev = merged[merged.length - 1];
    if (prev && run.i0 - prev.i1 - 1 <= mergeGap) prev.i1 = run.i1;
    else merged.push({ ...run });
  }
  return merged.filter((r) => r.i1 - r.i0 + 1 >= minLen);
}

/** Climb and descent bands with hysteresis so a grade hovering near the threshold does not flicker. */
export function gradeBands(
  grade: ArrayLike<number>,
  enter = GRADE_ENTER,
  exit = GRADE_EXIT,
  minLen = GRADE_MIN_S,
): GradeBand[] {
  const out: GradeBand[] = [];
  let kind: GradeBand['kind'] | null = null;
  let start = 0;
  const close = (end: number) => {
    if (kind !== null && end - start + 1 >= minLen) out.push({ kind, i0: start, i1: end });
    kind = null;
  };
  for (let i = 0; i < grade.length; i++) {
    const g = grade[i];
    if (!Number.isFinite(g)) {
      close(i - 1);
      continue;
    }
    if ((kind === 'up' && g < exit) || (kind === 'down' && g > -exit)) close(i - 1);
    if (kind === null) {
      if (g >= enter) {
        kind = 'up';
        start = i;
      } else if (g <= -enter) {
        kind = 'down';
        start = i;
      }
    }
  }
  close(grade.length - 1);
  return out;
}

export function stopRuns(moving: ArrayLike<number>): IndexRun[] {
  return runsWhere(moving.length, (i) => moving[i] === 0);
}

/** Where the (lightly smoothed) response sits away from the demand: the kinetic lag after load changes. */
export function lagRuns(hr: ArrayLike<number>, demand: ArrayLike<number>, threshold = LAG_THRESHOLD_BPM): IndexRun[] {
  const n = Math.min(hr.length, demand.length);
  const hrS = maskedMean(hr, null, LAG_SMOOTH_S);
  const demandS = maskedMean(demand, null, LAG_SMOOTH_S);
  return runsWhere(n, (i) => Math.abs(demandS[i] - hrS[i]) >= threshold, LAG_MIN_S, LAG_MERGE_S);
}

export function sortedFinite(values: ArrayLike<number>, keep?: (i: number) => boolean): Float64Array {
  const buf: number[] = [];
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (Number.isFinite(v) && (!keep || keep(i))) buf.push(v);
  }
  return Float64Array.from(buf).sort();
}

/** Linear-interpolated quantile of an ascending array; NaN when empty. */
export function quantile(sorted: ArrayLike<number>, q: number): number {
  const n = sorted.length;
  if (n === 0) return Number.NaN;
  const pos = Math.min(n - 1, Math.max(0, q * (n - 1)));
  const lo = Math.floor(pos);
  const hi = Math.min(n - 1, lo + 1);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

function mean(values: ArrayLike<number>, keep?: (i: number) => boolean): number {
  let sum = 0;
  let count = 0;
  for (let i = 0; i < values.length; i++) {
    if (Number.isFinite(values[i]) && (!keep || keep(i))) {
      sum += values[i];
      count++;
    }
  }
  return count > 0 ? sum / count : Number.NaN;
}

const finiteOr = (v: number, fallback: number) => (Number.isFinite(v) ? v : fallback);

/** Expand [lo, hi] to at least `minSpan` around its centre, then snap outward to `step`. */
export function snapDomain(lo: number, hi: number, minSpan: number, step: number): Domain {
  let a = lo;
  let b = hi;
  if (b - a < minSpan) {
    const mid = (a + b) / 2;
    a = mid - minSpan / 2;
    b = mid + minSpan / 2;
  }
  return { lo: Math.floor(a / step) * step, hi: Math.ceil(b / step) * step };
}

function elevationDomain(ele: Float64Array, units: Units): Domain {
  const sorted = sortedFinite(ele);
  if (sorted.length === 0) return { lo: 0, hi: 1 };
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  // A flat route with ±0.5 m altimeter noise must still look flat.
  const minSpan = units === 'metric' ? 20 : 60;
  const span = Math.max(max - min, minSpan);
  const extra = span - (max - min);
  const pad = span * 0.1;
  return { lo: min - extra / 2 - pad, hi: max + extra / 2 + pad };
}

function speedDomain(kind: SpeedKind, raw: Float64Array, smooth: Float64Array): Domain {
  if (kind === 'pace') {
    const sorted = sortedFinite(smooth);
    if (sorted.length === 0) return { lo: 240, hi: 480 };
    const lo = quantile(sorted, 0.01);
    const hi = quantile(sorted, 0.99);
    const pad = Math.max(hi - lo, 60) * 0.12;
    return snapDomain(lo - pad, hi + pad, 60, 15);
  }
  const top = Math.max(quantile(sortedFinite(raw), 0.995), quantile(sortedFinite(smooth), 1));
  if (!(top > 0)) return { lo: 0, hi: 10 };
  return { lo: 0, hi: Math.ceil((top * 1.08) / 5) * 5 };
}

/**
 * The on-transient from resting HR at the start (the first lag run, when it begins at t≈0 and is short
 * relative to the activity) is left out of the domain: it may run off the panel floor so the working
 * range, where lag after climbs lives, gets the vertical resolution.
 */
export function startTransientEnd(runs: readonly IndexRun[], n: number): number {
  const first = runs[0];
  return first && first.i0 <= 5 && first.i1 + 1 < n * 0.25 ? first.i1 + 1 : 0;
}

function hrDomainOf(hr: ArrayLike<number>, demand: ArrayLike<number>, from: number): Domain {
  const keep = (i: number) => i >= from;
  const a = sortedFinite(hr, keep);
  const b = sortedFinite(demand, keep);
  if (a.length + b.length === 0) return { lo: 60, hi: 180 };
  const lo = Math.min(finiteOr(quantile(a, 0.01), Infinity), finiteOr(quantile(b, 0.01), Infinity));
  const hi = Math.max(finiteOr(quantile(a, 0.998), -Infinity), finiteOr(quantile(b, 0.998), -Infinity));
  return snapDomain(lo - 5, hi + 5, 30, 10);
}

function cadenceDomainOf(foot: boolean, cadence: Float64Array): Domain {
  const sorted = sortedFinite(cadence);
  if (sorted.length === 0) return foot ? { lo: 140, hi: 190 } : { lo: 0, hi: 110 };
  if (!foot) return { lo: 0, hi: Math.max(60, Math.ceil((quantile(sorted, 0.99) + 8) / 10) * 10) };
  return snapDomain(quantile(sorted, 0.02) - 6, quantile(sorted, 0.98) + 6, 20, 10);
}

export function buildTraceModel(result: SimulationResult, activity: ActivityType, units: Units): TraceModel {
  const s = result.streams;
  const n = s.t.length;
  const foot = isFootSport(activity);
  const kind: SpeedKind = foot ? 'pace' : 'speed';
  const moving = s.moving;

  const smoothMoving = maskedMean(s.speed, moving, SMOOTH_WINDOW_S);
  const smoothSpeed = new Float64Array(n);
  for (let i = 0; i < n; i++) smoothSpeed[i] = moving[i] !== 0 ? smoothMoving[i] : foot ? Number.NaN : 0;

  const perUnit = units === 'metric' ? 1000 : METERS_PER_MILE;
  const slowest = (SLOWEST_PACE_S_PER_KM * perUnit) / 1000;
  const speedFactor = units === 'metric' ? 3.6 : 3600 / METERS_PER_MILE;
  const toDisplay = (mps: number, isMoving: boolean): number => {
    if (kind === 'speed') return Number.isFinite(mps) ? Math.max(0, mps) * speedFactor : Number.NaN;
    if (!isMoving || !(mps > 0)) return Number.NaN;
    const pace = perUnit / mps;
    return pace <= slowest ? pace : Number.NaN;
  };
  const speedRaw = new Float64Array(n);
  const speedSmooth = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    speedRaw[i] = toDisplay(s.speed[i], moving[i] !== 0);
    speedSmooth[i] = toDisplay(smoothSpeed[i], moving[i] !== 0);
  }

  const eleFactor = units === 'metric' ? 1 : FEET_PER_METER;
  const ele = new Float64Array(n);
  for (let i = 0; i < n; i++) ele[i] = s.ele[i] * eleFactor;

  const cadence = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const c = s.cadence[i];
    cadence[i] = moving[i] !== 0 && Number.isFinite(c) && (!foot || c > 0) ? c : Number.NaN;
  }

  const lag = lagRuns(s.hr, s.hrDemand);
  const eleSorted = sortedFinite(s.ele);
  const summary = result.summary;
  const isMoving = (i: number) => moving[i] !== 0;
  const averages: Averages = {
    elapsed: n > 0 ? s.t[n - 1] : 0,
    distance: n > 0 ? s.dist[n - 1] : 0,
    speed: summary.avgSpeed > 0 ? summary.avgSpeed : mean(s.speed, isMoving),
    hr: summary.avgHr > 0 ? summary.avgHr : mean(s.hr),
    demand: mean(s.hrDemand),
    cadence: summary.avgCadence > 0 ? summary.avgCadence : mean(cadence),
    ascent: finiteOr(summary.ascent, Number.NaN),
    eleMin: eleSorted.length ? eleSorted[0] : Number.NaN,
    eleMax: eleSorted.length ? eleSorted[eleSorted.length - 1] : Number.NaN,
  };

  return {
    streams: s,
    n,
    kind,
    cadenceUnit: foot ? 'spm' : 'rpm',
    units,
    totalTime: averages.elapsed,
    totalDistance: finiteOr(averages.distance, 0),
    smoothSpeed,
    ele,
    eleDomain: elevationDomain(ele, units),
    gradeBands: gradeBands(s.grade),
    speedRaw,
    speedSmooth,
    speedDomain: speedDomain(kind, speedRaw, speedSmooth),
    hrDomain: hrDomainOf(s.hr, s.hrDemand, startTransientEnd(lag, n)),
    lagRuns: lag,
    cadence,
    cadenceDomain: cadenceDomainOf(foot, cadence),
    stops: stopRuns(moving),
    averages,
  };
}
