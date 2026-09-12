// simulate(): route profile + athlete + session → 1 Hz streams, summary and warnings. Pure and deterministic.
import type {
  ActivityStreams,
  ActivityType,
  Athlete,
  GpsNoiseLevel,
  HrSensor,
  PacingStrategy,
  SessionSettings,
  SimulationInput,
  SimulationResult,
  StopsLevel,
  TargetSpec,
} from '../types';
import { fitnessParams, resolveVo2max, sanitiseAthlete, type FitnessParams } from './athlete';
import {
  cadenceStream,
  elevationStream,
  metabolicDemand,
  positionStreams,
  powerStream,
  trueElevation,
} from './channels';
import { hrDemand, hrKinetics, hrSensor, type DemandResult } from './hr';
import {
  BlipTrack,
  FOOT_ACCEL,
  FOOT_DECEL,
  FOOT_MIN_SPEED,
  KinRecord,
  PEDAL_BURSTS,
  type KinOutcome,
  type ScaleSolution,
  hikeWeight,
  RIDE_CORNER_DECEL,
  RIDE_MAX_POWER,
  RIDE_MAX_SPEED,
  integrate,
  solveScale,
  type KinContext,
} from './kinematics';
import {
  bikePhysics,
  bikeSteadyPower,
  runGradeMultiplier,
  vo2NetRide,
  vo2NetRun,
  vo2NetWalk,
  walkGradeMultiplier,
} from './models';
import { OuTrack, createRandom } from './rng';
import { normaliseStops, planStops, type StopEvent } from './stops';
import { summarise } from './summary';
import { buildTrack, cornerCaps, mapGrade, type Track } from './track';

export interface SimulationOverrides {
  /** Explicit stops (distance + seconds) instead of the random schedule from session.stops. */
  stops?: ReadonlyArray<StopEvent>;
}

const SPORTS: ReadonlyArray<ActivityType> = ['run', 'ride', 'walk', 'hike'];
const PACINGS: ReadonlyArray<PacingStrategy> = ['even', 'negative', 'positive'];
const STOPS_LEVELS: ReadonlyArray<StopsLevel> = ['none', 'few', 'urban'];
const GPS_LEVELS: ReadonlyArray<GpsNoiseLevel> = ['off', 'low', 'normal', 'high'];
const SENSORS: ReadonlyArray<HrSensor> = ['strap', 'optical'];
const FALLBACK_SPEED: Record<ActivityType, number> = { run: 3.0, walk: 1.39, hike: 1.1, ride: 25 / 3.6 };
/** Lateral acceleration limits in corners, m/s². */
const CORNER_LATERAL: Record<ActivityType, number> = { run: 2.5, walk: 1.5, hike: 1.5, ride: 4.0 };
const PACING_SLOPE: Record<PacingStrategy, number> = { even: 0, negative: 0.03, positive: -0.04 };
/** Pace noise amplitudes (τ s, σ of log-speed) that correspond to variability 0.35. */
const PACE_NOISE = [
  [4, 0.01],
  [45, 0.02],
  [600, 0.015],
] as const;
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
/** Flat walking speed treated as running speed by the walk warning, m/s. */
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
  return {
    ...s,
    type: pick(s?.type, SPORTS, 'run'),
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

/** VO2max multiplier at altitude: −8 % per 1000 m above 1500 m (Fulco 1998 order of magnitude). */
function altitudeFactor(ele: Float64Array, n: number): Float64Array {
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) out[i] = Math.max(0.6, 1 - 0.08 * Math.max(0, (ele[i] - 1500) / 1000));
  return out;
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
}

type Planned = { ok: true; plan: Plan } | { ok: false; result: SimulationResult };

function planRun(input: SimulationInput, overrides: SimulationOverrides): Planned {
  const athlete = sanitiseAthlete(input.athlete);
  const session = sanitiseSession(input.session);
  const sport = session.type;
  const warnings: string[] = [];
  const gradeLimit = sport === 'ride' ? 0.35 : 0.45;
  const track = buildTrack(input.profile, gradeLimit);
  if (track.n < 2 || !(track.total >= 1)) return { ok: false, result: degenerate(track, athlete, warnings) };

  const total = track.total;
  const short = total < SHORT_ROUTE;
  if (total < 50) warnings.push(`The route is only ${Math.round(total)} m long, so the activity lasts just a few seconds.`);
  const clamped = input.profile.points.some((p) => Number.isFinite(p.grade) && Math.abs(p.grade) > gradeLimit);
  if (clamped) warnings.push(`Grades steeper than ${Math.round(gradeLimit * 100)} % were treated as ${Math.round(gradeLimit * 100)} %.`);

  const targetTime = targetMovingTime(session.target, total, sport, warnings);
  const seed = session.seed;
  const fit = fitnessParams(athlete.fitness);
  const bodyKg = athlete.weightKg;
  const vo2max = resolveVo2max(athlete);
  const vo2Reserve = Math.max(5, vo2max - 3.5);
  const noiseScale = 0.1 + (0.9 / 0.35) * session.variability;

  const stops = overrides.stops
    ? normaliseStops(overrides.stops, total)
    : planStops(session.stops, total, total / targetTime, createRandom(seed, 'stops'));
  const stopSeconds = stops.reduce((sum, e) => sum + e.duration, 0);
  const maxSteps = Math.min(MAX_SECONDS, Math.ceil(total / (FOOT_MIN_SPEED * 0.8) + stopSeconds + 120));
  const expectedSamples = Math.min(maxSteps + 2, Math.ceil(targetTime * 1.1 + stopSeconds + 32));

  const ride = sport === 'ride';
  const bike = ride ? bikePhysics(bodyKg, track.ele[0], session.temperatureC) : null;
  const rel = ride ? new Float64Array(0) : mapGrade(track, sport === 'run' ? runGradeMultiplier : walkGradeMultiplier);
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
    for (let j = 1; j < track.n; j++) inv += (track.d[j] - track.d[j - 1]) / (0.5 * (rel[j] + rel[j - 1]));
    k0 = inv / total;
  }
  const flatEstimate = k0 * vBase;
  const restartRandom = createRandom(seed, 'restart');
  const ctx: KinContext = {
    sport,
    track,
    rel,
    cap,
    base,
    warmup: fit.warmup,
    // Heat raises cardiac drift (hr.ts), not the speed fade: a fade would lower demand and hide the drift.
    fatiguePerHour: fit.fatiguePerHour,
    pacingSlope: PACING_SLOPE[session.pacing],
    noise: ride
      ? new OuTrack(createRandom(seed, 'ride-power'), POWER_NOISE, noiseScale, expectedSamples)
      : new OuTrack(createRandom(seed, 'pace'), PACE_NOISE, noiseScale * (sport === 'run' ? 1 : 1.5), expectedSamples),
    stops,
    maxSteps,
    bike,
    blips: ride ? new BlipTrack(createRandom(seed, 'coast'), session.variability >= 0.05) : null,
    hike: sport === 'run' ? mapGrade(track, (g) => hikeWeight(flatEstimate * runGradeMultiplier(g), g)) : undefined,
    // Power-hiking is capped at the ≈30-min sustainable share of VO2 reserve (same limit as the endurance check).
    // It always uses the profile VO2max, so matching an average heart rate never changes the kinematics.
    hikeVo2Cap: Math.min(1.05, fit.fracLT + 0.13) * vo2Reserve,
    hikeRefK: k0,
    restartAccel: Float64Array.from(stops, () => 0.45 + 0.15 * restartRandom.uniform()),
    // A pedalled flat slower than 80 % of the target average is implausible; below that effort, descents brake.
    kFloor: ride ? Math.min(1, bikeSteadyPower(bike!, 0.8 * vBase, 0) / base) : 0,
    drag: ride ? new OuTrack(createRandom(seed, 'ride-drag'), DRAG_NOISE, noiseScale, expectedSamples) : null,
    descentLimit: ride ? new OuTrack(createRandom(seed, 'ride-descent'), DESCENT_NOISE, noiseScale, expectedSamples) : null,
    bursts: ride ? new BlipTrack(createRandom(seed, 'ride-burst'), session.variability >= 0.05, PEDAL_BURSTS) : null,
  };
  return {
    ok: true,
    plan: { athlete, session, sport, warnings, track, total, short, targetTime, fit, bodyKg, vo2max, vo2Reserve, vBase, base, k0, ctx, expectedSamples },
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
}

function move(p: Plan): Motion {
  const ride = p.sport === 'ride';
  const solution = solveScale((k) => integrate(p.ctx, k, null), p.targetTime, p.k0, ride ? 0.01 : 0.05, ride ? 60 : 20);
  const rec = new KinRecord(p.expectedSamples);
  const outcome = integrate(p.ctx, solution.k, rec);
  const n = rec.n;
  const moving = new Uint8Array(n);
  for (let i = 1; i < n; i++) moving[i] = rec.dist[i] > rec.dist[i - 1] ? 1 : 0;
  if (n > 1) moving[0] = moving[1];
  const demEle = trueElevation(p.track, rec.dist.subarray(0, n), n);
  return { solution, outcome, rec, n, moving, demEle, altitude: altitudeFactor(demEle, n) };
}

interface HeartPass {
  demand: DemandResult;
  hr: Float64Array;
}

/** Metabolic demand → HR demand → kinetics → sensor for one VO2max. Pure in (plan, motion, vo2max, cadence). */
function heartPass(p: Plan, m: Motion, vo2max: number, cadence: Float64Array): HeartPass {
  const { athlete, session, fit } = p;
  const vo2 = metabolicDemand(m.rec, m.n, p.sport, p.bodyKg, Math.max(5, vo2max - 3.5));
  const hrParams = {
    rest: athlete.restHr,
    max: athlete.maxHr,
    vo2max,
    tauScale: fit.tauScale,
    fracLT: fit.fracLT,
    temperatureC: session.temperatureC,
  };
  const demand = hrDemand(vo2, m.n, hrParams, { moving: m.moving, vo2maxFactor: m.altitude });
  const levels = { rest: athlete.restHr, max: athlete.maxHr };
  const trueHr = hrKinetics(demand.demand, m.n, fit.tauScale, athlete.restHr + 20, levels);
  const hr = hrSensor(trueHr, m.n, session.hrSensor, athlete.restHr, athlete.maxHr, createRandom(session.seed, 'hr-sensor'), {
    cadence,
    artefacts: createRandom(session.seed, 'hr-artefact'),
  });
  return { demand, hr };
}

/** Mean of a stream over moving samples (all samples when nothing moves). */
function movingMean(a: Float64Array, moving: Uint8Array, n: number): number {
  let sum = 0;
  let count = 0;
  for (let i = 0; i < n; i++) {
    if (!moving[i]) continue;
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
    return { vo2max, pass, mean: movingMean(pass.hr, m.moving, m.n) };
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
  streams.speed.set(rec.speed.subarray(0, n));
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
  streams.ele.set(elevationStream(track, streams.dist, n, session.gpsNoise, seed));

  const summary = summarise(rec, streams, n, sport, bodyKg, session.lapDistance, m.demEle);

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
    else reason = 'corner speed limits and the maximum plausible speed on this route cap how fast it can be covered';
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
        `The target average heart rate of ${Math.round(hrTarget)} bpm could not be matched on this route, so the average over moving time is ${Math.round(matched.mean)} bpm.`,
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
    const flatSpeed = k * vBase;
    const vo2Flat = sport === 'run' ? vo2NetRun(flatSpeed, 0) : vo2NetWalk(flatSpeed, 0);
    const frac = vo2Flat / vo2Reserve;
    if (frac > 1 && !short) {
      flatUnsustainable = true;
      warnings.push(
        `On flat ground this target means ${pace(flatSpeed)}, about ${Math.round(frac * 100)} % of this athlete's VO2 reserve, which is not sustainable; heart rate stays pinned near maximum.`,
      );
    }
    if (sport !== 'run' && flatSpeed > WALK_RUNNING_SPEED && !short) {
      warnings.push(`A flat walking speed of ${pace(flatSpeed)} is running speed; the walking model is stretched beyond its data.`);
    }
    if (outcome.hikeDistance > 20) {
      warnings.push(
        `Running speed fell below 1.9 m/s on climbs of 6 % or steeper, so ${Math.round(outcome.hikeDistance)} m were power-hiked with a walking gait and cadence.`,
      );
    }
  }
  if (!flatUnsustainable && !short) {
    const endurance = enduranceWarning(heart.demand.frac, n, fit.fracLT);
    if (endurance) warnings.push(endurance);
  }
  const result: SimulationResult = { streams, summary, warnings };
  if (matched) result.impliedVo2max = matched.vo2max;
  return result;
}

export interface EffortMeasure {
  /** Moving-time-weighted mean fraction of VO2 reserve (profile VO2max, altitude-adjusted). */
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
}

/**
 * Kinematics-only pass used by the effort presets: the same plan and calibrated motion simulate() would build for an
 * average moving speed of `mps`, reduced to the mean share of VO2 reserve. Null for degenerate or very short routes.
 */
export function measureEffort(input: SimulationInput, mps: number): EffortMeasure | null {
  const session: SessionSettings = { ...input.session, target: { kind: 'speed', mps }, hrTarget: null };
  const planned = planRun({ ...input, session }, {});
  if (!planned.ok || planned.plan.short) return null;
  const p = planned.plan;
  const m = move(p);
  const vo2 = metabolicDemand(m.rec, m.n, p.sport, p.bodyKg, p.vo2Reserve);
  let sum = 0;
  let count = 0;
  for (let i = 0; i < m.n; i++) {
    if (!m.moving[i]) continue;
    sum += Math.max(0, vo2[i] / Math.max(5, p.vo2max * m.altitude[i] - 3.5));
    count++;
  }
  let flatSpeed = m.solution.k * p.vBase;
  if (p.sport === 'ride') flatSpeed = flatRideSpeed(p, Math.max(m.solution.k, p.ctx.kFloor ?? 0) * p.base);
  return {
    effort: count > 0 ? sum / count : 0,
    movingTime: m.outcome.movingTime,
    targetTime: p.targetTime,
    flatSpeed,
    distance: p.total,
    matched: m.outcome.finished && m.solution.error <= TOLERANCE,
  };
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
