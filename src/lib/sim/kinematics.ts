// 1 Hz motion along the route: foot sports (planned speed + rate limits) and cycling (Martin 1998 dynamics).
// One integrator is used both for calibration (no recording) and for the final recorded pass, so the
// calibrated moving time is exactly the moving time of the output.
import type { ActivityType } from '../types';
import {
  CYCLING,
  bikeResistance,
  bikeSteadyPower,
  powerHikeSpeed,
  ridePowerGradeFactor,
  type BikePhysics,
} from './models';
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
/**
 * Power-hike band: below 1.8 m/s planned running speed on ≥ 6 % the runner power-hikes; above
 * 2.05 m/s or under 4 % they run; in between speed blends linearly.
 */
const HIKE_SPEED_LOW = 1.8;
const HIKE_SPEED_HIGH = 2.05;
const HIKE_GRADE_LOW = 0.04;
const HIKE_GRADE_HIGH = 0.06;

/**
 * Power-hike weight (0 run … 1 hike) for a planned running speed on a grade. The engine evaluates it once per
 * profile point from the pre-calibration speed estimate, so the gait choice is a property of the terrain and
 * target, and moving time stays continuous in the effort scale the calibration solves for.
 */
export function hikeWeight(vRun: number, grade: number): number {
  const wSpeed = Math.min(1, Math.max(0, (HIKE_SPEED_HIGH - vRun) / (HIKE_SPEED_HIGH - HIKE_SPEED_LOW)));
  const wGrade = Math.min(1, Math.max(0, (grade - HIKE_GRADE_LOW) / (HIKE_GRADE_HIGH - HIKE_GRADE_LOW)));
  return wSpeed * wGrade;
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

  constructor(capacity: number) {
    const c = Math.max(16, Math.ceil(capacity));
    this.dist = new Float64Array(c);
    this.speed = new Float64Array(c);
    this.grade = new Float64Array(c);
    this.power = new Float64Array(c);
    this.gait = new Uint8Array(c);
  }

  push(s: number, v: number, g: number, p: number, gait: number): void {
    if (this.n === this.dist.length) this.grow();
    const i = this.n++;
    this.dist[i] = s;
    this.speed[i] = v;
    this.grade[i] = g;
    this.power[i] = p;
    this.gait[i] = gait;
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
  fatiguePerHour: number;
  /** pacingPlan(x) = 1 + slope·(x/D − 0.5). */
  pacingSlope: number;
  /** Log-speed noise (foot) or log-power noise (ride). */
  noise: OuTrack;
  stops: StopEvent[];
  maxSteps: number;
  bike: BikePhysics | null;
  blips: BlipTrack | null;
  /** Foot (run): power-hike weight per profile point (see hikeWeight). */
  hike?: Float64Array;
  /** Foot (run): highest net VO2 (ml/kg/min) spent power-hiking at the reference effort. */
  hikeVo2Cap?: number;
  /**
   * Foot (run): reference effort scale for hikeVo2Cap. A harder target (k above it) raises the cap in
   * proportion, so a too-fast target is still met (and flagged) instead of being pushed onto absurd flats.
   */
  hikeRefK?: number;
  /** Foot: acceleration limit for the first seconds after each stop (per stop index), m/s². */
  restartAccel?: Float64Array;
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
}

export interface KinOutcome {
  /** Moving seconds, fractional on the final step. */
  movingTime: number;
  finished: boolean;
  /** Foot: metres covered with a walking gait during a run. */
  hikeDistance: number;
  /** Ride: seconds spent crawling at the minimum speed on steep climbs. */
  crawlSeconds: number;
  /** Ride: seconds where planned power hit RIDE_MAX_POWER. */
  cappedSeconds: number;
  /** Ride: descent braking set point at this effort, m/s (RIDE_MAX_SPEED unless effort is below kFloor). */
  descentSpeed: number;
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
  const hikeCap = (c.hikeVo2Cap ?? Infinity) * Math.max(1, k / (c.hikeRefK ?? k));
  let s = 0;
  let v = 0;
  let tm = 0;
  let i = 0;
  let stopIdx = 0;
  let stopLeft = 0;
  let accel = FOOT_ACCEL;
  let restart = FOOT_ACCEL;
  let walking = false;
  let hike = 0;
  let finished = false;

  if (rec) {
    rec.n = 0;
    rec.push(0, 0, track.grade[0], 0, isRun ? GAIT_RUN : GAIT_WALK);
  }

  while (i < c.maxSteps) {
    i++;
    if (stopLeft > 0) {
      stopLeft--;
      if (stopLeft === 0) accel = restart;
      if (rec) rec.push(s, 0, rec.grade[rec.n - 1], 0, GAIT_STOPPED);
      continue;
    }
    cur.seek(s);
    const g = cur.lerp(track.grade);
    const warm = 1 - c.warmup * Math.max(0, 1 - tm / 300);
    const fatigue = Math.max(0.7, 1 - (c.fatiguePerHour * Math.max(0, tm - 2700)) / 3600);
    const pacing = 1 + c.pacingSlope * (s / total - 0.5);
    const vFlat = k * c.base * warm * fatigue * pacing;
    const vRun = vFlat * cur.lerp(rel);
    let vPlan = vRun;
    if (isRun && c.hike) {
      const w = cur.lerp(c.hike);
      if (w > 0) vPlan = vRun + w * (powerHikeSpeed(vRun, g, hikeCap) - vRun);
      // The gait label only drives cadence and HR demand, so it may switch with hysteresis.
      if (walking) {
        if (w < 0.35) walking = false;
      } else if (w > 0.65) walking = true;
    }
    let vt = vPlan * Math.exp(c.noise.at(i));
    const cp = cur.lerp(cap);
    if (vt > cp) vt = cp;
    if (vt < FOOT_MIN_SPEED) vt = FOOT_MIN_SPEED;
    let vn = vt > v + accel ? v + accel : vt < v - FOOT_DECEL ? v - FOOT_DECEL : vt;
    if (vt <= v + accel) accel = FOOT_ACCEL;
    const gait = walking || !isRun ? GAIT_WALK : GAIT_RUN;

    if (stopIdx < stops.length) {
      const target = stops[stopIdx].s;
      const D = target - s;
      const exact = 2 * D - v;
      if (exact <= Math.min(ARRIVAL_SPEED, Math.max(v, vn))) {
        if (walking) hike += D;
        s = target;
        tm += 1;
        stopLeft = stops[stopIdx].duration;
        restart = c.restartAccel?.[stopIdx] ?? FOOT_ACCEL;
        stopIdx++;
        if (rec) {
          cur.seek(s);
          rec.push(s, Math.max(0, exact), cur.lerp(track.grade), 0, gait);
        }
        v = 0;
        continue;
      }
      const vs = stopLimit(D, v, 1, FOOT_STOP_DECEL);
      if (vn > vs) vn = vs;
    }

    const ds = 0.5 * (v + vn);
    if (s + ds >= total) {
      tm += ds > 0 ? (total - s) / ds : 1;
      if (walking) hike += total - s;
      s = total;
      v = vn;
      finished = true;
      if (rec) rec.push(s, v, track.grade[track.n - 1], 0, gait);
      break;
    }
    if (walking) hike += ds;
    s += ds;
    v = vn;
    tm += 1;
    if (rec) {
      cur.seek(s);
      rec.push(s, v, cur.lerp(track.grade), 0, gait);
    }
  }
  return { movingTime: tm, finished, hikeDistance: hike, crawlSeconds: 0, cappedSeconds: 0, descentSpeed: 0 };
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

  if (rec) {
    rec.n = 0;
    rec.push(0, 0, track.grade[0], 0, GAIT_PEDAL);
  }

  while (i < c.maxSteps) {
    i++;
    if (stopLeft > 0) {
      stopLeft--;
      recSpeed = 0;
      if (rec) rec.push(s, 0, rec.grade[rec.n - 1], 0, GAIT_STOPPED);
      continue;
    }
    cur.seek(s);
    const g = cur.lerp(track.grade);
    const warm = 1 - 2 * c.warmup * Math.max(0, 1 - tm / 300);
    const fatigue = Math.max(0.6, 1 - (1.5 * c.fatiguePerHour * Math.max(0, tm - 2700)) / 3600);
    const pacing = 1 + 2 * c.pacingSlope * (s / total - 0.5);
    let planned = effort * c.base * ridePowerGradeFactor(g) * warm * fatigue * pacing * Math.exp(c.noise.at(i));
    if (planned > RIDE_MAX_POWER) {
      planned = RIDE_MAX_POWER;
      capped++;
    }
    const dragScale = c.drag ? Math.exp(c.drag.at(i)) : 1;
    const setPoint = c.descentLimit ? Math.exp(c.descentLimit.at(i)) : 1;
    const limit = (g < -0.01 ? descentSpeed : RIDE_MAX_SPEED) * setPoint;

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
      let vn = v + ((drive - bikeResistance(bike, v, gs, dragScale)) / bike.massEff) * h;
      if (vn < 0) vn = 0;
      if (vn > limit) vn = v > limit ? Math.max(limit, Math.min(vn, v - RIDE_BRAKE_DECEL * h)) : limit;
      const cp = cur.lerp(cap);
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
  return { movingTime: tm, finished, hikeDistance: 0, crawlSeconds: crawl, cappedSeconds: capped, descentSpeed };
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
