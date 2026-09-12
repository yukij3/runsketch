// Effort presets: solve the average moving speed that puts this athlete at a chosen share of VO2 reserve on this route.
import type { ActivityType, SimulationInput } from '../types';
import { resolveVo2max, sanitiseAthlete } from './athlete';
import { bikePhysics, bikeSteadyPower, J_PER_ML_O2, VO2_REST, CYCLING_GROSS_EFFICIENCY, vo2NetRun, vo2NetWalk } from './models';
import { measureEffort, type EffortMeasure } from './simulate';

export type EffortPreset = 'easy' | 'steady' | 'tempo' | 'race';
export const EFFORT_PRESETS: readonly EffortPreset[] = ['easy', 'steady', 'tempo', 'race'];

/**
 * Moving-time-weighted mean share of VO2 reserve per preset. Runs and rides use 60/70/80/88 %. Walking cannot reach
 * those shares at walking speeds, so walks and hikes use lower HEURISTIC ladders (a brisk flat walk is ≈35 %).
 */
export const PRESET_GOALS: Readonly<Record<ActivityType, Readonly<Record<EffortPreset, number>>>> = {
  run: { easy: 0.6, steady: 0.7, tempo: 0.8, race: 0.88 },
  ride: { easy: 0.6, steady: 0.7, tempo: 0.8, race: 0.88 },
  walk: { easy: 0.25, steady: 0.32, tempo: 0.4, race: 0.47 },
  hike: { easy: 0.35, steady: 0.45, tempo: 0.55, race: 0.63 },
};

/** Race effort holds for this long, then decays with duration (Riegel's exponent 1.06 ≈ speed ∝ t^−0.057). */
export const RACE_HOLD_S = 1800;
export const RACE_DECAY = 0.057;

/** Average moving speed bounds per sport, m/s, and the fastest plausible flat walking speed. */
const SPEED_BOUNDS: Readonly<Record<ActivityType, readonly [number, number]>> = {
  run: [1.2, 7],
  ride: [2, 16],
  walk: [0.4, 2.4],
  hike: [0.3, 2.4],
};
const WALK_FLAT_CAP = 2.3;
/** Effort tolerance, share of VO2 reserve. */
const EFFORT_TOLERANCE = 0.002;
const MAX_EVALUATIONS = 12;

export interface PresetSolution {
  preset: EffortPreset;
  /** Average moving speed over the route, m/s. */
  mps: number;
  /** Moving time at that speed, s. */
  movingTime: number;
  /** Mean share of VO2 reserve reached. */
  effort: number;
  /** Mean share of VO2 reserve aimed for (after the race duration decay). */
  goal: number;
  evaluations: number;
}

export function presetGoal(sport: ActivityType, preset: EffortPreset, movingTime: number): number {
  const goal = (PRESET_GOALS[sport] ?? PRESET_GOALS.run)[preset];
  if (preset !== 'race' || !(movingTime > RACE_HOLD_S)) return goal;
  return goal * Math.pow(movingTime / RACE_HOLD_S, -RACE_DECAY);
}

function invert(f: (v: number) => number, value: number, lo: number, hi: number): number {
  for (let i = 0; i < 50; i++) {
    const mid = 0.5 * (lo + hi);
    if (f(mid) > value) hi = mid;
    else lo = mid;
  }
  return 0.5 * (lo + hi);
}

/** Flat-ground speed whose net VO2 is `vo2Net` (the starting guess for the route search). */
function flatSpeedFor(input: SimulationInput, sport: ActivityType, vo2Net: number): number {
  const athlete = sanitiseAthlete(input.athlete);
  if (sport === 'ride') {
    const power = ((vo2Net + VO2_REST) * CYCLING_GROSS_EFFICIENCY * J_PER_ML_O2 * athlete.weightKg) / 60;
    const ele = input.profile.points[0]?.ele;
    const bike = bikePhysics(athlete.weightKg, Number.isFinite(ele) ? ele : 0, input.session.temperatureC);
    return invert((v) => bikeSteadyPower(bike, v, 0), power, 0.5, 30);
  }
  if (sport === 'run') return invert((v) => vo2NetRun(v, 0), vo2Net, 0.1, 12);
  return invert((v) => vo2NetWalk(v, 0), vo2Net, 0.1, 4);
}

/**
 * Average moving speed for `preset` on this route and athlete: a secant search in log speed over the kinematics
 * simulate() itself runs, so the solved target reproduces the planned effort. Null when the route is too short.
 */
export function solveEffortPreset(input: SimulationInput, preset: EffortPreset): PresetSolution | null {
  const sport: ActivityType = PRESET_GOALS[input.session?.type] ? input.session.type : 'run';
  const athlete = sanitiseAthlete(input.athlete);
  const reserve = Math.max(5, resolveVo2max(athlete) - 3.5);
  const [vMin, vMax] = SPEED_BOUNDS[sport];
  const slopeGuess = sport === 'ride' ? 2 : 1;
  let evaluations = 0;
  let best: { v: number; m: EffortMeasure; goal: number; miss: number } | null = null;

  const evaluate = (v: number) => {
    const speed = Math.min(vMax, Math.max(vMin, v));
    const m = measureEffort(input, speed);
    evaluations++;
    if (!m) return null;
    const goal = presetGoal(sport, preset, m.targetTime);
    const miss = Math.log(Math.max(1e-4, m.effort)) - Math.log(goal);
    if (!best || Math.abs(miss) < Math.abs(best.miss)) best = { v: speed, m, goal, miss };
    return { v: speed, miss, m, goal };
  };

  const firstGoal = PRESET_GOALS[sport][preset];
  const first = evaluate(flatSpeedFor(input, sport, firstGoal * reserve));
  if (!first) return null;
  let x0 = Math.log(first.v);
  let f0 = first.miss;
  let x1 = x0 - f0 / slopeGuess;
  let current = first;
  while (evaluations < MAX_EVALUATIONS && Math.abs(current.m.effort - current.goal) > EFFORT_TOLERANCE) {
    x1 = Math.min(Math.log(vMax), Math.max(Math.log(vMin), x1));
    if (Math.abs(x1 - x0) < 1e-6) break;
    const next = evaluate(Math.exp(x1));
    if (!next) break;
    const slope = (next.miss - f0) / (x1 - x0);
    const usable = Number.isFinite(slope) && slope > 0.2 && slope < 8 ? slope : slopeGuess;
    x0 = x1;
    f0 = next.miss;
    x1 = x1 - next.miss / usable;
    current = next;
  }

  const chosen = best as { v: number; m: EffortMeasure; goal: number; miss: number } | null;
  if (!chosen) return null;
  let { v, m, goal } = chosen;
  // A walk or hike never plans a flat speed that is really running.
  if (sport !== 'run' && sport !== 'ride' && m.flatSpeed > WALK_FLAT_CAP) {
    const capped = measureEffort(input, Math.max(vMin, (v * WALK_FLAT_CAP) / m.flatSpeed));
    evaluations++;
    if (capped) {
      v = Math.max(vMin, (v * WALK_FLAT_CAP) / m.flatSpeed);
      m = capped;
      goal = presetGoal(sport, preset, capped.targetTime);
    }
  }
  return { preset, mps: v, movingTime: m.distance / v, effort: m.effort, goal, evaluations };
}
