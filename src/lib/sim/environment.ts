// Weather and the athlete's heat balance in the engine. Every simulation has a weather field: the fetched series in
// automatic mode, or constant manual conditions otherwise, so the physiology does not depend on whether a fetch worked.
// The integrator samples the field once per simulated second at the athlete's position and time (air along the direction
// of travel, air density, the surface state underfoot), steps the heat balance with that second's motion, and reads a
// thermal speed factor for the next second. The recorded pass keeps a per-second trace for heart rate, the wrist sensor
// and the summary.
import type { ActivityType, Athlete, FitnessLevel, ManualWeather, SessionSettings, SurfaceClass, TerrainProfile, WeatherPin, WeatherSeries, WeatherSettings, WeatherSummary } from '../types';
import { NEUTRAL_MANUAL, constantField, createAmbient, createWeatherField, isUsableSeries, type Conditions, type WeatherField } from '../weather/field';
import { BODY_WIND_FACTOR, WIND_2M_FACTOR, airDensityMoist, dewPointFromHumidity, meanRadiantTemperature, scaleHeight, wbgt } from '../weather/physics';
import { WET_SURFACE, createSurfaceState, precomputeSurface, SURFACE_MODEL, type SurfaceGrid, type SurfaceStation } from '../weather/surface';
import {
  BodyHeat,
  NEUTRAL_AIR,
  bodyFatPct,
  bodySurfaceArea,
  chooseClothing,
  createBodyInput,
  createThermalPace,
  drinkShare,
  heatHeartRateShare,
  shiverCapacity,
  thermalPace,
  type Clothing,
} from '../weather/thermal';
import type { KinRecord } from './kinematics';
import { G, type AirFlow } from './models';
import { Cursor, DEG, M_PER_DEG, type Track } from './track';

const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);
const finite = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

/** What the integrators read from the weather and the body each second. */
export interface EnvironmentSampler extends AirFlow {
  /** Samples air and ground at route distance s (m) and elapsed second i; call before reading anything else. */
  sample(s: number, i: number): void;
  /** Metabolic cost multiplier of moving on foot at v m/s through the sampled wind (1 in still air). */
  windCost(v: number): number;
  /** Speed multiplier of the surface state on foot at grade g (decimal), walking or running. */
  surfaceSpeed(grade: number, walking: boolean): number;
  /** O2-cost multiplier of the surface state on foot (fresh snow, ice). */
  readonly surfaceCost: number;
  /** Multiplier on corner speed caps from the grip the surface keeps. */
  readonly grip: number;
  /** Ride: multiplier on the descent braking set point. */
  readonly brake: number;
  /** Ride: multiplier on planned power. */
  readonly power: number;
  /** Speed (foot) or power (ride) multiplier from the athlete's thermal state against neutral weather. */
  readonly thermal: number;
  /** Starts an integrator pass: body temperatures back to their start; `record` keeps the per-second trace. */
  beginPass(record: boolean): void;
  /**
   * Advances the heat balance by elapsed second i after sample(): net O2 uptake of the motion (ml/kg/min), speed (m/s) and
   * grade; `crankW` is the crank power on a ride (foot sports lift their body on climbs instead).
   */
  body(i: number, vo2Net: number, speed: number, grade: number, crankW?: number): void;
}

/**
 * Wind on foot: gross metabolic power rises 6.13 % per 1 % of body weight of horizontal impeding force (da Silva, Kram
 * & Hoogkamer 2022; individual range 4.17–8.14 %), with drag area 0.2 m² per m² of body surface (≈ 0.37 m²; di Prampero
 * 1986 air power). A tailwind returns only part of the headwind cost: Davies 1980 found about 30 %, Yamashita et al.
 * 2024 more than the headwind cost, so 0.6 is a compromise (HEURISTIC).
 */
export const WIND_COST = { perBodyWeight: 6.13, dragAreaPerSurface: 0.2, tailwindShare: 0.6 } as const;

/**
 * Rides on wet roads: cornering grip about 60 % of dry (wet cornering at 70–80 % of dry speed, √0.6 = 0.77), descents
 * braked 20 % earlier (HEURISTIC). Planned power rises 1.5 % per m/s of headwind, within −5…+10 % (HEURISTIC).
 */
export const RIDE_WEATHER = { gripLoss: 0.4, descentBrake: 0.2, powerPerHeadwind: 0.015, powerRange: [0.95, 1.1] } as const;

/**
 * Snow and ice on foot. Fresh snow depth D raises the terrain factor to η = 1 + 0.0754·D cm (Pandolf, Haisman & Goldman
 * 1976; 1.38 at 5 cm), at most 4.5; at equal effort speed follows η^−0.7 and O2 cost η^0.3 (HEURISTIC split). Full ice
 * slows walking to 60 %, running to 50 % and steep descents to 40 %, and short, braced steps cost 15 % more O2; with
 * crampons walking keeps 90 %, descents 80 %, and the cost rises 5 % (no footwear grips wet ice, Manning & Jones 2001;
 * the factors are HEURISTIC). Ice is graded by the surface state (see SURFACE_MODEL).
 */
export const SNOW_AND_ICE = {
  perCm: 0.0754,
  maxFactor: 4.5,
  speedExponent: -0.7,
  costExponent: 0.3,
  iceWalk: 0.6,
  iceRun: 0.5,
  iceDescent: 0.4,
  iceCost: 0.15,
  cramponWalk: 0.9,
  cramponDescent: 0.8,
  cramponCost: 0.05,
} as const;

const PINS: readonly WeatherPin[] = ['temperature', 'wind', 'precipitation'];

/** Valid weather settings from a session, or null when there are none (neutral manual conditions then). */
export function sanitiseWeatherSettings(raw: unknown): WeatherSettings | null {
  if (!raw || typeof raw !== 'object') return null;
  const w = raw as Partial<WeatherSettings>;
  if (w.mode !== 'auto' && w.mode !== 'manual') return null;
  const m = (w.manual && typeof w.manual === 'object' ? w.manual : {}) as Partial<ManualWeather>;
  const num = (x: unknown, lo: number, hi: number, fallback: number): number => (finite(x) ? clamp(x, lo, hi) : fallback);
  return {
    mode: w.mode,
    manual: {
      humidityPct: num(m.humidityPct, 1, 100, 60),
      windMps: num(m.windMps, 0, 60, 0),
      windFromDeg: num(m.windFromDeg, 0, 360, 0) % 360,
      rainMmH: num(m.rainMmH, 0, 100, 0),
    },
    pinned: Array.isArray(w.pinned) ? PINS.filter((p) => (w.pinned as unknown[]).includes(p)) : [],
  };
}

/**
 * The weather a session simulates with: the series in automatic mode (pins applied), otherwise constant manual
 * conditions from session.temperatureC and the manual values (60 % humidity, calm and dry when there are none). A failed
 * fetch leaves automatic mode on its manual values.
 */
export function weatherField(series: WeatherSeries | null | undefined, session: SessionSettings): WeatherField {
  const settings = sanitiseWeatherSettings(session.weather);
  const conditions: Conditions = { temperatureC: finite(session.temperatureC) ? session.temperatureC : NEUTRAL_AIR.temperatureC, ...(settings?.manual ?? NEUTRAL_MANUAL) };
  if (settings?.mode === 'auto' && isUsableSeries(series)) return createWeatherField(series, conditions, settings.pinned);
  return constantField(conditions);
}

/** Moist air density at the start of the route, kg/m³. */
export function startAirDensity(field: WeatherField, startEpoch: number, elevation: number): number {
  const amb = createAmbient();
  field.at(0, startEpoch, elevation, amb);
  return airDensityMoist(amb.pressure, amb.temp, amb.dew);
}

/** Profile surface class and technicality per track point (the points buildTrack kept). */
function trackGround(profile: TerrainProfile, track: Track): { surface: Array<SurfaceClass | undefined>; technicality: Float64Array } {
  const pts = Array.isArray(profile?.points) ? profile.points : [];
  const surface: Array<SurfaceClass | undefined> = new Array(track.n).fill(undefined);
  const technicality = new Float64Array(track.n);
  let j = 0;
  let lastD = -Infinity;
  for (const p of pts) {
    if (j >= track.n) break;
    if (!p || !finite(p.d) || !finite(p.lon) || !finite(p.lat)) continue;
    if (j > 0 && p.d <= lastD + 1e-6) continue;
    lastD = p.d;
    surface[j] = p.surface && WET_SURFACE[p.surface] ? p.surface : undefined;
    technicality[j] = finite(p.technicality) ? clamp(p.technicality, 0, 1) : 0;
    j++;
  }
  return { surface, technicality };
}

/** Unit direction of travel (east, north) per track point over ±10 m of route. */
function travelDirection(track: Track): { east: Float64Array; north: Float64Array } {
  const { n, d, total } = track;
  const east = new Float64Array(n);
  const north = new Float64Array(n).fill(1);
  if (n < 2) return { east, north };
  const cur = new Cursor(track);
  const at = (s: number): [number, number] => {
    cur.seek(s);
    return [cur.lerp(track.lon), cur.lerp(track.lat)];
  };
  for (let j = 0; j < n; j++) {
    const [lonA, latA] = at(Math.max(0, d[j] - 10));
    const [lonB, latB] = at(Math.min(total, d[j] + 10));
    const dx = (lonB - lonA) * M_PER_DEG * Math.cos(track.lat[j] * DEG);
    const dy = (latB - latA) * M_PER_DEG;
    const len = Math.hypot(dx, dy);
    if (len > 1e-6) {
      east[j] = dx / len;
      north[j] = dy / len;
    } else if (j > 0) {
      east[j] = east[j - 1];
      north[j] = north[j - 1];
    }
  }
  return { east, north };
}

/** Per-second heat balance of the recorded pass (index = elapsed second). */
class BodyTrace {
  core = new Float64Array(0);
  skin = new Float64Array(0);
  lossG = new Float64Array(0);
  neutralCore = new Float64Array(0);
  neutralLossG = new Float64Array(0);
  shiverVo2 = new Float64Array(0);
  thermal = new Float64Array(0);
  cold = new Float64Array(0);
  /** Air speed past the athlete, m/s. */
  air = new Float64Array(0);
  /** Water in the clothing, share of what it holds. */
  wetness = new Float64Array(0);
  n = 0;

  clear(): void {
    this.n = 0;
  }

  store(i: number, actual: BodyHeat, neutral: BodyHeat, thermal: number, cold: number, air: number): void {
    if (i >= this.core.length) this.grow(Math.max(i + 1, Math.ceil(this.core.length * 1.5) + 256));
    this.core[i] = actual.core;
    this.skin[i] = actual.skin;
    this.lossG[i] = actual.lossG;
    this.neutralCore[i] = neutral.core;
    this.neutralLossG[i] = neutral.lossG;
    this.shiverVo2[i] = actual.shiverVo2;
    this.thermal[i] = thermal;
    this.cold[i] = cold;
    this.air[i] = air;
    this.wetness[i] = actual.wetness;
    // Seconds the integrator skipped (none in practice) hold the previous values.
    for (let k = this.n; k < i; k++) this.copy(k, k > 0 ? k - 1 : i);
    if (i + 1 > this.n) this.n = i + 1;
  }

  private copy(to: number, from: number): void {
    for (const a of [this.core, this.skin, this.lossG, this.neutralCore, this.neutralLossG, this.shiverVo2, this.thermal, this.cold, this.air, this.wetness]) a[to] = a[from];
  }

  private grow(size: number): void {
    const up = (a: Float64Array) => {
      const b = new Float64Array(size);
      b.set(a.subarray(0, this.n));
      return b;
    };
    this.core = up(this.core);
    this.skin = up(this.skin);
    this.lossG = up(this.lossG);
    this.neutralCore = up(this.neutralCore);
    this.neutralLossG = up(this.neutralLossG);
    this.shiverVo2 = up(this.shiverVo2);
    this.thermal = up(this.thermal);
    this.cold = up(this.cold);
    this.air = up(this.air);
    this.wetness = up(this.wetness);
  }
}

export interface EnvironmentOptions {
  field: WeatherField;
  profile: TerrainProfile;
  track: Track;
  sport: ActivityType;
  athlete: Athlete;
  /** Profile VO2max, ml/kg/min (shivering capacity). */
  vo2max: number;
  /** Epoch seconds of elapsed second 0. */
  startEpoch: number;
  /** Seconds after the start the surface state is stored for (held beyond). */
  horizonS: number;
  /** Net O2 uptake (ml/kg/min) and speed (m/s) the target plans on average: clothing is chosen for them. */
  planned: { vo2Net: number; speed: number };
  /** Crampons on snow and ice (mountaineering). */
  crampons?: boolean;
}

/** The sun is recomputed this often, s (it moves 2.5° of hour angle per 10 minutes). */
const SUN_STEP_S = 10;

export class Environment implements EnvironmentSampler {
  rho = 1.225;
  head = 0;
  cross = 0;
  surfaceCost = 1;
  grip = 1;
  brake = 1;
  power = 1;
  thermal = 1;
  readonly field: WeatherField;
  readonly surface: SurfaceGrid | null;
  readonly startEpoch: number;
  readonly sport: ActivityType;
  readonly amb = createAmbient();
  readonly ground = createSurfaceState();
  /** Clothing the athlete set off in, and what the neutral comparison wears. */
  readonly clothing: Clothing;
  readonly trace = new BodyTrace();
  private readonly track: Track;
  private readonly cur: Cursor;
  private readonly east: Float64Array;
  private readonly north: Float64Array;
  private readonly wetFlat: Float64Array;
  private readonly wetDescent: Float64Array;
  private readonly gripLoss: Float64Array;
  private readonly technicality: Float64Array;
  private readonly dragArea: number;
  private readonly weight: number;
  private readonly crampons: boolean;
  private readonly fitness: FitnessLevel;
  private readonly actualBody: BodyHeat;
  private readonly neutralBody: BodyHeat;
  private readonly input = createBodyInput();
  private readonly neutralInput = createBodyInput(NEUTRAL_AIR.temperatureC, dewPointFromHumidity(NEUTRAL_AIR.temperatureC, NEUTRAL_AIR.humidityPct));
  private readonly pace = createThermalPace();
  private recording = false;
  private lastS = 0;
  private sunUntil = -Infinity;
  private radiantGain = 0;
  private wet = 0;
  private wetEff = 0;
  private ice = 0;
  private snowSpeed = 1;
  private flat = 0;
  private descent = 0;
  private tech = 0;

  constructor(o: EnvironmentOptions) {
    this.field = o.field;
    this.track = o.track;
    this.cur = new Cursor(o.track);
    this.startEpoch = o.startEpoch;
    this.sport = o.sport;
    this.crampons = o.crampons === true;
    ({ east: this.east, north: this.north } = travelDirection(o.track));
    const n = o.track.n;
    const ground = trackGround(o.profile, o.track);
    this.technicality = ground.technicality;
    this.wetFlat = new Float64Array(n);
    this.wetDescent = new Float64Array(n);
    this.gripLoss = new Float64Array(n);
    for (let j = 0; j < n; j++) {
      const f = WET_SURFACE[ground.surface[j] ?? 'paved'];
      this.wetFlat[j] = f.flat;
      this.wetDescent[j] = f.descent;
      this.gripLoss[j] = f.gripLoss;
    }
    const athlete = o.athlete;
    const area = bodySurfaceArea(athlete.weightKg, athlete.heightCm);
    this.dragArea = WIND_COST.dragAreaPerSurface * area;
    this.weight = athlete.weightKg * G;
    this.fitness = athlete.fitness;

    // Clothing is chosen once, for the planned effort in the conditions at the start and whether rain or snow is due.
    const start = createAmbient();
    o.field.at(0, o.startEpoch, n > 0 ? o.track.ele[0] : 0, start);
    const plannedMetabolic = ((Math.max(0, o.planned.vo2Net) + 3.5) * athlete.weightKg * 20.9) / 60 / area;
    const wetDay = o.field.precipitates(o.startEpoch, o.startEpoch + o.horizonS);
    this.clothing = chooseClothing(o.sport, plannedMetabolic, start.temp, start.windSpeed, o.planned.speed, wetDay);
    const build = { weightKg: athlete.weightKg, heightCm: athlete.heightCm, age: athlete.age, sex: athlete.sex };
    const body = { ...build, bodyFatPct: bodyFatPct(build), sport: o.sport, drink: drinkShare(o.sport), shiverMax: shiverCapacity(build, o.vo2max) };
    this.actualBody = new BodyHeat({ ...body, clothing: this.clothing });
    // The reference is the same work on a mild day, so it is dressed for one. A mountain wardrobe starts at 1.2 clo with a
    // shell, which in 15 C of calm air would cook the reference body and make every summit day look hypothermic by
    // comparison; on a mild day the same climber would be walking in what a walker wears.
    const neutralSport: ActivityType = o.sport === 'alpine' ? 'walk' : o.sport;
    this.neutralBody = new BodyHeat({ ...body, clothing: chooseClothing(neutralSport, plannedMetabolic, NEUTRAL_AIR.temperatureC, 0, o.planned.speed, false) });

    // Stations along the route at 200 m (sparser on long routes), each with the surface class under it. Without any
    // precipitation from the spin-up to the horizon the ground stays dry and nothing needs stepping. Manual conditions
    // start at the start: their rain has not been falling for two days.
    const M = SURFACE_MODEL;
    const spinUpS = o.field.source === null ? 0 : M.spinUpS;
    if (!o.field.precipitates(o.startEpoch - spinUpS, o.startEpoch + o.horizonS)) {
      this.surface = null;
      return;
    }
    const total = o.track.total;
    const spacing = Math.max(M.stationSpacingM, total / (M.maxStations - 1));
    const stations: SurfaceStation[] = [];
    for (let k = 0; k * spacing <= total + 1e-6; k++) {
      const d = Math.min(total, k * spacing);
      this.cur.seek(d);
      const nearest = Math.min(n - 1, this.cur.j + (this.cur.f >= 0.5 ? 1 : 0));
      stations.push({ d, ele: this.cur.lerp(o.track.ele), surface: ground.surface[nearest] ?? 'paved' });
    }
    const grid = precomputeSurface(o.field, stations, o.startEpoch, o.startEpoch + o.horizonS, spinUpS);
    this.surface = grid.active ? grid : null;
  }

  sample(s: number, i: number): void {
    const cur = this.cur;
    const amb = this.amb;
    const t = this.startEpoch + i;
    this.lastS = s;
    cur.seek(s);
    this.field.at(s, t, cur.lerp(this.track.ele), amb);
    let ex = cur.lerp(this.east);
    let ny = cur.lerp(this.north);
    const len = Math.hypot(ex, ny);
    if (len > 1e-9) {
      ex /= len;
      ny /= len;
    }
    // The air moves along (windU, windV); against the direction of travel it is a headwind.
    this.head = -(amb.windU * ex + amb.windV * ny) * BODY_WIND_FACTOR;
    this.cross = (amb.windU * ny - amb.windV * ex) * BODY_WIND_FACTOR;
    this.rho = airDensityMoist(amb.pressure, amb.temp, amb.dew);
    const R = RIDE_WEATHER;
    this.power = clamp(1 + R.powerPerHeadwind * this.head, R.powerRange[0], R.powerRange[1]);
    if (!this.surface) return;
    const g = this.ground;
    this.surface.at(s, t, g);
    this.wet = g.wet;
    this.wetEff = g.wetEff;
    this.ice = g.ice;
    const S = SNOW_AND_ICE;
    const eta = Math.min(S.maxFactor, 1 + S.perCm * g.snowCm);
    this.snowSpeed = eta > 1 ? Math.pow(eta, S.speedExponent) : 1;
    this.surfaceCost = (eta > 1 ? Math.pow(eta, S.costExponent) : 1) * (1 + (this.crampons ? S.cramponCost : S.iceCost) * g.ice);
    this.flat = cur.lerp(this.wetFlat);
    this.descent = cur.lerp(this.wetDescent);
    this.tech = cur.lerp(this.technicality);
    const loss = this.sport === 'ride' ? R.gripLoss : cur.lerp(this.gripLoss);
    this.grip = Math.sqrt(Math.max(0.16, 1 - Math.max(g.wet * loss, (this.crampons ? 0.2 : 0.6) * g.ice)));
    this.brake = 1 - R.descentBrake * Math.max(g.wet, g.ice);
  }

  windCost(v: number): number {
    const va = v + this.head;
    let force = 0.5 * this.rho * this.dragArea * (va * Math.abs(va) - v * v);
    if (force < 0) force *= WIND_COST.tailwindShare;
    return Math.max(0.5, 1 + (WIND_COST.perBodyWeight * force) / this.weight);
  }

  /**
   * f_wet·f_snow·f_ice: a fully wet surface costs `flat` on the level and, on descents steeper than −5 % (full effect at
   * −25 %), `descent`·(0.5 + technicality) of speed on the wet-and-muddy state (HEURISTIC); ice as in SNOW_AND_ICE.
   */
  surfaceSpeed(grade: number, walking: boolean): number {
    if (!this.surface) return 1;
    const steep = clamp((-grade - 0.05) / 0.2, 0, 1);
    const wet = 1 - this.wet * this.flat - steep * this.wetEff * this.descent * (0.5 + this.tech);
    const S = SNOW_AND_ICE;
    const level = this.crampons ? S.cramponWalk : walking ? S.iceWalk : S.iceRun;
    const down = this.crampons ? S.cramponDescent : S.iceDescent;
    const ice = 1 - this.ice * (1 - (level + (down - level) * steep));
    return Math.max(0.2, wet * this.snowSpeed * ice);
  }

  beginPass(record: boolean): void {
    this.actualBody.reset();
    this.neutralBody.reset();
    this.thermal = 1;
    this.pace.heat = 1;
    this.pace.cold = 1;
    this.sunUntil = -Infinity;
    this.recording = record;
    if (record) {
      this.trace.clear();
      this.trace.store(0, this.actualBody, this.neutralBody, 1, 1, 0);
    }
  }

  body(i: number, vo2Net: number, speed: number, grade: number, crankW = -1): void {
    const amb = this.amb;
    const t = this.startEpoch + i;
    if (t >= this.sunUntil) {
      this.field.sun(this.lastS, t, amb);
      this.radiantGain = meanRadiantTemperature(0, amb.shortwave, amb.sunElev);
      this.sunUntil = t + SUN_STEP_S;
    }
    const v = Math.max(0, speed);
    const x = this.input;
    x.vo2Net = vo2Net;
    x.externalW = crankW >= 0 ? crankW : this.weight * v * Math.max(0, grade / Math.sqrt(1 + grade * grade));
    x.speed = v;
    x.airAlong = v + this.head;
    x.airAcross = this.cross;
    x.temp = amb.temp;
    x.dew = amb.dew;
    x.radiant = amb.temp + this.radiantGain;
    x.rain = amb.precip * (1 - amb.snow);
    x.snow = amb.precip * amb.snow;
    this.actualBody.step(x);
    const nx = this.neutralInput;
    nx.vo2Net = vo2Net;
    nx.externalW = x.externalW;
    nx.speed = v;
    nx.airAlong = v;
    this.neutralBody.step(nx);
    this.thermal = thermalPace(this.actualBody, this.neutralBody, this.fitness, this.pace);
    if (this.recording) this.trace.store(i, this.actualBody, this.neutralBody, this.thermal, this.pace.cold, Math.hypot(x.airAlong, x.airAcross));
  }
}

/** What the athlete met each second of the finished motion. */
export interface EnvironmentRecord {
  temp: Float64Array;
  dew: Float64Array;
  rh: Float64Array;
  /** Wind at 10 m, m/s, and the direction it blows from, degrees. */
  windSpeed: Float64Array;
  windFrom: Float64Array;
  /** Wind at body height along (+ from ahead) and across the direction of travel, m/s. */
  head: Float64Array;
  cross: Float64Array;
  /** Precipitation at the athlete, mm/h, and its snow share. */
  precip: Float64Array;
  snow: Float64Array;
  /** Mean radiant temperature and wet-bulb globe temperature, °C. */
  radiant: Float64Array;
  wbgt: Float64Array;
  /** Surface wetness including mud (0–1), fresh snow (cm) and the surface-state speed factor on foot. */
  wetness: Float64Array;
  snowCm: Float64Array;
  surfaceSpeed: Float64Array;
  /** Apparent altitude change from the pressure tendency at the athlete since the start, m; null without a changing pressure. */
  pressureOffset: Float64Array | null;
}

/** Samples the environment along recorded distances (second i at the start epoch + i). */
export function recordEnvironment(env: Environment, rec: Pick<KinRecord, 'dist' | 'grade' | 'gait'>, n: number, walkingGait: number): EnvironmentRecord {
  const make = () => new Float64Array(n);
  const r: EnvironmentRecord = {
    temp: make(),
    dew: make(),
    rh: make(),
    windSpeed: make(),
    windFrom: make(),
    head: make(),
    cross: make(),
    precip: make(),
    snow: make(),
    radiant: make(),
    wbgt: make(),
    wetness: make(),
    snowCm: make(),
    surfaceSpeed: make(),
    pressureOffset: env.field.varies ? make() : null,
  };
  const amb = env.amb;
  for (let i = 0; i < n; i++) {
    const s = rec.dist[i];
    env.sample(s, i);
    env.field.sun(s, env.startEpoch + i, amb);
    r.temp[i] = amb.temp;
    r.dew[i] = amb.dew;
    r.rh[i] = amb.rh;
    r.windSpeed[i] = amb.windSpeed;
    r.windFrom[i] = amb.windSpeed > 0 ? ((Math.atan2(-amb.windU, -amb.windV) / DEG) % 360 + 360) % 360 : 0;
    r.head[i] = env.head;
    r.cross[i] = env.cross;
    r.precip[i] = amb.precip;
    r.snow[i] = amb.snow;
    r.radiant[i] = meanRadiantTemperature(amb.temp, amb.shortwave, amb.sunElev);
    r.wbgt[i] = wbgt(amb.temp, amb.rh, amb.windSpeed * WIND_2M_FACTOR, r.radiant[i]);
    if (env.surface) {
      r.wetness[i] = env.ground.wetEff;
      r.snowCm[i] = env.ground.snowCm;
      r.surfaceSpeed[i] = env.surfaceSpeed(rec.grade[i], rec.gait[i] === walkingGait);
    } else {
      r.surfaceSpeed[i] = 1;
    }
    if (r.pressureOffset) {
      // A barometric watch calibrates at the start; later pressure changes at the same place read as altitude.
      const ratio = env.field.pressureTrend(s, env.startEpoch + i) / env.field.pressureTrend(s, env.startEpoch);
      r.pressureOffset[i] = -scaleHeight(amb.temp) * Math.log(ratio);
    }
  }
  return r;
}

/** The heat balance of the recorded pass, per elapsed second. */
export interface HeatStrain {
  /** Heart-rate share from heat strain against neutral weather (see heatHeartRateShare). */
  share: Float64Array;
  /** Shivering O2 uptake, ml/kg/min. */
  shiverVo2: Float64Array;
  core: Float64Array;
  skin: Float64Array;
  /** Thermal speed factor, and its cold part. */
  thermal: Float64Array;
  cold: Float64Array;
  /** Air speed past the athlete, m/s, and water in the clothing (share of what it holds). */
  air: Float64Array;
  clothingWet: Float64Array;
  coreMax: number;
  /** Lowest core temperature after the first ten minutes, °C. */
  coreMin: number;
  /** Sweat lost net of drinking at the finish, litres. */
  lossL: number;
  clothing: Clothing;
}

/** Heat strain from the environment's trace over the first n elapsed seconds. */
export function heatStrain(env: Environment, n: number, massKg: number): HeatStrain {
  const tr = env.trace;
  const take = (a: Float64Array): Float64Array => {
    const out = new Float64Array(n);
    const m = Math.min(n, tr.n);
    out.set(a.subarray(0, m));
    for (let i = m; i < n; i++) out[i] = m > 0 ? a[m - 1] : 0;
    return out;
  };
  const core = take(tr.core);
  const lossG = take(tr.lossG);
  const neutralCore = take(tr.neutralCore);
  const neutralLossG = take(tr.neutralLossG);
  const share = new Float64Array(n);
  let coreMax = -Infinity;
  let coreMin = Infinity;
  for (let i = 0; i < n; i++) {
    share[i] = heatHeartRateShare(core[i], neutralCore[i], lossG[i], neutralLossG[i], massKg);
    coreMax = Math.max(coreMax, core[i]);
    if (i >= 600 || i === n - 1) coreMin = Math.min(coreMin, core[i]);
  }
  return {
    share,
    shiverVo2: take(tr.shiverVo2),
    core,
    skin: take(tr.skin),
    thermal: take(tr.thermal),
    cold: take(tr.cold),
    air: take(tr.air),
    clothingWet: take(tr.wetness),
    coreMax: n > 0 ? coreMax : 37,
    coreMin: n > 0 ? coreMin : 37,
    lossL: n > 0 ? lossG[n - 1] / 1000 : 0,
    clothing: env.clothing,
  };
}

/** Precipitation at or above this rate counts as rain in the summary, mm/h. */
const RAIN_MM_H = 0.1;

/** What the athlete met, from the record over elapsed samples 0…n−1. */
export function summariseWeather(
  field: WeatherField,
  record: EnvironmentRecord,
  heat: HeatStrain,
  dist: ArrayLike<number>,
  moving: Uint8Array,
  n: number,
  startEpoch: number,
): WeatherSummary {
  let tMin = Infinity;
  let tMax = -Infinity;
  let wMin = Infinity;
  let wMax = -Infinity;
  let head = 0;
  let movingN = 0;
  let rainFrom: number | null = null;
  let rainTo: number | null = null;
  let rain = 0;
  let snow = 0;
  let snowMax = 0;
  let wet = 0;
  let wbgtMax = -Infinity;
  for (let i = 0; i < n; i++) {
    tMin = Math.min(tMin, record.temp[i]);
    tMax = Math.max(tMax, record.temp[i]);
    wMin = Math.min(wMin, record.windSpeed[i]);
    wMax = Math.max(wMax, record.windSpeed[i]);
    wbgtMax = Math.max(wbgtMax, record.wbgt[i]);
    snowMax = Math.max(snowMax, record.snowCm[i]);
    if (record.precip[i] >= RAIN_MM_H) {
      if (rainFrom === null) rainFrom = i;
      rainTo = i;
    }
    rain += record.precip[i] / 3600;
    snow += (record.precip[i] * record.snow[i]) / 3600;
    if (i > 0 && moving[i]) {
      head += record.head[i];
      movingN++;
      if (record.wetness[i] >= 0.3 || record.snowCm[i] >= 0.5) wet += Math.max(0, dist[i] - dist[i - 1]);
    }
  }
  const last = Math.max(0, n - 1);
  const summary: WeatherSummary = {
    airTempMin: n > 0 ? tMin : NaN,
    airTempMax: n > 0 ? tMax : NaN,
    airTempStart: n > 0 ? record.temp[0] : NaN,
    airTempEnd: n > 0 ? record.temp[last] : NaN,
    windMin: n > 0 ? wMin : 0,
    windMax: n > 0 ? wMax : 0,
    windFromStart: n > 0 ? record.windFrom[0] : 0,
    windFromEnd: n > 0 ? record.windFrom[last] : 0,
    headWindMean: movingN > 0 ? head / movingN : 0,
    rainFrom,
    rainTo,
    rainMm: rain,
    snowShare: rain > 0 ? snow / rain : 0,
    snowDepthMaxCm: snowMax,
    wetDistance: wet,
    coreTempMax: heat.coreMax,
    sweatLossL: heat.lossL,
    wbgtMax: n > 0 ? wbgtMax : NaN,
    uncoveredS: Number.isFinite(field.end) ? Math.max(0, Math.min(n, startEpoch + last - field.end)) : 0,
  };
  if (field.source) summary.source = field.source;
  if (field.analogYear !== undefined) summary.analogYear = field.analogYear;
  return summary;
}
