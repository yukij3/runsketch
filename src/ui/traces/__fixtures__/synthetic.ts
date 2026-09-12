// Synthetic SimulationResult for traces tests: no engine dependency, fully deterministic.
import type { HrZone } from '../../../lib/sim';
import type { SimulationResult } from '../../../lib/types';

export interface SyntheticOptions {
  seconds?: number;
  /** [start, endExclusive) seconds of a standing stop; null for none. */
  stop?: readonly [number, number] | null;
  /** No climb or descent at all. */
  flat?: boolean;
}

export const CLIMB_START = 200;
export const CLIMB_END = 380;
export const DESCENT_END = 480;

/**
 * Run: flat 3.2 m/s, then an 8 % climb at 2.4 m/s (200–379 s), a −6 % descent at 3.6 m/s (380–479 s),
 * flat again with a 20 s stop at 520 s. Demand steps with the terrain; HR follows it through
 * first-order kinetics (τ 30 s rising, 45 s falling), plus ±0.8 bpm ripple.
 */
export function syntheticResult({ seconds = 600, stop = [520, 540], flat = false }: SyntheticOptions = {}): SimulationResult {
  const n = seconds;
  const t = new Float64Array(n);
  const lat = new Float64Array(n);
  const lon = new Float64Array(n);
  const ele = new Float64Array(n);
  const dist = new Float64Array(n);
  const speed = new Float64Array(n);
  const hr = new Float64Array(n);
  const hrDemand = new Float64Array(n);
  const cadence = new Float64Array(n);
  const power = new Float64Array(n);
  const grade = new Float64Array(n);
  const moving = new Uint8Array(n);

  let d = 0;
  let z = 100;
  let h = 95;
  for (let i = 0; i < n; i++) {
    const phase = flat ? 'flat' : i >= CLIMB_START && i < CLIMB_END ? 'climb' : i >= CLIMB_END && i < DESCENT_END ? 'descent' : 'flat';
    const stopped = stop !== null && i >= stop[0] && i < stop[1];
    const g = phase === 'climb' ? 0.08 : phase === 'descent' ? -0.06 : 0;
    const base = phase === 'climb' ? 2.4 : phase === 'descent' ? 3.6 : 3.2;
    const v = stopped ? 0 : base + 0.12 * Math.sin(i * 1.7) + 0.05 * Math.sin(i * 0.31);
    const demand = stopped ? 110 : phase === 'climb' ? 172 : phase === 'descent' ? 138 : 146;
    if (i > 0) h += (demand - h) / (demand > h ? 30 : 45);

    t[i] = i;
    dist[i] = d;
    ele[i] = z;
    speed[i] = v;
    grade[i] = stopped ? 0 : g;
    hr[i] = h + 0.8 * Math.sin(i * 2.3);
    hrDemand[i] = demand;
    cadence[i] = stopped ? 0 : phase === 'climb' ? 164 : 172;
    power[i] = stopped ? 0 : 250;
    moving[i] = stopped ? 0 : 1;
    lat[i] = 52.5 + d / 111_320;
    lon[i] = 13.35;
    d += v;
    z += v * g;
  }

  let movingCount = 0;
  let hrSum = 0;
  let hrMax = 0;
  let cadSum = 0;
  let ascent = 0;
  let descent = 0;
  let maxSpeed = 0;
  for (let i = 0; i < n; i++) {
    hrSum += hr[i];
    hrMax = Math.max(hrMax, hr[i]);
    maxSpeed = Math.max(maxSpeed, speed[i]);
    if (moving[i]) {
      movingCount++;
      cadSum += cadence[i];
    }
    if (i > 0) {
      const dz = ele[i] - ele[i - 1];
      if (dz > 0) ascent += dz;
      else descent -= dz;
    }
  }
  const distance = n > 0 ? dist[n - 1] : 0;

  return {
    streams: { t, lat, lon, ele, dist, speed, hr, hrDemand, cadence, power, grade, moving },
    summary: {
      distance,
      elapsed: Math.max(0, n - 1),
      moving: movingCount,
      avgSpeed: movingCount > 0 ? distance / movingCount : 0,
      maxSpeed,
      avgHr: n > 0 ? hrSum / n : 0,
      maxHr: hrMax,
      avgCadence: movingCount > 0 ? cadSum / movingCount : 0,
      avgPower: 250,
      ascent,
      descent,
      calories: 0,
      laps: [],
    },
    warnings: [],
  };
}

/** Karvonen zones for rest 55 / max 185, as the engine's hrZones() would produce. */
export const TEST_ZONES: HrZone[] = [
  { id: 1, name: 'Recovery', min: 120, max: 133 },
  { id: 2, name: 'Endurance', min: 133, max: 146 },
  { id: 3, name: 'Tempo', min: 146, max: 159 },
  { id: 4, name: 'Threshold', min: 159, max: 172 },
  { id: 5, name: 'VO2max', min: 172, max: 185 },
];
