// Where the shared playhead rests when nobody is scrubbing: the crest of the largest climb, so the
// first view already shows demand falling while heart rate is still catching up. Flat routes rest at
// peak heart rate instead. One cached answer per result, shared by the traces strip and the map.
import type { SimulationResult } from '../../lib/types';
import { gradeBands } from './series';

export type RestKind = 'crest' | 'peak';

export interface RestPoint {
  index: number;
  kind: RestKind;
}

/** Seconds after a climb band ends that still count toward its crest (the band closes a little early). */
const CREST_SEARCH_S = 30;
/** A "climb" smaller than this (metres) is noise; the route is treated as flat. */
const MIN_CLIMB_M = 3;

const cache = new WeakMap<SimulationResult, RestPoint | null>();

function argmax(values: ArrayLike<number>, i0: number, i1: number): number {
  let best = -1;
  let bestV = -Infinity;
  for (let i = i0; i <= i1; i++) {
    const v = values[i];
    if (Number.isFinite(v) && v > bestV) {
      bestV = v;
      best = i;
    }
  }
  return best;
}

export function findRestPoint(result: SimulationResult): RestPoint | null {
  const s = result.streams;
  const n = s.t.length;
  if (n === 0) return null;

  let crest = -1;
  let bestGain = MIN_CLIMB_M;
  for (const band of gradeBands(s.grade)) {
    if (band.kind !== 'up') continue;
    const top = argmax(s.ele, band.i0, Math.min(n - 1, band.i1 + CREST_SEARCH_S));
    if (top < 0) continue;
    let low = Infinity;
    for (let i = band.i0; i <= top; i++) if (Number.isFinite(s.ele[i]) && s.ele[i] < low) low = s.ele[i];
    const gain = s.ele[top] - low;
    if (gain > bestGain) {
      bestGain = gain;
      crest = top;
    }
  }
  if (crest >= 0) return { index: crest, kind: 'crest' };

  const peak = argmax(s.hr, 0, n - 1);
  return { index: peak >= 0 ? peak : 0, kind: 'peak' };
}

export function restPoint(result: SimulationResult | null | undefined): RestPoint | null {
  if (!result) return null;
  if (!cache.has(result)) cache.set(result, findRestPoint(result));
  return cache.get(result) ?? null;
}
