// Cumulative fatigue within one activity: effort-weighted load, descent load, glycogen and D′ balance.
// Background: docs/fatigue.md. Every state is integrated once per moving second inside the kinematics, from
// the profile VO2max, so matching an average heart rate never changes the motion.
import type { FitnessLevel } from '../types';
import { J_PER_ML_O2, VO2_REST } from './models';

const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);

/** Net cost of flat running per km, J/kg (Minetti 2002: 3.6 J/kg/m). Load E counts flat-running kilometres. */
export const FLAT_KM_JOULES = 3600;

/** Net VO2 (ml/kg/min) per m/s of flat running: 3.6 J/kg/m · 60 / 20.9 kJ/L. */
export const VO2_PER_FLAT_MPS = (3.6 * 60) / J_PER_ML_O2;

/**
 * Intensity weighting of load E: exp(1.92·(f − 0.65)), f = share of VO2 reserve. The 1.92 exponent is Banister's
 * TRIMP weighting for men (Banister 1991), centred at a steady run, so a race kilometre counts ≈1.5 and an easy
 * one ≈0.9 (HEURISTIC centre).
 */
export function loadWeight(frac: number): number {
  return Math.exp(1.92 * (clamp(frac, 0, 1.5) - 0.65));
}

/**
 * Highest planned flat-equivalent running speed as a share of VO2 reserve: roughly what can be held for a few minutes
 * (HEURISTIC). A target that needs more on this route is not met; the engine warns instead of drawing it.
 */
export const RUN_FLAT_CEILING = 1.3;

/** Rides load the legs less per joule than running (no impact or eccentric work; HEURISTIC). */
export const RIDE_LOAD_SHARE = 0.6;

export interface FadeParams {
  /** Load (flat-running km) the athlete absorbs before capacity starts to fall. */
  onsetKm: number;
  /** Initial loss of speed per km of load beyond the onset. */
  slope: number;
  /** Largest loss the fade approaches, share of speed. */
  max: number;
}

/**
 * Durability: CP/VT1 are unchanged after 40–80 min of heavy work but fall 6–10 % by 2 h, less in fitter athletes
 * (Clark 2019; Stevenson 2022; Barrett & Maunder 2025). Onsets and slopes HEURISTIC, fitted to second halves of
 * recreational marathons 4–9 % slower (Deaner 2015; Smyth & Muniz-Pumares 2020).
 */
export const FADE: Record<FitnessLevel, FadeParams> = {
  beginner: { onsetKm: 8, slope: 0.0045, max: 0.35 },
  recreational: { onsetKm: 15, slope: 0.003, max: 0.3 },
  trained: { onsetKm: 25, slope: 0.002, max: 0.25 },
  elite: { onsetKm: 35, slope: 0.0012, max: 0.2 },
};

/** Softplus width around the fade onset, km of load (no kink when the fade starts). */
const FADE_ONSET_WIDTH = 3;

/**
 * Speed multiplier from load E: 1 − scale·max·(1 − exp(−slope·x/max)), x = softplus(E − onset). It starts with the
 * given slope and saturates smoothly instead of hitting a floor, so an ultra keeps slowing down hour after hour.
 */
export function fadeFactor(load: number, p: FadeParams, scale = 1): number {
  const x = softplus(load - p.onsetKm, FADE_ONSET_WIDTH);
  return 1 - scale * p.max * (1 - Math.exp((-p.slope * x) / p.max));
}

/**
 * Loss of running economy with load, share of O2 cost at saturation (Zanini 2024: +2.3 % vs +4.3 % after 90 min at
 * LT1 in faster vs slower runners; Unhjem 2024: +2.6 % vs +8.3 % relative intensity after 1 h in trained vs active
 * adults). It starts after ECONOMY_ONSET_KM of load (economy is measured from the first stage of those protocols,
 * not from a cold start) and saturates over ECONOMY_KM (HEURISTIC).
 */
export const ECONOMY_LOSS: Record<FitnessLevel, number> = { beginner: 0.09, recreational: 0.05, trained: 0.035, elite: 0.025 };
export const ECONOMY_ONSET_KM = 4;

/**
 * How fast cardiac drift builds, relative to the calibrated neutral rate, by level. Trained hearts hold their stroke
 * volume far better through a long effort: aerobic decoupling over 90 min runs at a few per cent for an elite and
 * upwards of 5 % for a beginner (Coyle & Gonzalez-Alonso 2001 on drift and stroke volume). HEURISTIC spread.
 */
export const DRIFT_BY_LEVEL: Record<FitnessLevel, number> = { beginner: 1.6, recreational: 1.15, trained: 1, elite: 0.85 };
export const ECONOMY_KM = 12;

/** Smooth max(0, x) with a transition of about `width` (softplus). */
function softplus(x: number, width: number): number {
  const z = x / width;
  return width * (z > 30 ? z : Math.log1p(Math.exp(z)));
}

/** Eccentric damage: flat O2 cost after a large descent load (Bontemps 2020: +7–10 %; Braun & Dutto 2003: +3.2 % at 48 h). */
export const DESCENT_ECONOMY: Record<FitnessLevel, number> = { beginner: 0.05, recreational: 0.04, trained: 0.03, elite: 0.02 };
/**
 * Extra slowdown on later descents at saturation (late-race speed falls more downhill than uphill: Genitrini 2022;
 * downhill cost +13 % after a mountain ultra, level unchanged: Vernillo 2015). HEURISTIC magnitudes.
 */
export const DESCENT_FADE: Record<FitnessLevel, number> = { beginner: 0.24, recreational: 0.2, trained: 0.16, elite: 0.14 };
/** Lasting slowdown on every grade at saturation, from the same damage (HEURISTIC, the speed side of DESCENT_ECONOMY). */
export const DESCENT_FLAT_FADE: Record<FitnessLevel, number> = { beginner: 0.1, recreational: 0.08, trained: 0.06, elite: 0.045 };
/** Descent load (weighted metres down) at which damage effects reach 63 % (HEURISTIC). */
export const DESCENT_LOAD_M = 2000;

/** Saturation 0…1 of descent damage. */
export function descentSaturation(load: number): number {
  return 1 - Math.exp(-load / DESCENT_LOAD_M);
}

/** Weighted descent metres per second: steeper than −8 % counts up to double; walking brakes far less (HEURISTIC). */
export function descentLoadRate(v: number, grade: number, walking: boolean): number {
  if (grade >= 0) return 0;
  const steep = 1 + Math.max(0, -grade - 0.08) / 0.08;
  return v * -grade * Math.min(2, steep) * (walking ? 0.3 : 1);
}

/** O2 cost multiplier from load and descent damage. */
export function economyFactor(load: number, descentLoad: number, fitness: FitnessLevel): number {
  const worn = 1 - Math.exp(-softplus(load - ECONOMY_ONSET_KM, 2) / ECONOMY_KM);
  return 1 + (ECONOMY_LOSS[fitness] ?? 0.08) * worn + (DESCENT_ECONOMY[fitness] ?? 0.04) * descentSaturation(descentLoad);
}

// ---------------------------------------------------------------- D′ balance (critical speed)

/**
 * Critical speed as a share of VO2 reserve (HEURISTIC mapping between the 6- and 30-minute endurance limits) and
 * D′ in flat-equivalent metres (recreational marathoners: CS 3.69 m/s, D′ 136 ± 39 m; Smyth & Muniz-Pumares 2020).
 */
export function criticalFraction(fracLT: number): number {
  return Math.min(0.95, fracLT + 0.15);
}
export const D_PRIME_M: Record<FitnessLevel, number> = { beginner: 116, recreational: 136, trained: 150, elite: 156 };
/** Running D′ reconstitution τ range, s (119–336 s from light to heavy recovery, over-ground running). */
export const D_PRIME_TAU = { min: 120, max: 340 } as const;

/**
 * One second of D′ balance (Skiba 2015 differential form): above CS it drains by the excess, below it refills
 * with τ = D′0/(CS − v), clamped to the running range.
 */
export function stepDPrime(balance: number, full: number, vEq: number, cs: number): number {
  if (vEq > cs) return Math.max(0, balance - (vEq - cs));
  const tau = clamp(full / Math.max(1e-6, cs - vEq), D_PRIME_TAU.min, D_PRIME_TAU.max);
  return balance + (full - balance) / tau;
}

/** Highest flat-equivalent speed the balance allows: CS when empty, the ≈6-minute speed CS + D′/360 when full. */
export function dPrimeCeiling(balance: number, cs: number): number {
  return cs + balance / 360;
}

// ---------------------------------------------------------------- glycogen and the wall

/** Muscle glycogen, kcal per kg of leg muscle (Rapoport 2010: 80 typical trained, up to 144 loaded; HEURISTIC by level). */
export const MUSCLE_GLYCOGEN: Record<FitnessLevel, number> = { beginner: 70, recreational: 80, trained: 100, elite: 120 };

/**
 * Starting glycogen, kcal per kg body mass (Rapoport 2010): liver 2.5 % of mass at 360 kcal/kg plus leg muscle
 * (21.4 % of mass in men, 20 % in women) at the athlete's muscle density. `spread` is a lognormal draw (CV ≈ 20 %).
 */
export function glycogenStore(fitness: FitnessLevel, female: boolean, spread: number): number {
  return 0.025 * 360 + (female ? 0.2 : 0.214) * (MUSCLE_GLYCOGEN[fitness] ?? 80) * spread;
}

/** Carbohydrate share of energy at a share i of VO2max: linear through 60 % at 75 % (HEURISTIC stand-in for Romijn 1993). */
export function carbFraction(i: number): number {
  return clamp(-0.2 + 1.07 * i, 0.1, 1);
}

/** Carbohydrate kcal/kg burnt in one second at net VO2 `vo2Net` against VO2max `vo2max` (4.9 kcal per litre O2). */
export function carbBurn(vo2Net: number, vo2max: number): number {
  const gross = Math.max(0, vo2Net) + VO2_REST;
  return ((gross * 4.9) / 60000) * carbFraction(gross / Math.max(10, vo2max));
}

/**
 * Carbohydrate taken in while running, kcal/h by level. Experienced runners drink and gel to a plan (30–45 g/h and
 * more); beginners take far less and hit the wall far more often — more than 40 % of 5 h+ marathon finishers do
 * (Smyth 2021). HEURISTIC split.
 */
export const CARB_INTAKE_KCAL_PER_HOUR: Readonly<Record<FitnessLevel, number>> = { beginner: 90, recreational: 120, trained: 150, elite: 180 };
/**
 * The wall starts once glycogen falls under this share of the starting store: performance declines well before the
 * store is empty (Rapoport 2010; Karlsson & Saltin), and field walls start at 29.5 km on average (Smyth 2021).
 */
export const WALL_THRESHOLD = 0.25;
/**
 * Only a hard effort (5-minute mean share of VO2 reserve at least this) hits the wall; slower running is mostly
 * fat-fuelled and the fuelling keeps up (walls cluster in marathons run near race effort: Smyth 2021; HEURISTIC gate).
 */
export const WALL_MIN_EFFORT = 0.72;
/**
 * Speed lost in the wall on top of the running fade. Runners who hit it run 37–40 % slower than their 5–20 km pace
 * for about 10 km (Smyth 2021); with the late-race fade this share lands there (HEURISTIC).
 */
export const WALL_SLOWDOWN = 0.25;
/** Distance over which the wall sets in, metres. */
export const WALL_RAMP_M = 1500;

/**
 * The wall is not simply a slower steady pace. The runner starts taking walk breaks — `share` of the time, in bouts of
 * about `boutS` seconds — and the pace wanders much more, so the splits go ragged instead of metronomic: `fastNoise`
 * and `slowNoise` scale up the two pace-noise amplitudes at the deepest point of the wall (HEURISTIC).
 */
export const WALL_WALK = { share: 0.2, boutS: 90, fastNoise: 0.8, slowNoise: 1.5 } as const;

// ---------------------------------------------------------------- pacing a long fade

/** The first hour of a long run is planned at most this far ahead of the average moving speed (HEURISTIC). */
export const FIRST_HOUR_LEAD = 0.06;

/**
 * Share of the fade to apply so the first hour runs at most FIRST_HOUR_LEAD ahead of the average. `rate[j]` is load
 * per metre and `speed[j]` the relative planned speed at point j (terrain only), `d` the point distances. The load
 * is estimated at the target pace, so the result does not depend on the effort scale being solved.
 */
export function fadeScaleForLead(
  d: Float64Array,
  speed: Float64Array,
  rate: Float64Array,
  n: number,
  targetTime: number,
  p: FadeParams,
): number {
  if (n < 2 || !(targetTime > 2 * 3600)) return 1;
  const leadOf = (scale: number): number => {
    let total = 0;
    let load = 0;
    const time = new Float64Array(n);
    for (let j = 1; j < n; j++) {
      const ds = d[j] - d[j - 1];
      load += rate[j] * ds;
      total += ds / (Math.max(1e-3, speed[j]) * fadeFactor(load, p, scale));
      time[j] = total;
    }
    const hour = (3600 * total) / targetTime;
    let j = 1;
    while (j < n - 1 && time[j] < hour) j++;
    return d[j] / hour / (d[n - 1] / total);
  };
  const base = leadOf(0);
  if (leadOf(1) / base <= 1 + FIRST_HOUR_LEAD) return 1;
  let lo = 0;
  let hi = 1;
  for (let it = 0; it < 24; it++) {
    const mid = 0.5 * (lo + hi);
    if (leadOf(mid) / base > 1 + FIRST_HOUR_LEAD) hi = mid;
    else lo = mid;
  }
  return lo;
}
