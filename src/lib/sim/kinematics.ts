// 1 Hz motion along the route: foot sports (planned speed + rate limits) and cycling (Martin 1998 dynamics).
// One integrator is used both for calibration (no recording) and for the final recorded pass, so the
// calibrated moving time is exactly the moving time of the output.
import type { ActivityType, FitnessLevel } from '../types';
import {
  FLAT_KM_JOULES,
  RIDE_LOAD_SHARE,
  RUN_FLAT_CEILING,
  VO2_PER_FLAT_MPS,
  WALL_SLOWDOWN,
  WALL_WALK,
  WALL_MIN_EFFORT,
  WALL_RAMP_M,
  WALL_THRESHOLD,
  carbBurn,
  descentLoadRate,
  descentSaturation,
  dPrimeCeiling,
  economyFactor,
  fadeFactor,
  loadWeight,
  stepDPrime,
  DESCENT_FADE,
  DESCENT_FLAT_FADE,
  type FadeParams,
} from './fatigue';
import {
  CYCLING,
  DESCENT_WALK_GRADE,
  DESCENT_WALK_RUN_SPEED,
  DESCENT_WALK_SKILL,
  DESCENT_WALK_SPEED,
  J_PER_ML_O2,
  LIGHT_FOOTWEAR_KG,
  VO2_REST,
  WALK_BREAK_HR_FLOOR,
  WALK_MAX_SPEED,
  WALK_VO2_CEILING,
  bikeResistance,
  bikeSteadyPower,
  costRun,
  costWalk,
  loadedClimbSpeed,
  paceFactorHr,
  powerHikeSpeed,
  ridePowerGradeFactor,
  softCap,
  toblerShape,
  transitionSpeed,
  vamSpeedLimit,
  vo2NetLoaded,
  vo2NetRide,
  vo2NetRun,
  vo2NetWalk,
  walkSpeedCostFactor,
  type BikePhysics,
} from './models';
import type { EnvironmentSampler } from './environment';
import { STEPS, technicalWalkWeight, type GroundTrack } from './ground';
import type { OuTrack, Random } from './rng';
import type { StopEvent } from './stops';
import { Cursor, type Track } from './track';

export const GAIT_RUN = 0;
export const GAIT_WALK = 1;
export const GAIT_PEDAL = 2;
export const GAIT_COAST = 3;
export const GAIT_STOPPED = 4;

export const FOOT_ACCEL = 0.6;
export const FOOT_DECEL = 1.2;
/** Braking curve into a stop, planned under FOOT_DECEL so 1 s sampling stays within it. */
const FOOT_STOP_DECEL = 1.0;
/** Progress floor for foot sports (≈0.5 km/h, slower than any real hiker on 40 % ground). */
export const FOOT_MIN_SPEED = 0.15;
/** Progress floor on mountain days, m/s: summit pushes near 7000 m average about 0.15 m/s including their slowest steps. */
export const ALPINE_MIN_SPEED = 0.08;
/**
 * Climbs on a mountain day are capped by an oxygen budget: net walking VO2 ≤ share·(VO2max·f − 3.5)·(1 − 0.5·(1 − f)),
 * f the altitude VO2max multiplier (see altitudeEndurance). The share grows with the planned flat speed and equals
 * `share` at the Swiss standard 4.2 km/h, so a faster target climbs harder and moving time stays monotone in the effort
 * the calibration solves. It applies in full from `fromGrade` (HEURISTIC; calibrated on guided summit days).
 */
export const ALPINE_CLIMB = { share: 0.5, refSpeed: 4.2 / 3.6, minShare: 0.1, maxShare: 1, fromGrade: 0.02 } as const;

/**
 * The same oxygen budget on a walking or trekking day, and the elevation band over which it starts to bind. Trekkers
 * climb well below the effort a mountaineer accepts (guidebook rates of 300 m/h above 4000 m), and at altitude the
 * limit is the air, not the legs (Wehrlin & Hallén 2006; Matthews 2020). Below `fromM` nothing is capped at all, so
 * low-level walks are untouched. HEURISTIC share and band.
 */
export const HIKE_CLIMB = { share: 0.34, fromM: 1500, fullM: 3000, paceExp: 1 } as const;

/** Oxygen budget on climbs for a walking day that is not mountaineering (see HIKE_CLIMB). */
export interface ClimbO2 {
  /** Net VO2 a climb may use at a share of 1 per track point, ml/kg/min. */
  budget: Float64Array;
  /** How far the budget has come in per track point, 0 below fromM to 1 above fullM. */
  weight: Float64Array;
  /** Climbing-rate multiplier per track point: 1 low down, the sustainable share of sea-level power high up. */
  vam: Float64Array;
}
/** Pace texture is compressed above this share of a sustained speed ceiling, so the ceiling bounds the motion itself. */
export const CEILING_KNEE = 0.95;
const smooth01 = (x: number): number => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

/** A gait switch needs at least this long or this far in the current gait (s, m; HEURISTIC). */
const GAIT_DWELL_S = 25;
const GAIT_DWELL_M = 50;
/**
 * Scale of run/walk alternation, s: at an even walking share a runner walks and runs about this long each. Steep
 * grades alternate in short bouts (athletes mix gaits on steep inclines, trading energy cost against soleus load;
 * Whiting 2020), gentle grades in long ones, so nobody flips gait every few hundred metres (HEURISTIC).
 */
const BOUT_STEEP_S = 20;
const BOUT_GENTLE_S = 150;
/**
 * Spread of bout lengths and dwell times, coefficient of variation: each gait switch draws a seeded lognormal multiplier,
 * so bouts on a steady climb do not repeat on an exact period while the walking share keeps following the duty (HEURISTIC).
 */
export const BOUT_SPREAD = 0.4;
/**
 * Carry-over after a change of grade, s: level speed stays depressed for ≈78 s after a climb and raised for ≈24 s
 * after a descent (Townshend 2010), so the planned grade multiplier follows a rise after a climb with τ ≈ 30 s and a
 * fall after a descent with τ ≈ 10 s. Entering a climb or a descent stays immediate.
 */
export const CREST_TAU = { afterClimb: 30, afterDescent: 10 } as const;
/** Power-hiking is visibly slower than running the same grade: at most this share of the running speed (HEURISTIC). */
const HIKE_RUN_RATIO = 0.85;
/** Fastest power-hike on a climb, m/s (HEURISTIC). */
const HIKE_MAX_SPEED = 1.75;

/**
 * Walking weight (0 run … 1 walk) for a planned running speed on a long-baseline grade. Uphill it rises across a band
 * around the transition speed, wider on steep grades where runners mix gaits; downhill it rises across
 * DESCENT_WALK_GRADE, steeper for skilled descenders (`skill` 0…1), and where the descent only allows a shuffle under
 * DESCENT_WALK_RUN_SPEED.
 */
export function walkWeight(vRun: number, grade: number, offset: number, skill = 0): number {
  if (grade >= 0) {
    const vT = transitionSpeed(grade);
    if (vT <= 0) return 0;
    const steep = smooth01((grade - 0.12) / 0.08);
    const lo = vT - offset - 0.15 - 0.35 * steep;
    const hi = vT - offset + 0.1 + 0.15 * steep;
    return smooth01((hi - vRun) / (hi - lo));
  }
  const shift = DESCENT_WALK_GRADE.skill * Math.min(1, Math.max(0, skill));
  const tooSteep = smooth01((-grade - DESCENT_WALK_GRADE.from - shift) / (DESCENT_WALK_GRADE.to - DESCENT_WALK_GRADE.from));
  const shuffle = grade < -0.08 ? smooth01((DESCENT_WALK_RUN_SPEED + 0.1 - vRun) / 0.2) : 0;
  return Math.max(tooSteep, shuffle);
}

/** Alternation scale on a long-baseline grade, s. */
function boutScale(grade: number): number {
  const g = Math.abs(grade);
  if (g >= 0.15) return BOUT_STEEP_S;
  if (g <= 0.06) return BOUT_GENTLE_S;
  return BOUT_GENTLE_S + ((BOUT_STEEP_S - BOUT_GENTLE_S) * (g - 0.06)) / 0.09;
}

const RIDE_SUBSTEPS = 4;
export const RIDE_CORNER_DECEL = 2.5;
const RIDE_STOP_DECEL = 2.0;
/** Descent speed a recreational rider brakes to (heuristic, ≈65 km/h). */
export const RIDE_MAX_SPEED = 18;
/** Deceleration used to brake toward the descent set point, m/s². */
const RIDE_BRAKE_DECEL = 1.5;
/** Human ceiling on planned crank power, W. */
export const RIDE_MAX_POWER = 2000;
const COAST_ENTER_SPEED = 11.1; // 40 km/h on descents steeper than −4 %
const COAST_EXIT_SPEED = 10.0;
const SPIN_OUT_SPEED = 15.5;
const CRAWL_SPEED = 1.0;
/** Ramp from a standstill when the planned power cannot move the bike on a steep ramp, m/s². */
const CRAWL_ACCEL = 0.5;
/** Arrival: land exactly on the stop when that needs an end speed no higher than this (m/s). */
const ARRIVAL_SPEED = 1.0;

export class KinRecord {
  n = 0;
  dist: Float64Array;
  speed: Float64Array;
  grade: Float64Array;
  power: Float64Array;
  gait: Uint8Array;
  /** Multiplier on the O2 cost of the recorded motion from the terrain under it (1 on smooth pavement). */
  cost: Float64Array;
  /** Multiplier on the O2 cost from fatigue (running economy lost to load and descent damage). */
  economy: Float64Array;
  /** Lowest net VO2 heart rate responds to, ml/kg/min (walk breaks during a run; 0 elsewhere). */
  floor: Float64Array;

  constructor(capacity: number) {
    const c = Math.max(16, Math.ceil(capacity));
    this.dist = new Float64Array(c);
    this.speed = new Float64Array(c);
    this.grade = new Float64Array(c);
    this.power = new Float64Array(c);
    this.gait = new Uint8Array(c);
    this.cost = new Float64Array(c);
    this.economy = new Float64Array(c);
    this.floor = new Float64Array(c);
  }

  push(s: number, v: number, g: number, p: number, gait: number, cost = 1, economy = 1, floor = 0): void {
    if (this.n === this.dist.length) this.grow();
    const i = this.n++;
    this.dist[i] = s;
    this.speed[i] = v;
    this.grade[i] = g;
    this.power[i] = p;
    this.gait[i] = gait;
    this.cost[i] = cost;
    this.economy[i] = economy;
    this.floor[i] = floor;
  }

  private grow(): void {
    const c = Math.ceil(this.dist.length * 1.5) + 16;
    const f = (a: Float64Array): Float64Array => {
      const b = new Float64Array(c);
      b.set(a);
      return b;
    };
    this.dist = f(this.dist);
    this.speed = f(this.speed);
    this.grade = f(this.grade);
    this.power = f(this.power);
    this.cost = f(this.cost);
    this.economy = f(this.economy);
    this.floor = f(this.floor);
    const g = new Uint8Array(c);
    g.set(this.gait);
    this.gait = g;
  }
}

export interface BlipTiming {
  /** Shortest episode, s. */
  minLength: number;
  /** Random extra length, s. */
  lengthSpan: number;
  /** Shortest gap between episodes, s. */
  minGap: number;
  /** Random extra gap, s. */
  gapSpan: number;
}

/** Coasting blips on flat roads: 2–5 s every 1–3 min. */
export const COAST_BLIPS: BlipTiming = { minLength: 2, lengthSpan: 4, minGap: 60, gapSpan: 120 };
/** Pedal bursts while coasting a gentle descent: 3–8 s every 40–120 s (HEURISTIC). */
export const PEDAL_BURSTS: BlipTiming = { minLength: 3, lengthSpan: 6, minGap: 40, gapSpan: 80 };

/** Lazily generated on/off episodes indexed by second. */
export class BlipTrack {
  private buf = new Uint8Array(4096);
  /** Every index below this is final. */
  private filled = 0;
  private nextStart: number;

  constructor(
    private readonly random: Random,
    private readonly enabled: boolean,
    private readonly timing: BlipTiming = COAST_BLIPS,
  ) {
    this.nextStart = timing.minGap + Math.floor(random.uniform() * timing.gapSpan);
  }

  at(i: number): boolean {
    if (!this.enabled) return false;
    while (i >= this.filled) this.addBlip();
    return this.buf[i] === 1;
  }

  private addBlip(): void {
    const t = this.timing;
    const end = this.nextStart + t.minLength + Math.floor(this.random.uniform() * t.lengthSpan);
    if (end > this.buf.length) {
      const grown = new Uint8Array(Math.max(end, this.buf.length * 2));
      grown.set(this.buf);
      this.buf = grown;
    }
    for (let k = this.nextStart; k < end; k++) this.buf[k] = 1;
    this.filled = end;
    this.nextStart = end + t.minGap + Math.floor(this.random.uniform() * t.gapSpan);
  }
}

/**
 * Within-activity fatigue (see fatigue.ts). All states use the profile VO2max, so heart-rate matching never
 * changes the motion.
 */
export interface FatigueContext {
  fitness: FitnessLevel;
  /** Profile VO2max, ml/kg/min. */
  vo2max: number;
  /** VO2max multiplier per track point (altitude), or null for 1. */
  altitude: Float64Array | null;
  fade: FadeParams;
  /** Share of the load fade applied (below 1 when a full fade would front-load a long run). */
  fadeScale: number;
  /** Critical speed as a share of VO2 reserve. */
  csFraction: number;
  /** Runs: D′ in flat-equivalent metres; 0 disables the governor. */
  dPrime: number;
  /** Runs: starting glycogen, kcal/kg; 0 disables the wall. */
  glycogen: number;
  /** Carbohydrate intake, kcal/kg per second. */
  intake: number;
  /** Distance where the wall sets in (frozen between calibration passes); Infinity for none. */
  wallFrom: number;
}

/** Foot: gait decisions and climbing limits. */
export interface GaitContext {
  /** Grade over a ≥ 100 m baseline per track point, so short ramps and DEM bumps never change gait. */
  longGrade: Float64Array;
  /** Runs: running speed multiplier at the long-baseline grade per track point. */
  relLong: Float64Array;
  /** Subtracted from the walk–run transition speed, m/s. */
  transitionOffset: number;
  /** Highest sustained vertical speed, m/h (0 = none). */
  vam: number;
  /** Runs: descent skill 0…1 (see DESCENT_SKILL), lowered on technical ground; steeper descents stay run, walked ones go faster. */
  descentSkill?: number;
  /** Runs: seeded bout-length and dwell multipliers (see BOUT_SPREAD), taken in order, one per gait switch. */
  boutJitter?: Float64Array;
}

/** Mountaineering: the oxygen budget that caps climbs, and the gear that raises walking cost. */
export interface AlpineContext {
  /** Net VO2 a climb may use at a share of 1 per track point, ml/kg/min: (VO2max·f − 3.5)·altitudeEndurance(f). */
  budget: Float64Array;
  /** Footwear pair mass per track point, kg (crampons included on snow and ice). */
  footKg: Float64Array;
  /** Pack multiplier on net walking cost. */
  load: number;
  /** Speed and cost multipliers of the terrain snow of the day (see snowFactors), against which weather's fresh snow is compared. */
  snowSpeed: number;
  snowCost: number;
}

/** Moving seconds each speed ceiling held the motion down; the ceiling that binds most names why a target was missed. */
export interface LimitSeconds {
  /** Corner and maximum-speed caps. */
  corner: number;
  /** Vertical speed ceiling on climbs. */
  vertical: number;
  /** Flat ceiling: the fastest planned running pace, or the fastest plausible walking speed or VO2. */
  flat: number;
  /** Mountaineering: the oxygen budget on climbs. */
  oxygen: number;
}

export interface KinContext {
  sport: ActivityType;
  track: Track;
  /** Foot: grade speed multiplier per profile point. */
  rel: Float64Array;
  /** Corner caps after braking/acceleration passes, m/s. */
  cap: Float64Array;
  /** Foot: average target speed m/s; ride: flat power at the target speed, W. */
  base: number;
  warmup: number;
  fatigue: FatigueContext | null;
  /** pacingPlan(x) = 1 + slope·(x/D − 0.5). */
  pacingSlope: number;
  /** Log-speed noise (foot) or log-power noise (ride). */
  noise: OuTrack;
  stops: StopEvent[];
  maxSteps: number;
  bike: BikePhysics | null;
  blips: BlipTrack | null;
  /** Foot: walk/run decisions (runs) and the vertical-speed ceiling (every foot sport). */
  gait?: GaitContext;
  /** Ground factors per track point (surface, technicality), or null on untagged routes. */
  ground?: GroundTrack | null;
  /** Foot: slow log-speed wander (mood, wind), kept apart from the fast noise that uneven ground scales up. */
  noiseSlow?: OuTrack | null;
  /** Foot: acceleration limit for the first seconds after each stop (per stop index), m/s². */
  restartAccel?: Float64Array;
  /** Whole seconds standing still before the first step (recorded, not moving time). */
  preRoll?: number;
  /**
   * Ride: effort scale below which flat power stops falling; the rest of the slack is absorbed by braking
   * on descents (a slow target on a descent-dominated route).
   */
  kFloor?: number;
  /** Ride: log multiplier on the aerodynamic drag (position changes, gusts). */
  drag?: OuTrack | null;
  /** Ride: log multiplier on the descent braking set point. */
  descentLimit?: OuTrack | null;
  /** Ride: short pedal bursts while coasting gentle descents. */
  bursts?: BlipTrack | null;
  /**
   * Weather at the athlete's simulated position and time, sampled every second: wind and air density, and the surface
   * state (wet, muddy, snowy, icy) multiplying the ground factors. Null or absent: still, dry air as before weather.
   */
  environment?: EnvironmentSampler | null;
  /** Walks and hikes: pack multiplier on net walking cost (1 without a pack). */
  packLoad?: number;
  /** Mountaineering: oxygen budget and gear along the track. */
  alpine?: AlpineContext | null;
  /** Walks and treks: the oxygen budget that caps high climbs (see HIKE_CLIMB). Null low down, where it never binds. */
  climbO2?: ClimbO2 | null;
}

export interface KinOutcome {
  /** Moving seconds, fractional on the final step. */
  movingTime: number;
  finished: boolean;
  /** Foot: metres of climb covered with a walking gait during a run. */
  hikeDistance: number;
  /** Foot: metres of descent walked during a run. */
  descentWalkDistance: number;
  /** Ride: seconds spent crawling at the minimum speed on steep climbs. */
  crawlSeconds: number;
  /** Ride: seconds where planned power hit RIDE_MAX_POWER. */
  cappedSeconds: number;
  /** Ride: descent braking set point at this effort, m/s (RIDE_MAX_SPEED unless effort is below kFloor). */
  descentSpeed: number;
  /** Run: distance where glycogen first fell under the wall threshold, m (Infinity if it never did). */
  wallAt: number;
  /** Foot: moving seconds held down by each speed ceiling. */
  limited: LimitSeconds;
}

/** Multiplier on vo2NetWalk for mountain gear at speed v: pack, footwear and slow walking on top of the ground cost. */
function loadedCostRatio(v: number, grade: number, groundCost: number, load: number, pairKg: number): number {
  const plain = v > 0.05 ? vo2NetWalk(v, grade) : 0;
  return plain > 1e-9 ? vo2NetLoaded(v, grade, groundCost, load, pairKg) / plain : groundCost * load;
}

export function integrate(c: KinContext, k: number, rec: KinRecord | null): KinOutcome {
  return c.sport === 'ride' ? integrateRide(c, k, rec) : integrateFoot(c, k, rec);
}

/**
 * Largest end-of-step speed that still allows braking at `decel` to a stop `D` metres ahead, keeping at least
 * 0.75·vn·h metres so the final step can land exactly on the stop with a positive recorded speed.
 */
function stopLimit(D: number, v: number, h: number, decel: number): number {
  const room = Math.max(0, D - 0.5 * v * h);
  const braking = 0.5 * (-decel * h + Math.sqrt(decel * decel * h * h + 8 * decel * room));
  return Math.min(braking, room / (1.25 * h));
}

function integrateFoot(c: KinContext, k: number, rec: KinRecord | null): KinOutcome {
  const { track, rel, cap, stops } = c;
  const total = track.total;
  const cur = new Cursor(track);
  const isRun = c.sport === 'run';
  const gaitCtx = c.gait;
  const env = c.environment;
  const alpine = c.alpine ?? null;
  const hikeO2 = alpine ? null : (c.climbO2 ?? null);
  const minSpeed = alpine ? ALPINE_MIN_SPEED : FOOT_MIN_SPEED;
  const gearLoad = alpine ? alpine.load : (c.packLoad ?? 1);
  const limited: LimitSeconds = { corner: 0, vertical: 0, flat: 0, oxygen: 0 };
  let s = 0;
  let v = 0;
  let tm = 0;
  let i = 0;
  let stopIdx = 0;
  let stopLeft = 0;
  let accel = FOOT_ACCEL;
  let restart = FOOT_ACCEL;
  let finished = false;
  // Run gait: walking label, alternation accumulator (walking share owed, s) and time/distance since the last switch.
  let walking = false;
  let bout = 0;
  let dwellS = GAIT_DWELL_S;
  let dwellM = GAIT_DWELL_M;
  // Seeded multiplier on the current bout's length and dwell, one per switch.
  const jitters = gaitCtx?.boutJitter;
  let jitter = jitters && jitters.length > 0 ? jitters[0] : 1;
  let switches = 0;
  let hike = 0;
  let descentWalk = 0;
  // Warm starts for the ceiling speeds solved each second.
  let climbGuess = 0.5;
  let walkGuess = 1.5;
  // Crest carry-over of the grade multiplier (runs): the last clear grade sign and the multiplier actually planned.
  const aAfterClimb = 1 - Math.exp(-1 / CREST_TAU.afterClimb);
  const aAfterDescent = 1 - Math.exp(-1 / CREST_TAU.afterDescent);
  let lastSign = 0;
  let relPlanned = NaN;
  const countWalk = (ds: number, g: number): void => {
    if (!walking) return;
    if (g >= 0) hike += ds;
    else descentWalk += ds;
  };

  // Fatigue states: load E (flat-running km, effort weighted), weighted descent metres, glycogen, D′ balance.
  const fat = c.fatigue;
  const fitness = fat?.fitness ?? 'recreational';
  const descentFade = DESCENT_FADE[fitness] ?? 0.2;
  const flatFade = DESCENT_FLAT_FADE[fitness] ?? 0.05;
  let load = 0;
  let descended = 0;
  let glycogen = fat ? fat.glycogen : 0;
  let balance = fat ? fat.dPrime : 0;
  let reserve = fat ? Math.max(5, fat.vo2max - VO2_REST) : 5;
  let cs = 0;
  let economy = 1;
  /** 5-minute mean share of VO2 reserve (gates the wall to hard efforts). */
  let effortAvg = 0;
  let wallAt = Infinity;
  /** Absorb one moving second that ended at speed vEnd after covering ds on grade g. */
  const absorb = (vEnd: number, ds: number, g: number, walkingGait: boolean, groundCost: number): void => {
    if (!fat) return;
    const vo2 = (walkingGait ? vo2NetWalk(vEnd, g) : vo2NetRun(vEnd, g)) * groundCost;
    const perMetre = (walkingGait ? costWalk(g) * walkSpeedCostFactor(vEnd) : costRun(g)) * groundCost;
    const frac = vo2 / reserve;
    effortAvg += (frac - effortAvg) / 300;
    load += ((perMetre * ds) / FLAT_KM_JOULES) * loadWeight(frac);
    descended += descentLoadRate(ds, g, walkingGait);
    if (fat.dPrime > 0) balance = stepDPrime(balance, fat.dPrime, vo2 / VO2_PER_FLAT_MPS, cs);
    if (fat.glycogen > 0) {
      glycogen -= carbBurn(vo2, reserve + VO2_REST) - fat.intake;
      if (wallAt === Infinity && glycogen < WALL_THRESHOLD * fat.glycogen && effortAvg >= WALL_MIN_EFFORT) wallAt = s;
    }
    economy = economyFactor(load, descended, fitness);
  };

  /** One second of the athlete's heat balance at the O2 uptake of this second's motion. */
  const bodyStep = (vEnd: number, g: number, walkingGait: boolean, cost: number): void => {
    if (env) env.body(i, (walkingGait ? vo2NetWalk(vEnd, g) : vo2NetRun(vEnd, g)) * cost, vEnd, g);
  };
  env?.beginPass(rec !== null);
  if (rec) {
    rec.n = 0;
    rec.push(0, 0, track.grade[0], 0, c.preRoll ? GAIT_STOPPED : isRun ? GAIT_RUN : GAIT_WALK);
  }
  // Standing start: the watch records a few seconds before the first step.
  for (let p = 0; p < (c.preRoll ?? 0) && i < c.maxSteps; p++) {
    i++;
    if (env) {
      env.sample(0, i);
      env.body(i, 0, 0, 0);
    }
    if (rec) rec.push(0, 0, track.grade[0], 0, GAIT_STOPPED);
  }

  while (i < c.maxSteps) {
    i++;
    if (stopLeft > 0) {
      stopLeft--;
      if (stopLeft === 0) accel = restart;
      if (fat && fat.dPrime > 0) balance = stepDPrime(balance, fat.dPrime, 0, cs);
      if (env) {
        env.sample(s, i);
        env.body(i, 0, 0, 0);
      }
      if (rec) rec.push(s, 0, rec.grade[rec.n - 1], 0, GAIT_STOPPED);
      continue;
    }
    cur.seek(s);
    const g = cur.lerp(track.grade);
    const gr = c.ground;
    let runGround = gr ? cur.lerp(gr.runSpeed) : 1;
    let walkGround = gr ? cur.lerp(gr.walkSpeed) : 1;
    const onSteps = gr ? cur.lerp(gr.steps) > 0.5 : false;
    // Mountaineering: ground the terrain already counts as snow or ice (see groundTrack).
    const terrainSnow = alpine !== null && gr != null && cur.lerp(gr.snow) > 0.5;
    if (env) {
      // The surface state under the athlete now (water film, mud, snow, ice) multiplies the dry ground factors. On
      // terrain snow, weather's fresh snow only slows the walk where it is stronger than the snow already counted.
      env.sample(s, i);
      runGround *= env.surfaceSpeed(g, false);
      const surfaceWalk = env.surfaceSpeed(g, true);
      walkGround *= alpine && terrainSnow ? Math.min(1, surfaceWalk / alpine.snowSpeed) : surfaceWalk;
    }
    const warm = 1 - c.warmup * Math.max(0, 1 - tm / 300);
    const pacing = 1 + c.pacingSlope * (s / total - 0.5);
    // The thermal state (heat or cold against neutral weather) scales the effort like the fatigue fade does.
    let vFlat = k * c.base * warm * pacing * (env ? env.thermal : 1);
    let damage = 0;
    /** How deep into the wall this second is, 0 … 1. */
    let wall = 0;
    let flatBound = false;
    let verticalBound = false;
    let oxygenBound = false;
    if (fat) {
      reserve = Math.max(5, fat.vo2max * (fat.altitude ? cur.lerp(fat.altitude) : 1) - VO2_REST);
      damage = descentSaturation(descended);
      const tired = fadeFactor(load, fat.fade, fat.fadeScale) * (1 - flatFade * damage);
      vFlat *= tired;
      // The wall: out of glycogen the pace drops sharply over WALL_RAMP_M and keeps fading from there.
      if (s > fat.wallFrom) {
        wall = smooth01((s - fat.wallFrom) / WALL_RAMP_M);
        vFlat *= 1 - WALL_SLOWDOWN * wall;
      }
      // No planned flat-equivalent speed beyond a few-minute maximal effort: a target that needs more is not met.
      const flatCeiling = (RUN_FLAT_CEILING * reserve) / VO2_PER_FLAT_MPS;
      if (isRun && vFlat > flatCeiling) {
        vFlat = flatCeiling;
        flatBound = true;
      }
      // Critical speed in flat-equivalent m/s. A target beyond it on the flat lifts it, so an unsustainable
      // target is still met (and flagged) instead of being impossible.
      cs = Math.max((fat.csFraction * reserve) / VO2_PER_FLAT_MPS, k * c.base);
    }
    let relNow = cur.lerp(rel);
    if (isRun) {
      if (g > 0.02) lastSign = 1;
      else if (g < -0.02) lastSign = -1;
      if (!(relPlanned > 0)) relPlanned = relNow;
      else if (relNow > relPlanned && lastSign > 0) relPlanned += (relNow - relPlanned) * aAfterClimb;
      else if (relNow < relPlanned && lastSign < 0) relPlanned += (relNow - relPlanned) * aAfterDescent;
      else relPlanned = relNow;
      relNow = relPlanned;
    }
    let vRun = vFlat * relNow * (isRun ? runGround : walkGround);
    // Eccentric damage slows later descents more than climbs.
    if (damage > 0 && g < -0.02) vRun *= 1 - descentFade * damage * smooth01((-g - 0.02) / 0.04);
    let vPlan = vRun;
    // High up the ceiling on climbing rate falls with the air: 500–600 m/h low down is 300 m/h above 4000 m.
    const vam = gaitCtx ? vamSpeedLimit(gaitCtx.vam * (hikeO2 ? cur.lerp(hikeO2.vam) : 1), g) : Infinity;
    /** Sustained ceiling on this second's speed: pace texture may approach it but never carries the motion past it. */
    let ceiling = vam;
    if (isRun) {
      // D′ governor: above critical speed only while the balance lasts (race-effort climbs slow near the top).
      const ceilingEq = fat && fat.dPrime > 0 ? dPrimeCeiling(balance, cs) : Infinity;
      const vRunCapped = Math.min(vRun, ceilingEq / paceFactorHr(g * 100), vam);
      // Descent skill, lowered on technical ground, keeps steeper descents run and walked ones faster.
      const skill = (gaitCtx?.descentSkill ?? 0) * (1 - 0.7 * (gr ? cur.lerp(gr.technicality) : 0));
      if (gaitCtx) {
        // Gait follows the planned (fatigued, capped) running speed on the long-baseline grade. Walking takes a share
        // of the time in bouts whose duty follows that share (a sigma-delta accumulator), so switches show a real
        // speed step while moving time stays continuous in the effort scale the calibration solves for.
        const gL = cur.lerp(gaitCtx.longGrade);
        // Critical speed, not the draining D′ ceiling: walking refills D′, which would otherwise flip the decision back.
        const sustainable = fat && fat.dPrime > 0 ? cs / paceFactorHr(gL * 100) : Infinity;
        const vDecide = Math.min(vFlat * cur.lerp(gaitCtx.relLong) * runGround, sustainable, vamSpeedLimit(gaitCtx.vam, gL));
        // Steps up are always walked, and so is alpine ground.
        const weight = Math.max(walkWeight(vDecide, gL, gaitCtx.transitionOffset, skill), gr ? technicalWalkWeight(cur.lerp(gr.technicality), gL) : 0);
        const plain = onSteps && g > 0.02 ? 1 : smooth01((weight - 0.15) / 0.7);
        // Past the wall the runner walks a share of the time, in bouts of a couple of minutes.
        const duty = wall > 0 ? Math.max(plain, WALL_WALK.share * wall) : plain;
        const scale = wall > 0 ? boutScale(gL) + (WALL_WALK.boutS - boutScale(gL)) * wall : boutScale(gL);
        const half = 0.5 * scale * jitter;
        bout = Math.min(half, Math.max(-half, bout + duty - (walking ? 1 : 0)));
        if (dwellS >= GAIT_DWELL_S * jitter || dwellM >= GAIT_DWELL_M * jitter) {
          const toWalk: boolean = !walking && (duty >= 1 || (duty > 0 && bout >= half - 1e-9));
          const toRun: boolean = walking && (duty <= 0 || (duty < 1 && bout <= -half + 1e-9));
          if (toWalk || toRun) {
            walking = toWalk;
            dwellS = 0;
            dwellM = 0;
            switches++;
            if (jitters && jitters.length > 0) jitter = jitters[switches % jitters.length];
          }
        }
      }
      if (walking) {
        // Power-hike at the running power (capped by the D′ ceiling) or walk down with Tobler's shape, faster with skill.
        const walkSpeed =
          g >= 0
            ? Math.min(powerHikeSpeed(vRunCapped, g, VO2_PER_FLAT_MPS * ceilingEq) * (walkGround / runGround), HIKE_MAX_SPEED)
            : DESCENT_WALK_SPEED * (1 + DESCENT_WALK_SKILL * skill) * toblerShape(g) * walkGround;
        vPlan = Math.min(walkSpeed, HIKE_RUN_RATIO * vRunCapped, vam);
      } else {
        vPlan = vRunCapped;
      }
      verticalBound = vam < Infinity && vPlan >= vam - 1e-9;
    } else {
      const budget = alpine ? alpine.budget : hikeO2 ? hikeO2.budget : null;
      if (budget && g > 0) {
        // Oxygen budget on climbs; its share follows the planned flat speed, so moving time stays monotone in k. On a
        // trek the budget only starts to bind high up, so the same code leaves low walks alone.
        const ratio = alpine ? ALPINE_CLIMB.share : HIKE_CLIMB.share;
        const share = Math.min(ALPINE_CLIMB.maxShare, Math.max(ALPINE_CLIMB.minShare, (ratio * vFlat) / ALPINE_CLIMB.refSpeed));
        const pairKg = alpine ? cur.lerp(alpine.footKg) : LIGHT_FOOTWEAR_KG;
        const o2Cap = loadedClimbSpeed(share * cur.lerp(budget), g, gr ? cur.lerp(gr.walkCost) : 1, gearLoad, pairKg, climbGuess);
        climbGuess = o2Cap > 0.02 ? o2Cap : 0.5;
        const w = smooth01(g / ALPINE_CLIMB.fromGrade) * (hikeO2 ? cur.lerp(hikeO2.weight) : 1);
        if (o2Cap < vPlan) {
          vPlan -= w * (vPlan - o2Cap);
          oxygenBound = w >= 1;
        }
        if (w >= 1) ceiling = Math.min(ceiling, o2Cap);
      }
      if (vam < vPlan) {
        vPlan = vam;
        verticalBound = true;
      }
      if (fat) {
        // No walking plan faster than people walk, or dearer than the athlete's VO2max.
        const walkCost = gr ? cur.lerp(gr.walkCost) : 1;
        const pairKg = alpine ? cur.lerp(alpine.footKg) : LIGHT_FOOTWEAR_KG;
        const vo2Limit = WALK_VO2_CEILING * reserve;
        let walkCeiling = WALK_MAX_SPEED;
        if (vo2NetLoaded(Math.min(vPlan, WALK_MAX_SPEED), Math.max(0, g), walkCost, gearLoad, pairKg) > vo2Limit) {
          walkCeiling = Math.min(WALK_MAX_SPEED, loadedClimbSpeed(vo2Limit, g, walkCost, gearLoad, pairKg, walkGuess));
          walkGuess = Math.max(0.1, walkCeiling);
        }
        if (vPlan > walkCeiling) {
          vPlan = walkCeiling;
          flatBound = true;
        }
        ceiling = Math.min(ceiling, walkCeiling);
      }
    }
    let airCost = 1;
    if (env) {
      // At equal effort speed falls by the metabolic cost of the wind's drag at that speed (two fixed-point steps).
      airCost = env.windCost(vPlan / env.windCost(vPlan));
      vPlan /= airCost;
    }
    if (onSteps) vPlan = Math.min(vPlan, isRun && !walking ? STEPS.run : g > 0 ? STEPS.walkUp : STEPS.walkDown);
    // Uneven ground and technical descents make the pace less steady; the slow wander is not tied to the ground.
    const unsteady = (gr ? 1 + cur.lerp(gr.roughness) + 1.5 * cur.lerp(gr.technicality) * smooth01(-g / 0.2) : 1) * (1 + WALL_WALK.fastNoise * wall);
    const drifting = 1 + WALL_WALK.slowNoise * wall;
    let vt = vPlan * Math.exp(c.noise.at(i) * unsteady + (c.noiseSlow ? c.noiseSlow.at(i) * drifting : 0));
    if (ceiling < Infinity) vt = softCap(vt, ceiling, CEILING_KNEE * ceiling);
    let cp = cur.lerp(cap);
    if (env) cp *= env.grip;
    if (vt > cp) {
      vt = cp;
      limited.corner++;
    }
    if (vt < minSpeed) vt = minSpeed;
    if (flatBound) limited.flat++;
    if (verticalBound) limited.vertical++;
    if (oxygenBound) limited.oxygen++;
    let vn = vt > v + accel ? v + accel : vt < v - FOOT_DECEL ? v - FOOT_DECEL : vt;
    if (vt <= v + accel) accel = FOOT_ACCEL;
    const gait = walking || !isRun ? GAIT_WALK : GAIT_RUN;
    let groundCost = gr ? cur.lerp(gait === GAIT_WALK ? gr.walkCost : gr.runCost) : 1;
    // Fresh snow from the weather on ground the terrain already counts as snow costs the stronger of the two, not both.
    if (env) groundCost *= airCost * (alpine && terrainSnow ? Math.max(1, env.surfaceCost / alpine.snowCost) : env.surfaceCost);
    const footKg = alpine ? cur.lerp(alpine.footKg) : LIGHT_FOOTWEAR_KG;
    const hrFloor = walking ? WALK_BREAK_HR_FLOOR * VO2_PER_FLAT_MPS * vFlat : 0;

    if (stopIdx < stops.length) {
      const target = stops[stopIdx].s;
      const D = target - s;
      const exact = 2 * D - v;
      if (exact <= Math.min(ARRIVAL_SPEED, Math.max(v, vn))) {
        const arrival = Math.max(0, exact);
        const arrivalCost = alpine ? loadedCostRatio(arrival, g, groundCost, gearLoad, footKg) : groundCost * gearLoad;
        countWalk(D, g);
        absorb(0, D, g, gait === GAIT_WALK, arrivalCost);
        bodyStep(0, g, gait === GAIT_WALK, arrivalCost);
        s = target;
        tm += 1;
        stopLeft = stops[stopIdx].duration;
        restart = c.restartAccel?.[stopIdx] ?? FOOT_ACCEL;
        stopIdx++;
        if (rec) {
          cur.seek(s);
          rec.push(s, arrival, cur.lerp(track.grade), 0, gait, arrivalCost, economy, hrFloor);
        }
        v = 0;
        continue;
      }
      const vs = stopLimit(D, v, 1, FOOT_STOP_DECEL);
      if (vn > vs) vn = vs;
    }

    const ds = 0.5 * (v + vn);
    // Mountain days add pack, footwear and slow walking; a pack on a walk or hike multiplies the ground's cost.
    const costFactor = alpine ? loadedCostRatio(vn, g, groundCost, gearLoad, footKg) : groundCost * gearLoad;
    if (s + ds >= total) {
      tm += ds > 0 ? (total - s) / ds : 1;
      countWalk(total - s, g);
      absorb(vn, total - s, g, gait === GAIT_WALK, costFactor);
      bodyStep(vn, g, gait === GAIT_WALK, costFactor);
      s = total;
      v = vn;
      finished = true;
      if (rec) rec.push(s, v, track.grade[track.n - 1], 0, gait, costFactor, economy, hrFloor);
      break;
    }
    countWalk(ds, g);
    absorb(vn, ds, g, gait === GAIT_WALK, costFactor);
    bodyStep(vn, g, gait === GAIT_WALK, costFactor);
    dwellS += 1;
    dwellM += ds;
    s += ds;
    v = vn;
    tm += 1;
    if (rec) {
      cur.seek(s);
      rec.push(s, v, cur.lerp(track.grade), 0, gait, costFactor, economy, hrFloor);
    }
  }
  return {
    movingTime: tm,
    finished,
    hikeDistance: hike,
    descentWalkDistance: descentWalk,
    crawlSeconds: 0,
    cappedSeconds: 0,
    descentSpeed: 0,
    wallAt,
    limited,
  };
}

/** Descent set point at effort k: full speed at or above kFloor, falling with (k/kFloor)² below it. */
export function descentSpeedAt(k: number, kFloor: number): number {
  if (!(kFloor > 0) || k >= kFloor) return RIDE_MAX_SPEED;
  return Math.max(3, RIDE_MAX_SPEED * (k / kFloor) ** 2);
}

function integrateRide(c: KinContext, k: number, rec: KinRecord | null): KinOutcome {
  const { track, cap, stops } = c;
  const bike = c.bike as BikePhysics;
  const total = track.total;
  const cur = new Cursor(track);
  const h = 1 / RIDE_SUBSTEPS;
  const ec = CYCLING.chainEfficiency;
  const kFloor = c.kFloor ?? 0;
  const effort = Math.max(k, kFloor);
  const descentSpeed = descentSpeedAt(k, kFloor);
  const env = c.environment;
  let s = 0;
  let v = 0;
  let tm = 0;
  let i = 0;
  let stopIdx = 0;
  let stopLeft = 0;
  let coasting = false;
  let crawl = 0;
  let capped = 0;
  let finished = false;
  let recDist = 0;
  let recSpeed = 0;
  // Effort-weighted load from pedalled metabolic power (a ride's equivalent of the running load).
  const fat = c.fatigue;
  const riderKg = bike.massT - CYCLING.bikeKg;
  const reserve = fat ? Math.max(5, fat.vo2max - VO2_REST) : 5;
  let load = 0;

  env?.beginPass(rec !== null);
  if (rec) {
    rec.n = 0;
    rec.push(0, 0, track.grade[0], 0, c.preRoll ? GAIT_STOPPED : GAIT_PEDAL);
  }
  for (let p = 0; p < (c.preRoll ?? 0) && i < c.maxSteps; p++) {
    i++;
    if (env) {
      env.sample(0, i);
      env.body(i, 0, 0, 0);
    }
    if (rec) rec.push(0, 0, track.grade[0], 0, GAIT_STOPPED);
  }

  while (i < c.maxSteps) {
    i++;
    if (stopLeft > 0) {
      stopLeft--;
      recSpeed = 0;
      if (env) {
        env.sample(s, i);
        env.body(i, 0, 0, 0);
      }
      if (rec) rec.push(s, 0, rec.grade[rec.n - 1], 0, GAIT_STOPPED);
      continue;
    }
    cur.seek(s);
    const g = cur.lerp(track.grade);
    const warm = 1 - 2 * c.warmup * Math.max(0, 1 - tm / 300);
    const fatigue = fat ? fadeFactor(load, fat.fade) : 1;
    const pacing = 1 + 2 * c.pacingSlope * (s / total - 0.5);
    let planned = effort * c.base * ridePowerGradeFactor(g) * warm * fatigue * pacing * Math.exp(c.noise.at(i));
    if (env) {
      env.sample(s, i);
      planned *= env.power * env.thermal;
    }
    if (planned > RIDE_MAX_POWER) {
      planned = RIDE_MAX_POWER;
      capped++;
    }
    const dragScale = c.drag ? Math.exp(c.drag.at(i)) : 1;
    const setPoint = c.descentLimit ? Math.exp(c.descentLimit.at(i)) : 1;
    let limit = (g < -0.01 ? descentSpeed : RIDE_MAX_SPEED) * setPoint;
    if (env) limit *= env.brake;

    const descending = g < -0.02;
    if (coasting) {
      const hold = descending && (v > SPIN_OUT_SPEED - 1 || v >= limit - 1);
      if ((v < COAST_EXIT_SPEED || g > -0.03) && !hold) coasting = false;
    } else if ((g < -0.04 && v > COAST_ENTER_SPEED) || (descending && (v > SPIN_OUT_SPEED || v >= limit - 0.3))) {
      coasting = true;
    }

    const stopAt = stopIdx < stops.length ? stops[stopIdx].s : Infinity;
    // Stop pedalling into a stop; at walking pace only where the bike still rolls (a steep ramp needs pedalling).
    const braking = (v > 2 || (v > 0.5 && g <= 0.02)) && stopAt - s < (v * v) / (2 * RIDE_STOP_DECEL) + 2 * v + 1;
    const blip = c.blips != null && v > 5 && Math.abs(g) < 0.02 && c.blips.at(i);
    const burst = coasting && g > -0.06 && v < limit - 1 && v < SPIN_OUT_SPEED && c.bursts != null && c.bursts.at(i);
    const pedal = (!coasting || burst) && !braking && !blip && planned > 0;
    const drivePower = burst ? 0.6 * planned : planned;
    let power = pedal ? drivePower : 0;

    const s0 = s;
    let arrived = false;
    let crawled = false;
    let stepFrac = 1;
    for (let sub = 0; sub < RIDE_SUBSTEPS; sub++) {
      cur.seek(s);
      const gs = cur.lerp(track.grade);
      const D = stopAt - s;
      if (stopAt < Infinity && (D < 0.02 || (2 * D) / h - v <= Math.min(ARRIVAL_SPEED, v))) {
        s = stopAt;
        v = 0;
        arrived = true;
        break;
      }
      // Force is torque-limited at low speed (≈1.1 m/s² standing start at 150 W).
      const drive = pedal ? (drivePower * ec) / Math.max(v, 1.5) : 0;
      let vn = v + ((drive - bikeResistance(bike, v, gs, dragScale, c.ground ? cur.lerp(c.ground.rolling) : 1, env ?? null)) / bike.massEff) * h;
      if (vn < 0) vn = 0;
      if (vn > limit) vn = v > limit ? Math.max(limit, Math.min(vn, v - RIDE_BRAKE_DECEL * h)) : limit;
      let cp = cur.lerp(cap);
      if (env) cp *= env.grip;
      if (vn > cp) vn = cp;
      const vs = stopAt < Infinity ? stopLimit(D, v, h, RIDE_STOP_DECEL) : Infinity;
      if (vn > vs) vn = vs;
      if (pedal && vn < CRAWL_SPEED) {
        // Standing on the pedals: never slower than walking pace, ramping up from a standstill.
        const floor = Math.min(CRAWL_SPEED, v + CRAWL_ACCEL * h, vs);
        if (vn < floor) {
          if (gs > 0.02 && v >= CRAWL_SPEED - 1e-9) crawled = true;
          vn = floor;
        }
      }
      const ds = 0.5 * (v + vn) * h;
      if (s + ds >= total) {
        stepFrac = (sub + (ds > 0 ? (total - s) / ds : 1)) / RIDE_SUBSTEPS;
        s = total;
        v = vn;
        finished = true;
        break;
      }
      s += ds;
      v = vn;
    }
    if (crawled) {
      crawl++;
      power = Math.min(RIDE_MAX_POWER, Math.max(power, bikeSteadyPower(bike, v, g)));
    }
    if (env) env.body(i, vo2NetRide(power, riderKg), v, g, power);
    if (fat && power > 0 && s > s0) {
      const vo2 = vo2NetRide(power, riderKg);
      load += ((vo2 * J_PER_ML_O2) / 60 / FLAT_KM_JOULES) * RIDE_LOAD_SHARE * loadWeight(vo2 / reserve) * stepFrac;
    }
    if (s > s0) tm += stepFrac;
    if (rec) {
      cur.seek(s);
      // Arrival second: a speed consistent with the distance covered (never 0 while distance advances), no power.
      const dd = s - recDist;
      const recorded = arrived ? Math.max(2 * dd - recSpeed, Math.min(dd, ARRIVAL_SPEED)) : v;
      if (arrived) power = 0;
      rec.push(s, recorded, cur.lerp(track.grade), power, pedal && !arrived ? GAIT_PEDAL : GAIT_COAST);
      recDist = s;
      recSpeed = recorded;
    }
    if (arrived) {
      stopLeft = stops[stopIdx].duration;
      stopIdx++;
    }
    if (finished) break;
  }
  return {
    movingTime: tm,
    finished,
    hikeDistance: 0,
    descentWalkDistance: 0,
    crawlSeconds: crawl,
    cappedSeconds: capped,
    descentSpeed,
    wallAt: Infinity,
    limited: { corner: 0, vertical: 0, flat: 0, oxygen: 0 },
  };
}

export interface ScaleSolution {
  k: number;
  outcome: KinOutcome;
  /** |log(time/target)| of the returned k. */
  error: number;
  evaluations: number;
  /** True when efforts on both sides of the target were found (a residual error then means a jump in time(k)). */
  bracketed: boolean;
}

/**
 * Bracketed 1-D root find on log k for moving time = target. Moving time falls monotonically with k
 * (up to discrete events), so the bracket is expanded geometrically, then shrunk with Illinois false
 * position (a bisection-safe secant; falls back to bisection when the secant leaves the bracket).
 */
export function solveScale(
  evaluate: (k: number) => KinOutcome,
  target: number,
  k0: number,
  kMin: number,
  kMax: number,
  tolerance = 2e-4,
): ScaleSolution {
  let evaluations = 0;
  let bracketed = false;
  const errOf = (o: KinOutcome): number => Math.log(Math.max(o.movingTime, 1e-9) / target);
  let best: Omit<ScaleSolution, 'bracketed'> | null = null;
  const run = (k: number): { o: KinOutcome; e: number } => {
    const o = evaluate(k);
    evaluations++;
    const e = o.finished ? errOf(o) : Math.abs(errOf(o)) + 10;
    if (!best || Math.abs(e) < best.error) best = { k, outcome: o, error: Math.abs(e), evaluations };
    return { o, e };
  };
  const done = (): ScaleSolution => {
    const b = best as unknown as Omit<ScaleSolution, 'bracketed'>;
    return { ...b, evaluations, bracketed };
  };

  let a = Math.min(kMax, Math.max(kMin, k0));
  let fa = run(a).e;
  if (Math.abs(fa) < tolerance) return done();
  let b: number;
  let fb: number;
  if (fa > 0) {
    b = a;
    fb = fa;
    while (fb > 0) {
      if (b >= kMax) return done();
      a = b;
      fa = fb;
      b = Math.min(kMax, b * 1.35);
      fb = run(b).e;
    }
  } else {
    b = a;
    fb = fa;
    while (fa < 0) {
      if (a <= kMin) return done();
      b = a;
      fb = fa;
      a = Math.max(kMin, a / 1.35);
      fa = run(a).e;
    }
  }
  bracketed = true;
  if (Math.abs(fa) < tolerance || Math.abs(fb) < tolerance) return done();

  let side = 0;
  for (let iter = 0; iter < 60; iter++) {
    const la = Math.log(a);
    const lb = Math.log(b);
    if (lb - la < 1e-7) break;
    let lc = lb - (fb * (lb - la)) / (fb - fa);
    if (!(lc > la && lc < lb) || iter % 8 === 7) lc = 0.5 * (la + lb);
    const c = Math.exp(lc);
    const fc = run(c).e;
    if (Math.abs(fc) < tolerance) break;
    if (fc > 0) {
      a = c;
      fa = fc;
      if (side === 1) fb /= 2;
      side = 1;
    } else {
      b = c;
      fb = fc;
      if (side === -1) fa /= 2;
      side = -1;
    }
  }
  return done();
}
