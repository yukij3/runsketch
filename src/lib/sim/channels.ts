// Per-second channels derived from the recorded motion: metabolic demand, cadence, power, GPS, altitude, device
// temperature and the recorded speed.
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
 * Running cadence noise, spm: OU wander and white noise per second. Tuned so whole strides/min stay unchanged in
 * about 80 % of 1 s steps, as a 1 s Garmin recording shows.
 */
export const RUN_CADENCE_NOISE = { tau: 30, sigma: 1.2, white: 0.2 } as const;

/**
 * Setting off and arriving: within `windowS` seconds of standing still and below `to` m/s, running cadence blends
 * linearly from walking cadence at `from` m/s, so the first steps of a start are not counted at a running rate.
 */
export const CADENCE_START_BLEND = { from: 0.8, to: 2.2, windowS: 10 } as const;

/**
 * Step length a mountaineer keeps on steep snow and thin air, m. Below about 0.75 m/s the walking-cadence fit would ask
 * for a shuffle of ever shorter steps; climbers instead hold the step and pause on the locked leg — the rest step — so
 * cadence follows the step length down to a quarter of a normal walk (HEURISTIC; 0.4–0.6 m is the usual range).
 */
const REST_STEP_M = 0.5;

/** Seconds to the nearest standstill sample (speed 0) before or after each sample. */
function secondsFromStandstill(speed: Float64Array, n: number): Float64Array {
  const out = new Float64Array(n).fill(Infinity);
  let last = -Infinity;
  for (let i = 0; i < n; i++) {
    if (!(speed[i] > 0)) last = i;
    out[i] = i - last;
  }
  let next = Infinity;
  for (let i = n - 1; i >= 0; i--) {
    if (!(speed[i] > 0)) next = i;
    out[i] = Math.min(out[i], next - i);
  }
  return out;
}

/**
 * Cadence: steps/min for foot sports, rpm for rides. Runs: speed + grade + stature model with
 * OU σ 1.2 spm τ 30 s + white 0.2 and 2.5 spm lower at the very start, blended from walking cadence while setting off
 * or arriving (CADENCE_START_BLEND); walking gait σ 2 spm, and on a mountain day the rest step (REST_STEP_M) takes
 * cadence below the walking floor on the slowest ground. Cycling: grade model with
 * OU σ 3 rpm τ 15 s, +0.15 rpm per % of power surge over the 30 s average, limited by the lowest gear at
 * crawling speed; 0 while coasting. 0 whenever the sample is not moving.
 */
export function cadenceStream(rec: KinRecord, n: number, sport: ActivityType, athlete: Athlete, random: Random): Float64Array {
  const out = new Float64Array(n);
  const heightM = athlete.heightCm / 100;
  const ride = sport === 'ride';
  const alpine = sport === 'alpine';
  const runWander = ouStepper(random, RUN_CADENCE_NOISE.tau, RUN_CADENCE_NOISE.sigma);
  const walkWander = ouStepper(random, 20, 2.0);
  const rideWander = ouStepper(random, 15, 3.0);
  const aPower = 1 - Math.exp(-1 / 30);
  const still = ride ? null : secondsFromStandstill(rec.speed, n);
  const B = CADENCE_START_BLEND;
  let powerAvg = 0;
  for (let i = 0; i < n; i++) {
    const run = runWander();
    const walk = walkWander();
    const spin = rideWander();
    const z = random.normal();
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
      c = Math.min(110, Math.max(55, rideCadence(gPct, athlete.fitness) + spin + 0.5 * z + surge));
      c = Math.min(c, Math.max(25, (v * 60) / LOWEST_GEAR_M));
    } else if (gait === GAIT_RUN) {
      const warm = 2.5 * Math.max(0, 1 - i / 300);
      const noise = run + RUN_CADENCE_NOISE.white * z;
      const running = runCadence(v, gPct, heightM) - warm;
      if (still && still[i] <= B.windowS && v < B.to) {
        const stepping = walkCadence(v, gPct);
        const w = Math.max(0, (v - B.from) / (B.to - B.from));
        c = Math.min(205, Math.max(80, stepping + w * (running - stepping) + noise));
      } else {
        c = Math.min(205, Math.max(140, running + noise));
      }
    } else {
      const stepping = walkCadence(v, gPct) + walk + 0.5 * z;
      // The rest step is a way of climbing: the weight settles on a locked leg and the party pauses on it. Going down,
      // the same party plunge-steps at an ordinary turnover, so only very slow ground brings the rest step back.
      const rest = alpine && (gPct > 5 || v < 0.35);
      c = rest ? Math.min(135, Math.max(25, Math.min(stepping, (60 * v) / REST_STEP_M))) : Math.min(135, Math.max(alpine ? 70 : 80, stepping));
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

/**
 * Recorded speed as a watch writes it: the kinematic speed low-passed forwards and backwards (τ 1 s per pass, so the
 * smoothing adds no lag against distance), plus a sensor error that wanders over tens of seconds (OU τ 25 s, low-passed
 * 0.8 s, σ 0.02 m/s + 5 % of speed up to 5 m/s), rounded to 0.01 m/s. Tuned so a steady run has 1 s speed changes of ≈ 0.04 m/s SD,
 * lag-1 autocorrelation ≈ 0.94 and ≈ 4 % variation around its 1-min average, as a 1 s Garmin fenix 2 recording shows
 * (the error size is HEURISTIC, well inside wrist GNSS speed errors: Gløersen et al. 2018). The filter and the error
 * shrink toward standstill (full size from 2 m/s), so starts and stops are not smeared. Exactly 0 while stopped, at
 * least 0.01 m/s while moving. Distance is not touched.
 */
export const SPEED_SENSOR = {
  tau: 1,
  fullSpeed: 2,
  errorTau: 25,
  errorSmooth: 0.8,
  errorBase: 0.02,
  errorPerMps: 0.05,
  errorSpeedCap: 5,
} as const;

export function recordedSpeed(speed: Float64Array, moving: Uint8Array, n: number, random: Random): Float64Array {
  const S = SPEED_SENSOR;
  const out = new Float64Array(n);
  const gain = new Float64Array(n);
  const still = (i: number) => !moving[i] || !(speed[i] > 0);
  for (let i = 0; i < n; i++) {
    const tau = S.tau * Math.min(1, speed[i] / S.fullSpeed);
    gain[i] = still(i) || tau < 1e-3 ? 1 : 1 - Math.exp(-1 / tau);
  }
  let f = 0;
  for (let i = 0; i < n; i++) {
    f += ((still(i) ? 0 : speed[i]) - f) * gain[i];
    out[i] = f;
  }
  for (let i = n - 2; i >= 0; i--) out[i] = out[i + 1] + (out[i] - out[i + 1]) * gain[i];
  // The error is low-passed too (unit stationary σ kept), so it wanders smoothly rather than stepping every second.
  const error = ouStepper(random, S.errorTau, S.errorSmooth > 0 ? Math.sqrt((S.errorTau + S.errorSmooth) / S.errorTau) : 1);
  const aError = S.errorSmooth > 0 ? 1 - Math.exp(-1 / S.errorSmooth) : 1;
  let e = 0;
  for (let i = 0; i < n; i++) {
    const draw = error();
    e = i === 0 ? draw / Math.sqrt((S.errorTau + S.errorSmooth) / S.errorTau) : e + (draw - e) * aError;
    if (still(i)) {
      out[i] = 0;
      continue;
    }
    const v = speed[i];
    const sigma = (S.errorBase + S.errorPerMps * Math.min(v, S.errorSpeedCap)) * Math.min(1, v / S.fullSpeed);
    out[i] = Math.max(0.01, Math.round((out[i] + sigma * e) * 100) / 100);
  }
  return out;
}

/**
 * Device temperature sensor, whole °C. The sensor is inside the unit, so body heat and airflow set what it reads
 * (Garmin fēnix 8 manual: "Your body temperature affects the temperature reading"). On foot a wrist unit settles at
 * T_air + k·(T_wrist − T_air) with k = 0.55 / (1 + 0.22·v): about +5 °C when running at 15 °C, more when walking or
 * standing, and little in the heat. Rides model a bar-mounted computer: air temperature plus up to 1.5 °C from its
 * electronics and sun, which airflow takes away. First-order response τ 10 min on the wrist (5 min on the bar),
 * starting 0–1.5 °C above air, plus a slow wander σ 0.4 °C τ 10 min. The whole-degree reading only moves once the
 * value is 0.6 °C away from it.
 *
 * Given the heat balance, the wrist follows it instead of a fixed curve: the watch sits on a limb, which runs cooler
 * than mean skin by `distalShare` of the skin-to-air gap (hands and wrists vasoconstrict first in the cold), the
 * airflow is the air speed the athlete actually meets rather than their ground speed, rain wets the strap and cools it
 * by up to `rainCooling` of the coupling, and a sleeve over the watch cuts the airflow to `sleeveAirflow` and halves
 * the limb's cooling. Coupling, shares and time constants are HEURISTIC.
 */
export const DEVICE_TEMPERATURE = {
  wristCoupling: 0.55,
  airflowPerMps: 0.22,
  barOffset: 1.5,
  barAirflowMps: 3,
  tauWrist: 600,
  tauBar: 300,
  airflowTau: 30,
  startAbove: 1.5,
  wanderSigma: 0.4,
  wanderTau: 600,
  hysteresis: 0.6,
  distalShare: 0.1,
  rainCooling: 0.3,
  rainFullMmH: 1,
  sleeveAirflow: 0.25,
  sleeveDistal: 0.5,
} as const;

/** Wrist skin temperature under a watch while exercising, °C (HEURISTIC: 33 °C at 25 °C air, 0.15 °C per °C, 27–35). */
export function wristSkinTemperature(airC: number): number {
  return Math.min(35, Math.max(27, 33 + 0.15 * (airC - 25)));
}

/** What the athlete's heat balance gives the watch on their wrist. */
export interface WristBody {
  /** Mean skin temperature under the clothing, °C. */
  skin: ArrayLike<number>;
  /** Air speed relative to the athlete, m/s. */
  air: ArrayLike<number>;
  /** Precipitation rate, mm/h. */
  rain: ArrayLike<number>;
  /** True when a sleeve covers the watch. */
  sleeve: boolean;
}

/**
 * `airC` is the air temperature per second; `speed` is the kinematic speed in m/s. Without `body` the wrist follows the
 * old fixed skin curve, which only knows the air temperature.
 */
export function temperatureStream(
  speed: ArrayLike<number>,
  airC: ArrayLike<number>,
  n: number,
  sport: ActivityType,
  random: Random,
  body?: WristBody,
): Float64Array {
  const T = DEVICE_TEMPERATURE;
  const out = new Float64Array(n);
  if (n === 0) return out;
  const air = (i: number) => (Number.isFinite(airC[i]) ? airC[i] : 15);
  const ride = sport === 'ride';
  const aResponse = 1 - Math.exp(-1 / (ride ? T.tauBar : T.tauWrist));
  const aFlow = 1 - Math.exp(-1 / T.airflowTau);
  const wander = ouStepper(random, T.wanderTau, T.wanderSigma);
  let value = air(0) + T.startAbove * random.uniform();
  let flow = 0;
  let shown = Math.round(value);
  const sleeveAir = body && body.sleeve ? T.sleeveAirflow : 1;
  const distal = T.distalShare * (body && body.sleeve ? T.sleeveDistal : 1);
  for (let i = 0; i < n; i++) {
    const a = air(i);
    const moved = body && !ride ? sleeveAir * Math.max(0, body.air[i] || 0) : Math.max(0, speed[i] || 0);
    flow += (moved - flow) * aFlow;
    let settle: number;
    if (ride) {
      settle = a + T.barOffset / (1 + flow / T.barAirflowMps);
    } else if (body) {
      // The limb the watch is on, then the wet strap.
      const wrist = a + (1 - distal) * (body.skin[i] - a);
      const wet = 1 - T.rainCooling * Math.min(1, Math.max(0, body.rain[i] || 0) / T.rainFullMmH);
      settle = a + ((T.wristCoupling * wet) / (1 + T.airflowPerMps * flow)) * (wrist - a);
    } else {
      settle = a + (T.wristCoupling / (1 + T.airflowPerMps * flow)) * (wristSkinTemperature(a) - a);
    }
    value += (settle - value) * aResponse;
    const reading = value + wander();
    if (Math.abs(reading - shown) >= T.hysteresis) shown = Math.round(reading);
    out[i] = shown;
  }
  return out;
}

const GPS_ENVIRONMENT: Readonly<Record<string, number>> = { low: 0.5, normal: 1.0, high: 1.6 };
const round7 = (x: number): number => Math.round(x * 1e7) / 1e7;

/** GPS error model constants (σ in metres, or seconds for timing, before the environment multiplier). */
export const GPS_MODEL = {
  /** Slowly wandering bias (geometry/atmosphere), smoothed so it drifts rather than jitters. */
  biasSigma: 1.5,
  biasTau: 240,
  biasSmooth: 30,
  /** Multipath: correlated over distance moved (reflector geometry), held while standing still. */
  multipathSigma: 0.4,
  multipathLength: 20,
  multipathSmooth: 6,
  /**
   * Fix timing error along the path (receiver filter latency that varies with signal quality), seconds of travel at
   * up to `timingSpeedCap` m/s. It sets the 1 s step-length jitter (SD ≈ 0.9 m at 3.4 m/s with lag-1 correlation
   * ≈ 0.65, as a 1 Hz single-band wrist GPS shows) without sideways zigzag, which is what inflates track length
   * (Ranacher et al. 2016).
   */
  timingSigma: 1.2,
  timingTau: 8,
  timingSmooth: 3,
  timingSpeedCap: 4,
  /** Slow time-domain wander: keeps positions drifting while standing still. */
  wanderSigma: 0.3,
  wanderTau: 30,
  wanderSmooth: 5,
  white: 0.02,
  /** Receiver tracking lag used only for corner cutting (along-track lag is removed). */
  lag: 1.5,
  cornerMax: 6,
  /** Spike guard: a 1 s displacement may exceed the true step by max(0.5 m, 2.5·stepSigma), and never 1.5·step + 3 m. */
  stepSigma: 0.9,
  /**
   * Start transient (HEURISTIC rate): in this share of activities the receiver is still settling, as in a 1 s Garmin
   * fenix 2 file whose first fixes repeated and whose track then jumped 30 m in one second. Fixes repeat until
   * `staleAfterMove` seconds after the athlete sets off, the track holds `offset` metres off until one correction
   * jump `jumpAfterMove` seconds after setting off (so the jump is 10–40 m), and the `residual` share fades with
   * τ `decayS`.
   */
  start: { share: 0.3, staleAfterMove: [2, 4], offset: [11, 44], jumpAfterMove: [5, 15], residual: 0.1, decayS: 5 },
} as const;

/** Error parts smoothed by a first-order filter keep their stationary σ: σ_in = σ·√((τ + τs)/τ). */
const smoothedSigma = (sigma: number, tau: number, smooth: number): number => sigma * Math.sqrt((tau + smooth) / tau);

/**
 * Recorded positions. 'off': exact route points. Otherwise the route point at the recorded distance shifted by a fix
 * timing error along the path, plus bias (OU, low-passed) + distance-correlated multipath (low-passed) + slow time
 * wander + tiny white jitter, all × environment multiplier. Corner cutting comes from a 1.5 s tracking lag with its
 * along-track component removed, so points never trail the distance stream. While stopped the timing error and
 * multipath hold but bias and wander keep drifting. A spike guard limits each 1 s displacement (GPS_MODEL.stepSigma),
 * and a seeded share of activities starts with a settling transient.
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
  const timingRandom = createRandom(seed, 'gps-timing');
  const wanderRandom = createRandom(seed, 'gps-wander');
  const startRandom = createRandom(seed, 'gps-start');
  const biasSigma = smoothedSigma(M.biasSigma * env, M.biasTau, M.biasSmooth);
  const biasE = ouStepper(biasRandom, M.biasTau, biasSigma);
  const biasN = ouStepper(biasRandom, M.biasTau, biasSigma);
  const timingIn = ouStepper(timingRandom, M.timingTau, smoothedSigma(M.timingSigma * env, M.timingTau, M.timingSmooth));
  const wanderSigma = smoothedSigma(M.wanderSigma * env, M.wanderTau, M.wanderSmooth);
  const wanderE = ouStepper(wanderRandom, M.wanderTau, wanderSigma);
  const wanderN = ouStepper(wanderRandom, M.wanderTau, wanderSigma);
  // Distance-domain OU has a different effective time constant per step; the smoothing correction uses the
  // walking-speed case (the one that matters for track length).
  const pathSigma = M.multipathSigma * env * Math.sqrt(1 + M.multipathSmooth / (M.multipathLength / 1.4));
  let pathE = pathSigma * pathRandom.normal();
  let pathN = pathSigma * pathRandom.normal();
  const aBias = 1 - Math.exp(-1 / M.biasSmooth);
  const aPath = 1 - Math.exp(-1 / M.multipathSmooth);
  const aTiming = 1 - Math.exp(-1 / M.timingSmooth);
  const aWander = 1 - Math.exp(-1 / M.wanderSmooth);
  // Pace behind the timing offset: follows motion over 3 s, but fades over 15 s once stopped, so a receiver that
  // was running ahead or behind settles onto the standing position slowly instead of sliding there.
  const aSpeed = 1 - Math.exp(-1 / 3);
  const aStill = 1 - Math.exp(-1 / 15);
  const aLag = 1 - Math.exp(-1 / M.lag);
  const white = M.white * env;
  const margin = Math.max(0.5, 2.5 * M.stepSigma * env);

  const S = M.start;
  const unit = () => startRandom.uniform();
  const settling = unit() < S.share;
  const staleAfter = S.staleAfterMove[0] + Math.floor(unit() * (S.staleAfterMove[1] - S.staleAfterMove[0] + 1));
  const offset = S.offset[0] + (S.offset[1] - S.offset[0]) * unit();
  const heading = 2 * Math.PI * unit();
  const jumpAfter = Math.round(S.jumpAfterMove[0] + (S.jumpAfterMove[1] - S.jumpAfterMove[0]) * unit());
  const startE = settling ? offset * Math.cos(heading) : 0;
  const startN = settling ? offset * Math.sin(heading) : 0;
  // Counted from the first second of movement, so a standing start does not hide the repeated fixes.
  let firstMove = n;
  for (let i = 1; i < n && firstMove === n; i++) if (dist[i] > dist[i - 1]) firstMove = i;
  const staleUntil = firstMove + staleAfter;
  const jumpAt = Math.max(staleUntil + 1, firstMove + jumpAfter);

  const lon0 = track.lon[0];
  const lat0 = track.lat[0];
  const kx = M_PER_DEG * Math.max(0.01, Math.cos(lat0 * DEG));
  const shifted = new Cursor(track);
  let bE = biasE();
  let bN = biasN();
  let mE = pathE;
  let mN = pathN;
  let timing = timingIn();
  let wE = wanderE();
  let wN = wanderN();
  let pace = 0;
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
    // Filter latency only displaces moving fixes, so the timing error holds while standing still.
    const timingDraw = timingIn();
    if (step > 0) timing += (timingDraw - timing) * aTiming;
    wE += (wanderE() - wE) * aWander;
    wN += (wanderN() - wN) * aWander;
    const jE = white * whiteRandom.normal();
    const jN = white * whiteRandom.normal();
    pace += (Math.max(0, step) - pace) * (step > 0 ? aSpeed : aStill);

    // Early or late fix: the route point a little ahead of or behind the recorded distance.
    shifted.seek(Math.max(0, Math.min(track.total, dist[i] + timing * Math.min(pace, M.timingSpeedCap))));
    const sx = (shifted.lerp(track.lon) - lon0) * kx;
    const sy = (shifted.lerp(track.lat) - lat0) * M_PER_DEG;

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

    let ox = sx + bE + mE + wE + jE + cx;
    let oy = sy + bN + mN + wN + jN + cy;
    if (i > 0) {
      const limit = Math.min(Math.max(0, step) + margin, 1.5 * Math.max(0, step) + 3);
      const dx = ox - prevX;
      const dy = oy - prevY;
      const d = Math.hypot(dx, dy);
      if (d > limit) {
        ox = prevX + (dx * limit) / d;
        oy = prevY + (dy * limit) / d;
      }
    }
    prevX = ox;
    prevY = oy;
    // The settling offset is added after the guard: its correction jump is exactly what a real file shows.
    let tx = 0;
    let ty = 0;
    if (settling) {
      const w = i < jumpAt ? 1 : S.residual * Math.exp(-(i - jumpAt) / S.decayS);
      tx = w * startE;
      ty = w * startN;
    }
    if (settling && i > 0 && i < staleUntil) {
      lon[i] = lon[0];
      lat[i] = lat[0];
      continue;
    }
    lon[i] = round7(lon0 + (ox + tx) / kx);
    lat[i] = round7(lat0 + (oy + ty) / M_PER_DEG);
  }
  return { lat, lon };
}

/**
 * Barometric altimeter model. Apparent altitude = DEM (height differences from the start stretched by `heightGain`)
 * + slow wander + weather drift + fast pressure noise, quantised to 0.2 m like barometric watches, calibrated at the
 * start (no constant offset, which would only disagree with basemaps). Barometric units over-estimate total ascent
 * against surveyed routes (Sánchez & Villena 2020, 202 mountain efforts); the 0–4 % stretch is HEURISTIC. Weather: the
 * pressure tendency is a slow random walk of the drift rate (σ 1.5 m/h, τ 3 h), i.e. mostly inside the Met Office
 * "slowly" band of 0.1–1.5 hPa per 3 h at 8.3 m per hPa. Fast noise (gusts, arm swing, sensor) is AR(1) τ 3 s, 1.6×
 * stronger while moving; with the 0.2 m steps about half of 1 s steps are unchanged and a few percent move ≥ 0.4 m.
 */
export const BARO_MODEL = {
  heightGain: [0, 0.04],
  wanderSigma: 0.8,
  wanderTau: 300,
  weatherRateSigma: 1.5,
  weatherRateTau: 10800,
  fastSigma: 0.09,
  fastTau: 3,
  movingGain: 1.6,
  resolution: 0.2,
} as const;

export interface ElevationOptions {
  /**
   * Apparent altitude change from air pressure, metres per second of the activity relative to its start (about
   * −8.3 m per hPa of pressure rise near sea level). Replaces the random weather drift when present.
   */
  pressureOffset?: ArrayLike<number>;
}

/** Recorded altitude (BARO_MODEL). 'off' returns the DEM profile exactly. */
export function elevationStream(
  track: Track,
  dist: Float64Array,
  n: number,
  level: GpsNoiseLevel,
  seed: number,
  options: ElevationOptions = {},
): Float64Array {
  const ele = trueElevation(track, dist, n);
  if (level === 'off') return ele;
  const B = BARO_MODEL;
  const gain = B.heightGain[0] + (B.heightGain[1] - B.heightGain[0]) * createRandom(seed, 'baro-gain').uniform();
  const ref = n > 0 ? ele[0] : 0;
  const wander = ouStepper(createRandom(seed, 'baro'), B.wanderTau, B.wanderSigma);
  const rate = ouStepper(createRandom(seed, 'baro-weather'), B.weatherRateTau, B.weatherRateSigma / 3600);
  const fast = ouStepper(createRandom(seed, 'baro-fast'), B.fastTau, B.fastSigma);
  const pressure = options.pressureOffset && options.pressureOffset.length >= n ? options.pressureOffset : null;
  const steps = 1 / B.resolution;
  let drift = 0;
  for (let i = 0; i < n; i++) {
    const r = rate();
    if (i > 0) drift += r;
    const weather = pressure ? pressure[i] - pressure[0] : drift;
    const moving = i > 0 && dist[i] > dist[i - 1];
    const noise = fast() * (moving ? B.movingGain : 1);
    ele[i] = Math.round((ref + (ele[i] - ref) * (1 + gain) + wander() + weather + noise) * steps) / steps;
  }
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
