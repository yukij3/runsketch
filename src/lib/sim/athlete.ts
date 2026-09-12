// Athlete defaults, fitness-dependent parameters and heart-rate zones.
import type { ActivityType, Athlete, FitnessLevel, SessionSettings } from '../types';

export interface HrZone {
  id: 1 | 2 | 3 | 4 | 5;
  name: string;
  min: number;
  max: number;
}

/** Tanaka, Monahan & Seals 2001: HRmax = 208 − 0.7·age. */
export function estimateMaxHr(age: number): number {
  const a = Number.isFinite(age) ? age : 35;
  return Math.round(208 - 0.7 * a);
}

const VO2MAX_BY_FITNESS: Record<FitnessLevel, number> = { beginner: 35, recreational: 45, trained: 55, elite: 66 };

/** ml/kg/min; athlete.vo2max wins, otherwise fitness table (female −6). */
export function resolveVo2max(athlete: Athlete): number {
  if (athlete.vo2max !== undefined && Number.isFinite(athlete.vo2max) && athlete.vo2max > 10) return athlete.vo2max;
  const base = VO2MAX_BY_FITNESS[athlete.fitness] ?? 45;
  return athlete.sex === 'female' ? base - 6 : base;
}

export interface FitnessParams {
  /** Multiplies every HR time constant (Bunc 1988 trained/untrained ratio). */
  tauScale: number;
  /** Fraction of VO2 reserve at lactate threshold (slow-component onset). */
  fracLT: number;
  /** Warm-up: first 5 min this fraction slower, ramping to 0. */
  warmup: number;
  /** Speed fade per hour after 45 min. */
  fatiguePerHour: number;
}

export const FITNESS: Record<FitnessLevel, FitnessParams> = {
  beginner: { tauScale: 1.4, fracLT: 0.7, warmup: 0.06, fatiguePerHour: 0.05 },
  recreational: { tauScale: 1.0, fracLT: 0.75, warmup: 0.05, fatiguePerHour: 0.03 },
  trained: { tauScale: 0.75, fracLT: 0.83, warmup: 0.04, fatiguePerHour: 0.015 },
  elite: { tauScale: 0.6, fracLT: 0.88, warmup: 0.03, fatiguePerHour: 0.01 },
};

export function fitnessParams(level: FitnessLevel): FitnessParams {
  return FITNESS[level] ?? FITNESS.recreational;
}

const ZONES: ReadonlyArray<readonly [HrZone['id'], string, number, number]> = [
  [1, 'Recovery', 0.5, 0.6],
  [2, 'Endurance', 0.6, 0.7],
  [3, 'Tempo', 0.7, 0.8],
  [4, 'Threshold', 0.8, 0.9],
  [5, 'VO2max', 0.9, 1.0],
];

const FITNESS_LEVELS: ReadonlyArray<FitnessLevel> = ['beginner', 'recreational', 'trained', 'elite'];

const inRange = (x: unknown, lo: number, hi: number, fallback: number): number =>
  typeof x === 'number' && Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : fallback;

/** Clamps every athlete field to a physiological range (resting HR at least 40 bpm under HRmax). */
export function sanitiseAthlete(a: Athlete): Athlete {
  const age = inRange(a?.age, 8, 100, 35);
  const maxHr = inRange(a?.maxHr, 100, 230, estimateMaxHr(age));
  const restHr = Math.min(inRange(a?.restHr, 30, 110, 60), maxHr - 40);
  return {
    age,
    sex: a?.sex === 'female' ? 'female' : 'male',
    weightKg: inRange(a?.weightKg, 25, 250, 70),
    heightCm: inRange(a?.heightCm, 110, 230, 175),
    restHr,
    maxHr,
    vo2max: a?.vo2max,
    fitness: FITNESS_LEVELS.includes(a?.fitness) ? a.fitness : 'recreational',
  };
}

/** Five zones by % heart-rate reserve (Karvonen), on the sanitised athlete. */
export function hrZones(athlete: Athlete): HrZone[] {
  const { restHr: rest, maxHr } = sanitiseAthlete(athlete);
  const hrr = maxHr - rest;
  return ZONES.map(([id, name, lo, hi]) => ({
    id,
    name,
    min: Math.round(rest + lo * hrr),
    max: Math.round(rest + hi * hrr),
  }));
}

export function defaultAthlete(): Athlete {
  return {
    age: 35,
    sex: 'male',
    weightKg: 70,
    heightCm: 175,
    restHr: 55,
    maxHr: estimateMaxHr(35),
    fitness: 'recreational',
  };
}

const DEFAULT_TARGET: Record<ActivityType, SessionSettings['target']> = {
  run: { kind: 'pace', secPerKm: 330 },
  walk: { kind: 'pace', secPerKm: 720 },
  hike: { kind: 'pace', secPerKm: 900 },
  ride: { kind: 'speed', mps: 25 / 3.6 },
};

const TYPE_NOUN: Record<ActivityType, string> = { run: 'Run', ride: 'Ride', walk: 'Walk', hike: 'Hike' };

function partOfDay(hour: number): string {
  if (hour < 5) return 'Night';
  if (hour < 11) return 'Morning';
  if (hour < 14) return 'Lunch';
  if (hour < 18) return 'Afternoon';
  if (hour < 22) return 'Evening';
  return 'Night';
}

export function defaultSession(type: ActivityType, now: number): SessionSettings {
  const start = Math.floor((Number.isFinite(now) ? now : 0) / 1000) * 1000;
  const date = new Date(start);
  return {
    type,
    startTime: start,
    utcOffsetMin: -date.getTimezoneOffset(),
    target: DEFAULT_TARGET[type],
    variability: 0.35,
    pacing: 'even',
    stops: 'none',
    gpsNoise: 'normal',
    hrSensor: 'optical',
    temperatureC: 15,
    seed: (Math.floor(start / 1000) ^ 0x5bd1e995) >>> 0,
    name: `${partOfDay(date.getHours())} ${TYPE_NOUN[type]}`,
    description: '',
    lapDistance: 1000,
  };
}
