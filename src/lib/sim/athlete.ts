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

/** Default VO2max by level for a 35-year-old man, ml/kg/min. */
export const VO2MAX_BY_FITNESS: Record<FitnessLevel, number> = { beginner: 35, recreational: 45, trained: 55, elite: 66 };

/**
 * Default VO2max relative to age 35. People who keep training lose endurance capacity slowly until their fifties and
 * faster after (Tanaka & Seals 2008); population VO2max falls by roughly a tenth per decade (FRIEND registry; Kaminsky
 * 2015), which overstates the loss for a given fitness level. Curvilinear HEURISTIC fit: 1.02 at 25, 0.945 at 45,
 * 0.88 at 55, 0.8 at 65, 0.72 at 75.
 */
export function ageVo2maxFactor(age: number): number {
  const a = Math.min(90, Math.max(20, Number.isFinite(age) ? age : 35));
  if (a <= 35) return 1 + 0.002 * (35 - Math.max(25, a));
  return 1 - 0.005 * (a - 35) - 0.00005 * (a - 35) * (a - 35);
}

/** ml/kg/min; athlete.vo2max wins, otherwise the fitness table (female −6) adjusted for age. */
export function resolveVo2max(athlete: Athlete): number {
  if (athlete.vo2max !== undefined && Number.isFinite(athlete.vo2max) && athlete.vo2max > 10) return athlete.vo2max;
  const base = VO2MAX_BY_FITNESS[athlete.fitness] ?? 45;
  return (athlete.sex === 'female' ? base - 6 : base) * ageVo2maxFactor(athlete.age);
}

export interface FitnessParams {
  /** Multiplies every HR time constant (Bunc 1988 trained/untrained ratio). */
  tauScale: number;
  /** Fraction of VO2 reserve at lactate threshold (slow-component onset). */
  fracLT: number;
  /** Warm-up: first 5 min this fraction slower, ramping to 0. */
  warmup: number;
}

export const FITNESS: Record<FitnessLevel, FitnessParams> = {
  beginner: { tauScale: 1.4, fracLT: 0.7, warmup: 0.06 },
  recreational: { tauScale: 1.0, fracLT: 0.75, warmup: 0.05 },
  trained: { tauScale: 0.75, fracLT: 0.83, warmup: 0.04 },
  elite: { tauScale: 0.6, fracLT: 0.88, warmup: 0.03 },
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
  alpine: { kind: 'duration', seconds: 8 * 3600 },
};

const TYPE_NOUN: Record<ActivityType, string> = { run: 'Run', ride: 'Ride', walk: 'Walk', hike: 'Hike', alpine: 'Ascent' };

export type MountainSettings = Required<Pick<SessionSettings, 'acclimatisation' | 'packKg' | 'footwear' | 'crampons' | 'snow'>> & {
  snowlineM: number | null;
};

/**
 * Mountain settings an activity starts with. Mountaineering: about a week at altitude, an 8 kg summit-day pack, mountain
 * boots and crampons, firm snow (common guide kit lists; HEURISTIC). Everything else: no acclimatisation, no pack, light
 * shoes, so other activities are unchanged until the user sets a pack or acclimatisation.
 */
export function mountainDefaults(type: ActivityType): MountainSettings {
  return type === 'alpine'
    ? { acclimatisation: 'partial', packKg: 8, footwear: 'mountain-boots', crampons: true, snow: 'firm', snowlineM: null }
    : { acclimatisation: 'none', packKg: 0, footwear: 'trail-shoes', crampons: false, snow: 'firm', snowlineM: null };
}

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
    stops: type === 'alpine' ? 'alpine' : 'none',
    gpsNoise: 'normal',
    hrSensor: 'optical',
    temperatureC: 15,
    seed: (Math.floor(start / 1000) ^ 0x5bd1e995) >>> 0,
    name: `${partOfDay(date.getHours())} ${TYPE_NOUN[type]}`,
    description: '',
    lapDistance: 1000,
    ...mountainDefaults(type),
  };
}
