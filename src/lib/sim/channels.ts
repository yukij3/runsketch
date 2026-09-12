// Per-second channels derived from the recorded motion: metabolic demand, cadence, power, GPS, altitude.
import type { ActivityType, Athlete, GpsNoiseLevel } from '../types';
import { GAIT_COAST, GAIT_PEDAL, GAIT_RUN, GAIT_STOPPED, GAIT_WALK, type KinRecord } from './kinematics';
import {
  coastDemandFraction,
  rideCadence,
  runCadence,
  runningPower,
  vo2NetRide,
  vo2NetRun,
  vo2NetWalk,
  walkCadence,
} from './models';
import { createRandom, ouStepper, type Random } from './rng';
import { Cursor, DEG, M_PER_DEG, type Track } from './track';

/**
 * Net VO2 demand (ml/kg/min) per second, low-passed to muscle-level demand: 5 s on foot (stride noise),
 * 8 s on the bike (crank power swings stroke to stroke; VO2 phase-II kinetics filter them). While riding,
 * demand never falls below the coasting floor (a share of the VO2 reserve that rises with speed), so a
 * descent is not treated like standing still.
 */
export function metabolicDemand(
  rec: KinRecord,
  n: number,
  sport: ActivityType,
  bodyKg: number,
  vo2Reserve = 0,
): Float64Array {
  const out = new Float64Array(n);
  const a = 1 - Math.exp(-1 / (sport === 'ride' ? 8 : 5));
  let smooth = 0;
  for (let i = 0; i < n; i++) {
    const gait = rec.gait[i];
    const v = rec.speed[i];
    const g = rec.grade[i];
    let inst = 0;
    if (gait === GAIT_RUN && v > 0.05) inst = vo2NetRun(v, g);
    else if (gait === GAIT_WALK && v > 0.05) inst = vo2NetWalk(v, g);
    else if (gait === GAIT_PEDAL || gait === GAIT_COAST) {
      inst = Math.max(vo2NetRide(rec.power[i], bodyKg), v > 0.05 ? vo2Reserve * coastDemandFraction(v) : 0);
    }
    smooth += (inst - smooth) * a;
    out[i] = smooth;
  }
  return out;
}

/** Lowest gear development, metres per crank revolution (compact 34×34 on 700c ≈ 2.1 m; MTB ≈ 1.4 m). */
const LOWEST_GEAR_M = 1.4;

/**
 * Cadence: steps/min for foot sports, rpm for rides. Runs: speed + grade + stature model with
 * OU σ 1.2 spm τ 20 s and 2.5 spm lower at the very start; walking gait σ 2 spm. Cycling: grade model with
 * OU σ 3 rpm τ 15 s, +0.15 rpm per % of power surge over the 30 s average, limited by the lowest gear at
 * crawling speed; 0 while coasting. 0 whenever the sample is not moving.
 */
export function cadenceStream(rec: KinRecord, n: number, sport: ActivityType, athlete: Athlete, random: Random): Float64Array {
  const out = new Float64Array(n);
  const heightM = athlete.heightCm / 100;
  const ride = sport === 'ride';
  const runWander = ouStepper(random, 20, 1.2);
  const walkWander = ouStepper(random, 20, 2.0);
  const rideWander = ouStepper(random, 15, 3.0);
  const aPower = 1 - Math.exp(-1 / 30);
  let powerAvg = 0;
  for (let i = 0; i < n; i++) {
    const run = runWander();
    const walk = walkWander();
    const spin = rideWander();
    const white = 0.5 * random.normal();
    const v = rec.speed[i];
    const gait = rec.gait[i];
    const advanced = i > 0 && rec.dist[i] > rec.dist[i - 1];
    if (gait === GAIT_STOPPED || v <= 0.05 || !advanced) continue;
    const gPct = rec.grade[i] * 100;
    let c = 0;
    if (ride) {
      if (gait !== GAIT_PEDAL) continue;
      const p = rec.power[i];
      powerAvg = powerAvg > 0 ? powerAvg + (p - powerAvg) * aPower : p;
      const surge = powerAvg > 1 ? Math.max(-8, Math.min(8, (15 * (p - powerAvg)) / powerAvg)) : 0;
      c = Math.min(110, Math.max(55, rideCadence(gPct, athlete.fitness) + spin + white + surge));
      c = Math.min(c, Math.max(25, (v * 60) / LOWEST_GEAR_M));
    } else if (gait === GAIT_RUN) {
      const warm = 2.5 * Math.max(0, 1 - i / 300);
      c = Math.min(205, Math.max(140, runCadence(v, gPct, heightM) - warm + run + white));
    } else {
      c = Math.min(135, Math.max(80, walkCadence(v, gPct) + walk + white));
    }
    out[i] = Math.round(c);
  }
  return out;
}

/**
 * Watts. Rides: crank power from the dynamics (already carries power noise; 0 when coasting).
 * Runs: Stryd-like estimate m·v/0.98·(Cr(i)/Cr(0))^γ with OU σ 3 % τ 5 s.
 * Walks and hikes: 0 — no mainstream walking power meter exists, so the file stays honest.
 */
export function powerStream(rec: KinRecord, n: number, sport: ActivityType, bodyKg: number, random: Random): Float64Array {
  const out = new Float64Array(n);
  if (sport === 'ride') {
    for (let i = 0; i < n; i++) out[i] = Math.round(Math.max(0, rec.power[i]));
    return out;
  }
  if (sport !== 'run') return out;
  const wander = ouStepper(random, 5, 0.03);
  for (let i = 0; i < n; i++) {
    const noise = wander();
    const v = rec.speed[i];
    if (rec.gait[i] === GAIT_STOPPED || v <= 0.05) continue;
    out[i] = Math.round(runningPower(bodyKg, v, rec.grade[i]) * Math.exp(noise));
  }
  return out;
}

const GPS_ENVIRONMENT: Readonly<Record<string, number>> = { low: 0.6, normal: 1.0, high: 2.0 };
const round7 = (x: number): number => Math.round(x * 1e7) / 1e7;

/** GPS error model constants (σ in metres before the environment multiplier). */
export const GPS_MODEL = {
  /** Slowly wandering bias (geometry/atmosphere), smoothed so it drifts rather than jitters. */
  biasSigma: 1.5,
  biasTau: 240,
  biasSmooth: 30,
  /** Multipath: correlated over distance moved (reflector geometry), held while standing still. */
  multipathSigma: 0.6,
  multipathLength: 20,
  multipathSmooth: 6,
  white: 0.02,
  /** Receiver tracking lag used only for corner cutting (along-track lag is removed). */
  lag: 1.5,
  cornerMax: 6,
} as const;

/** Error parts smoothed by a first-order filter keep their stationary σ: σ_in = σ·√((τ + τs)/τ). */
const smoothedSigma = (sigma: number, tau: number, smooth: number): number => sigma * Math.sqrt((tau + smooth) / tau);

/**
 * Recorded positions. 'off': exact route points. Otherwise the true position plus a smooth error:
 * bias (OU, low-passed) + distance-correlated multipath (low-passed) + tiny white jitter, all × environment
 * multiplier. Corner cutting comes from a 1.5 s tracking lag with its along-track component removed, so points
 * never trail the distance stream. Position holds while stopped (static hold), and a spike guard keeps each
 * 1 s displacement within max(1.25·true step, true step + 0.5 m).
 */
export function positionStreams(
  track: Track,
  dist: Float64Array,
  n: number,
  level: GpsNoiseLevel,
  seed: number,
): { lat: Float64Array; lon: Float64Array } {
  const lat = new Float64Array(n);
  const lon = new Float64Array(n);
  const cur = new Cursor(track);
  const env = Object.prototype.hasOwnProperty.call(GPS_ENVIRONMENT, level) ? GPS_ENVIRONMENT[level] : 0;
  if (!(env > 0) || track.n === 0) {
    for (let i = 0; i < n; i++) {
      cur.seek(dist[i]);
      lon[i] = cur.lerp(track.lon);
      lat[i] = cur.lerp(track.lat);
    }
    return { lat, lon };
  }
  const M = GPS_MODEL;
  const biasRandom = createRandom(seed, 'gps-bias');
  const pathRandom = createRandom(seed, 'gps-multipath');
  const whiteRandom = createRandom(seed, 'gps-white');
  const biasSigma = smoothedSigma(M.biasSigma * env, M.biasTau, M.biasSmooth);
  const biasE = ouStepper(biasRandom, M.biasTau, biasSigma);
  const biasN = ouStepper(biasRandom, M.biasTau, biasSigma);
  // Distance-domain OU has a different effective time constant per step; the smoothing correction uses the
  // walking-speed case (the one that matters for track length).
  const pathSigma = M.multipathSigma * env * Math.sqrt(1 + M.multipathSmooth / (M.multipathLength / 1.4));
  let pathE = pathSigma * pathRandom.normal();
  let pathN = pathSigma * pathRandom.normal();
  const aBias = 1 - Math.exp(-1 / M.biasSmooth);
  const aPath = 1 - Math.exp(-1 / M.multipathSmooth);
  const aLag = 1 - Math.exp(-1 / M.lag);
  const white = M.white * env;

  const lon0 = track.lon[0];
  const lat0 = track.lat[0];
  const kx = M_PER_DEG * Math.max(0.01, Math.cos(lat0 * DEG));
  let bE = biasE();
  let bN = biasN();
  let mE = pathE;
  let mN = pathN;
  let lagX = 0;
  let lagY = 0;
  let ux = 1;
  let uy = 0;
  if (track.n > 1) {
    const hx = (track.lon[1] - lon0) * kx;
    const hy = (track.lat[1] - lat0) * M_PER_DEG;
    const hl = Math.hypot(hx, hy);
    if (hl > 0) {
      ux = hx / hl;
      uy = hy / hl;
    }
  }
  let prevX = 0;
  let prevY = 0;
  for (let i = 0; i < n; i++) {
    cur.seek(dist[i]);
    const x = (cur.lerp(track.lon) - lon0) * kx;
    const y = (cur.lerp(track.lat) - lat0) * M_PER_DEG;
    const step = i > 0 ? dist[i] - dist[i - 1] : 0;

    bE += (biasE() - bE) * aBias;
    bN += (biasN() - bN) * aBias;
    const rho = Math.exp(-Math.max(0, step) / M.multipathLength);
    const kick = pathSigma * Math.sqrt(1 - rho * rho);
    pathE = pathE * rho + kick * pathRandom.normal();
    pathN = pathN * rho + kick * pathRandom.normal();
    mE += (pathE - mE) * aPath;
    mN += (pathN - mN) * aPath;
    const wE = white * whiteRandom.normal();
    const wN = white * whiteRandom.normal();

    let cx = 0;
    let cy = 0;
    if (i === 0) {
      lagX = x;
      lagY = y;
    } else {
      const px = lagX;
      const py = lagY;
      lagX += (x - lagX) * aLag;
      lagY += (y - lagY) * aLag;
      const mx = lagX - px;
      const my = lagY - py;
      const ml = Math.hypot(mx, my);
      if (ml > 0.05) {
        ux = mx / ml;
        uy = my / ml;
      }
      const along = (x - lagX) * ux + (y - lagY) * uy;
      cx = lagX + along * ux - x;
      cy = lagY + along * uy - y;
      const cl = Math.hypot(cx, cy);
      if (cl > M.cornerMax) {
        cx *= M.cornerMax / cl;
        cy *= M.cornerMax / cl;
      }
    }

    let ox = x + bE + mE + wE + cx;
    let oy = y + bN + mN + wN + cy;
    if (i > 0) {
      if (step <= 0) {
        ox = prevX;
        oy = prevY;
      } else {
        const limit = Math.max(1.25 * step, step + 0.5);
        const dx = ox - prevX;
        const dy = oy - prevY;
        const d = Math.hypot(dx, dy);
        if (d > limit) {
          ox = prevX + (dx * limit) / d;
          oy = prevY + (dy * limit) / d;
        }
      }
    }
    prevX = ox;
    prevY = oy;
    lon[i] = round7(lon0 + ox / kx);
    lat[i] = round7(lat0 + oy / M_PER_DEG);
  }
  return { lat, lon };
}

/**
 * Recorded altitude: DEM + barometric wander OU σ 0.8 m τ 300 s, quantised to 0.2 m like barometric watches.
 * No constant offset (it would only disagree with basemaps). 'off' returns the DEM profile exactly.
 */
export function elevationStream(track: Track, dist: Float64Array, n: number, level: GpsNoiseLevel, seed: number): Float64Array {
  const ele = trueElevation(track, dist, n);
  if (level === 'off') return ele;
  const random = createRandom(seed, 'baro');
  const wander = ouStepper(random, 300, 0.8);
  for (let i = 0; i < n; i++) ele[i] = Math.round((ele[i] + wander()) * 5) / 5;
  return ele;
}

/** DEM elevation at each recorded distance (noise-free). */
export function trueElevation(track: Track, dist: Float64Array, n: number): Float64Array {
  const ele = new Float64Array(n);
  const cur = new Cursor(track);
  for (let i = 0; i < n; i++) {
    cur.seek(dist[i]);
    ele[i] = cur.lerp(track.ele);
  }
  return ele;
}
