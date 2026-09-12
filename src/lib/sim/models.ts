// Closed-form physiology and physics used by the engine. Background: docs/physiology.md.
import type { FitnessLevel } from '../types';

export const G = 9.81;
/** Energy equivalent of oxygen, J per ml O2 (Minetti 2002: 20.9 kJ/L). */
export const J_PER_ML_O2 = 20.9;
/** Resting oxygen uptake, ml/kg/min (1 MET). */
export const VO2_REST = 3.5;

const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);

// ---------------------------------------------------------------- grade → speed (foot)

/** Partial effort compliance on hills (heuristic 0.8). */
export const HILL_BETA = 0.8;
/** Foot speed on descents never exceeds this multiple of the local flat speed. */
export const DOWNHILL_CAP = 1.2;

/**
 * HR-calibrated pace factor (ultraPacer / Strava-2017 shape): actual pace = flat pace × F.
 * g in percent. Quadratic on [−22, 16], continued linearly with the edge slope outside.
 */
export function paceFactor(gPct: number): number {
  const lo = -22;
  const hi = 16;
  let f: number;
  if (gPct < lo) f = 0.0021 * lo * lo + 0.034 * lo + 1 + (2 * 0.0021 * lo + 0.034) * (gPct - lo);
  else if (gPct > hi) f = 0.0021 * hi * hi + 0.034 * hi + 1 + (2 * 0.0021 * hi + 0.034) * (gPct - hi);
  else f = 0.0021 * gPct * gPct + 0.034 * gPct + 1;
  return f < 0.3 ? 0.3 : f;
}

/** Running speed multiplier on grade g (decimal): F^(−β), capped at DOWNHILL_CAP. */
export function runGradeMultiplier(grade: number): number {
  return Math.min(DOWNHILL_CAP, Math.pow(paceFactor(grade * 100), -HILL_BETA));
}

/** Tobler (1993) hiking-function shape normalised to 1 on the flat: exp(−3.5·(|S+0.05| − 0.05)). */
export function toblerShape(grade: number): number {
  return Math.exp(-3.5 * (Math.abs(grade + 0.05) - 0.05));
}

/**
 * Walking/hiking speed multiplier: the plain Tobler shape. Tobler is already an observed speed curve, so no
 * extra compliance exponent (β = 0.8 would make +30 % climbs 25 % faster than Tobler and Naismith).
 */
export function walkGradeMultiplier(grade: number): number {
  return Math.min(DOWNHILL_CAP, toblerShape(grade));
}

// ---------------------------------------------------------------- metabolic cost (Minetti 2002, VERIFIED)

/** Net energy cost of running, J·kg⁻¹·m⁻¹, grade as decimal (valid ±0.45). */
export function costRun(grade: number): number {
  const i = clamp(grade, -0.45, 0.45);
  const c = ((((155.4 * i - 30.4) * i - 43.3) * i + 46.3) * i + 19.5) * i + 3.6;
  return c < 0.5 ? 0.5 : c;
}

/** Net energy cost of walking at optimal speed, J·kg⁻¹·m⁻¹ (valid ±0.45). */
export function costWalk(grade: number): number {
  const i = clamp(grade, -0.45, 0.45);
  const c = ((((280.5 * i - 58.7) * i - 76.8) * i + 51.9) * i + 19.6) * i + 2.5;
  return c < 0.4 ? 0.4 : c;
}

/**
 * Walking cost rises above ≈1.3 m/s (U-shaped cost-per-metre curve; slope approximated from the
 * Ralston 1958 speed–energy relation — HEURISTIC fit: ×1.2 at 1.8 m/s, ×1.28 at 2.0 m/s).
 */
export function walkSpeedCostFactor(v: number): number {
  return 1 + 0.4 * Math.max(0, v - 1.3);
}

/** Vertex of the pace-factor parabola: the grade (percent) where downhill running is easiest. */
export const PACE_FACTOR_VERTEX = -0.034 / (2 * 0.0021);

/**
 * Pace factor used for heart-rate demand. Below the vertex (≈ −8 %) F rises again because braking and footing
 * slow the runner, not because the heart works harder; metabolic cost keeps falling (Minetti), so the
 * cardiac factor is held at its minimum there. Eccentric braking keeps HR up on very steep descents, so the
 * HR-equivalent speed never drops under 60 % of the flat speed of the same effort (HEURISTIC floor).
 */
export function paceFactorHr(gPct: number): number {
  const f = paceFactor(Math.max(gPct, PACE_FACTOR_VERTEX));
  return gPct < PACE_FACTOR_VERTEX ? Math.max(f, 0.6 / runGradeMultiplier(gPct / 100)) : f;
}

/** Net VO2 (ml/kg/min) while running at v on grade: HR-equivalent flat speed v·F(g) at 3.6 J/kg/m. */
export function vo2NetRun(v: number, grade: number): number {
  return (costRun(0) * v * paceFactorHr(grade * 100) * 60) / J_PER_ML_O2;
}

/** Net VO2 (ml/kg/min) while walking at v on grade: Minetti Cw with the speed penalty. */
export function vo2NetWalk(v: number, grade: number): number {
  return (costWalk(grade) * walkSpeedCostFactor(v) * v * 60) / J_PER_ML_O2;
}

/** Gross mechanical efficiency used to turn crank power into oxygen demand (≈21 %). */
export const CYCLING_GROSS_EFFICIENCY = 0.21;

/**
 * Net VO2 (ml/kg/min) for crank power P and body mass. Gross efficiency includes resting metabolism, so the
 * gross VO2 minus 1 MET is the net demand compared against the VO2 reserve.
 */
export function vo2NetRide(powerW: number, bodyKg: number): number {
  return Math.max(0, (Math.max(0, powerW) * 60) / (CYCLING_GROSS_EFFICIENCY * J_PER_ML_O2 * bodyKg) - VO2_REST);
}

/**
 * Fraction of VO2 reserve a rider still spends while coasting (bracing, isometric upper-body and core work,
 * cold air, arousal; HEURISTIC). Rises with speed: ≈12 % slow, ≈24 % at 58 km/h.
 */
export function coastDemandFraction(v: number): number {
  return 0.12 + 0.12 * clamp(v / 16, 0, 1);
}

/**
 * Walking speed that costs the same metabolic power as running at vRun on this grade (power-hike switch).
 * Solves Cw(g)·w·(1 + 0.4·max(0, w − 1.3)) = min(Cr(0)·vRun·F(g), cap) in closed form, where the optional cap
 * is the highest net VO2 (ml/kg/min) the athlete may spend power-hiking, so steep climbs stay sustainable.
 */
export function powerHikeSpeed(vRun: number, grade: number, maxVo2Net = Infinity): number {
  const power = Math.min(costRun(0) * vRun * paceFactor(grade * 100), (maxVo2Net * J_PER_ML_O2) / 60);
  const x = power / costWalk(grade);
  const w = x <= 1.3 ? x : (-0.48 + Math.sqrt(0.2304 + 1.6 * x)) / 0.8;
  return clamp(w, 0.4, 1.9);
}

// ---------------------------------------------------------------- running power (heuristic)

/** Running-effectiveness 0.98 estimate, scaled by the Minetti cost ratio (γ = 1 up, 0.5 down). */
export function runningPower(massKg: number, v: number, grade: number): number {
  const ratio = costRun(grade) / costRun(0);
  return ((massKg * v) / 0.98) * Math.pow(ratio, grade > 0 ? 1 : 0.5);
}

// ---------------------------------------------------------------- cycling (Martin et al. 1998, VERIFIED constants)

export const CYCLING = {
  chainEfficiency: 0.977,
  spokeDragArea: 0.0044,
  wheelInertia: 0.14,
  wheelRadius: 0.311,
  cda: 0.32,
  crr: 0.004,
  bikeKg: 9,
} as const;

/** Air density from altitude (ISA troposphere pressure) and air temperature, kg/m³. */
export function airDensity(elevationM: number, temperatureC: number): number {
  const h = clamp(Number.isFinite(elevationM) ? elevationM : 0, -400, 8000);
  const t = clamp(Number.isFinite(temperatureC) ? temperatureC : 15, -40, 50);
  const pressure = 101325 * Math.pow(1 - 2.25577e-5 * h, 5.25588);
  return pressure / (287.05 * (t + 273.15));
}

export interface BikePhysics {
  /** Rider + bike, kg. */
  massT: number;
  /** massT + I/r², kg. */
  massEff: number;
  rho: number;
}

export function bikePhysics(riderKg: number, elevationM: number, temperatureC: number): BikePhysics {
  const massT = riderKg + CYCLING.bikeKg;
  return {
    massT,
    massEff: massT + CYCLING.wheelInertia / (CYCLING.wheelRadius * CYCLING.wheelRadius),
    rho: airDensity(elevationM, temperatureC),
  };
}

/**
 * Sum of resisting forces (N) at ground speed v on grade (rise/run), still air. `dragScale` multiplies the
 * aerodynamic term (position changes, gusts).
 */
export function bikeResistance(p: BikePhysics, v: number, grade: number, dragScale = 1): number {
  const inv = 1 / Math.sqrt(1 + grade * grade);
  const aero = 0.5 * p.rho * (CYCLING.cda + CYCLING.spokeDragArea) * dragScale * v * v;
  const moving = v > 0.01 ? CYCLING.crr * p.massT * G * inv + (91 + 8.7 * v) * 1e-3 : 0;
  return aero + moving + p.massT * G * grade * inv;
}

/** Crank power (W) needed to hold v on grade. */
export function bikeSteadyPower(p: BikePhysics, v: number, grade: number): number {
  return Math.max(0, (v * bikeResistance(p, v, grade)) / CYCLING.chainEfficiency);
}

/** Rider power plan on grade: P_flat·clamp(1 + 0.03·g%, 0, 1.35) (heuristic). */
export function ridePowerGradeFactor(grade: number): number {
  return clamp(1 + 3 * grade, 0, 1.35);
}

// ---------------------------------------------------------------- cadence

export function runCadence(v: number, gPct: number, heightM: number): number {
  const stature = 120 * (heightM - 1.75);
  let spm = (147.6 + 7.9 * v) * (1 + 0.0062 * Math.max(gPct, 0) - 0.0025 * Math.max(-gPct, 0)) - stature;
  if (gPct < -12) {
    // Steep technical descents: short quick steps at or above the flat cadence of the same effort (HEURISTIC).
    const flatEquivalent = v / Math.max(0.3, runGradeMultiplier(gPct / 100));
    const floor = (147.6 + 7.9 * flatEquivalent - stature) * (1 + 0.003 * (-gPct - 12));
    spm = Math.max(spm, floor);
  }
  return clamp(spm, 140, 205);
}

export function walkCadence(v: number, gPct: number): number {
  return clamp((64.3 + 36.5 * v) * (1 - 0.004 * Math.max(gPct, 0)), 80, 135);
}

export function rideCadence(gPct: number, fitness: FitnessLevel): number {
  const base = clamp(90 - 2.4 * Math.max(gPct, 0), 62, 100);
  return fitness === 'beginner' || fitness === 'recreational' ? base - 5 : base;
}

// ---------------------------------------------------------------- heart rate helpers

/** Smooth saturation near HRmax (HR deflection): identity below knee, asymptote at cap. */
export function softCap(x: number, cap: number, knee: number): number {
  if (x <= knee) return x;
  const span = cap - knee;
  if (span <= 0) return Math.min(x, cap);
  return knee + span * (1 - Math.exp(-(x - knee) / span));
}

/** Cardiac drift rate, fraction of HR per hour: 0.03·exp(0.09·(T − 15)) (heuristic). */
export function driftRatePerHour(temperatureC: number): number {
  const t = clamp(Number.isFinite(temperatureC) ? temperatureC : 15, -30, 45);
  return 0.03 * Math.exp(0.09 * (t - 15));
}
