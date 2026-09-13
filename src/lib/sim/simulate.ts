// simulate(): route profile + athlete + session → 1 Hz streams, summary and warnings. Pure and deterministic.
import type {
  Acclimatisation,
  ActivityStreams,
  ActivityType,
  Athlete,
  Footwear,
  GpsNoiseLevel,
  HrSensor,
  PacingStrategy,
  SessionSettings,
  SimulationInput,
  SimulationResult,
  SnowCondition,
  StopsLevel,
  TargetSpec,
  TerrainProfile,
  WeatherSummary,
} from '../types';
import { gradeLimit } from '../terrain';
import { NEUTRAL_MANUAL } from '../weather/field';
import { NEUTRAL_AIR } from '../weather/thermal';
import { alpineContext, climbOxygen, expectedMovingTime, gearPoint, mountainOf, type Mountain } from './alpine';
import { VO2MAX_BY_FITNESS, fitnessParams, mountainDefaults, resolveVo2max, sanitiseAthlete, type FitnessParams } from './athlete';
import {
  cadenceStream,
  elevationStream,
  metabolicDemand,
  positionStreams,
  powerStream,
  recordedSpeed,
  temperatureStream,
  trueElevation,
} from './channels';
import {
  CARB_INTAKE_KCAL_PER_HOUR,
  D_PRIME_M,
  DRIFT_BY_LEVEL,
  FADE,
  FLAT_KM_JOULES,
  RUN_FLAT_CEILING,
  VO2_PER_FLAT_MPS,
  criticalFraction,
  fadeScaleForLead,
  glycogenStore,
  loadWeight,
  type FadeParams,
} from './fatigue';
import { Environment, heatStrain, recordEnvironment, startAirDensity, summariseWeather, weatherField, type EnvironmentRecord, type HeatStrain } from './environment';
import { groundTrack, type GroundTrack } from './ground';
import { SLOW_COMPONENT, hrDemand, hrKinetics, hrSensor, physiologicalWander, type DemandResult } from './hr';
import {
  ALPINE_CLIMB,
  HIKE_CLIMB,
  ALPINE_MIN_SPEED,
  BOUT_SPREAD,
  BlipTrack,
  FOOT_ACCEL,
  FOOT_DECEL,
  FOOT_MIN_SPEED,
  GAIT_WALK,
  KinRecord,
  PEDAL_BURSTS,
  type FatigueContext,
  type GaitContext,
  type KinOutcome,
  type LimitSeconds,
  type ScaleSolution,
  RIDE_CORNER_DECEL,
  RIDE_MAX_POWER,
  RIDE_MAX_SPEED,
  integrate,
  solveScale,
  type KinContext,
} from './kinematics';
import {
  DESCENT_SKILL,
  TRANSITION_OFFSET,
  VAM_BY_FITNESS,
  VO2_REST,
  WALK_MAX_SPEED,
  altitudeEndurance,
  altitudeFactor,
  bikePhysics,
  bikeSteadyPower,
  costRun,
  costWalk,
  hrMaxAltitudeFactor,
  packLoadFactor,
  restHrAltitudeFactor,
  runGradeMultiplier,
  swissGradeMultiplier,
  vo2NetRide,
  vo2NetRun,
  vo2NetWalk,
  walkGradeMultiplier,
  walkSpeedCostFactor,
} from './models';
import { OuTrack, createRandom } from './rng';
import { normaliseStops, planStops, type StopEvent } from './stops';
import { summarise, timerSamples } from './summary';
import { buildTrack, cornerCaps, mapGrade, type Track } from './track';

export interface SimulationOverrides {
  /** Explicit stops (distance + seconds) instead of the random schedule from session.stops. */
  stops?: ReadonlyArray<StopEvent>;
}

const SPORTS: ReadonlyArray<ActivityType> = ['run', 'ride', 'walk', 'hike', 'alpine'];
const PACINGS: ReadonlyArray<PacingStrategy> = ['even', 'negative', 'positive'];
const STOPS_LEVELS: ReadonlyArray<StopsLevel> = ['none', 'few', 'urban', 'alpine'];
const GPS_LEVELS: ReadonlyArray<GpsNoiseLevel> = ['off', 'low', 'normal', 'high'];
const SENSORS: ReadonlyArray<HrSensor> = ['strap', 'optical'];
const ACCLIMATISATIONS: ReadonlyArray<Acclimatisation> = ['none', 'partial', 'full'];
const FOOTWEARS: ReadonlyArray<Footwear> = ['trail-shoes', 'mountain-boots', 'double-boots'];
const SNOWS: ReadonlyArray<SnowCondition> = ['firm', 'soft', 'deep'];
const FALLBACK_SPEED: Record<ActivityType, number> = { run: 3.0, walk: 1.39, hike: 1.1, ride: 25 / 3.6, alpine: 0.45 };
/** Lateral acceleration limits in corners, m/s². */
const CORNER_LATERAL: Record<ActivityType, number> = { run: 2.5, walk: 1.5, hike: 1.5, ride: 4.0, alpine: 1.2 };
/** Altitude above which an unacclimatised ascent is not realistic, and above which most ascents use bottled oxygen, m. */
export const ALTITUDE_NOTES = { acclimatisationM: 5500, bottledOxygenM: 7500, turnaroundHour: 13 } as const;

/** A pace target is worth a note once ground this slow covers this much of the route. */
export const TECHNICAL_GROUND = { speed: 0.9, minM: 500 } as const;
const PACING_SLOPE: Record<PacingStrategy, number> = { even: 0, negative: 0.03, positive: -0.04 };
/**
 * Pace noise amplitudes (τ s, σ of log-speed) that correspond to variability 0.35: fast parts (footing, breathing,
 * attention), which uneven ground scales up, and a slow wander (mood, wind, energy) that it does not. Real watch speed
 * is smooth from one second to the next (lag-1 autocorrelation ≈ 0.94) yet wanders about 4 % around its 1-minute mean;
 * the 15 s part carries most of that (HEURISTIC amplitudes, fitted to a decoded 1 Hz running file).
 */
const PACE_NOISE = [
  [4, 0.012],
  [15, 0.03],
  [45, 0.025],
] as const;
const PACE_WANDER = [[600, 0.015]] as const;
/** Log-power noise: pedal-stroke/second surges (HEURISTIC, VI ≈ 1.02–1.05 on steady flats) plus slower wander. */
const POWER_NOISE = [
  [1, 0.13],
  [3, 0.08],
  [20, 0.05],
  [60, 0.07],
] as const;
/** Ride aerodynamic drag wander (tuck and position changes, gusts), log σ at variability 0.35 (HEURISTIC). */
const DRAG_NOISE = [[25, 0.06]] as const;
/** Descent braking set point wander, log σ (HEURISTIC, ±0.7 m/s at 18 m/s). */
const DESCENT_NOISE = [[20, 0.04]] as const;
const MAX_SECONDS = 7 * 24 * 3600;
/** Flat walking speed that is really running, m/s: walking plans stay under it (see WALK_MAX_SPEED). */
export const WALK_RUNNING_SPEED = 2.4;
const TOLERANCE = Math.log(1.005);
/** Routes shorter than this are dominated by the standing start; effort warnings are skipped. */
const SHORT_ROUTE = 200;
/**
 * Longest sustainable mean %VO2R per window, as a margin over the lactate-threshold fraction (critical-power
 * shape, HEURISTIC): recreational ≈ 1.0 for 6 min, 0.93 for 15 min, 0.88 for 30 min, 0.84 for 1 h, 0.80 for 3 h.
 */
const ENDURANCE: ReadonlyArray<readonly [windowS: number, margin: number]> = [
  [360, 0.25],
  [900, 0.18],
  [1800, 0.13],
  [3600, 0.09],
  [10800, 0.05],
];

const inRange = (x: unknown, lo: number, hi: number, fallback: number): number =>
  typeof x === 'number' && Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : fallback;

const pick = <T extends string>(value: unknown, options: ReadonlyArray<T>, fallback: T): T =>
  options.includes(value as T) ? (value as T) : fallback;

function sanitiseSession(s: SessionSettings): SessionSettings {
  const type = pick(s?.type, SPORTS, 'run');
  const mountain = mountainDefaults(type);
  return {
    ...s,
    type,
    acclimatisation: pick(s?.acclimatisation, ACCLIMATISATIONS, mountain.acclimatisation),
    packKg: inRange(s?.packKg, 0, 60, mountain.packKg),
    footwear: pick(s?.footwear, FOOTWEARS, mountain.footwear),
    crampons: typeof s?.crampons === 'boolean' ? s.crampons : mountain.crampons,
    snow: pick(s?.snow, SNOWS, mountain.snow),
    snowlineM: typeof s?.snowlineM === 'number' && Number.isFinite(s.snowlineM) ? inRange(s.snowlineM, 0, 9000, 0) : null,
    pacing: pick(s?.pacing, PACINGS, 'even'),
    stops: pick(s?.stops, STOPS_LEVELS, 'none'),
    gpsNoise: pick(s?.gpsNoise, GPS_LEVELS, 'normal'),
    hrSensor: pick(s?.hrSensor, SENSORS, 'optical'),
    variability: inRange(s?.variability, 0, 1, 0.35),
    temperatureC: inRange(s?.temperatureC, -30, 45, 15),
    seed: inRange(s?.seed, -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, 0),
    lapDistance: inRange(s?.lapDistance, 10, 1e7, 1000),
    hrTarget: typeof s?.hrTarget === 'number' && Number.isFinite(s.hrTarget) && s.hrTarget > 0 ? inRange(s.hrTarget, 30, 240, 0) : null,
  };
}

function pace(mps: number): string {
  if (!(mps > 0)) return '–';
  const sec = Math.round(1000 / mps);
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}/km`;
}

function clock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const mm = String(m).padStart(h > 0 ? 2 : 1, '0');
  return h > 0 ? `${h}:${mm}:${String(r).padStart(2, '0')}` : `${mm}:${String(r).padStart(2, '0')}`;
}

/** Target → moving time for the route. pace/speed are averages over the whole route's moving time. */
function targetMovingTime(target: TargetSpec | undefined, total: number, sport: ActivityType, warnings: string[]): number {
  let seconds = NaN;
  if (target?.kind === 'pace') seconds = (total * target.secPerKm) / 1000;
  else if (target?.kind === 'speed') seconds = total / target.mps;
  else if (target?.kind === 'duration') seconds = target.seconds;
  if (!(Number.isFinite(seconds) && seconds > 0)) {
    const fallback = FALLBACK_SPEED[sport];
    warnings.push(`The target was missing or not positive, so a default average pace of ${pace(fallback)} was used.`);
    seconds = total / fallback;
  }
  if (seconds > MAX_SECONDS) {
    warnings.push(`The target moving time is longer than ${clock(MAX_SECONDS)}, so ${clock(MAX_SECONDS)} was used.`);
    return MAX_SECONDS;
  }
  return seconds;
}

function emptyStreams(n: number): ActivityStreams {
  return {
    t: new Float64Array(n),
    lat: new Float64Array(n),
    lon: new Float64Array(n),
    ele: new Float64Array(n),
    dist: new Float64Array(n),
    speed: new Float64Array(n),
    hr: new Float64Array(n),
    hrDemand: new Float64Array(n),
    cadence: new Float64Array(n),
    power: new Float64Array(n),
    grade: new Float64Array(n),
    moving: new Uint8Array(n),
    temperature: new Float64Array(n),
  };
}

function degenerate(track: Track, athlete: Athlete, warnings: string[]): SimulationResult {
  const n = track.n > 0 ? 1 : 0;
  const streams = emptyStreams(n);
  if (n === 1) {
    streams.lat[0] = track.lat[0];
    streams.lon[0] = track.lon[0];
    streams.ele[0] = track.ele[0];
    streams.hr[0] = Math.round(athlete.restHr + 20);
    streams.hrDemand[0] = athlete.restHr;
  }
  warnings.push('The route has fewer than two distinct points, so there is nothing to simulate.');
  return {
    streams,
    summary: {
      distance: 0,
      elapsed: 0,
      moving: 0,
      avgSpeed: 0,
      maxSpeed: 0,
      avgHr: n ? streams.hr[0] : 0,
      maxHr: n ? streams.hr[0] : 0,
      avgCadence: 0,
      avgPower: 0,
      ascent: 0,
      descent: 0,
      calories: 0,
      laps: [],
    },
    warnings,
  };
}

/** VO2max multiplier for each elevation sample at acclimatisation A (the one place altitude enters aerobic capacity). */
function altitudeSeries(ele: ArrayLike<number>, n: number, acclimatisation: number): Float64Array {
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) out[i] = altitudeFactor(ele[i], acclimatisation);
  return out;
}

/** Seeded bout-length multipliers, lognormal with a coefficient of variation of BOUT_SPREAD, kept within 0.4–2.5. */
function boutJitter(seed: number): Float64Array {
  const random = createRandom(seed, 'gait-bouts');
  const sigma = Math.sqrt(Math.log(1 + BOUT_SPREAD * BOUT_SPREAD));
  return Float64Array.from({ length: 256 }, () => Math.min(2.5, Math.max(0.4, Math.exp(sigma * random.normal() - (sigma * sigma) / 2))));
}

/**
 * Half-length of the baseline gait decisions average the grade over, metres. A 200 m baseline keeps 20–50 m ramps and
 * DEM bumps (bridges, canopy) from switching a runner to walking, and evens out short alternating grades.
 */
const GAIT_GRADE_HALF_WINDOW = 100;

/** Grade averaged over ±half metres along the track (distance-weighted), clipped at the route ends. */
function longGrade(track: Track, half: number): Float64Array {
  const { n, d, grade } = track;
  const out = new Float64Array(n);
  if (n < 2) return out;
  const area = new Float64Array(n);
  for (let j = 1; j < n; j++) area[j] = area[j - 1] + 0.5 * (grade[j] + grade[j - 1]) * (d[j] - d[j - 1]);
  /** Integral of grade from 0 to x, with d[j] ≤ x ≤ d[j + 1]. */
  const integral = (x: number, j: number): number => {
    const seg = d[j + 1] - d[j];
    const gx = grade[j] + (seg > 0 ? ((grade[j + 1] - grade[j]) * (x - d[j])) / seg : 0);
    return area[j] + 0.5 * (grade[j] + gx) * (x - d[j]);
  };
  let lo = 0;
  let hi = 0;
  for (let j = 0; j < n; j++) {
    const a = Math.max(0, d[j] - half);
    const b = Math.min(d[n - 1], d[j] + half);
    while (lo < n - 2 && d[lo + 1] <= a) lo++;
    while (hi < n - 2 && d[hi + 1] < b) hi++;
    out[j] = b > a ? (integral(b, hi) - integral(a, lo)) / (b - a) : grade[j];
  }
  return out;
}

/** Metres of a profile whose grade exceeds the limit, for profiles that do not carry the terrain step's own count. */
function clampedMetres(profile: TerrainProfile, limit: number): number {
  const pts = Array.isArray(profile?.points) ? profile.points : [];
  let metres = 0;
  for (let k = 1; k < pts.length; k++) {
    const p = pts[k];
    const prev = pts[k - 1];
    if (!p || !prev || !Number.isFinite(p.grade) || Math.abs(p.grade) <= limit) continue;
    if (Number.isFinite(p.d) && Number.isFinite(prev.d)) metres += Math.max(0, p.d - prev.d);
  }
  return metres;
}

/**
 * Gait decisions on a long-baseline grade and the vertical-speed ceiling, scaled by the profile VO2max against the
 * level's table value (so it falls with age too). Uses the profile VO2max, so heart-rate matching never changes it.
 */
function gaitContext(track: Track, sport: ActivityType, athlete: Athlete, vo2max: number, ground: GroundTrack | null, seed: number): GaitContext {
  const grades = longGrade(track, GAIT_GRADE_HALF_WINDOW);
  const table = VO2MAX_BY_FITNESS[athlete.fitness] ?? 45;
  return {
    longGrade: grades,
    relLong: sport === 'run' ? runGradeTrack(grades, DESCENT_SKILL[athlete.fitness] ?? 0.35, ground) : new Float64Array(track.n).fill(1),
    transitionOffset: TRANSITION_OFFSET[athlete.fitness] ?? 0.15,
    vam: (VAM_BY_FITNESS[athlete.fitness] ?? 1100) * Math.min(1.3, Math.max(0.6, vo2max / table)),
    descentSkill: DESCENT_SKILL[athlete.fitness] ?? 0.35,
    boutJitter: sport === 'run' ? boutJitter(seed) : undefined,
  };
}

/** Running speed multiplier per track point for grades `grades`, with descent skill lowered by technical ground. */
function runGradeTrack(grades: Float64Array, skill: number, ground: GroundTrack | null): Float64Array {
  return Float64Array.from(grades, (g, j) => runGradeMultiplier(g, skill, ground ? ground.technicality[j] : 0));
}

/** Glycogen store spread between athletes: lognormal, CV ≈ 25 %, mean 1, fixed by the seed. */
function glycogenSpread(seed: number): number {
  return Math.exp(0.2462 * createRandom(seed, 'glycogen').normal() - 0.0303);
}

/**
 * Share of the load fade to apply on this route: load per metre is estimated at the target pace on each point's
 * grade, and the fade is compressed when it would put the first hour more than FIRST_HOUR_LEAD ahead of the average.
 */
function leadFadeScale(
  track: Track,
  rel: Float64Array,
  ground: GroundTrack | null,
  altitude: Float64Array,
  vo2max: number,
  vFlat: number,
  targetTime: number,
  walking: boolean,
  fade: FadeParams,
): number {
  const { n, grade } = track;
  if (!(targetTime > 2 * 3600)) return 1;
  const rate = new Float64Array(n);
  const speed = new Float64Array(n);
  for (let j = 0; j < n; j++) {
    const g = grade[j];
    speed[j] = rel[j] * (ground ? (walking ? ground.walkSpeed[j] : ground.runSpeed[j]) : 1);
    const cost = ground ? (walking ? ground.walkCost[j] : ground.runCost[j]) : 1;
    const v = Math.max(0.1, vFlat * speed[j]);
    const reserve = Math.max(5, vo2max * altitude[j] - VO2_REST);
    const vo2 = (walking ? vo2NetWalk(v, g) : vo2NetRun(v, g)) * cost;
    const perMetre = (walking ? costWalk(g) * walkSpeedCostFactor(v) : costRun(g)) * cost;
    rate[j] = (perMetre / FLAT_KM_JOULES) * loadWeight(vo2 / reserve);
  }
  return fadeScaleForLead(track.d, speed, rate, n, targetTime, fade);
}

/**
 * What the target plans on average over the route's terrain: net O2 uptake (ml/kg/min) and speed (m/s). Clothing is
 * chosen for them, so it does not depend on the effort scale the calibration is still solving.
 */
function plannedEffort(
  track: Track,
  sport: ActivityType,
  rel: Float64Array,
  groundSpeed: (j: number) => number,
  flatSpeed: number,
  base: number,
  bodyKg: number,
  packLoad: number,
): { vo2Net: number; speed: number } {
  if (sport === 'ride') return { vo2Net: vo2NetRide(base, bodyKg), speed: flatSpeed };
  let time = 0;
  let vo2 = 0;
  for (let j = 1; j < track.n; j++) {
    const ds = track.d[j] - track.d[j - 1];
    const v = Math.max(0.1, flatSpeed * rel[j] * groundSpeed(j));
    const dt = ds / v;
    const g = track.grade[j];
    time += dt;
    vo2 += (sport === 'run' ? vo2NetRun(v, g) : vo2NetWalk(v, Math.max(0, g)) * packLoad) * dt;
  }
  return time > 0 ? { vo2Net: vo2 / time, speed: track.total / time } : { vo2Net: 0, speed: flatSpeed };
}

/** Output-based sustainability check: the worst window whose mean %VO2R exceeds its endurance limit. */
function enduranceWarning(frac: Float64Array, n: number, fracLT: number): string | null {
  const prefix = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i] + Math.min(frac[i], 1.5);
  let worst: { window: number; mean: number; ratio: number } | null = null;
  for (const [window, margin] of ENDURANCE) {
    if (window > n) break;
    const limit = Math.min(1.05, fracLT + margin);
    let best = 0;
    for (let i = window; i <= n; i++) best = Math.max(best, (prefix[i] - prefix[i - window]) / window);
    if (best > limit && (!worst || best / limit > worst.ratio)) worst = { window, mean: best, ratio: best / limit };
  }
  if (!worst) return null;
  return `Effort averages about ${Math.round(worst.mean * 100)} % of VO2 reserve for ${clock(worst.window)}, more than this athlete can sustain for that long, so heart rate sits near maximum.`;
}

/** Why a foot target is out of reach: the speed ceiling that held the motion down for the most seconds. */
function footLimitReason(limited: LimitSeconds, sport: ActivityType): string {
  const top = Math.max(limited.oxygen, limited.vertical, limited.flat, limited.corner);
  if (top > 0 && limited.oxygen === top) return 'the oxygen available at altitude caps how fast the climbs can go';
  if (top > 0 && limited.vertical === top) return "this athlete's highest sustainable climbing rate caps how fast the climbs can go";
  if (top > 0 && limited.flat === top) {
    return sport === 'run'
      ? 'the fastest pace this athlete can hold on the flat caps how fast the route can be covered'
      : 'the fastest plausible walking speed caps how fast the route can be covered';
  }
  return 'corner speed limits and the maximum plausible speed on this route cap how fast it can be covered';
}

/** Local clock time "H:MM" of an epoch millisecond at a zone offset. */
function localClock(epochMs: number, utcOffsetMin: number): { hour: number; text: string } {
  const d = new Date(epochMs + (Number.isFinite(utcOffsetMin) ? utcOffsetMin : 0) * 60_000);
  const hour = d.getUTCHours();
  return { hour, text: `${hour}:${String(d.getUTCMinutes()).padStart(2, '0')}` };
}

/**
 * High-route notes: a summit reached after the usual 13:00 turnaround on a mountain day (Everest climbers who died
 * summited at a median 13:00–13:59, survivors at 09:00–09:59; Firth 2008; Elbrus parties must turn by 14:00), an ascent
 * above 5500 m without acclimatisation, and heights where supplemental oxygen, not modelled, is the norm.
 */
function altitudeWarnings(p: Plan, m: Motion): string[] {
  const out: string[] = [];
  if (m.n < 2) return out;
  let top = 0;
  for (let i = 1; i < m.n; i++) if (m.demEle[i] > m.demEle[top]) top = i;
  const maxEle = m.demEle[top];
  if (p.sport === 'alpine' && maxEle - m.demEle[0] >= 100) {
    const at = localClock(p.session.startTime + top * 1000, p.session.utcOffsetMin);
    if (at.hour >= ALTITUDE_NOTES.turnaroundHour) {
      out.push(`The highest point (${Math.round(maxEle)} m) is reached at ${at.text} local time, after 13:00, when parties usually turn around to get down safely.`);
    }
  }
  if (maxEle > ALTITUDE_NOTES.acclimatisationM && p.session.acclimatisation === 'none') {
    out.push(`The route climbs to ${Math.round(maxEle)} m; above 5500 m that is not realistic without acclimatisation.`);
  }
  if (maxEle > ALTITUDE_NOTES.bottledOxygenM) {
    out.push(`The route climbs to ${Math.round(maxEle)} m; above 7500 m most ascents use bottled oxygen, which is not modelled.`);
  }
  return out;
}

/**
 * A pace asked for on rock, roots or scree is not the same ask as on a path: the ground caps the speed, so the pace is
 * held at a much higher effort and heart rate. Only for a pace target — an effort preset has already taken the ground
 * into account when it solved the speed.
 */
function technicalGroundWarning(track: Track, ground: ReturnType<typeof groundTrack>, sport: ActivityType, target: SessionSettings['target']): string | null {
  if (!ground || !target || target.kind !== 'pace') return null;
  const speed = sport === 'run' ? ground.runSpeed : ground.walkSpeed;
  let metres = 0;
  let weighted = 0;
  for (let j = 1; j < track.n; j++) {
    const f = 0.5 * (speed[j] + speed[j - 1]);
    if (f >= TECHNICAL_GROUND.speed) continue;
    const len = track.d[j] - track.d[j - 1];
    metres += len;
    weighted += len * f;
  }
  if (metres < TECHNICAL_GROUND.minM) return null;
  const share = Math.round((weighted / metres) * 100);
  return `Technical ground allows only about ${share} % of smooth-path speed over ${(metres / 1000).toFixed(1)} km, so holding the target pace there takes much more effort.`;
}

/** Everything fixed before the effort scale is solved: sanitised inputs, route track and kinematic context. */
interface Plan {
  athlete: Athlete;
  session: SessionSettings;
  sport: ActivityType;
  warnings: string[];
  track: Track;
  total: number;
  short: boolean;
  targetTime: number;
  fit: FitnessParams;
  bodyKg: number;
  /** Profile VO2max (athlete.vo2max or the fitness table), ml/kg/min. */
  vo2max: number;
  vo2Reserve: number;
  vBase: number;
  base: number;
  k0: number;
  ctx: KinContext;
  expectedSamples: number;
  /** Weather and the athlete's heat balance at their position and time (constant manual conditions without a series). */
  env: Environment;
  mountain: Mountain;
}

type Planned = { ok: true; plan: Plan } | { ok: false; result: SimulationResult };

function planRun(input: SimulationInput, overrides: SimulationOverrides): Planned {
  const athlete = sanitiseAthlete(input.athlete);
  const session = sanitiseSession(input.session);
  const sport = session.type;
  const warnings: string[] = [];
  // One grade limit shared with the terrain step, so its clamp and this warning agree.
  const limit = gradeLimit(sport);
  const track = buildTrack(input.profile, limit);
  if (track.n < 2 || !(track.total >= 1)) return { ok: false, result: degenerate(track, athlete, warnings) };

  const total = track.total;
  const short = total < SHORT_ROUTE;
  if (total < 50) warnings.push(`The route is only ${Math.round(total)} m long, so the activity lasts just a few seconds.`);
  // The terrain step counts metres clamped by the activity limit or by what the way type plausibly allows.
  const clampedM = input.profile.gradeClampedM ?? clampedMetres(input.profile, limit);
  if (clampedM > 0) {
    warnings.push(`The elevation data was steeper than this route plausibly is, so grades were limited on about ${Math.max(10, Math.round(clampedM / 10) * 10)} m.`);
  }

  const targetTime = targetMovingTime(session.target, total, sport, warnings);
  const seed = session.seed;
  const fit = fitnessParams(athlete.fitness);
  const bodyKg = athlete.weightKg;
  const vo2max = resolveVo2max(athlete);
  const vo2Reserve = Math.max(5, vo2max - 3.5);
  const noiseScale = 0.1 + (0.9 / 0.35) * session.variability;
  const mountain = mountainOf(session, input.profile);

  const ride = sport === 'ride';
  const alpine = sport === 'alpine';
  const bike = ride ? bikePhysics(bodyKg, track.ele[0], session.temperatureC) : null;
  const skill = DESCENT_SKILL[athlete.fitness] ?? 0.35;
  const ground = groundTrack(input.profile, track, {
    snowDepthCm: mountain.snowDepthCm,
    alpine: alpine ? { snowlineM: mountain.snowlineM, crampons: mountain.crampons } : undefined,
  });
  const rel = ride
    ? new Float64Array(0)
    : sport === 'run'
      ? runGradeTrack(track.grade, skill, ground)
      : mapGrade(track, alpine ? swissGradeMultiplier : walkGradeMultiplier);
  const altitude = altitudeSeries(track.ele, track.n, mountain.acclimatisation);

  const stops = overrides.stops
    ? normaliseStops(overrides.stops, total)
    : planStops(
        session.stops,
        total,
        total / targetTime,
        createRandom(seed, 'stops'),
        track,
        session.stops === 'alpine' && !ride
          ? { time: expectedMovingTime(track, rel, ground, altitude, mountain.acclimatisation, targetTime), gearAt: mountain.crampons ? gearPoint(track, ground) : null }
          : undefined,
      );
  const stopSeconds = stops.reduce((sum, e) => sum + e.duration, 0);
  /** Standing start before the first step, 2–5 s (recorded watch files stand still for a few seconds). */
  const preRoll = 2 + Math.floor(4 * createRandom(seed, 'start').uniform());
  const minSpeed = alpine ? ALPINE_MIN_SPEED : FOOT_MIN_SPEED;
  const maxSteps = Math.min(MAX_SECONDS, Math.ceil(total / (minSpeed * 0.8) + stopSeconds + preRoll + 120));
  const expectedSamples = Math.min(maxSteps + 2, Math.ceil(targetTime * 1.1 + stopSeconds + preRoll + 32));

  const field = weatherField(input.weather, session);
  const startEpoch = Number.isFinite(session.startTime) ? Math.round(session.startTime / 1000) : 0;
  const horizonS = Math.min(maxSteps, Math.ceil(2 * targetTime + stopSeconds + preRoll + 3600));
  // The flat power a target speed needs is set in the air at the start.
  if (bike) bike.rho = startAirDensity(field, startEpoch, track.ele[0]);
  /** Planned speed multiplier of the ground at point j. */
  const groundSpeed = (j: number): number => (ground ? (sport === 'run' ? ground.runSpeed[j] : ground.walkSpeed[j]) : 1);
  // Ride corner caps sit above the descent set point, so the wandering braking set point (not a hard
  // clamp) decides top speed on straight descents.
  const cap = ride
    ? cornerCaps(track, CORNER_LATERAL.ride, RIDE_CORNER_DECEL, 0, RIDE_MAX_SPEED * 1.25)
    : cornerCaps(track, CORNER_LATERAL[sport], FOOT_DECEL, FOOT_ACCEL, 12);
  const vBase = total / targetTime;
  const base = ride ? Math.max(20, bikeSteadyPower(bike!, vBase, 0)) : vBase;
  let k0 = 1;
  if (!ride) {
    let inv = 0;
    for (let j = 1; j < track.n; j++) inv += (track.d[j] - track.d[j - 1]) / (0.5 * (rel[j] * groundSpeed(j) + rel[j - 1] * groundSpeed(j - 1)));
    k0 = inv / total;
  }
  const flatEstimate = k0 * vBase;
  const packLoad = ride || sport === 'run' ? 1 : packLoadFactor(mountain.packKg, bodyKg);
  const env = new Environment({
    field,
    profile: input.profile,
    track,
    sport,
    athlete,
    vo2max,
    startEpoch,
    horizonS,
    planned: plannedEffort(track, sport, rel, groundSpeed, flatEstimate, base, bodyKg, packLoad),
    crampons: sport === 'alpine' && mountain.crampons,
  });
  const restartRandom = createRandom(seed, 'restart');
  const fade = FADE[athlete.fitness] ?? FADE.recreational;
  const fatigue: FatigueContext = {
    fitness: athlete.fitness,
    vo2max,
    altitude,
    fade,
    fadeScale: ride ? 1 : leadFadeScale(track, rel, ground, altitude, vo2max, flatEstimate, targetTime, sport !== 'run', fade),
    csFraction: criticalFraction(fit.fracLT),
    dPrime: sport === 'run' ? D_PRIME_M[athlete.fitness] : 0,
    glycogen: sport === 'run' ? glycogenStore(athlete.fitness, athlete.sex === 'female', glycogenSpread(seed)) : 0,
    intake: (CARB_INTAKE_KCAL_PER_HOUR[athlete.fitness] ?? CARB_INTAKE_KCAL_PER_HOUR.recreational) / bodyKg / 3600,
    wallFrom: Infinity,
  };
  const ctx: KinContext = {
    sport,
    track,
    rel,
    cap,
    base,
    warmup: fit.warmup,
    fatigue,
    pacingSlope: PACING_SLOPE[session.pacing],
    noise: ride
      ? new OuTrack(createRandom(seed, 'ride-power'), POWER_NOISE, noiseScale, expectedSamples)
      : new OuTrack(createRandom(seed, 'pace'), PACE_NOISE, noiseScale * (sport === 'run' ? 1 : 1.5), expectedSamples),
    noiseSlow: ride ? null : new OuTrack(createRandom(seed, 'pace-wander'), PACE_WANDER, noiseScale * (sport === 'run' ? 1 : 1.5), expectedSamples),
    ground,
    stops,
    maxSteps,
    bike,
    blips: ride ? new BlipTrack(createRandom(seed, 'coast'), session.variability >= 0.05) : null,
    gait: ride ? undefined : gaitContext(track, sport, athlete, vo2max, ground, seed),
    packLoad,
    alpine: alpine ? alpineContext(track, ground, altitude, vo2max, mountain, bodyKg) : null,
    climbO2: sport === 'walk' || sport === 'hike' ? climbOxygen(track, altitude, vo2max, mountain.acclimatisation) : null,
    restartAccel: Float64Array.from(stops, () => 0.45 + 0.15 * restartRandom.uniform()),
    preRoll,
    // A pedalled flat slower than 80 % of the target average is implausible; below that effort, descents brake.
    kFloor: ride ? Math.min(1, bikeSteadyPower(bike!, 0.8 * vBase, 0) / base) : 0,
    drag: ride ? new OuTrack(createRandom(seed, 'ride-drag'), DRAG_NOISE, noiseScale, expectedSamples) : null,
    descentLimit: ride ? new OuTrack(createRandom(seed, 'ride-descent'), DESCENT_NOISE, noiseScale, expectedSamples) : null,
    bursts: ride ? new BlipTrack(createRandom(seed, 'ride-burst'), session.variability >= 0.05, PEDAL_BURSTS) : null,
    environment: env,
  };
  return {
    ok: true,
    plan: { athlete, session, sport, warnings, track, total, short, targetTime, fit, bodyKg, vo2max, vo2Reserve, vBase, base, k0, ctx, expectedSamples, env, mountain },
  };
}

/** The calibrated motion: effort scale, recorded kinematics, moving flags and noise-free DEM elevation. */
interface Motion {
  solution: ScaleSolution;
  outcome: KinOutcome;
  rec: KinRecord;
  n: number;
  moving: Uint8Array;
  demEle: Float64Array;
  /** VO2max multiplier per second (altitude). */
  altitude: Float64Array;
  /** HRmax multiplier and resting-HR rise (bpm) per second (altitude). */
  hrMaxFactor: Float64Array;
  restOffset: Float64Array;
  /** Resting and maximal heart rate per second, bpm. */
  restAt: Float64Array;
  maxAt: Float64Array;
  /** Ambient air temperature per second, °C. */
  airTemp: Float64Array;
  /** Run: distance where the athlete hit the wall, m (Infinity for none). */
  wallFrom: number;
  /** What the athlete met each second. */
  weather: EnvironmentRecord;
  /** The athlete's heat balance each second, against the same motion in neutral weather. */
  heat: HeatStrain;
}

/** A wall this close to the finish changes nothing visible and is ignored, metres. */
const WALL_FINISH_GUARD = 1000;

function move(p: Plan): Motion {
  const ride = p.sport === 'ride';
  const solve = (k0: number) => solveScale((k) => integrate(p.ctx, k, null), p.targetTime, k0, ride ? 0.01 : 0.05, ride ? 60 : 20);
  let solution = solve(p.k0);
  // A glycogen threshold would make moving time jump with the effort scale, so the onset found at the solved effort
  // is frozen and the effort solved again with the wall in place (keeps the search monotone).
  const fat = p.ctx.fatigue;
  if (fat && fat.glycogen > 0 && solution.outcome.wallAt < p.total - WALL_FINISH_GUARD) {
    fat.wallFrom = solution.outcome.wallAt;
    solution = solve(solution.k);
  }
  const rec = new KinRecord(p.expectedSamples);
  const outcome = integrate(p.ctx, solution.k, rec);
  const n = rec.n;
  const moving = new Uint8Array(n);
  for (let i = 1; i < n; i++) moving[i] = rec.dist[i] > rec.dist[i - 1] ? 1 : 0;
  if (n > 1) moving[0] = moving[1];
  const demEle = trueElevation(p.track, rec.dist.subarray(0, n), n);
  const heat = heatStrain(p.env, n, p.bodyKg);
  const weather = recordEnvironment(p.env, rec, n, GAIT_WALK);
  const acclimatisation = p.mountain.acclimatisation;
  const altitude = altitudeSeries(demEle, n, acclimatisation);
  const hrMaxFactor = new Float64Array(n);
  const restOffset = new Float64Array(n);
  const restAt = new Float64Array(n);
  const maxAt = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    hrMaxFactor[i] = hrMaxAltitudeFactor(altitude[i], acclimatisation);
    restOffset[i] = p.athlete.restHr * (restHrAltitudeFactor(demEle[i], acclimatisation) - 1);
    restAt[i] = p.athlete.restHr + restOffset[i];
    maxAt[i] = p.athlete.maxHr * hrMaxFactor[i];
  }
  return {
    solution,
    outcome,
    rec,
    n,
    moving,
    demEle,
    altitude,
    hrMaxFactor,
    restOffset,
    restAt,
    maxAt,
    airTemp: weather.temp,
    wallFrom: fat ? fat.wallFrom : Infinity,
    weather,
    heat,
  };
}

/**
 * Net VO2 per second with the terrain cost the kinematics recorded and the economy lost to fatigue. The presets
 * measure it too, so a solved effort is judged on the heart rate the athlete really carries late in a long run; the
 * loss shares the slow-rise budget rather than stacking on it (see DRIFT), so counting it does not slow races twice.
 */
function demandVo2(p: Plan, m: Motion, vo2Reserve: number, withEconomy: boolean): Float64Array {
  const vo2 = metabolicDemand(m.rec, m.n, p.sport, p.bodyKg, vo2Reserve);
  for (let i = 0; i < m.n; i++) {
    vo2[i] *= m.rec.cost[i] * (withEconomy ? m.rec.economy[i] : 1);
    if (withEconomy && vo2[i] < m.rec.floor[i]) vo2[i] = m.rec.floor[i];
  }
  return vo2;
}

interface HeartPass {
  demand: DemandResult;
  hr: Float64Array;
}

/** Metabolic demand → HR demand → kinetics → sensor for one VO2max. Pure in (plan, motion, vo2max, cadence). */
function heartPass(p: Plan, m: Motion, vo2max: number, cadence: Float64Array): HeartPass {
  const { athlete, session, fit } = p;
  const vo2 = demandVo2(p, m, Math.max(5, vo2max - 3.5), true);
  // Shivering raises O2 uptake, and with it heart rate, on top of the motion's demand.
  for (let i = 0; i < m.n; i++) vo2[i] += m.heat.shiverVo2[i];
  const hrParams = {
    rest: athlete.restHr,
    max: athlete.maxHr,
    vo2max,
    tauScale: fit.tauScale,
    fracLT: fit.fracLT,
    slowComponent: p.sport === 'ride' ? SLOW_COMPONENT.ride : SLOW_COMPONENT.run,
    driftScale: DRIFT_BY_LEVEL[athlete.fitness] ?? 1,
  };
  // Altitude lowers HRmax and raises resting HR each second; the weather enters through the heat balance.
  const economy = new Float64Array(m.n);
  for (let i = 0; i < m.n; i++) economy[i] = m.rec.economy[i] - 1;
  const demand = hrDemand(vo2, m.n, hrParams, {
    moving: m.moving,
    vo2maxFactor: m.altitude,
    heat: m.heat.share,
    hrMaxFactor: m.hrMaxFactor,
    restOffset: m.restOffset,
    economy,
  });
  const levels = { rest: athlete.restHr, max: athlete.maxHr, restAt: m.restAt, maxAt: m.maxAt };
  const trueHr = hrKinetics(demand.demand, m.n, fit.tauScale, (m.n > 0 ? m.restAt[0] : athlete.restHr) + 20, levels, m.moving);
  // Breathing, posture and small effort changes: slow wander on the kinetic response, its own seeded channel, scaled by
  // the variability setting like the pace noise.
  const wander = physiologicalWander(m.n, m.moving, createRandom(session.seed, 'hr-wander'), 0.1 + (0.9 / 0.35) * session.variability);
  const hr = hrSensor(trueHr, m.n, session.hrSensor, athlete.restHr, athlete.maxHr, createRandom(session.seed, 'hr-sensor'), {
    cadence,
    artefacts: createRandom(session.seed, 'hr-artefact'),
    restAt: m.restAt,
    maxAt: m.maxAt,
    wander,
  });
  // Sensor noise may not push a recorded beat above the athlete's maximum heart rate (lower at altitude).
  const ceiling = Math.floor(athlete.maxHr);
  for (let i = 0; i < m.n; i++) {
    const cap = Math.min(ceiling, Math.round(m.maxAt[i]));
    if (hr[i] > cap) hr[i] = cap;
  }
  return { demand, hr };
}

/** Mean of a stream over timer-time samples (see timerSamples; all samples when the mask is empty). */
function timerMean(a: Float64Array, timer: Uint8Array, n: number): number {
  let sum = 0;
  let count = 0;
  for (let i = 0; i < n; i++) {
    if (!timer[i]) continue;
    sum += a[i];
    count++;
  }
  if (count > 0) return sum / count;
  for (let i = 0; i < n; i++) sum += a[i];
  return n > 0 ? sum / n : 0;
}

/** Effective VO2max search range for HR matching, and the range reported as physiologically usual. */
export const HR_MATCH_VO2MAX = { min: 20, max: 90, usualMin: 25, usualMax: 85 } as const;
/** Mean moving HR must land this close to the target, bpm. */
export const HR_MATCH_TOLERANCE = 0.5;

interface HrMatch {
  vo2max: number;
  pass: HeartPass;
  mean: number;
}

/**
 * Bisection on the effective VO2max: a higher VO2max turns the same metabolic demand into a smaller share of the
 * reserve, so mean HR falls monotonically with it (up to integer sensor rounding). Returns the closest pass.
 */
function matchHeartRate(p: Plan, m: Motion, cadence: Float64Array, target: number): HrMatch {
  const evaluate = (vo2max: number): HrMatch => {
    const pass = heartPass(p, m, vo2max, cadence);
    // Timer time, the same average the summary and the exported files report.
    return { vo2max, pass, mean: timerMean(pass.hr, timerSamples(m.moving, m.n), m.n) };
  };
  let lo = evaluate(HR_MATCH_VO2MAX.min);
  if (lo.mean <= target) return lo;
  let hi = evaluate(HR_MATCH_VO2MAX.max);
  if (hi.mean >= target) return hi;
  let best = Math.abs(lo.mean - target) < Math.abs(hi.mean - target) ? lo : hi;
  for (let iter = 0; iter < 40 && hi.vo2max - lo.vo2max > 1e-3; iter++) {
    const mid = evaluate(0.5 * (lo.vo2max + hi.vo2max));
    if (Math.abs(mid.mean - target) < Math.abs(best.mean - target)) best = mid;
    if (Math.abs(mid.mean - target) <= 0.05) break;
    if (mid.mean > target) lo = mid;
    else hi = mid;
  }
  return best;
}

/** Deterministic 1 Hz simulation: same input (including seed) → byte-identical output. */
export function simulate(input: SimulationInput, overrides: SimulationOverrides = {}): SimulationResult {
  const planned = planRun(input, overrides);
  if (!planned.ok) return planned.result;
  const p = planned.plan;
  const { athlete, session, sport, warnings, track, short, targetTime, fit, bodyKg, vBase, base, ctx } = p;
  const seed = session.seed;
  const ride = sport === 'ride';

  const m = move(p);
  const { solution, outcome, rec, n } = m;

  const streams = emptyStreams(n);
  for (let i = 0; i < n; i++) streams.t[i] = i;
  streams.dist.set(rec.dist.subarray(0, n));
  streams.speed.set(recordedSpeed(rec.speed, m.moving, n, createRandom(seed, 'speed-sensor')));
  streams.grade.set(rec.grade.subarray(0, n));
  streams.moving.set(m.moving);

  streams.cadence.set(cadenceStream(rec, n, sport, athlete, createRandom(seed, 'cadence')));
  const hrTarget = session.hrTarget ?? null;
  let heart: HeartPass;
  let vo2max = p.vo2max;
  let matched: HrMatch | null = null;
  if (hrTarget !== null) {
    matched = matchHeartRate(p, m, streams.cadence, hrTarget);
    heart = matched.pass;
    vo2max = matched.vo2max;
  } else {
    heart = heartPass(p, m, vo2max, streams.cadence);
  }
  // Effort warnings judge the effort against the VO2max the heart rate was derived from.
  const vo2Reserve = Math.max(5, vo2max - 3.5);
  streams.hrDemand.set(heart.demand.demand);
  streams.hr.set(heart.hr);
  streams.power.set(powerStream(rec, n, sport, bodyKg, createRandom(seed, 'run-power')));
  const pos = positionStreams(track, streams.dist, n, session.gpsNoise, seed);
  streams.lat.set(pos.lat);
  streams.lon.set(pos.lon);
  streams.ele.set(elevationStream(track, streams.dist, n, session.gpsNoise, seed, m.weather?.pressureOffset ? { pressureOffset: m.weather.pressureOffset } : {}));
  streams.temperature.set(
    temperatureStream(rec.speed, m.airTemp, n, sport, createRandom(seed, 'device-temp'), {
      skin: m.heat.skin,
      air: m.heat.air,
      rain: m.weather.precip,
      sleeve: m.heat.clothing.clo >= SLEEVE_CLO,
    }),
  );

  const summary = summarise(rec, streams, n, sport, bodyKg, session.lapDistance);

  // ---------------------------------------------------------------- warnings
  if (!outcome.finished) {
    warnings.push(`The simulation was cut off after ${clock(n - 1)}; the route is too long for the chosen target.`);
  } else if (solution.error > TOLERANCE) {
    const tooSlow = outcome.movingTime > targetTime;
    let reason: string;
    if (solution.bracketed) reason = 'moving time jumps between two nearly equal efforts on this route (a gait change or a stop)';
    else if (!tooSlow) reason = 'the slowest plausible moving speed still covers the route sooner';
    else if (short) reason = 'accelerating from a standing start takes up most of this short route';
    else if (ride) reason = `the maximum plausible power (${RIDE_MAX_POWER} W) and speed cap how fast this route can be ridden`;
    else reason = footLimitReason(outcome.limited, sport);
    warnings.push(
      `The target moving time of ${clock(targetTime)} could not be matched: ${reason}, so the moving time is ${clock(outcome.movingTime)}.`,
    );
  }
  if (matched && hrTarget !== null) {
    const lo = Math.round(athlete.restHr + 10);
    const hi = Math.round(athlete.maxHr - 2);
    if (hrTarget < lo || hrTarget > hi) {
      warnings.push(`The target average heart rate of ${Math.round(hrTarget)} bpm is outside this athlete's plausible range of ${lo}–${hi} bpm.`);
    }
    if (Math.abs(matched.mean - hrTarget) > HR_MATCH_TOLERANCE) {
      warnings.push(
        `The target average heart rate of ${Math.round(hrTarget)} bpm could not be matched on this route, so the average in the file is ${Math.round(matched.mean)} bpm.`,
      );
    } else if (matched.vo2max < HR_MATCH_VO2MAX.usualMin || matched.vo2max > HR_MATCH_VO2MAX.usualMax) {
      warnings.push(
        `Matching an average heart rate of ${Math.round(hrTarget)} bpm at this pace implies a VO2max of about ${Math.round(matched.vo2max)} ml/kg/min, outside the usual range of ${HR_MATCH_VO2MAX.usualMin}–${HR_MATCH_VO2MAX.usualMax}.`,
      );
    }
  }
  const k = solution.k;
  let flatUnsustainable = false;
  if (ride) {
    const flatPower = Math.min(RIDE_MAX_POWER, Math.max(k, ctx.kFloor ?? 0) * base);
    const frac = vo2NetRide(flatPower, bodyKg) / vo2Reserve;
    if (frac > 1 && !short) {
      flatUnsustainable = true;
      warnings.push(
        `The target needs about ${Math.round(flatPower)} W on flat road (${(flatPower / bodyKg).toFixed(1)} W/kg, ${Math.round(frac * 100)} % of VO2 reserve), more than this athlete can sustain; heart rate stays pinned near maximum.`,
      );
    }
    if (outcome.crawlSeconds > 10) {
      warnings.push(
        `Some climbs are too steep for the planned power, so the rider crawls at 3.6 km/h for about ${clock(outcome.crawlSeconds)}.`,
      );
    }
    if (outcome.descentSpeed < RIDE_MAX_SPEED) {
      let braked = false;
      for (let i = 1; i < n && !braked; i++) braked = streams.grade[i] < -0.02 && streams.speed[i] > 0.85 * outcome.descentSpeed;
      if (braked) {
        warnings.push(
          `The target average speed is slower than this route's descents allow at an easy effort, so the rider brakes to about ${Math.round(outcome.descentSpeed * 3.6)} km/h on descents.`,
        );
      }
    }
  } else {
    // The planned flat speed, after the running flat ceiling or the walking speed ceiling.
    const flatSpeed = sport === 'run' ? Math.min(k * vBase, runFlatCeiling(p)) : Math.min(k * vBase, WALK_MAX_SPEED);
    const vo2Flat = sport === 'run' ? vo2NetRun(flatSpeed, 0) : vo2NetWalk(flatSpeed, 0) * (ctx.packLoad ?? 1);
    const frac = vo2Flat / vo2Reserve;
    if (frac > 1 && !short) {
      flatUnsustainable = true;
      warnings.push(
        `On flat ground this target means ${pace(flatSpeed)}, about ${Math.round(frac * 100)} % of this athlete's VO2 reserve, which is not sustainable; heart rate stays pinned near maximum.`,
      );
    }
    const technical = technicalGroundWarning(track, ctx.ground ?? null, sport, session.target);
    if (technical) warnings.push(technical);
    if (outcome.hikeDistance > 20) {
      warnings.push(
        `Running speed on steep climbs fell below the walk–run transition, so ${Math.round(outcome.hikeDistance)} m were power-hiked with a walking gait and cadence.`,
      );
    }
    if (outcome.descentWalkDistance > 20) {
      warnings.push(`Some descents are too steep to run, so ${Math.round(outcome.descentWalkDistance)} m were walked down.`);
    }
    if (Number.isFinite(m.wallFrom)) {
      warnings.push(`Glycogen ran low around ${Math.round(m.wallFrom / 1000)} km, so the pace dropped sharply from there (hitting the wall).`);
    }
  }
  if (!flatUnsustainable && !short) {
    const endurance = enduranceWarning(heart.demand.frac, n, fit.fracLT);
    if (endurance) warnings.push(endurance);
  }
  const weather: WeatherSummary = summariseWeather(p.env.field, m.weather, m.heat, streams.dist, m.moving, n, p.env.startEpoch);
  if (weather.uncoveredS >= 60) {
    warnings.push(`The weather data ends ${clock(weather.uncoveredS)} before the activity does, so the last known hour was held.`);
  }
  warnings.push(...thermalWarnings(m.heat, m.moving, n));
  const wet = sport === 'ride' ? null : wetDescents(m.weather, streams, n);
  if (wet) warnings.push(`Rain made ${(weather.wetDistance / 1000).toFixed(1)} km of the route wet, and the wet descents were about ${wet} % slower.`);
  warnings.push(...altitudeWarnings(p, m));
  const result: SimulationResult = { streams, summary, warnings };
  if (matched) result.impliedVo2max = matched.vo2max;
  result.weather = weather;
  return result;
}

/** Clothing from which a sleeve covers the watch, clo. */
const SLEEVE_CLO = 0.9;

/**
 * Core temperatures the heat and cold notes are given from, °C, the cold slowdown worth a note, and the window it is
 * measured over, s.
 */
const THERMAL_NOTES = { hotCore: 39, coldCore: 36, coldSlowdown: 0.03, windowS: 600 } as const;

/** Notes on heat and cold: a high core temperature, a falling one, or cold muscles that held the pace down for minutes. */
function thermalWarnings(heat: HeatStrain, moving: Uint8Array, n: number): string[] {
  const out: string[] = [];
  if (heat.coreMax >= THERMAL_NOTES.hotCore) {
    out.push(`Heat pushed core temperature to about ${heat.coreMax.toFixed(1)} °C, so heart rate rose and the pace eased.`);
  }
  if (heat.coreMin <= THERMAL_NOTES.coldCore) {
    out.push(`Cold, wet weather cooled core temperature to about ${heat.coreMin.toFixed(1)} °C, so the pace slowed and shivering raised heart rate.`);
    return out;
  }
  // The worst ten-minute mean of the cold part of the speed factor over moving time.
  const w = THERMAL_NOTES.windowS;
  const prefix = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i] + (moving[i] ? heat.cold[i] : 1);
  let worst = 1;
  for (let i = w; i <= n; i++) worst = Math.min(worst, (prefix[i] - prefix[i - w]) / w);
  const pct = Math.round((1 - worst) * 100);
  if (1 - worst >= THERMAL_NOTES.coldSlowdown) out.push(`Cold, wind and wet clothing cooled the muscles and slowed the pace by up to about ${pct} %.`);
  return out;
}

/** Speed lost to the surface state on wet descents steeper than −5 %, whole per cent; null under 200 m or 3 %. */
function wetDescents(record: EnvironmentRecord, streams: ActivityStreams, n: number): number | null {
  let metres = 0;
  let factor = 0;
  for (let i = 1; i < n; i++) {
    if (!streams.moving[i] || streams.grade[i] > -0.05 || record.wetness[i] < 0.3) continue;
    const step = Math.max(0, streams.dist[i] - streams.dist[i - 1]);
    metres += step;
    factor += record.surfaceSpeed[i] * step;
  }
  if (metres < 200) return null;
  const pct = Math.round((1 - factor / metres) * 100);
  return pct >= 3 ? pct : null;
}

export interface EffortMeasure {
  /**
   * Moving-time-weighted mean fraction of VO2 reserve (profile VO2max, altitude-adjusted). Mountaineering measures it
   * over climbing time (grades from 2 %, when climbs are at least a fifth of moving time) and against the share of the
   * reserve still sustainable at altitude (see altitudeEndurance), so a preset keeps the slower pace of high climbs
   * instead of pushing through it, and costly snow descents do not hold the climbs back.
   */
  effort: number;
  /** Moving time the kinematics produced, s. */
  movingTime: number;
  /** Target moving time for the speed that was asked for, s. */
  targetTime: number;
  /** Foot: flat-ground speed at the solved effort, m/s. Ride: flat-road speed at the solved flat power. */
  flatSpeed: number;
  /** Route length, m. */
  distance: number;
  /** True when the kinematics met the target moving time. */
  matched: boolean;
  /** The effort scale the kinematics solved for this average speed. */
  k: number;
}

/**
 * Kinematics-only pass used by the effort presets: the same plan and calibrated motion simulate() would build for an
 * average moving speed of `mps`, reduced to the mean share of VO2 reserve. Null for degenerate or very short routes.
 */
export function measureEffort(input: SimulationInput, mps: number, reference = false): EffortMeasure | null {
  const base = reference ? referenceAir(input) : input;
  const session: SessionSettings = { ...base.session, target: { kind: 'speed', mps }, hrTarget: null };
  const planned = planRun({ ...base, session }, {});
  if (!planned.ok || planned.plan.short) return null;
  const p = planned.plan;
  const m = move(p);
  const vo2 = demandVo2(p, m, p.vo2Reserve, true);
  const alpine = p.sport === 'alpine';
  // Walking days are measured against what altitude leaves sustainable for hours, not against peak capacity.
  const onFoot = alpine || p.sport === 'hike' || p.sport === 'walk';
  // A walker high up settles far below even that: the pace is set by breathing, and guide times for the Nepal passes
  // are about half the sea-level rate for the same climb. The exponent fades in over HIKE_CLIMB's band, so walks below
  // it are untouched, and mountaineering keeps its own measure. HEURISTIC.
  const trek = onFoot && !alpine;
  const span = Math.max(1, HIKE_CLIMB.fullM - HIKE_CLIMB.fromM);
  let sum = 0;
  let count = 0;
  let climbSum = 0;
  let climbCount = 0;
  for (let i = 0; i < m.n; i++) {
    if (!m.moving[i]) continue;
    const f = m.altitude[i];
    let sustainable = onFoot ? altitudeEndurance(f, p.mountain.acclimatisation) : 1;
    if (trek && sustainable < 1) {
      const up = Math.min(1, Math.max(0, (m.demEle[i] - HIKE_CLIMB.fromM) / span));
      sustainable **= HIKE_CLIMB.paceExp * up * up * (3 - 2 * up);
    }
    const share = Math.max(0, vo2[i] / (Math.max(5, p.vo2max * f - 3.5) * sustainable));
    sum += share;
    count++;
    if (alpine && m.rec.grade[i] >= ALPINE_CLIMB.fromGrade) {
      climbSum += share;
      climbCount++;
    }
  }
  // A mountain day's effort is the climbing: descents on snow or scree cost more or less by ground, not by intent.
  const useClimbs = alpine && climbCount >= 0.2 * count;
  let flatSpeed = p.sport === 'run' ? Math.min(m.solution.k * p.vBase, runFlatCeiling(p)) : Math.min(m.solution.k * p.vBase, WALK_MAX_SPEED);
  if (p.sport === 'ride') flatSpeed = flatRideSpeed(p, Math.max(m.solution.k, p.ctx.kFloor ?? 0) * p.base);
  const measure: EffortMeasure = {
    effort: useClimbs ? climbSum / climbCount : count > 0 ? sum / count : 0,
    movingTime: m.outcome.movingTime,
    targetTime: p.targetTime,
    flatSpeed,
    distance: p.total,
    matched: m.outcome.finished && m.solution.error <= TOLERANCE,
    k: m.solution.k,
  };
  return measure;
}

/**
 * The same activity in the reference atmosphere the effort presets are solved in: 15 °C, 60 % humidity, calm and dry,
 * with no series. An easy run is the same easy run in any weather; what the weather changes is how long it takes.
 */
function referenceAir(input: SimulationInput): SimulationInput {
  const weather = { mode: 'manual' as const, manual: { ...NEUTRAL_MANUAL }, pinned: [] };
  return { ...input, weather: null, session: { ...input.session, temperatureC: NEUTRAL_AIR.temperatureC, weather } };
}

/**
 * Moving time this route takes at an average speed of `mps` and a fixed effort scale `k`, s, and whether the motion
 * finished. The effort presets solve `k` in the reference air and then read the time the weather makes of it.
 */
export function movingTimeAtEffort(input: SimulationInput, mps: number, k: number): { movingTime: number; finished: boolean } | null {
  const session: SessionSettings = { ...input.session, target: { kind: 'speed', mps }, hrTarget: null };
  const planned = planRun({ ...input, session }, {});
  if (!planned.ok) return null;
  const outcome = integrate(planned.plan.ctx, k, null);
  return { movingTime: outcome.movingTime, finished: outcome.finished };
}

/** Fastest planned flat running speed at the start elevation, m/s (see RUN_FLAT_CEILING). */
function runFlatCeiling(p: Plan): number {
  return (RUN_FLAT_CEILING * Math.max(5, p.vo2max * altitudeFactor(p.track.ele[0], p.mountain.acclimatisation) - VO2_REST)) / VO2_PER_FLAT_MPS;
}

function flatRideSpeed(p: Plan, power: number): number {
  const bike = p.ctx.bike;
  if (!bike) return 0;
  let lo = 0.5;
  let hi = 30;
  for (let i = 0; i < 40; i++) {
    const mid = 0.5 * (lo + hi);
    if (bikeSteadyPower(bike, mid, 0) > power) hi = mid;
    else lo = mid;
  }
  return 0.5 * (lo + hi);
}
