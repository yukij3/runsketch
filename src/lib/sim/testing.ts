// Measurement helpers shared by the engine's tests and by anyone reviewing traces (no test framework here).
import type { ActivityStreams, SimulationResult } from '../types';
import { DEG, M_PER_DEG } from './track';

/** Mean of a[lo, hi) clipped to the array. NaN when the range is empty. */
export function meanRange(a: ArrayLike<number>, lo: number, hi: number): number {
  let sum = 0;
  let count = 0;
  for (let i = Math.max(0, lo); i < Math.min(a.length, hi); i++) {
    sum += a[i];
    count++;
  }
  return count > 0 ? sum / count : NaN;
}

/** First sample whose distance reaches d (last sample if never). */
export function indexAtDistance(s: ActivityStreams, d: number): number {
  for (let i = 0; i < s.dist.length; i++) if (s.dist[i] >= d) return i;
  return s.dist.length - 1;
}

/** Centred moving average with an odd window. */
export function movingAverage(a: ArrayLike<number>, window: number): Float64Array {
  const half = Math.floor(window / 2);
  const out = new Float64Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = meanRange(a, i - half, i + half + 1);
  return out;
}

/** Event-aligned ensemble mean of one stream: out[k] ↔ offset k − before seconds from each event. */
export function ensembleAround(
  results: ReadonlyArray<SimulationResult>,
  key: Exclude<keyof ActivityStreams, 'moving'>,
  eventIndex: (r: SimulationResult) => number,
  before: number,
  after: number,
): Float64Array {
  const out = new Float64Array(before + after);
  for (const r of results) {
    const stream = r.streams[key];
    const i0 = eventIndex(r);
    for (let k = 0; k < before + after; k++) {
      const i = Math.min(stream.length - 1, Math.max(0, i0 - before + k));
      out[k] += stream[i] / results.length;
    }
  }
  return out;
}

/** Names of streams containing NaN or ±Infinity. */
export function nonFiniteStreams(r: SimulationResult): string[] {
  return Object.entries(r.streams)
    .filter(([, arr]) => {
      const a = arr as ArrayLike<number>;
      for (let i = 0; i < a.length; i++) if (!Number.isFinite(a[i])) return true;
      return false;
    })
    .map(([name]) => name);
}

/** Per-second planar displacement of the recorded positions, metres (jumps[0] = 0). */
export function positionJumps(s: ActivityStreams): Float64Array {
  const out = new Float64Array(s.lat.length);
  for (let i = 1; i < s.lat.length; i++) {
    const dy = (s.lat[i] - s.lat[i - 1]) * M_PER_DEG;
    const dx = (s.lon[i] - s.lon[i - 1]) * M_PER_DEG * Math.cos(s.lat[i] * DEG);
    out[i] = Math.hypot(dx, dy);
  }
  return out;
}

/** First k ≥ from where predicate(a[k]) holds, or −1. */
export function firstIndex(a: ArrayLike<number>, from: number, predicate: (x: number) => boolean): number {
  for (let k = Math.max(0, from); k < a.length; k++) if (predicate(a[k])) return k;
  return -1;
}
