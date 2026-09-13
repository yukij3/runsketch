// Closed-form physiology and physics used by the engine. Background: docs/physiology.md.
import type { Acclimatisation, FitnessLevel } from '../types';

export const G = 9.81;
/** Energy equivalent of oxygen, J per ml O2 (Minetti 2002: 20.9 kJ/L). */
export const J_PER_ML_O2 = 20.9;
/** Resting oxygen uptake, ml/kg/min (1 MET). */
export const VO2_REST = 3.5;

const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);

// ---------------------------------------------------------------- grade → speed (foot)

/**
 * Partial effort compliance on hills: running speed = flat speed × F^(−β). Self-paced runners slow 23 % uphill with
 * VO2 at 100 % of the ventilatory threshold against 89 % on the level (Townshend 2010), a demand rise of ≈12 % that
 * β = 0.7 reproduces on 5–8 % climbs (β = 0.8 gave ≈7 %). Descents keep 0.8 for the typical runner (HEURISTIC).
 */
export const HILL_BETA_UP = 0.7;
export const HILL_BETA_DOWN = 0.8;
/** Walking speed on descents never exceeds this multiple of the local flat speed. */
export const DOWNHILL_CAP = 1.2;

/**
 * Descent skill by level, 0 (typical HR-calibrated curve) … 1 (record-holder envelope). Better finishers run descents
 * relatively faster (Genitrini 2022), and descending skill spreads most on steep, rough courses (Kay 2014). HEURISTIC.
 */
export const DESCENT_SKILL: Record<FitnessLevel, number> = { beginner: 0, recreational: 0.35, trained: 0.65, elite: 0.9 };

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

/**
 * Kay 2012 quartic fitted to hill-race records: speed relative to flat, fastest at m ≈ −0.103 (×1.23), back to flat
 * near −0.21. Valid for m ≥ −0.386 (inflection); held at the engine's −45 % limit beyond it.
 */
export function kayDownhill(grade: number): number {
  const m = clamp(grade, -0.45, 0);
  return 1 / (1 + m * (3.639 + m * (17.757 + m * (-3.1 + m * -23.834))));
}

/** The typical running curve: F^(−β), with the descent part capped at 1.15× flat (skill 0, no caution). */
export function typicalRunGrade(grade: number): number {
  const f = paceFactor(grade * 100);
  return grade >= 0 ? Math.pow(f, -HILL_BETA_UP) : Math.min(1.15, Math.pow(f, -HILL_BETA_DOWN));
}

/**
 * Running speed multiplier on grade g (decimal). Uphill F^(−β). Downhill the typical curve is blended toward Kay's
 * record envelope by descent skill (technical ground lowers the effective skill), capped at 1.15–1.25× flat, and
 * unskilled runners hold back further on steep ground (up to 40 % slower at −32 %; HEURISTIC caution).
 */
export function runGradeMultiplier(grade: number, skill = 0, technicality = 0): number {
  if (grade >= 0) return typicalRunGrade(grade);
  const t = clamp(technicality, 0, 1);
  const s = clamp(skill, 0, 1) * (1 - 0.7 * t);
  const typical = Math.pow(paceFactor(grade * 100), -HILL_BETA_DOWN);
  const blended = typical + (kayDownhill(grade) - typical) * s;
  const caution = 1 - 0.4 * (1 - s) ** 3 * clamp((-grade - 0.12) / 0.2, 0, 1);
  const cap = (1.15 + 0.1 * s) * (1 - 0.15 * t);
  return Math.min(cap, blended * caution);
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

/** Swiss hiking-time polynomial: minutes per km = Σ C_i·x^i, x = slope % / 10 (C_0 = 14.271 min/km is 4.2 km/h). */
const SWISS_MIN_PER_KM = [
  14.271, 3.6992, 2.5922, -1.4384, 0.32105, 0.81542, -0.090261, -0.20757, 0.010192, 0.028588, -0.00057466, -0.0021842, 0.000015176,
  0.000086894, -0.00000013584, -0.0000014026,
] as const;

/**
 * Mountain walking speed multiplier: the Swiss hiking-time formula (Schweizer Wanderwege and swisstopo, fitted to Gerhard
 * Weber's timings on more than 150 routes) relative to its 4.2 km/h on the flat, held constant beyond ±40 %. Its vertical
 * rate levels off near 370 m/h from +15 to +40 %, as the DIN 33466 (300 m/h) and SAC (400 m/h) rules assume; descents
 * peak near 655 m/h at −30 to −40 %. It tracks Tobler within ±0.07 up to +20 % and is a little slower on steep climbs.
 */
export function swissGradeMultiplier(grade: number): number {
  const x = clamp(Number.isFinite(grade) ? grade * 10 : 0, -4, 4);
  let minutes = 0;
  for (let i = SWISS_MIN_PER_KM.length - 1; i >= 0; i--) minutes = minutes * x + SWISS_MIN_PER_KM[i];
  return SWISS_MIN_PER_KM[0] / minutes;
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
 * Share of the flat speed of the same effort below which the HR-equivalent speed on a steep descent never drops.
 * Eccentric braking, footing and arousal keep HR up: at the same VO2, HR is higher running fast downhill than uphill
 * (Lemire 2021), and trail traces show steep descents only 10–25 bpm under the surrounding flats (HEURISTIC).
 */
export const DESCENT_HR_FLOOR = 0.85;

/**
 * During a run, heart rate on a walk break keeps at least this share of the O2 demand of the planned flat running
 * speed: a runner walking a steep descent or a climb stays aroused and braced, and never looks like a stroll
 * (HEURISTIC; Minetti's walking cost alone gives resting-level HR on a slow steep descent).
 */
export const WALK_BREAK_HR_FLOOR = 0.5;

/**
 * Pace factor used for heart-rate demand. Below the vertex (≈ −8 %) F rises again because braking and footing
 * slow the runner, not because the heart works harder; metabolic cost keeps falling (Minetti), so the
 * cardiac factor is held at its minimum there, and the HR-equivalent speed keeps DESCENT_HR_FLOOR of the flat speed.
 */
export function paceFactorHr(gPct: number): number {
  const f = paceFactor(Math.max(gPct, PACE_FACTOR_VERTEX));
  return gPct < PACE_FACTOR_VERTEX ? Math.max(f, DESCENT_HR_FLOOR / typicalRunGrade(gPct / 100)) : f;
}

/** Net VO2 (ml/kg/min) while running at v on grade: HR-equivalent flat speed v·F(g) at 3.6 J/kg/m. */
export function vo2NetRun(v: number, grade: number): number {
  return (costRun(0) * v * paceFactorHr(grade * 100) * 60) / J_PER_ML_O2;
}

/** Net VO2 (ml/kg/min) while walking at v on grade: Minetti Cw with the speed penalty. */
export function vo2NetWalk(v: number, grade: number): number {
  return (costWalk(grade) * walkSpeedCostFactor(v) * v * 60) / J_PER_ML_O2;
}

// ---------------------------------------------------------------- loaded walking (mountain days)

/** Backpack load multiplier on the whole net walking cost, grade included: 1 + 1.96·(L/W)^1.36, L/W ≤ 0.66 (Looney 2022). */
export function packLoadFactor(packKg: number, bodyKg: number): number {
  const ratio = packKg > 0 && bodyKg > 0 ? Math.min(0.66, packKg / bodyKg) : 0;
  return 1 + 1.96 * ratio ** 1.36;
}

/** Pair of footwear that costs nothing extra (running or trail shoes), kg. */
export const LIGHT_FOOTWEAR_KG = 0.6;

/**
 * Footwear multiplier on net walking cost for a pair of `pairKg` (crampons included): +0.4 % per 100 g above light shoes
 * at mountaineering speeds, rising to +0.8 % per 100 g from 1.4 m/s. Heavier footwear costs 0.7–0.96 % per 100 g at
 * normal walking speeds (Jones 1986; Legg & Mahanty 1986) and barely matters walking slowly in snow (Smolander 1989).
 * The speed ramp is HEURISTIC.
 */
export function footwearFactor(v: number, pairKg: number): number {
  const perGram = 0.004 + 0.004 * clamp((v - 0.6) / 0.8, 0, 1);
  return 1 + (perGram * (pairKg - LIGHT_FOOTWEAR_KG)) / 0.1;
}

/** Flat net walking power of the load-carriage (LCDA) walking term, W/kg: 0.19 + 1.78·v^0.58 + 0.27·v⁴ (Looney 2019, 2022). */
function lcdaFlatPower(v: number): number {
  return 0.19 + 1.78 * v ** 0.58 + 0.27 * v ** 4;
}
/** LCDA flat cost at 1 m/s, J/kg/m: the speed where the slow-walking surcharge ends. */
const LCDA_COST_AT_1 = 2.24;

/**
 * Slow walking costs more per metre than Minetti's cost at the optimal speed: the LCDA walking term gives 2.24 J/kg/m at
 * 1 m/s, 2.80 at 0.5 m/s (×1.25) and 3.59 at 0.3 m/s (×1.6). Multiplier on the level part of the cost below 1 m/s, 1 from
 * there (fast walking has its own penalty, walkSpeedCostFactor).
 */
export function slowWalkFactor(v: number): number {
  const w = Math.max(0.02, v);
  return w < 1 ? Math.max(1, lcdaFlatPower(w) / w / LCDA_COST_AT_1) : 1;
}

/**
 * Net VO2 (ml/kg/min) walking at v on grade with mountain gear: Minetti's Cw with the fast-walking penalty, times the
 * footwear, ground and pack factors, plus the slow-walking surcharge on the level part of the cost, times the pack.
 */
export function vo2NetLoaded(v: number, grade: number, groundCost: number, loadFactor: number, pairKg: number): number {
  const w = Math.max(0, v);
  const slow = w > 0 && w < 1 ? costWalk(0) * Math.max(0, lcdaFlatPower(Math.max(0.02, w)) / LCDA_COST_AT_1 - w) : 0;
  return ((costWalk(grade) * walkSpeedCostFactor(w) * footwearFactor(w, pairKg) * groundCost * w + slow) * loadFactor * 60) / J_PER_ML_O2;
}

/**
 * Speed along a climb (grade ≥ 0) whose vo2NetLoaded equals `vo2Net`: safeguarded Newton from `guess` inside [0, 3] m/s.
 * The cost rises with speed on any climb (its slope is at least Cw(g) − Cw(0) ≥ 0), so the root is unique.
 */
export function loadedClimbSpeed(vo2Net: number, grade: number, groundCost: number, loadFactor: number, pairKg: number, guess = 0.5): number {
  const target = (Math.max(0, vo2Net) * J_PER_ML_O2) / (60 * loadFactor);
  if (!(target > 0)) return 0;
  const a = costWalk(Math.max(0, grade)) * groundCost;
  const b = costWalk(0);
  const extraGram = (pairKg - LIGHT_FOOTWEAR_KG) / 0.1;
  let lo = 0;
  let hi = 3;
  let v = clamp(Number.isFinite(guess) ? guess : 0.5, 0.02, 2.9);
  for (let it = 0; it < 16; it++) {
    const ramp = (v - 0.6) / 0.8;
    const foot = 1 + (0.004 + 0.004 * clamp(ramp, 0, 1)) * extraGram;
    const dFoot = ramp > 0 && ramp < 1 ? (0.004 / 0.8) * extraGram : 0;
    const penalty = 1 + 0.4 * Math.max(0, v - 1.3);
    const dPenalty = v > 1.3 ? 0.4 : 0;
    const root = v ** 0.58;
    const extra = v < 1 ? (0.19 + 1.78 * root + 0.27 * v ** 4) / LCDA_COST_AT_1 - v : 0;
    const dExtra = extra > 0 ? (1.0324 * (root / v) + 1.08 * v ** 3) / LCDA_COST_AT_1 - 1 : 0;
    const f = a * penalty * foot * v + b * Math.max(0, extra) - target;
    if (Math.abs(f) <= 1e-9 * target) break;
    if (f > 0) hi = v;
    else lo = v;
    const df = a * (penalty * foot + v * (dPenalty * foot + penalty * dFoot)) + b * dExtra;
    let next = df > 0 ? v - f / df : NaN;
    if (!(next > lo && next < hi)) next = 0.5 * (lo + hi);
    if (Math.abs(next - v) < 1e-9) {
      v = next;
      break;
    }
    v = next;
  }
  return v;
}

// ---------------------------------------------------------------- altitude, 0–8849 m

/** Acclimatisation A: arrived within about two days 0, about a week 0.5, three weeks or more (or rotations) 1. */
export const ACCLIMATISATION: Readonly<Record<Acclimatisation, number>> = { none: 0, partial: 0.5, full: 1 };

/**
 * Inspired O2 partial pressure, Torr, at elevation (m): West (1996) model atmosphere PB = exp(6.63268 − 0.1112·h −
 * 0.00149·h²) with h in km (the mean of the 15° and 30° latitude models, within 1 % at many high sites), PIO2 =
 * 0.2093·(PB − 47). It gives 43 Torr on the Everest summit, the value of AMREE and Operation Everest II.
 */
export function inspiredO2(eleM: number): number {
  const h = (Number.isFinite(eleM) ? eleM : 0) / 1000;
  return 0.2093 * (Math.exp(6.63268 - 0.1112 * h - 0.00149 * h * h) - 47);
}

const SEA_LEVEL_PIO2 = inspiredO2(0);

/**
 * Altitude where VO2max starts to fall, the end of the studied linear range (m), and the loss per 1000 m; above it the
 * hypoxia curve, the acute penalty for unacclimatised athletes, where that penalty is complete (m), and the floor.
 */
const ALTITUDE = {
  onset: 300,
  linearTo: 2800,
  slope: 0.063,
  onsetWidth: 50,
  hypoxiaScale: 1.287,
  hypoxiaExponent: 1.719,
  acutePenalty: 0.12,
  acuteFull: 4500,
  floor: 0.15,
} as const;

/**
 * VO2max multiplier at elevation (m) for acclimatisation A (0…1). To 2800 m: −6.3 % per 1000 m from 300 m (Wehrlin &
 * Hallén 2006; range 4.6–7.5 % per 1000 m, already measurable between 300 and 800 m), the onset rounded over a few tens
 * of metres. Above, the loss follows the hypoxia of the inspired air, x = 1 − PIO2/PIO2(sea level): 1.287·x^1.719 meets
 * the linear part at 2800 m and passes through 0.283 at PIO2 43 Torr, the Everest summit after 40 days of chamber
 * acclimatisation (Cymerman 1989). Acclimatisation hardly restores VO2max (0.54 acute, 0.585 after 9–10 weeks at 5260 m;
 * Calbet 2003), so the unacclimatised lose up to 12 % more of the deficit, ramping in from 2800 to 4500 m (HEURISTIC
 * ramp). 0.61 (A = 1) and 0.56 (A = 0) at 5300 m, 0.36 and 0.28 at 8000 m; never below 0.15.
 */
export function altitudeFactor(eleM: number, acclimatisation = 0): number {
  const h = Number.isFinite(eleM) ? eleM : 0;
  const z = (h - ALTITUDE.onset) / ALTITUDE.onsetWidth;
  const km = (ALTITUDE.onsetWidth * (z > 30 ? z : Math.log1p(Math.exp(z)))) / 1000;
  const linear = 1 - ALTITUDE.slope * km;
  if (h <= ALTITUDE.linearTo) return linear;
  const x = Math.max(0, 1 - inspiredO2(h) / SEA_LEVEL_PIO2);
  const a = clamp(Number.isFinite(acclimatisation) ? acclimatisation : 0, 0, 1);
  const acute = 1 + ALTITUDE.acutePenalty * (1 - a) * clamp((h - ALTITUDE.linearTo) / (ALTITUDE.acuteFull - ALTITUDE.linearTo), 0, 1);
  const hypoxic = 1 - ALTITUDE.hypoxiaScale * x ** ALTITUDE.hypoxiaExponent * acute;
  return clamp(Math.min(linear, hypoxic), ALTITUDE.floor, 1);
}

/** VO2max loss HRmax ignores: unchanged below about 620 m (HEURISTIC; see hrMaxAltitudeFactor). */
const HRMAX_DEADBAND = 0.02;

/**
 * Maximal heart rate multiplier at altitude from the VO2max multiplier f: 1 − (0.20 + 0.15·A)·(1 − f − 0.02). Acute
 * hypoxia lowers HRmax about 1.7 bpm per 1000 m (Mourot 2018, 86 studies) and by 12–17 bpm at PIO2 70 Torr (Benoit
 * 2003); after weeks at 5400 m it is 155 of 186 bpm, and 142–144 bpm at 8750 m (Lundby & van Hall 2001). The first 2 % of
 * VO2max loss leaves it alone (no change up to 2286 m in recreational runners; Squires & Buskirk 1982). 0.92 acute and
 * 0.87 acclimatised at 5400 m.
 */
export function hrMaxAltitudeFactor(vo2maxFactor: number, acclimatisation = 0): number {
  const a = clamp(Number.isFinite(acclimatisation) ? acclimatisation : 0, 0, 1);
  return 1 - (0.2 + 0.15 * a) * clamp(1 - vo2maxFactor - HRMAX_DEADBAND, 0, 1);
}

/**
 * Resting heart rate multiplier at altitude: 1 + min(0.5, (0.02·u + 0.012·u²)·(1 + 0.3·(1 − A))), u = km above 1500 m.
 * Well-acclimatised climbers rested at 57, 70 and 80 bpm at sea level, 5400 and 6300 m (Karliner 1985); the acute
 * surcharge and the +50 % cap are HEURISTIC.
 */
export function restHrAltitudeFactor(eleM: number, acclimatisation = 0): number {
  const u = Math.max(0, (Number.isFinite(eleM) ? eleM : 0) / 1000 - 1.5);
  const a = clamp(Number.isFinite(acclimatisation) ? acclimatisation : 0, 0, 1);
  return 1 + Math.min(0.5, (0.02 * u + 0.012 * u * u) * (1 + 0.3 * (1 - a)));
}

/**
 * Strength of the altitude endurance loss, and the share of it full acclimatisation restores (see altitudeEndurance;
 * HEURISTIC, calibrated on guided summit days).
 */
export const ALTITUDE_ENDURANCE = { loss: 0.5, restored: 0.3 } as const;

/**
 * Share of a sustainable effort (as a fraction of the altitude-reduced VO2 reserve) that can still be held for hours at
 * altitude: 1 − loss·(1 − restored·A)·(1 − f). Time to exhaustion at the same relative intensity falls 14.5 % per
 * 1000 m, twice the VO2max loss (Wehrlin & Hallén 2006), and climbing speed falls faster than VO2max (−24 % VO2max,
 * −41 % speed; Matthews 2020). Submaximal performance improves with acclimatisation although VO2max does not (Fulco,
 * Rock & Cymerman 1998). HEURISTIC form.
 */
export function altitudeEndurance(vo2maxFactor: number, acclimatisation = 0): number {
  const a = clamp(Number.isFinite(acclimatisation) ? acclimatisation : 0, 0, 1);
  return 1 - ALTITUDE_ENDURANCE.loss * (1 - ALTITUDE_ENDURANCE.restored * a) * clamp(1 - vo2maxFactor, 0, 1);
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

// ---------------------------------------------------------------- walk–run transition and vertical speed

/** Walk–run transition anchors on climbs: [incline in degrees, speed along the slope m/s]. */
const TRANSITION: ReadonlyArray<readonly [deg: number, speed: number]> = [
  [3, 2.0],
  [9.4, 1.9],
  [15.8, 1.3],
  [30, 0.75],
];
/** Below this grade climbs never trigger walking (the transition ramps up from 0 here to the 3° anchor). */
const TRANSITION_MIN_GRADE = 0.03;

/**
 * Speed along the slope below which walking a climb is at least as economical as running (decimal grade). Anchors:
 * the classic ≈2.0 m/s level transition (3° anchor), running still competitive at 9.4° and 2.14 m/s, walking cheaper
 * at 15.8° and 1.29 m/s (Giovanelli 2016), equal cost at 30° and 0.8 m/s, walking cheaper below 0.7 m/s (Ortiz 2017).
 * The transition falls with incline (Brill & Kram 2021).
 */
export function transitionSpeed(grade: number): number {
  if (grade <= TRANSITION_MIN_GRADE) return 0;
  const deg = (Math.atan(grade) * 180) / Math.PI;
  const [d0, v0] = TRANSITION[0];
  if (deg <= d0) {
    const g0 = Math.tan((d0 * Math.PI) / 180);
    return (v0 * (grade - TRANSITION_MIN_GRADE)) / (g0 - TRANSITION_MIN_GRADE);
  }
  for (let j = 1; j < TRANSITION.length; j++) {
    const [d1, v1] = TRANSITION[j];
    const [da, va] = TRANSITION[j - 1];
    if (deg <= d1) return va + ((v1 - va) * (deg - da)) / (d1 - da);
  }
  return TRANSITION[TRANSITION.length - 1][1];
}

/**
 * Runners switch to walking below the equal-cost speed (spontaneous transitions 0.5–0.9 km/h under it; Minetti 1994),
 * elites closer to it (Brill & Kram 2021). m/s subtracted from transitionSpeed, HEURISTIC by level.
 */
export const TRANSITION_OFFSET: Record<FitnessLevel, number> = { beginner: 0.15, recreational: 0.15, trained: 0.1, elite: 0.05 };

/**
 * Descents steeper than this band are walked, decimal grades; skilled descenders keep running steeper ground, the band
 * moving `skill` steeper at descent skill 1 (HEURISTIC; running on −40 % scree is a shuffle for most, while hill-race
 * records descend 1.47 m/s vertically on −36 %, Kay 2012).
 */
export const DESCENT_WALK_GRADE = { from: 0.25, to: 0.3, skill: 0.15 } as const;
/** Descents are walked when the running speed they allow falls under this, m/s (HEURISTIC). */
export const DESCENT_WALK_RUN_SPEED = 1.4;
/** Brisk walking speed on the flat that steep descents scale down with Tobler's function, m/s (HEURISTIC). */
export const DESCENT_WALK_SPEED = 1.8;
/** Walked descents are faster with descent skill s: DESCENT_WALK_SPEED·(1 + DESCENT_WALK_SKILL·s) (HEURISTIC). */
export const DESCENT_WALK_SKILL = 0.8;
/**
 * Fastest planned walking speed, m/s: beyond ≈8 km/h people run, and the walking cost model has no data (Ralston 1958
 * covers up to ≈2 m/s). A walking target that needs more is reported as not met.
 */
export const WALK_MAX_SPEED = 2.3;
/** Highest net VO2 a walking plan may ask for, share of VO2 reserve (a few minutes at VO2max; HEURISTIC). */
export const WALK_VO2_CEILING = 1;

/**
 * Highest sustained vertical speed on climbs, m/h, for an athlete at the table VO2max of the level. Elite: the VK
 * record is ≈2080–2190 m/h (Fully, > 50 %), and the fastest ascent in hill-race records 2045 m/h (Kay 2012); treadmill
 * VK studies use 1260 m/h for trained runners (Giovanelli 2016). Other levels HEURISTIC.
 */
export const VAM_BY_FITNESS: Record<FitnessLevel, number> = { beginner: 800, recreational: 1100, trained: 1500, elite: 1950 };

/** Speed along a climb (decimal grade) that gains `vam` metres per hour; no limit under 2 %. */
export function vamSpeedLimit(vam: number, grade: number): number {
  if (!(vam > 0) || grade <= 0.02) return Infinity;
  return ((vam / 3600) * Math.sqrt(1 + grade * grade)) / grade;
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

/** Air the rider moves through: density (kg/m³) and wind along the direction of travel at body height (m/s, + from ahead). */
export interface AirFlow {
  rho: number;
  head: number;
}

/**
 * Sum of resisting forces (N) at ground speed v on grade (rise/run). `dragScale` multiplies the aerodynamic term
 * (position changes, gusts), `rollingScale` the rolling resistance (surface; see ground.ts). Without `air` the air is
 * still at the density in `p`; with it, drag acts on the air speed v + head (Martin et al. 1998), so a tailwind faster
 * than the rider pushes.
 */
export function bikeResistance(p: BikePhysics, v: number, grade: number, dragScale = 1, rollingScale = 1, air: AirFlow | null = null): number {
  const inv = 1 / Math.sqrt(1 + grade * grade);
  const va = air ? v + air.head : v;
  const aero = air
    ? 0.5 * air.rho * (CYCLING.cda + CYCLING.spokeDragArea) * dragScale * va * Math.abs(va)
    : 0.5 * p.rho * (CYCLING.cda + CYCLING.spokeDragArea) * dragScale * v * v;
  const moving = v > 0.01 ? CYCLING.crr * rollingScale * p.massT * G * inv + (91 + 8.7 * v) * 1e-3 : 0;
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

/**
 * Running cadence, steps/min. Speed term: treadmill fit (147.6 + 7.9·v). Grade terms at the same speed: +0.25 % per %
 * uphill up to 12 % and +0.1 % per % beyond, −0.1 % per % downhill. At a fixed speed step frequency rises ≈4.5 % on 7 %
 * (Padulo 2013) and falls only 0.6–1.8 % on −13 % (lab data), but self-paced runners slow down on climbs, so field
 * cadence drops uphill and is unchanged downhill (Garmin data from 148 runners; Chan 2025). The smaller uphill term
 * lets the speed term carry that. Steep descents (below −15 %) keep short quick steps at or above the flat cadence of
 * the same effort (HEURISTIC). Taller runners take fewer steps (−120 spm per metre over 1.75 m).
 */
export function runCadence(v: number, gPct: number, heightM: number): number {
  const stature = 120 * (heightM - 1.75);
  const up = gPct > 0 ? 0.0025 * Math.min(gPct, 12) + 0.001 * Math.max(0, gPct - 12) : 0;
  const down = gPct < 0 ? 0.001 * -gPct : 0;
  let spm = (147.6 + 7.9 * v) * (1 + up - down) - stature;
  if (gPct < -15) {
    const flatEquivalent = v / Math.max(0.3, typicalRunGrade(gPct / 100));
    const floor = (147.6 + 7.9 * flatEquivalent - stature) * (1 + 0.003 * (-gPct - 15));
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

