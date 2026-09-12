// Lap ranges and per-lap aggregates that the contract's Lap does not carry (max speed, power, calories).
import type { ActivitySummary, Lap, SimulationResult } from '../types';
import { clamp } from './common';

export interface ExportLap {
  index: number;
  /** First sample index (inclusive). */
  start: number;
  /** One past the last sample index. */
  end: number;
  distance: number;
  elapsed: number;
  moving: number;
  avgSpeed: number;
  maxSpeed: number;
  avgHr: number;
  maxHr: number;
  /** Stream units: steps/min (foot) or rpm (ride). */
  avgCadence: number;
  maxCadence: number;
  avgPower: number;
  maxPower: number;
  ascent: number;
  descent: number;
  calories: number;
  /** Cadence integrated over the lap: steps (foot) or crank revolutions (ride). */
  cycles: number;
}

function wholeActivityLap(summary: ActivitySummary, n: number): Lap {
  return {
    index: 0,
    startIndex: 0,
    endIndex: n - 1,
    distance: summary.distance,
    elapsed: summary.elapsed,
    moving: summary.moving,
    avgSpeed: summary.avgSpeed,
    avgHr: summary.avgHr,
    maxHr: summary.maxHr,
    avgCadence: summary.avgCadence,
    ascent: summary.ascent,
    descent: summary.descent,
  };
}

const num = (v: number) => (Number.isFinite(v) ? v : 0);

/** Integers proportional to `weights` that sum exactly to `total` (largest remainder). */
export function apportion(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (weights.length === 0) return [];
  if (!(sum > 0)) return weights.map((_, i) => (i === 0 ? total : 0));
  const raw = weights.map((w) => (total * w) / sum);
  const out = raw.map(Math.floor);
  let rest = total - out.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => [r - Math.floor(r), i] as const).sort((a, b) => b[0] - a[0]);
  for (const [, i] of order) {
    if (rest <= 0) break;
    out[i] += 1;
    rest -= 1;
  }
  return out;
}

/**
 * Partitions samples by lap: a lap runs from its startIndex to the next lap's startIndex, so the
 * result covers every sample exactly once whether the simulator's endIndex is inclusive or not.
 */
export function exportLaps(result: SimulationResult): ExportLap[] {
  const { streams: s, summary } = result;
  const n = s.t.length;
  const source = summary.laps.length
    ? [...summary.laps].sort((a, b) => a.startIndex - b.startIndex)
    : [wholeActivityLap(summary, n)];

  const ranges = source
    .map((lap, k) => {
      const start = k === 0 ? 0 : clamp(Math.round(lap.startIndex), 0, n);
      const next = source[k + 1];
      const end = next ? clamp(Math.round(next.startIndex), start, n) : n;
      return { lap, start, end };
    })
    .filter((r) => r.end > r.start);

  const stats = ranges.map(({ start, end }) => {
    let maxSpeed = 0;
    let maxCadence = 0;
    let maxPower = 0;
    let powerSum = 0;
    let movingPowerSum = 0;
    let movingSamples = 0;
    let cycles = 0;
    for (let i = start; i < end; i++) {
      const power = Math.max(0, num(s.power[i]));
      maxSpeed = Math.max(maxSpeed, num(s.speed[i]));
      maxCadence = Math.max(maxCadence, num(s.cadence[i]));
      maxPower = Math.max(maxPower, power);
      powerSum += power;
      if (s.moving[i]) {
        movingPowerSum += power;
        movingSamples += 1;
      }
      // 1 Hz samples: cadence per minute / 60 = cycles in that second.
      cycles += Math.max(0, num(s.cadence[i])) / 60;
    }
    // Over moving samples, like avgSpeed over moving time, so a stop does not dilute the lap average.
    const avgPower = movingSamples > 0 ? movingPowerSum / movingSamples : powerSum / (end - start);
    return { maxSpeed, maxCadence, maxPower, powerSum, cycles, avgPower };
  });

  // Energy tracks mechanical work; fall back to distance, then to sample count.
  const byPower = stats.map((x) => x.powerSum);
  const byDistance = ranges.map((r) => Math.max(0, num(r.lap.distance)));
  const bySamples = ranges.map((r) => r.end - r.start);
  const positive = (w: number[]) => w.reduce((a, b) => a + b, 0) > 0;
  const weights = positive(byPower) ? byPower : positive(byDistance) ? byDistance : bySamples;
  const calories = apportion(Math.max(0, Math.round(num(summary.calories))), weights);

  return ranges.map(({ lap, start, end }, k) => ({
    index: k,
    start,
    end,
    distance: num(lap.distance),
    elapsed: num(lap.elapsed),
    moving: num(lap.moving),
    avgSpeed: num(lap.avgSpeed),
    maxSpeed: stats[k].maxSpeed,
    avgHr: num(lap.avgHr),
    maxHr: num(lap.maxHr),
    avgCadence: num(lap.avgCadence),
    maxCadence: stats[k].maxCadence,
    avgPower: stats[k].avgPower,
    maxPower: stats[k].maxPower,
    ascent: num(lap.ascent),
    descent: num(lap.descent),
    calories: calories[k],
    cycles: stats[k].cycles,
  }));
}

/** Largest value of a stream, ignoring non-finite samples. */
export function streamMax(values: Float64Array): number {
  let max = 0;
  for (let i = 0; i < values.length; i++) if (Number.isFinite(values[i])) max = Math.max(max, values[i]);
  return max;
}

export function streamCycles(cadence: Float64Array): number {
  let sum = 0;
  for (let i = 0; i < cadence.length; i++) if (cadence[i] > 0) sum += cadence[i] / 60;
  return sum;
}
