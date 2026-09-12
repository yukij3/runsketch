// Heart rate: metabolic demand → steady-state HR (Swain %HRR = %VO2R) → slow component + cardiac drift
// → vagal/sympathetic kinetics → sensor. Background: docs/physiology.md.
import type { HrSensor } from '../types';
import { driftRatePerHour, softCap } from './models';
import { ouStepper, type Random } from './rng';

/**
 * Kinetic time constants, s, before fitness scaling. HR above rest is split into a vagal part (the first
 * VAGAL_FRACTION of HR reserve: fast withdrawal at onset τ ≈ 8–27 s, fast reactivation when exercise stops)
 * and a sympathetic part above it (slow: on τ ≈ 33–70 s, off τ ≈ 96–120 s). PMC5492202, PMC5526966.
 */
export const HR_TAU = { vagalUp: 10, vagalDown: 30, sympatheticUp: 50, sympatheticDown: 160 } as const;

/** Share of HR reserve under vagal control (HEURISTIC; on-kinetics are fastest below ≈45–60 % VO2max). */
export const VAGAL_FRACTION = 0.25;

/** Heavy-domain slow component (Zakynthinaki 2015 τ = 420 s, ≈4 bpm per mM lactate). */
export const SLOW_COMPONENT = { amplitude: 15, tauUp: 420, tauDown: 450 } as const;

/** Drift onset, cap, and recovery of accumulated drift while stopped (recovery τ HEURISTIC). */
export const DRIFT = { onsetS: 720, cap: 0.15, recoveryTau: 1200 } as const;

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
  temperatureC: number;
}

export interface DemandOptions {
  /** 1 while moving. Drift builds on moving time only and partly recovers while stopped. */
  moving?: Uint8Array;
  /** Per-sample multiplier on VO2max (altitude). */
  vo2maxFactor?: Float64Array;
}

export interface DemandResult {
  demand: Float64Array;
  /** Fraction of VO2 reserve after smoothing (for warnings/tests). */
  frac: Float64Array;
}

/**
 * Steady-state HR demand from net VO2 per second (already smoothed to muscle-level demand).
 * HR_base = rest + HRR·(u + (1−u)·frac), compressed near HRmax (HR deflection); then ·(1 + drift) plus the
 * slow component, which therefore still shows above threshold, and a final soft cap just under HRmax.
 */
export function hrDemand(vo2Net: Float64Array, n: number, p: HrParams, opts: DemandOptions = {}): DemandResult {
  const demand = new Float64Array(n);
  const frac = new Float64Array(n);
  const hrr = Math.max(10, p.max - p.rest);
  const rate = driftRatePerHour(p.temperatureC);
  const aUp = 1 - Math.exp(-1 / SLOW_COMPONENT.tauUp);
  const aDown = 1 - Math.exp(-1 / SLOW_COMPONENT.tauDown);
  const aIntensity = 1 - Math.exp(-1 / 300);
  const aRecover = 1 - Math.exp(-1 / DRIFT.recoveryTau);
  const lt = Math.min(0.95, Math.max(0.5, p.fracLT));
  const { moving, vo2maxFactor } = opts;
  let sc = 0;
  let slowFrac = 0;
  let driftExcess = 0;
  let exercised = 0;
  for (let i = 0; i < n; i++) {
    const factor = vo2maxFactor ? vo2maxFactor[i] : 1;
    const vo2r = Math.max(5, p.vo2max * factor - 3.5);
    const f = Math.max(0, vo2Net[i] / vo2r);
    frac[i] = f;
    slowFrac += (Math.min(f, 1.2) - slowFrac) * aIntensity;
    const scTarget = SLOW_COMPONENT.amplitude * Math.min(1.2, Math.max(0, (f - lt) / (1 - lt)));
    sc += (scTarget - sc) * (scTarget > sc ? aUp : aDown);
    if (!moving || moving[i]) {
      exercised++;
      if (exercised > DRIFT.onsetS) driftExcess++;
    } else {
      driftExcess -= driftExcess * aRecover;
    }
    const intensity = Math.min(1.3, Math.max(0.5, slowFrac / 0.65));
    const drift = Math.min(DRIFT.cap, (rate * driftExcess * intensity) / 3600);
    const effort = UPRIGHT_FRACTION + (1 - UPRIGHT_FRACTION) * Math.min(f, 1.15);
    const base = softCap(p.rest + hrr * effort, p.max - 6, p.max - 18);
    demand[i] = softCap(base * (1 + drift) + sc, p.max - 1, p.max - 5);
  }
  return { demand, frac };
}

export interface HrLevels {
  rest: number;
  max: number;
}

const DEFAULT_LEVELS: HrLevels = { rest: 60, max: 190 };

/** Demand this far (bpm) above its 10 s trend means effort is ramping back up (HEURISTIC). */
const RECOVERY_RISE = 2;

/**
 * Two parallel first-order states: HR = rest + vagal + sympathetic. The demand above rest is split at
 * VAGAL_FRACTION of HR reserve; each state tracks its share with its own rise or fall constant, chosen by the
 * sign of its own gap. Large transitions (start, stops) therefore move immediately, while changes high in the
 * range (a climb, a crest) stay slow and asymmetric. Sympathetic withdrawal pauses while demand is ramping back
 * up, so HR turns upward within seconds of resuming after a short stop instead of sagging for another 30 s.
 */
export function hrKinetics(
  demand: Float64Array,
  n: number,
  tauScale: number,
  initial: number,
  levels: HrLevels = DEFAULT_LEVELS,
): Float64Array {
  const out = new Float64Array(n);
  const sc = Math.max(0.2, tauScale);
  const rate = (tau: number): number => 1 - Math.exp(-1 / (tau * sc));
  const vUp = rate(HR_TAU.vagalUp);
  const vDown = rate(HR_TAU.vagalDown);
  const sUp = rate(HR_TAU.sympatheticUp);
  const sDown = rate(HR_TAU.sympatheticDown);
  const rest = levels.rest;
  const span = VAGAL_FRACTION * Math.max(10, levels.max - rest);
  const above0 = Math.max(0, initial - rest);
  let vagal = Math.min(above0, span);
  let symp = above0 - vagal;
  if (n > 0) out[0] = rest + vagal + symp;
  const aTrend = 1 - Math.exp(-1 / 10);
  let trend = n > 0 ? demand[0] : 0;
  for (let i = 1; i < n; i++) {
    trend += (demand[i] - trend) * aTrend;
    const above = Math.max(0, demand[i] - rest);
    const vt = Math.min(above, span);
    const st = above - vt;
    vagal += (vt - vagal) * (vt > vagal ? vUp : vDown);
    if (st > symp) symp += (st - symp) * sUp;
    else if (demand[i] <= trend + RECOVERY_RISE) symp += (st - symp) * sDown;
    out[i] = rest + vagal + symp;
  }
  return out;
}

export interface SensorExtras {
  /** Cadence stream (spm) for optical cadence-lock episodes. */
  cadence?: Float64Array;
  /** Separate random stream for optical artefact episodes. */
  artefacts?: Random;
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
 * Recorded HR. Strap: OU σ 1.2 bpm τ 15 s + white 0.4. Optical: (truth + white 0.6) through the 5 s
 * averaging window, + OU σ 2 bpm τ 20 s, + rare artefact episodes. Integer bpm clamped to [rest − 5, max + 2].
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
  const wander = ouStepper(random, optical ? 20 : 15, optical ? 2.0 : 1.2);
  const white = optical ? 0.6 : 0.4;
  const aLp = 1 - Math.exp(-1 / 5);
  const lo = Math.round(rest - 5);
  const hi = Math.round(max + 2);
  const artefact = optical && extras.artefacts ? opticalArtefacts(trueHr, n, extras.cadence, extras.artefacts) : null;
  let lp = n > 0 ? trueHr[0] : 0;
  for (let i = 0; i < n; i++) {
    const w = white * random.normal();
    let x: number;
    if (optical) {
      lp += (trueHr[i] + w + (artefact ? artefact[i] : 0) - lp) * aLp;
      x = lp;
    } else {
      x = trueHr[i] + w;
    }
    const obs = Math.round(x + wander());
    out[i] = obs < lo ? lo : obs > hi ? hi : obs;
  }
  return out;
}
