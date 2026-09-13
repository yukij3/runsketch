// Heart rate: metabolic demand → steady-state HR (Swain %HRR = %VO2R) → slow component + cardiac drift
// → vagal/sympathetic kinetics → sensor. Background: docs/physiology.md.
import type { HrSensor } from '../types';
import { softCap } from './models';
import { ouStepper, type Random } from './rng';

/**
 * Kinetic time constants, s, before fitness scaling. HR above rest is split into a vagal part (the first
 * VAGAL_FRACTION of HR reserve: fast withdrawal at onset τ ≈ 8–27 s, fast reactivation when exercise stops)
 * and a sympathetic part above it (on τ ≈ 33–70 s; off τ ≈ 96 s when exercise stops altogether). PMC5492202,
 * PMC5526966. The sympathetic part falls at most twice as slowly as it rises: between two exercise intensities
 * off-transients are faster than after stopping, and a slower fall would push mean HR above mean demand on rolling
 * routes (HEURISTIC ratio). `sympatheticDown` applies after a sustained effort; see SURGE. Standing still, recovery
 * follows the slower post-exercise course (`sympatheticStopped`). The vagal part only matters when exercise starts or
 * stops, where its fast 30 s reactivation is the classic first phase of HR recovery.
 */
export const HR_TAU = { vagalUp: 10, vagalDown: 30, sympatheticUp: 50, sympatheticDown: 100, sympatheticStopped: 160 } as const;

/**
 * Sympathetic withdrawal after a short surge is faster: the fall τ runs from `ratio`·sympatheticUp for a brief surge
 * to sympatheticDown for an effort held for minutes. How brief is judged by how much of the rise above a slow
 * `baseline`-second average the `memory`-second average has not caught up with yet. HEURISTIC.
 */
export const SURGE = { ratio: 1.2, memory: 120, baseline: 600 } as const;

/** Seconds after setting off during which HR stops falling (central command withdraws vagal tone at once). */
export const RESTART_HOLD = 20;

/** Share of HR reserve under vagal control (HEURISTIC; on-kinetics are fastest below ≈45–60 % VO2max). */
export const VAGAL_FRACTION = 0.25;

/**
 * Heavy-domain slow component, bpm at full amplitude (Zakynthinaki 2015 τ = 420 s, ≈4 bpm per mM lactate). The VO2
 * slow component is about a third smaller in running than in cycling (Carter 2000: 205/302 vs 334/430 ml/min), so
 * foot sports use 10 bpm and rides 15 (HEURISTIC mapping to bpm).
 */
export const SLOW_COMPONENT = { run: 10, ride: 15, tauUp: 420, tauDown: 450 } as const;

/**
 * Cardiac drift in neutral weather (15 °C, dry, calm): onset, rate as a fraction of HR per hour, soft limit (linear up
 * to `knee`, approaching `cap`), recovery of accumulated drift while stopped, and the share of the curve left once
 * economy loss with fatigue raises O2 cost on its own. Warmer or colder air does not change this rate: the weather
 * reaches heart rate through the heat balance instead (DemandOptions.heat), measured against this same neutral air, so
 * the two are never counted twice. Rate, recovery τ, limits and scale HEURISTIC.
 */
export const DRIFT = { onsetS: 720, ratePerHour: 0.03, knee: 0.1, cap: 0.18, recoveryTau: 1200, scale: 0.9 } as const;

/**
 * Standing/upright baseline as a fraction of HR reserve. Resting HR is usually taken lying down or
 * seated; standing adds ≈10 bpm (orthostatic), so the Swain mapping is referenced to this floor.
 */
export const UPRIGHT_FRACTION = 0.08;

export interface HrParams {
  rest: number;
  max: number;
  /** ml/kg/min. */
  vo2max: number;
  /** Fitness multiplier for all kinetic time constants. */
  tauScale: number;
  fracLT: number;
  /** Slow component at full amplitude, bpm (defaults to the running value). */
  slowComponent?: number;
  /**
   * Multiplier on the drift rate. A beginner's heart rate climbs through a long effort faster than an elite's; that
   * difference used to ride on a large economy loss, and belongs here instead (see DRIFT_BY_LEVEL).
   */
  driftScale?: number;
}

export interface DemandOptions {
  /** 1 while moving. Drift builds on moving time only and partly recovers while stopped. */
  moving?: Uint8Array;
  /** Per-sample multiplier on VO2max (altitude). */
  vo2maxFactor?: Float64Array;
/**
   * Per-sample heart-rate share from heat strain, added to the drift before its soft limit. It is the heat balance in
   * the real weather against the same motion in neutral weather, so it is zero in neutral air and the calibrated
   * neutral drift above is never counted twice.
   */
  heat?: Float64Array;
  /** Per-sample multiplier on HRmax (altitude lowers maximal heart rate; see hrMaxAltitudeFactor). Independent of heat. */
  hrMaxFactor?: Float64Array;
  /** Per-sample rise of resting heart rate, bpm (altitude; see restHrAltitudeFactor). */
  restOffset?: Float64Array;
  /**
   * Per-sample share of O2 cost lost to fatigue (economyFactor − 1). It already sits in vo2Net, so it is counted
   * against the same soft limit as drift and heat and then taken back out: the slow rise has one budget, not three.
   */
  economy?: Float64Array;
}

export interface DemandResult {
  demand: Float64Array;
  /** Fraction of VO2 reserve after smoothing (for warnings/tests). */
  frac: Float64Array;
}

/**
 * Steady-state HR demand from net VO2 per second (already smoothed to muscle-level demand).
 * HR_base = rest + HRR·(u + (1−u)·frac), compressed near HRmax (HR deflection); then ·(1 + drift) plus the
 * slow component, which therefore still shows above threshold, and a final soft cap just under HRmax. Resting and
 * maximal heart rate, and so the reserve and both caps, follow the per-sample altitude levels when given.
 */
export function hrDemand(vo2Net: Float64Array, n: number, p: HrParams, opts: DemandOptions = {}): DemandResult {
  const demand = new Float64Array(n);
  const frac = new Float64Array(n);
  const aUp = 1 - Math.exp(-1 / SLOW_COMPONENT.tauUp);
  const aDown = 1 - Math.exp(-1 / SLOW_COMPONENT.tauDown);
  const aIntensity = 1 - Math.exp(-1 / 300);
  const aRecover = 1 - Math.exp(-1 / DRIFT.recoveryTau);
  const lt = Math.min(0.95, Math.max(0.5, p.fracLT));
  const slowAmplitude = p.slowComponent ?? SLOW_COMPONENT.run;
  const driftScale = p.driftScale ?? 1;
  const { moving, vo2maxFactor, heat, hrMaxFactor, restOffset, economy } = opts;
  let sc = 0;
  let slowFrac = 0;
  /** Accumulated drift at intensity 1: Σ rate(T)·dt over moving time after the onset. */
  let driftSum = 0;
  let exercised = 0;
  for (let i = 0; i < n; i++) {
    const factor = vo2maxFactor ? vo2maxFactor[i] : 1;
    const vo2r = Math.max(5, p.vo2max * factor - 3.5);
    const f = Math.max(0, vo2Net[i] / vo2r);
    frac[i] = f;
    slowFrac += (Math.min(f, 1.2) - slowFrac) * aIntensity;
    const scTarget = slowAmplitude * Math.min(1.2, Math.max(0, (f - lt) / (1 - lt)));
    sc += (scTarget - sc) * (scTarget > sc ? aUp : aDown);
    if (!moving || moving[i]) {
      exercised++;
      if (exercised > DRIFT.onsetS) driftSum += (DRIFT.ratePerHour * driftScale) / 3600;
    } else {
      driftSum -= driftSum * aRecover;
    }
    const intensity = Math.min(1.3, Math.max(0.5, slowFrac / 0.65));
    // One budget for the whole slow rise. Cardiac drift, heat strain and the O2 cost fatigue has already cost the
    // runner all press on the same ceiling, so none of them can stack the heart rate into its maximum. What economy
    // adds is already in vo2Net, so it is taken back out once the limit has been applied.
    const used = economy ? Math.max(0, economy[i]) : 0;
    const own = Math.max(0, DRIFT.scale * driftSum * intensity + (heat ? heat[i] : 0));
    const rising = own + used;
    // The whole slow rise presses on one ceiling, and the squeeze near it is shared in proportion. Taking the economy
    // loss straight off the drift instead would pull heart rate down late in a long run, as that loss keeps growing.
    const drift = rising > 0 ? own * (softCap(rising, DRIFT.cap, DRIFT.knee) / rising) : 0;
    const effort = UPRIGHT_FRACTION + (1 - UPRIGHT_FRACTION) * Math.min(f, 1.15);
    const rest = restOffset ? p.rest + restOffset[i] : p.rest;
    const max = hrMaxFactor ? p.max * hrMaxFactor[i] : p.max;
    const base = softCap(rest + Math.max(10, max - rest) * effort, max - 6, max - 18);
    demand[i] = softCap(base * (1 + drift) + sc, max - 1, max - 5);
  }
  return { demand, frac };
}

export interface HrLevels {
  rest: number;
  max: number;
  /** Per-sample resting HR, bpm (altitude); `rest` when absent. */
  restAt?: ArrayLike<number>;
  /** Per-sample maximal HR, bpm (altitude); `max` when absent. */
  maxAt?: ArrayLike<number>;
}

const DEFAULT_LEVELS: HrLevels = { rest: 60, max: 190 };

/** Demand this far (bpm) above its 10 s trend means effort is ramping back up (HEURISTIC). */
const RECOVERY_RISE = 2;

/**
 * Two parallel first-order states: HR = rest + vagal + sympathetic. The demand above rest is split at
 * VAGAL_FRACTION of HR reserve; each state tracks its share with its own rise or fall constant, chosen by the
 * sign of its own gap. Large transitions (start, stops) therefore move immediately, while changes high in the
 * range (a climb, a crest) stay slower. Sympathetic withdrawal is faster after a short surge than after a held effort
 * (SURGE), and pauses while demand is ramping back up. With `moving`, HR also stops falling for RESTART_HOLD seconds
 * after setting off, so it turns upward at the restart instead of sagging while the runner accelerates.
 */
export function hrKinetics(
  demand: Float64Array,
  n: number,
  tauScale: number,
  initial: number,
  levels: HrLevels = DEFAULT_LEVELS,
  moving?: Uint8Array,
): Float64Array {
  const out = new Float64Array(n);
  const sc = Math.max(0.2, tauScale);
  const rate = (tau: number): number => 1 - Math.exp(-1 / (tau * sc));
  const vUp = rate(HR_TAU.vagalUp);
  const vDown = rate(HR_TAU.vagalDown);
  const sUp = rate(HR_TAU.sympatheticUp);
  const sStopped = rate(HR_TAU.sympatheticStopped);
  const aHeld = rate(SURGE.memory);
  const aBaseline = rate(SURGE.baseline);
  const sustainedRatio = HR_TAU.sympatheticDown / HR_TAU.sympatheticUp;
  const { restAt, maxAt } = levels;
  const restOf = (i: number): number => (restAt && i < restAt.length ? restAt[i] : levels.rest);
  const spanOf = (i: number, rest: number): number => VAGAL_FRACTION * Math.max(10, (maxAt && i < maxAt.length ? maxAt[i] : levels.max) - rest);
  const above0 = Math.max(0, initial - restOf(0));
  let vagal = Math.min(above0, n > 0 ? spanOf(0, restOf(0)) : 0);
  let symp = above0 - vagal;
  /** Averages of the sympathetic part over SURGE.memory and SURGE.baseline: how long the current level has been held. */
  let held = symp;
  let baseline = symp;
  let hold = 0;
  if (n > 0) out[0] = restOf(0) + vagal + symp;
  const aTrend = 1 - Math.exp(-1 / 10);
  let trend = n > 0 ? demand[0] : 0;
  for (let i = 1; i < n; i++) {
    trend += (demand[i] - trend) * aTrend;
    if (moving && moving[i] && !moving[i - 1]) hold = RESTART_HOLD;
    const rest = restOf(i);
    const span = spanOf(i, rest);
    const above = Math.max(0, demand[i] - rest);
    const vt = Math.min(above, span);
    const st = above - vt;
    if (vt > vagal) vagal += (vt - vagal) * vUp;
    else if (hold === 0) vagal += (vt - vagal) * vDown;
    held += (symp - held) * aHeld;
    baseline += (symp - baseline) * aBaseline;
    if (st > symp) symp += (st - symp) * sUp;
    else if (hold === 0 && demand[i] <= trend + RECOVERY_RISE) {
      if (moving && !moving[i]) {
        symp += (st - symp) * sStopped;
      } else {
        const rise = symp - baseline;
        const brief = rise > 1 ? Math.min(1, Math.max(0, (symp - held) / rise)) : 0;
        const tau = HR_TAU.sympatheticUp * (sustainedRatio - (sustainedRatio - SURGE.ratio) * brief);
        symp += (st - symp) * rate(tau);
      }
    }
    if (hold > 0) hold--;
    out[i] = rest + vagal + symp;
  }
  return out;
}

export interface SensorExtras {
  /** Cadence stream (spm) for optical cadence-lock episodes. */
  cadence?: Float64Array;
  /** Separate random stream for optical artefact episodes. */
  artefacts?: Random;
  /** Per-sample resting and maximal HR, bpm (altitude): the recorded range follows them. */
  restAt?: ArrayLike<number>;
  maxAt?: ArrayLike<number>;
  /** Physiological wander, bpm (see physiologicalWander), added after the squeeze under the maximum. */
  wander?: Float64Array;
}

const ARTEFACT = { earlyWindow: 600, pEarly: 1 / 1800, pLate: 1 / 7200, minS: 20, maxS: 90, ramp: 8 } as const;

/**
 * Optical artefact episodes (magnitudes UNVERIFIED): mostly in the first 10 min, 20–90 s long, either
 * locking onto running cadence or under-reading by 10–20 bpm. Returns a per-second additive offset.
 */
function opticalArtefacts(trueHr: Float64Array, n: number, cadence: Float64Array | undefined, random: Random): Float64Array {
  const offset = new Float64Array(n);
  let i = 0;
  while (i < n) {
    const p = i < ARTEFACT.earlyWindow ? ARTEFACT.pEarly : ARTEFACT.pLate;
    if (random.uniform() >= p) {
      i++;
      continue;
    }
    const duration = Math.round(ARTEFACT.minS + random.uniform() * (ARTEFACT.maxS - ARTEFACT.minS));
    const lockCandidate = random.uniform() < 0.5;
    const depth = 10 + 10 * random.uniform();
    const end = Math.min(n, i + duration);
    for (let k = i; k < end; k++) {
      const w = Math.min(1, (k - i + 1) / ARTEFACT.ramp, (end - k) / ARTEFACT.ramp);
      const c = cadence ? cadence[k] : 0;
      const locked = lockCandidate && c > trueHr[k] + 10 && c < trueHr[k] + 60;
      offset[k] = w * (locked ? c - trueHr[k] : -depth);
    }
    i = end + 1;
  }
  return offset;
}

/**
 * Optical under-read on the first ramp-up (Icenhower et al. 2025, Garmin FR45 vs Polar H10: ECG − PPG +14.35 bpm on
 * the first ramp, 72 % of people beyond ±5 bpm, +2.5 on the second). While true HR is still rising in the first
 * minutes the sensor reports `fraction` of the rise less, up to `cap` bpm; once the ramp ends the gap closes with
 * τ = `decay` s. Share, fraction, cap and decay ranges are HEURISTIC.
 */
export const FIRST_RAMP = {
  share: 0.85,
  fraction: [0.25, 0.5],
  cap: [10, 20],
  decay: [45, 90],
  /** The ramp ends when true HR rose less than `flatBpm` over the last `flatWindowS` seconds, or at `maxS`. */
  flatBpm: 2,
  flatWindowS: 20,
  minS: 30,
  maxS: 300,
} as const;

const between = (range: readonly [number, number], u: number): number => range[0] + (range[1] - range[0]) * u;

/** Per-second bpm the optical sensor under-reads during the first ramp (all zeros for activities without it). */
function firstRampUnderRead(trueHr: Float64Array, n: number, random: Random): Float64Array {
  const out = new Float64Array(n);
  const R = FIRST_RAMP;
  const present = random.uniform() < R.share;
  const fraction = between(R.fraction, random.uniform());
  const cap = between(R.cap, random.uniform());
  const decay = between(R.decay, random.uniform());
  if (!present || n === 0) return out;
  const start = trueHr[0];
  let end = -1;
  let atEnd = 0;
  for (let i = 0; i < n; i++) {
    if (end < 0) {
      const flat = i >= R.minS && trueHr[i] - trueHr[i - R.flatWindowS] < R.flatBpm;
      out[i] = Math.min(cap, fraction * Math.max(0, trueHr[i] - start));
      if (flat || i >= R.maxS) {
        end = i;
        atEnd = out[i];
      }
    } else {
      out[i] = atEnd * Math.exp(-(i - end) / decay);
      if (out[i] < 0.01) break;
    }
  }
  return out;
}

/** Sensor noise: OU wander (τ s, σ bpm) and white bpm per sample. Strap tuned to ≈ 64 % unchanged seconds at 1 Hz. */
export const HR_SENSOR_NOISE = {
  strap: { tau: 25, sigma: 0.9, white: 0.2 },
  optical: { tau: 25, sigma: 2.0, white: 0.6 },
} as const;

/**
 * Physiological wander of heart rate around its kinetic response: breathing, posture, small changes of effort and
 * footing. The one decoded 1 Hz strap file we have wanders 1.50 bpm around a 61 s moving average over its steady middle,
 * and 2.44 bpm around a 121 s one, while most seconds still read the
 * same beat (≈64 % unchanged), so the wander is slow: an OU process (τ s, σ bpm before smoothing) passed twice through a
 * `smooth`-second low-pass, which adds little from one second to the next. Standing still it shrinks to `stoppedShare`,
 * eased in over `easeS` seconds. `scale` follows the session's variability like the pace noise (HEURISTIC amplitude,
 * fitted to those files at the default variability).
 */
export const HR_WANDER = { tau: 20, smooth: 8, sigma: 6.5, stoppedShare: 0.5, easeS: 10 } as const;

/** Per-second physiological HR wander, bpm (see HR_WANDER); `moving` shrinks it while standing. */
export function physiologicalWander(n: number, moving: Uint8Array | undefined, random: Random, scale = 1): Float64Array {
  const out = new Float64Array(n);
  const W = HR_WANDER;
  const step = ouStepper(random, W.tau, W.sigma * Math.max(0, scale));
  const aSmooth = 1 - Math.exp(-1 / W.smooth);
  const aEase = 1 - Math.exp(-1 / W.easeS);
  let first = n > 0 ? step() : 0;
  let second = first;
  let share = moving && n > 0 && !moving[0] ? W.stoppedShare : 1;
  for (let i = 0; i < n; i++) {
    first += (step() - first) * aSmooth;
    second += (first - second) * aSmooth;
    share += ((moving && !moving[i] ? W.stoppedShare : 1) - share) * aEase;
    out[i] = second * share;
  }
  return out;
}

/**
 * The kinetic heart rate is squeezed smoothly into `headroom` bpm below the maximum (from `knee` bpm further down), then
 * the physiological wander and sensor noise are added, and whatever still crosses the maximum is reflected back below
 * it. Recorded HR then never exceeds the maximum without sitting on a flat shelf there, as clipping would leave. The
 * wander fades within `fade` bpm of the maximum, so a near-maximal effort is not pulled down by reflections
 * (HEURISTIC widths).
 */
export const HR_CEILING = { headroom: 1, knee: 3, fade: 10 } as const;

/**
 * Recorded HR. Strap: OU σ 0.9 bpm τ 25 s + white 0.2. Optical: (truth − first-ramp under-read + white 0.6 +
 * OU σ 2 bpm τ 25 s + rare artefact episodes) through the 5 s averaging window. Truth is squeezed under the maximum
 * first, the physiological wander added, and readings above the maximum are reflected (see HR_CEILING). Integer bpm
 * within [rest − 5, max].
 */
export function hrSensor(
  trueHr: Float64Array,
  n: number,
  sensor: HrSensor,
  rest: number,
  max: number,
  random: Random,
  extras: SensorExtras = {},
): Float64Array {
  const out = new Float64Array(n);
  const optical = sensor === 'optical';
  const noise = optical ? HR_SENSOR_NOISE.optical : HR_SENSOR_NOISE.strap;
  const underRead = optical ? firstRampUnderRead(trueHr, n, random) : null;
  const wander = ouStepper(random, noise.tau, noise.sigma);
  const aLp = 1 - Math.exp(-1 / 5);
  const { restAt, maxAt } = extras;
  const artefact = optical && extras.artefacts ? opticalArtefacts(trueHr, n, extras.cadence, extras.artefacts) : null;
  let lp = n > 0 ? trueHr[0] : 0;
  const C = HR_CEILING;
  for (let i = 0; i < n; i++) {
    const w = noise.white * random.normal();
    const drift = wander();
    const maxI = maxAt ? maxAt[i] : max;
    // Heart rate varies less as it nears its maximum, so the wander fades within `fade` bpm of it.
    const squeezed = softCap(trueHr[i], maxI - C.headroom, maxI - C.headroom - C.knee);
    const truth = squeezed + (extras.wander ? extras.wander[i] * Math.min(1, (maxI - squeezed) / C.fade) : 0);
    let x: number;
    if (optical) {
      lp += (truth - underRead![i] + w + drift + (artefact ? artefact[i] : 0) - lp) * aLp;
      x = lp;
    } else {
      x = truth + w + drift;
    }
    if (x > maxI) x = 2 * maxI - x;
    const top = Math.floor(maxI);
    const obs = Math.round(x);
    const lo = Math.round((restAt ? restAt[i] : rest) - 5);
    out[i] = obs < lo ? lo : obs > top ? top : obs;
  }
  return out;
}
