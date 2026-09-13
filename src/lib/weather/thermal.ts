// The athlete's heat balance, second by second. Core, mean skin and working-muscle temperatures follow a two-node core
// and skin model (Gagge, Fobelets & Berglund 1986) with a muscle node; dry heat leaves through clothing whose insulation
// wind, walking and wetting reduce (ISO 9920; Havenith & Nilsson 2004); sweat evaporates as in the predicted heat strain
// model (ISO 7933; Malchaire et al. 2001); rain and snow wet the clothing, which dries again; cold skin and core make
// people shiver (Tikuisis & Giesbrecht 1999). The kinematics step it once in the weather and once in neutral weather,
// so heart rate and pace respond only to what the weather changes. Constants marked HEURISTIC are fitted to the anchors
// in the tests.
import type { ActivityType, FitnessLevel } from '../types';
import { BODY_WIND_FACTOR, vapourPressureHpa } from './physics';

const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);
/** 0 at `from`, 1 at `to` (either order), smooth in between. */
const ramp = (from: number, to: number, x: number): number => {
  const t = clamp((x - from) / (to - from), 0, 1);
  return t * t * (3 - 2 * t);
};

/** Body heat capacity J/(kg·K), latent heat of sweat J/kg, energy per ml O2 J (Minetti 2002: 20.9 kJ/L), water J/(kg·K). */
const SPECIFIC_HEAT = 3490;
const LATENT_J_PER_KG = 2.43e6;
const J_PER_ML_O2 = 20.9;
const WATER_HEAT = 4186;
/** Lewis relation, K/kPa. */
const LEWIS = 16.7;
/** Static insulation of the air layer around a standing person, m²·K/W (0.7 clo; ISO 9920). */
const AIR_LAYER = 0.111;
/** Resting oxygen uptake, ml/kg/min. */
const VO2_REST = 3.5;

const satKpa = (tC: number): number => vapourPressureHpa(tC) / 10;

/**
 * Model constants.
 * - Start: core 37 °C, skin 33 °C, working muscle 35.5 °C.
 * - Sweating (ISO 7933:2023): at most 400 W/m² unacclimatised, skin wettedness at most 0.85, response τ 10 min. It ramps
 *   up from `sweatOnset` °C below the core temperature the body regulates to at the current metabolic rate M (W/m²,
 *   averaged over τ 10 min), 36.8 + `setPointSlope`·(M − 55) °C, across `sweatRamp` °C. ISO 7933 uses a slope of 0.0036;
 *   half of it puts a temperate marathon at 38.5 °C (HEURISTIC gate and slope).
 * - Clothing: static moisture permeability 0.38, a shell 0.2; ISO 9920 corrections of total insulation, of the air layer
 *   and of evaporative resistance for relative air speed and walking, valid to 3.5 m/s and 1.2 m/s (held there beyond).
 *   A windproof shell keeps `shellWind` of the wind's effect on insulation: at 5 m/s and 1.2 m/s of walking, ISO 11079's
 *   air-permeability form gives 27 % more insulation at 8 L/m²/s than at 200, and halving the ISO 9920 wind term gives
 *   25 %. Soaked clothing loses `wetInsulationLoss` of its own insulation (a wet mid layer −16 % walking, Bröde et al.
 *   2008; casualty coverings −22…−29 %, Jussila et al. 2014) and holds `waterPerClo` kg/m² per clo; wet layers block
 *   `wetVapourBlock` of evaporation from the skin (HEURISTIC).
 * - Rain: a walker catches `rainCatch` of the rain falling on the ground, from still air to 5 m/s (the body's projected
 *   area grows with driving rain); a shell lets `shellRainPass` through; snow wets at `snowWetting` of rain; intercepted
 *   water warms toward clothing temperature with `rainBodyShare` of that heat from the body; water evaporating from wet
 *   clothing draws `wetEvaporationBodyShare` of its heat from the body; `sweatToClothing` of unevaporated sweat soaks in
 *   (HEURISTIC).
 * - Muscle: relaxes with τ `muscleTau` toward core − share·(core − skin), share `muscleSkinShare` from rest to a metabolic
 *   rate of `activeMetabolic` W/m² (HEURISTIC).
 * - Shivering follows the temperatures alone, minus `shiverSuppression` W/m² per W/m² of exercise metabolism: exercise
 *   shifts the onset only slightly (36.2 vs 36.5 °C core during light cycling; Fujimoto et al. 2019), and walkers in cold
 *   rain still raised heat production 40 % (Thompson & Hayward 1996).
 * - `workToSkinShare` of the heat from working muscle and from shivering is released in the shell rather than the core:
 *   both happen largely in muscle that the skin sits on, and shivering is strongest in superficial muscle. A two-node
 *   model that puts every watt in the core holds core temperature up and runs mean skin several degrees too cold in
 *   wind and rain, which is the classic weakness of the form (HEURISTIC share).
 */
export const THERMAL = {
  coreStart: 37,
  skinStart: 33,
  muscleStart: 35.5,
  sweatMax: 400,
  wettednessMax: 0.85,
  sweatTau: 600,
  sweatOnset: 0.1,
  sweatRamp: 0.4,
  setPointSlope: 0.0018,
  setPointTau: 600,
  permeability: 0.38,
  shellPermeability: 0.2,
  radiative: 4.7,
  airLimit: 3.5,
  walkLimit: 1.2,
  shellWind: 0.5,
  wetInsulationLoss: 0.25,
  waterPerClo: 0.3,
  wetVapourBlock: 0.5,
  rainCatch: [0.15, 0.35],
  shellRainPass: 0.15,
  snowWetting: 0.3,
  rainBodyShare: 0.5,
  wetEvaporationBodyShare: 0.5,
  sweatToClothing: 1,
  muscleTau: 600,
  muscleSkinShare: [0.45, 0.15],
  activeMetabolic: 300,
  shiverSuppression: 0.05,
  workToSkinShare: 0.15,
} as const;

/**
 * Heart rate per unit of heat strain against neutral weather: +8 % per °C of core temperature (stroke volume falls 7–8 %
 * per °C; González-Alonso et al. 1997) and +7.5 % per % of body mass lost (González-Alonso et al. 2000 measured ≈3 %,
 * and 5–8 bpm per % is the usual report; raised here because it is the one term that parts a warm day from a cool one
 * — HEURISTIC). This is the whole heat→HR term; a later HR budget pass tunes it here.
 */
export const HR_HEAT = { perCoreDegree: 0.08, perPercentLoss: 0.09 } as const;

/** Neutral weather heart-rate drift and pacing are calibrated for: 15 °C, 60 % humidity, calm, dry and overcast. */
export const NEUTRAL_AIR = { temperatureC: 15, humidityPct: 60 } as const;

/**
 * Thermal state → self-paced speed on foot, or power on a ride, relative to the same motion in neutral weather.
 * - Heat, anticipatory: people ease off with warm skin long before core temperature differs. In a clamped-effort ride at
 *   35 °C power fell 2.35 W/min against 1.61 in the cold with the same starting power and the same core temperature for
 *   22 min (Tucker et al. 2006); a 15-minute time trial lost 17 % of its work with skin 5 °C warmer and core temperature
 *   equal (Ely et al. 2010); outdoor and laboratory time trials in the heat lose 13–16 % of power (Périard et al. 2011;
 *   Racinais et al. 2015; Junge et al. 2016 put the mean at 15 %). Runners lose far less: marathon speed falls 0.3–0.4 %
 *   per °C of WBGT above the optimum (Mantzios et al. 2022) and the fastest men 1.7 → 4.5 % across WBGT 5–25 °C
 *   (Ely et al. 2007). So power falls `ridePerDegree` and foot speed `footPerDegree` per °C that skin is warmer than in
 *   neutral weather, beyond `skinFrom` °C, at most `maxAnticipation` (HEURISTIC slopes on those anchors).
 * - Heat, fluid deficit: `lossPerPercent` slower per % of body mass lost beyond `lossFrom` % more than the same motion
 *   in neutral weather, at most `maxDehydration`. Losing 2 % of body mass costs a few per cent of endurance performance,
 *   and more in the heat (Sawka et al. 2007; Casa et al. 2010). On a warm day this, not core temperature, is what
 *   separates the hours: during exercise skin blood flow already sits at its ceiling and core temperature holds until the
 *   evaporative limit is near, while sweat losses go on accumulating.
 * - Heat, critical core temperature: up to `coreLoss` slower from `coreFrom` to `coreTo` °C (fixed-intensity exercise ends
 *   at 40.1–40.2 °C; González-Alonso et al. 1999; in a race core temperature did not itself predict who stopped, so the
 *   term is small: Racinais et al. 2022), shifted by fitness (Cheung & McLellan 1998).
 * - Cold muscle: `musclePerDegree` slower per °C that working muscle is colder than in neutral weather beyond
 *   `muscleFrom` °C. Maximal power and efficiency fall about 3 % per °C of muscle temperature (Schafer et al. 2024;
 *   4–6 % for dynamic maximal work, Bergh & Ekblom 1979; 2–5 % in Racinais & Oksa 2010).
 * - Cold core: up to `coreColdLoss` slower as core temperature falls from `coreColdFrom` to `coreColdTo` °C (walkers in
 *   cold rain slowed, could not hold the pace and cooled further; Thompson & Hayward 1996; Pugh 1966; HEURISTIC).
 */
export const THERMAL_PACE = {
  footPerDegree: 0.009,
  ridePerDegree: 0.05,
  skinFrom: 0.3,
  maxAnticipation: 0.15,
  coreFrom: 39.3,
  coreTo: 40.5,
  coreLoss: 0.12,
  musclePerDegree: 0.03,
  muscleFrom: 0.8,
  lossPerPercent: 0.03,
  lossFrom: 0.2,
  maxDehydration: 0.25,
  coreColdFrom: 36,
  coreColdTo: 34.5,
  coreColdLoss: 0.35,
  floor: 0.4,
} as const;

/** Core temperature tolerance shift by fitness, °C (HEURISTIC steps). */
export const HEAT_TOLERANCE: Readonly<Record<FitnessLevel, number>> = { beginner: -0.2, recreational: 0, trained: 0.2, elite: 0.3 };

/** Share of sweat replaced by drinking during the activity (HEURISTIC). */
export function drinkShare(sport: ActivityType): number {
  return sport === 'run' ? 0.3 : sport === 'ride' || sport === 'alpine' ? 0.5 : 0.6;
}

/** DuBois body surface area, m². */
export function bodySurfaceArea(massKg: number, heightCm: number): number {
  return 0.202 * Math.pow(massKg, 0.425) * Math.pow(heightCm / 100, 0.725);
}

export interface BodyBuild {
  weightKg: number;
  heightCm: number;
  age: number;
  sex: 'male' | 'female';
}

/** Body fat from BMI, age and sex, % (Deurenberg, Weststrate & Seidell 1991), within 5–50 %. */
export function bodyFatPct(a: BodyBuild): number {
  const bmi = a.weightKg / (a.heightCm / 100) ** 2;
  return clamp(1.2 * bmi + 0.23 * a.age - 10.8 * (a.sex === 'male' ? 1 : 0) - 5.4, 5, 50);
}

/** Highest shivering heat production, W/m²: peak shivering VO2 30.5 + 0.348·VO2max − 0.909·BMI − 0.233·age ml/kg/min (Eyolfson et al. 2001). */
export function shiverCapacity(a: BodyBuild, vo2max: number): number {
  const bmi = a.weightKg / (a.heightCm / 100) ** 2;
  const peak = Math.max(VO2_REST + 1, 30.5 + 0.348 * vo2max - 0.909 * bmi - 0.233 * a.age);
  return ((peak - VO2_REST) * a.weightKg * J_PER_ML_O2) / 60 / bodySurfaceArea(a.weightKg, a.heightCm);
}

export interface Clothing {
  /** Intrinsic insulation, clo. */
  clo: number;
  /** A windproof, waterproof outer layer. */
  shell: boolean;
}

/**
 * Clothing steps by activity, clo: running from shorts and shirt to tights and a warm top, riding with more for the
 * airflow, walking and hiking up to a full winter outfit, and mountaineering from a climbing layer system to a down
 * suit, so an equipped climber starts dressed for the mountain (HEURISTIC).
 */
export const WARDROBE: Readonly<Record<ActivityType, readonly number[]>> = {
  run: [0.3, 0.45, 0.65, 0.9, 1.2],
  ride: [0.4, 0.6, 0.9, 1.2, 1.6],
  walk: [0.5, 0.8, 1.1, 1.5, 2, 2.5],
  hike: [0.5, 0.8, 1.1, 1.5, 2, 2.5],
  alpine: [1.2, 1.6, 2, 2.5, 3, 3.5],
};

/** ISO 9920 resultant correction of total insulation for relative air speed and walking; a shell keeps part of the wind effect. */
function totalInsulationCorrection(air: number, walk: number, shell: boolean): number {
  const v = Math.min(THERMAL.airLimit, Math.max(0.15, air)) - 0.15;
  const w = Math.min(THERMAL.walkLimit, Math.max(0, walk));
  return Math.exp((shell ? THERMAL.shellWind : 1) * (-0.281 * v + 0.044 * v * v) - 0.492 * w + 0.176 * w * w);
}

/** ISO 9920 resultant correction of evaporative resistance. */
function evaporativeCorrection(air: number, walk: number): number {
  const v = Math.min(THERMAL.airLimit, Math.max(0.15, air)) - 0.15;
  const w = Math.min(THERMAL.walkLimit, Math.max(0, walk));
  return Math.exp(-0.468 * v + 0.08 * v * v - 0.874 * w + 0.358 * w * w);
}

/** ISO 9920 resultant correction of the air layer. */
function airLayerCorrection(air: number, walk: number): number {
  const v = Math.min(THERMAL.airLimit, Math.max(0.15, air)) - 0.15;
  const w = Math.min(THERMAL.walkLimit, Math.max(0, walk));
  return Math.exp(-0.533 * v + 0.069 * v * v - 0.462 * w + 0.201 * w * w);
}

/** Resultant total insulation of dry clothing and air layer, m²·K/W, at relative air speed `air` and walking speed `walk`. */
export function resultantInsulation(c: Clothing, air: number, walk: number): number {
  const fcl = 1 + 0.28 * c.clo;
  return (0.155 * c.clo + AIR_LAYER / fcl) * totalInsulationCorrection(air, walk, c.shell);
}

/**
 * Clothing chosen once from the start: the lightest step whose resultant insulation keeps the skin at the comfortable
 * temperature for the planned metabolic rate (35.7 − 0.0285·M °C, at least 27 °C; ISO 11079) while dry heat loss
 * matches the heat left after respiration and a minimum of sweating (the IREQ idea). A shell goes on for a wet day,
 * always on a mountain day, and for walks in cold wind (HEURISTIC).
 */
export function chooseClothing(sport: ActivityType, metabolicWm2: number, airC: number, wind10: number, speed: number, wetDay: boolean): Clothing {
  const steps = WARDROBE[sport] ?? WARDROBE.walk;
  const foot = sport !== 'ride';
  const shell = sport === 'alpine' || (wetDay && (sport !== 'run' || airC < 12)) || (foot && sport !== 'run' && airC < 5 && wind10 > 6);
  const M = Math.max(60, metabolicWm2);
  const skin = Math.max(27, 35.7 - 0.0285 * M);
  const pa = satKpa(Math.min(airC, airC - 2));
  const respiration = 0.0014 * M * (34 - airC) + 0.0173 * M * (5.87 - pa);
  const available = Math.max(15, M - respiration - 0.06 * M);
  const air = Math.max(0, speed) + BODY_WIND_FACTOR * Math.max(0, wind10);
  for (const clo of steps) {
    if ((skin - airC) / resultantInsulation({ clo, shell }, air, foot ? speed : 0) <= available) return { clo, shell };
  }
  return { clo: steps[steps.length - 1], shell };
}

export interface ThermalBody extends BodyBuild {
  /** Body fat, % (shivering scales with 1/√BF). */
  bodyFatPct: number;
  sport: ActivityType;
  clothing: Clothing;
  /** Share of sweat replaced by drinking. */
  drink: number;
  /** Highest shivering heat production, W/m². */
  shiverMax: number;
}

/** One second of what the body meets. */
export interface BodyInput {
  /** Net O2 uptake of the motion, ml/kg/min. */
  vo2Net: number;
  /** External mechanical power, W (crank power, or lifting the body on climbs). */
  externalW: number;
  /** Speed over ground, m/s. */
  speed: number;
  /** Air speed past the athlete along and across the direction of travel, m/s. */
  airAlong: number;
  airAcross: number;
  /** Air temperature and dew point, °C. */
  temp: number;
  dew: number;
  /** Mean radiant temperature, °C. */
  radiant: number;
  /** Rain and snow (as water) falling at the athlete, mm/h. */
  rain: number;
  snow: number;
}

export function createBodyInput(temp: number = NEUTRAL_AIR.temperatureC, dew = 7.3): BodyInput {
  return { vo2Net: 0, externalW: 0, speed: 0, airAlong: 0, airAcross: 0, temp, dew, radiant: temp, rain: 0, snow: 0 };
}

/**
 * The heat balance state, stepped with explicit Euler at 1 s (skin τ ≈ 30–60 s, core τ ≥ 20 min). Allocation-free, so it
 * runs inside every calibration pass.
 */
export class BodyHeat {
  /** Core, mean skin and working-muscle temperatures, °C. */
  core: number = THERMAL.coreStart;
  skin: number = THERMAL.skinStart;
  muscle: number = THERMAL.muscleStart;
  /** Sweat rate, W/m². */
  sweat = 0;
  /** Water held in the clothing, kg/m². */
  clothWater = 0;
  /** Sweat and respiratory water lost net of drinking, g. */
  lossG = 0;
  /** Shivering heat production, W/m². */
  shiver = 0;
  /** Skin blood flow, L/(m²·h). */
  skinFlow = 0;
  /** Metabolic rate averaged over THERMAL.setPointTau, W/m². */
  metabolicMean = 0;
  readonly area: number;
  /** W/m² per ml/kg/min of O2 uptake. */
  private readonly perVo2: number;
  private readonly coreCapacity: number;
  private readonly skinCapacity: number;
  private readonly waterCapacity: number;
  private readonly foot: boolean;
  private readonly aSweat = 1 - Math.exp(-1 / THERMAL.sweatTau);
  private readonly aSetPoint = 1 - Math.exp(-1 / THERMAL.setPointTau);
  private readonly aMuscle = 1 - Math.exp(-1 / THERMAL.muscleTau);

  constructor(readonly body: ThermalBody) {
    this.area = bodySurfaceArea(body.weightKg, body.heightCm);
    this.perVo2 = ((body.weightKg / 60) * J_PER_ML_O2) / this.area;
    this.coreCapacity = (0.9 * body.weightKg * SPECIFIC_HEAT) / this.area;
    this.skinCapacity = (0.1 * body.weightKg * SPECIFIC_HEAT) / this.area;
    this.waterCapacity = Math.max(0.05, THERMAL.waterPerClo * body.clothing.clo);
    this.foot = body.sport !== 'ride';
    this.reset();
  }

  reset(): void {
    this.core = THERMAL.coreStart;
    this.skin = THERMAL.skinStart;
    this.muscle = THERMAL.muscleStart;
    this.sweat = 0;
    this.clothWater = 0;
    this.lossG = 0;
    this.shiver = 0;
    this.skinFlow = 0;
    this.metabolicMean = VO2_REST * this.perVo2;
  }

  /** Shivering as net O2 uptake, ml/kg/min. */
  get shiverVo2(): number {
    return this.shiver / this.perVo2;
  }

  /** Water in the clothing as a share of what it holds, 0–1. */
  get wetness(): number {
    return Math.min(1, this.clothWater / this.waterCapacity);
  }

  step(x: BodyInput): void {
    const T = THERMAL;
    const b = this.body;
    const rest = VO2_REST * this.perVo2;
    const exercise = Math.max(0, x.vo2Net) * this.perVo2;
    const metabolic = rest + exercise + this.shiver;
    this.metabolicMean += (metabolic - this.metabolicMean) * this.aSetPoint;
    const coreSet = 36.8 + T.setPointSlope * Math.max(0, this.metabolicMean - 55);
    const work = Math.min(0.8 * (rest + exercise), Math.max(0, x.externalW) / this.area);
    const ta = x.temp;
    const pa = satKpa(Math.min(x.dew, ta));
    const tSkin = this.skin;
    const tCore = this.core;
    const air = Math.hypot(x.airAlong, x.airAcross);
    const walk = this.foot ? Math.max(0, x.speed) : 0;
    const clo = b.clothing.clo;
    const fcl = 1 + 0.28 * clo;
    const wet = Math.min(1, this.clothWater / this.waterCapacity);

    // Clothing insulation after wind, walking and wetting (ISO 9920 resultant values), then the air layer at the actual
    // air speed (ISO 7933 convection) with radiation.
    const corrTotal = totalInsulationCorrection(air, walk, b.clothing.shell);
    const iClDyn = Math.max(0.002, (0.155 * clo * (1 - T.wetInsulationLoss * wet) + AIR_LAYER / fcl) * corrTotal - (AIR_LAYER * airLayerCorrection(air, walk)) / fcl);
    const hc = Math.max(2.38 * Math.pow(Math.abs(tSkin - ta), 0.25), air <= 1 ? 3.5 + 5.2 * air : 8.7 * Math.pow(air, 0.6));
    const hr = T.radiative;
    const boundary = 1 / (fcl * (hc + hr));
    const operative = (hc * ta + hr * x.radiant) / (hc + hr);
    const resistance = iClDyn + boundary;
    const dry = (tSkin - operative) / resistance;
    const tClothing = operative + ((tSkin - operative) * boundary) / resistance;

    // Respiration (ISO 7933).
    const exhaled = 28.56 + 0.115 * ta + 0.641 * pa;
    const breathLatent = 0.00127 * metabolic * (59.34 + 0.53 * ta - 11.63 * pa);
    const breath = 0.001516 * metabolic * (exhaled - ta) + breathLatent;

    // Evaporation from the skin through the clothing (ISO 9920 evaporative correction); soaked layers hold part of it back.
    const permeability = b.clothing.shell ? T.shellPermeability : T.permeability;
    const staticResistance = (0.155 * clo + AIR_LAYER / fcl) / (permeability * LEWIS);
    const eMax = Math.max(0, (satKpa(tSkin) - pa) / (staticResistance * evaporativeCorrection(air, walk))) * (1 - T.wetVapourBlock * wet);

    // Rain and snow wet the clothing; the water warms toward clothing temperature, and wet clothing evaporates.
    const catchShare = (T.rainCatch[0] + (T.rainCatch[1] - T.rainCatch[0]) * Math.min(1, air / 5)) * (b.clothing.shell ? T.shellRainPass : 1);
    const waterIn = ((Math.max(0, x.rain) + T.snowWetting * Math.max(0, x.snow)) / 3600) * catchShare;
    const rainCooling = waterIn * WATER_HEAT * Math.max(0, tClothing - ta) * T.rainBodyShare;
    const clothEvap = wet > 0 ? wet * Math.max(0, satKpa(tClothing) - pa) * LEWIS * hc : 0;
    const clothEvapBody = T.wetEvaporationBodyShare * clothEvap;

    // Sweating toward the requirement, gated by core temperature against its metabolic set point.
    const required = metabolic - work - breath - dry - rainCooling - clothEvapBody;
    let target = 0;
    if (required > 0 && eMax > 0) {
      const w = required / eMax;
      const efficiency = w >= 2 ? 0.05 : Math.max(0.05, w <= 1 ? 1 - (w * w) / 2 : ((2 - w) * (2 - w)) / 2);
      target = Math.min(required / efficiency, T.sweatMax) * clamp((tCore - coreSet + T.sweatOnset) / T.sweatRamp, 0, 1);
    }
    this.sweat += (target - this.sweat) * this.aSweat;
    let skinEvap = 0;
    if (this.sweat > 1e-9 && eMax > 0) {
      const k = eMax / this.sweat;
      skinEvap = Math.min(T.wettednessMax, k >= 0.5 ? -k + Math.sqrt(k * k + 2) : 1) * eMax;
    }
    const drip = Math.max(0, this.sweat - skinEvap);
    this.clothWater = clamp(this.clothWater + waterIn + (T.sweatToClothing * drip - clothEvap) / LATENT_J_PER_KG, 0, this.waterCapacity);

    // Skin blood flow and core-to-skin conductance (Gagge).
    const bloodFlow = clamp((6.3 + 120 * Math.max(0, tCore - coreSet)) / (1 + 0.5 * Math.max(0, 33.7 - tSkin)), 0.5, 90);
    this.skinFlow = bloodFlow;
    const flow = (5.28 + 1.163 * bloodFlow) * (tCore - tSkin);
    const inShell = T.workToSkinShare * (exercise + this.shiver);
    const coreGain = metabolic - work - breath - flow - inShell;
    const skinGain = flow + inShell - dry - skinEvap - rainCooling - clothEvapBody;
    this.core = clamp(tCore + coreGain / this.coreCapacity, 30, 42.5);
    this.skin = clamp(tSkin + skinGain / this.skinCapacity, 5, 42);

    // Working muscle sits between core and skin, nearer the core the harder it works.
    const active = ramp(1.5 * rest, T.activeMetabolic, rest + exercise);
    const share = T.muscleSkinShare[0] + (T.muscleSkinShare[1] - T.muscleSkinShare[0]) * active;
    this.muscle += (this.core - (this.core - this.skin) * share - this.muscle) * this.aMuscle;

    // Shivering for the next second (Tikuisis & Giesbrecht 1999), damped by exercise.
    const coolSkin = 33 - this.skin;
    const drive = 155.5 * (37 - this.core) + 47 * coolSkin - 1.57 * coolSkin * coolSkin;
    this.shiver = clamp(drive / Math.sqrt(b.bodyFatPct) - T.shiverSuppression * exercise, 0, b.shiverMax);
    this.lossG += ((this.sweat + breathLatent) * this.area * 1000 * (1 - b.drink)) / LATENT_J_PER_KG;
  }
}

/** Heart-rate share from heat strain: core temperature and body-mass loss above those of the same motion in neutral weather. */
export function heatHeartRateShare(core: number, neutralCore: number, lossG: number, neutralLossG: number, massKg: number): number {
  return HR_HEAT.perCoreDegree * (core - neutralCore) + (HR_HEAT.perPercentLoss * (lossG - neutralLossG)) / (10 * massKg);
}

/** The heat and cold parts of the last thermal speed factor. */
export interface ThermalPace {
  heat: number;
  cold: number;
}

export function createThermalPace(): ThermalPace {
  return { heat: 1, cold: 1 };
}

/** Speed multiplier from thermal state (THERMAL_PACE): the actual body against the same motion in neutral weather. */
export function thermalPace(actual: BodyHeat, neutral: BodyHeat, fitness: FitnessLevel, out: ThermalPace): number {
  const P = THERMAL_PACE;
  const shift = HEAT_TOLERANCE[fitness] ?? 0;
  const perDegree = actual.body.sport === 'ride' ? P.ridePerDegree : P.footPerDegree;
  const anticipation = Math.min(P.maxAnticipation, perDegree * Math.max(0, actual.skin - neutral.skin - P.skinFrom));
  const critical = P.coreLoss * Math.max(0, ramp(P.coreFrom + shift, P.coreTo + shift, actual.core) - ramp(P.coreFrom + shift, P.coreTo + shift, neutral.core));
  const deficit = (actual.lossG - neutral.lossG) / (10 * actual.body.weightKg);
  const dehydration = Math.min(P.maxDehydration, P.lossPerPercent * Math.max(0, deficit - P.lossFrom));
  const muscle = P.musclePerDegree * Math.max(0, neutral.muscle - actual.muscle - P.muscleFrom);
  const hypothermia = P.coreColdLoss * ramp(P.coreColdFrom, P.coreColdTo, actual.core);
  out.heat = (1 - anticipation) * (1 - critical) * (1 - dehydration);
  out.cold = Math.max(P.floor, (1 - Math.min(0.5, muscle)) * (1 - hypothermia));
  return Math.max(P.floor, out.heat * out.cold);
}
