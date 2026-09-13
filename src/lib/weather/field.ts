// The weather field: ambient conditions at any route distance, time and elevation, from a series (hourly values at a
// few route points) or from constant manual conditions. Queries allocate nothing, so the integrator samples the field
// every second at the athlete's simulated position and time.
import type { ManualWeather, WeatherPin, WeatherSeries, WeatherSource } from '../types';
import { dewPointFromHumidity, relativeHumidity, scaleHeight, snowShare, standardPressure, wetBulb } from './physics';
import { sunElevationDeg } from './time';

/** Conditions at one place and time. */
export interface Ambient {
  /** Air temperature at 2 m, °C. */
  temp: number;
  /** Dew point, °C (never above temp). */
  dew: number;
  /** Relative humidity, %. */
  rh: number;
  /** Surface pressure at the route elevation, hPa. */
  pressure: number;
  /** Wind at 10 m as the air moves: east and north components, m/s. */
  windU: number;
  windV: number;
  /** Wind speed at 10 m, m/s. */
  windSpeed: number;
  /** Precipitation rate, mm/h of water. */
  precip: number;
  /** Share of it falling as snow, 0–1. */
  snow: number;
  /** Cloud cover, %. */
  cloud: number;
  /** Global irradiance, W/m² (filled by sun()). */
  shortwave: number;
  /** Sun elevation, degrees (filled by sun()). */
  sunElev: number;
}

export function createAmbient(): Ambient {
  return { temp: 15, dew: 7, rh: 60, pressure: 1013.25, windU: 0, windV: 0, windSpeed: 0, precip: 0, snow: 0, cloud: 50, shortwave: 0, sunElev: 0 };
}

/** Constant conditions for manual mode, for pins and for gaps in a series. */
export interface Conditions extends ManualWeather {
  temperatureC: number;
}

/** Manual conditions that keep the engine on its pre-weather path (with the manual temperature). */
export const NEUTRAL_MANUAL: Readonly<ManualWeather> = { humidityPct: 60, windMps: 0, windFromDeg: 0, rainMmH: 0 };

export function isNeutralManual(m: ManualWeather): boolean {
  return m.humidityPct === NEUTRAL_MANUAL.humidityPct && m.windMps === 0 && m.rainMmH === 0;
}

/** Lapse rates for the residual between the route and the sampled point elevation, K/m (Open-Meteo downscales with these). */
export const LAPSE = { temperature: 0.0065, dewPoint: 0.006 } as const;

export interface WeatherField {
  /** Series source; null for constant manual conditions. */
  readonly source: WeatherSource | null;
  readonly analogYear?: number;
  /** Epoch seconds of the first and last slot (±Infinity for constant conditions). */
  readonly start: number;
  readonly end: number;
  /** True when pressure changes over time, so a barometer follows it. */
  readonly varies: boolean;
  /** Conditions at route distance s (m), epoch seconds t and route elevation (m). Leaves shortwave and sunElev alone. */
  at(s: number, t: number, ele: number, out: Ambient): void;
  /** Fills out.sunElev and out.shortwave at route distance s and epoch seconds t. */
  sun(s: number, t: number, out: Ambient): void;
  /** Surface pressure at the sampled points' own elevations, smooth in time (for pressure tendencies), hPa. */
  pressureTrend(s: number, t: number): number;
  /** True when any precipitation falls anywhere between epoch seconds `from` and `to`. */
  precipitates(from: number, to: number): boolean;
}

const windU = (speed: number, fromDeg: number): number => -speed * Math.sin((fromDeg * Math.PI) / 180);
const windV = (speed: number, fromDeg: number): number => -speed * Math.cos((fromDeg * Math.PI) / 180);

/** Constant manual conditions: no lapse, no sun, ISA pressure at the route elevation. */
export function constantField(c: Conditions): WeatherField {
  const dew = dewPointFromHumidity(c.temperatureC, c.humidityPct);
  const rh = relativeHumidity(c.temperatureC, dew);
  const u = windU(c.windMps, c.windFromDeg);
  const v = windV(c.windMps, c.windFromDeg);
  const snow = snowShare(wetBulb(c.temperatureC, rh));
  return {
    source: null,
    start: -Infinity,
    end: Infinity,
    varies: false,
    at(_s, _t, ele, out) {
      out.temp = c.temperatureC;
      out.dew = dew;
      out.rh = rh;
      out.pressure = standardPressure(ele);
      out.windU = u;
      out.windV = v;
      out.windSpeed = c.windMps;
      out.precip = c.rainMmH;
      out.snow = snow;
      out.cloud = c.rainMmH > 0 ? 100 : 50;
    },
    sun(_s, _t, out) {
      out.sunElev = 0;
      out.shortwave = 0;
    },
    pressureTrend: () => 1013.25,
    precipitates: () => c.rainMmH > 0,
  };
}

const T = 0;
const TD = 1;
const U = 2;
const V = 3;
const RAIN = 4;
const CLEAR = 5;
const CLOUD = 6;
const PRESS = 7;
const VARIABLES = 8;

/** Highest clear-sky scaling of sin(sun elevation), W/m² (keeps dawn hours with a tiny mean elevation bounded). */
const MAX_CLEARNESS = 1100;

const finiteOr = (x: number | null | undefined, fallback: number): number => (typeof x === 'number' && Number.isFinite(x) ? x : fallback);

/** Fills gaps by holding the nearest valid slot; all-empty rows take the fallback. */
function holdGaps(row: Float64Array, fallback: number): void {
  let last = -1;
  for (let k = 0; k < row.length; k++) {
    if (Number.isNaN(row[k])) continue;
    if (last === -1) row.fill(row[k], 0, k);
    else if (k - last > 1) {
      const mid = (last + k) >> 1;
      row.fill(row[last], last + 1, mid + 1);
      row.fill(row[k], mid + 1, k);
    }
    last = k;
  }
  if (last === -1) row.fill(fallback);
  else row.fill(row[last], last + 1);
}

/** Series valid enough to build a field from: at least one point, one slot and a finite time axis. */
export function isUsableSeries(s: unknown): s is WeatherSeries {
  const x = s as WeatherSeries | null;
  if (!x || x.v !== 1 || !Array.isArray(x.points) || x.points.length === 0 || !Number.isFinite(x.t0) || !(x.stepS > 0)) return false;
  const slots = Array.isArray(x.temperature) && Array.isArray(x.temperature[0]) ? x.temperature[0].length : 0;
  if (slots === 0) return false;
  const rows = [x.temperature, x.dewPoint, x.precipitation, x.windSpeed, x.windFrom, x.surfacePressure, x.shortwave, x.cloudCover];
  return rows.every((r) => Array.isArray(r) && r.length === x.points.length && r.every((row) => Array.isArray(row) && row.length === slots));
}

/**
 * Field over a series. Space: linear in route distance between the sampled points (their values already refer to their
 * own elevation), then lapse-corrected to the route elevation (T 6.5 K/km, dew point 6.0 K/km capped at T, pressure
 * hypsometric). Time: instant variables linear between slots; wind interpolated as a vector; precipitation a constant
 * rate over the hour it was summed over; irradiance as the hour's clearness scaling times the instantaneous
 * sin(sun elevation), so it is zero below the horizon; pressure tendencies monotone cubic (Fritsch & Carlson 1980).
 * Pinned quantities take the manual value everywhere; gaps hold the nearest slot or take the manual value.
 */
export function createWeatherField(series: WeatherSeries, fallback: Conditions, pinned: ReadonlyArray<WeatherPin> = []): WeatherField {
  return new SeriesField(series, fallback, pinned);
}

class SeriesField implements WeatherField {
  readonly source: WeatherSource;
  readonly analogYear?: number;
  readonly start: number;
  readonly end: number;
  readonly varies = true;
  private readonly np: number;
  private readonly ns: number;
  private readonly t0: number;
  private readonly step: number;
  private readonly d: Float64Array;
  private readonly ele: Float64Array;
  private readonly lat: Float64Array;
  private readonly lon: Float64Array;
  private readonly data: Float64Array[];
  /** Pressure tangents per slot (hPa per slot). */
  private readonly slope: Float64Array;
  private readonly pinT: boolean;
  private readonly pinWind: boolean;
  private readonly pinRain: boolean;
  private readonly manualDew: number;
  private readonly c: Conditions;
  private j = 0;
  private w = 0;

  constructor(s: WeatherSeries, c: Conditions, pinned: ReadonlyArray<WeatherPin>) {
    const order = s.points.map((p, i) => [finiteOr(p.d, 0), i] as const).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    this.np = order.length;
    this.ns = s.temperature[0].length;
    this.t0 = s.t0;
    this.step = s.stepS;
    this.source = s.source;
    if (s.analogYear !== undefined) this.analogYear = s.analogYear;
    this.start = s.t0;
    this.end = s.t0 + (this.ns - 1) * s.stepS;
    this.c = c;
    this.pinT = pinned.includes('temperature');
    this.pinWind = pinned.includes('wind');
    this.pinRain = pinned.includes('precipitation');
    this.manualDew = dewPointFromHumidity(c.temperatureC, c.humidityPct);
    const np = this.np;
    const ns = this.ns;
    this.d = new Float64Array(np);
    this.ele = new Float64Array(np);
    this.lat = new Float64Array(np);
    this.lon = new Float64Array(np);
    this.data = Array.from({ length: VARIABLES }, () => new Float64Array(np * ns));
    this.slope = new Float64Array(np * ns);
    const stepH = s.stepS / 3600;
    order.forEach(([d, src], p) => {
      const point = s.points[src];
      this.d[p] = p > 0 ? Math.max(d, this.d[p - 1]) : d;
      this.ele[p] = finiteOr(point.ele, 0);
      this.lat[p] = finiteOr(point.lat, 0);
      this.lon[p] = finiteOr(point.lon, 0);
      const row = (values: Array<number | null>, fallbackValue: number, scale = 1): Float64Array => {
        const out = new Float64Array(ns);
        for (let k = 0; k < ns; k++) out[k] = typeof values[k] === 'number' && Number.isFinite(values[k]) ? (values[k] as number) * scale : NaN;
        holdGaps(out, fallbackValue);
        return out;
      };
      const temp = row(s.temperature[src], c.temperatureC);
      const dew = row(s.dewPoint[src], this.manualDew);
      const speed = row(s.windSpeed[src], c.windMps);
      const from = row(s.windFrom[src], c.windFromDeg);
      const rain = row(s.precipitation[src], c.rainMmH * stepH, 1 / stepH);
      const shortwave = row(s.shortwave[src], 0);
      const cloud = row(s.cloudCover[src], 50);
      const pressure = row(s.surfacePressure[src], standardPressure(this.ele[p]));
      const base = p * ns;
      for (let k = 0; k < ns; k++) {
        this.data[T][base + k] = temp[k];
        this.data[TD][base + k] = Math.min(dew[k], temp[k]);
        this.data[U][base + k] = windU(Math.max(0, speed[k]), from[k]);
        this.data[V][base + k] = windV(Math.max(0, speed[k]), from[k]);
        this.data[RAIN][base + k] = Math.max(0, rain[k]);
        this.data[CLOUD][base + k] = cloud[k];
        this.data[PRESS][base + k] = pressure[k];
        // Mean of sin⁺(sun elevation) over the hour the irradiance was averaged over (six samples).
        let mean = 0;
        const end = s.t0 + k * s.stepS;
        for (let q = 0; q < 6; q++) mean += Math.max(0, Math.sin((sunElevationDeg(this.lat[p], this.lon[p], end - ((q + 0.5) * s.stepS) / 6) * Math.PI) / 180)) / 6;
        this.data[CLEAR][base + k] = mean > 1e-3 ? Math.min(MAX_CLEARNESS, Math.max(0, shortwave[k]) / mean) : 0;
      }
      monotoneSlopes(this.data[PRESS], this.slope, base, ns);
    });
  }

  /** Spatial bracket for s: sets j (left point) and w (weight of the right point). */
  private locate(s: number): void {
    const { d, np } = this;
    if (np < 2) {
      this.j = 0;
      this.w = 0;
      return;
    }
    let j = this.j;
    while (j > 0 && s < d[j]) j--;
    while (j < np - 2 && d[j + 1] <= s) j++;
    this.j = j;
    const span = d[j + 1] - d[j];
    const w = span > 0 ? (s - d[j]) / span : 0;
    this.w = w < 0 ? 0 : w > 1 ? 1 : w;
  }

  /** Value of variable `v` at slot position (k, f) and the current spatial bracket. */
  private value(v: number, k: number, f: number): number {
    const a = this.data[v];
    const ns = this.ns;
    const k1 = k + 1 < ns ? k + 1 : k;
    const left = this.j * ns;
    const l = a[left + k] + (a[left + k1] - a[left + k]) * f;
    if (this.w === 0) return l;
    const right = left + ns;
    const r = a[right + k] + (a[right + k1] - a[right + k]) * f;
    return l + (r - l) * this.w;
  }

  at(s: number, t: number, ele: number, out: Ambient): void {
    this.locate(s);
    const u = (t - this.t0) / this.step;
    const last = this.ns - 1;
    const k = u <= 0 ? 0 : u >= last ? last : Math.floor(u);
    const f = u <= 0 || u >= last ? 0 : u - k;
    const baseEle = this.ele[this.j] + (this.ele[Math.min(this.np - 1, this.j + 1)] - this.ele[this.j]) * this.w;
    const dz = (Number.isFinite(ele) ? ele : baseEle) - baseEle;
    let temp: number;
    let dew: number;
    if (this.pinT) {
      temp = this.c.temperatureC;
      dew = this.manualDew;
    } else {
      temp = this.value(T, k, f) - LAPSE.temperature * dz;
      dew = Math.min(temp, this.value(TD, k, f) - LAPSE.dewPoint * dz);
    }
    out.temp = temp;
    out.dew = dew;
    out.rh = relativeHumidity(temp, dew);
    out.pressure = this.value(PRESS, k, f) * Math.exp(-dz / scaleHeight(temp));
    if (this.pinWind) {
      out.windU = windU(this.c.windMps, this.c.windFromDeg);
      out.windV = windV(this.c.windMps, this.c.windFromDeg);
    } else {
      out.windU = this.value(U, k, f);
      out.windV = this.value(V, k, f);
    }
    out.windSpeed = Math.hypot(out.windU, out.windV);
    if (this.pinRain) {
      out.precip = this.c.rainMmH;
    } else {
      // The sum at slot k covers (t_{k−1}, t_k]: a constant rate over that hour.
      const hour = u <= 0 ? 0 : u >= last ? last : Math.ceil(u);
      out.precip = this.value(RAIN, hour, 0);
    }
    out.snow = out.precip > 0 ? snowShare(wetBulb(temp, out.rh)) : 0;
    out.cloud = this.value(CLOUD, k, f);
  }

  sun(s: number, t: number, out: Ambient): void {
    this.locate(s);
    const j1 = Math.min(this.np - 1, this.j + 1);
    const lat = this.lat[this.j] + (this.lat[j1] - this.lat[this.j]) * this.w;
    const lon = this.lon[this.j] + (this.lon[j1] - this.lon[this.j]) * this.w;
    const elev = sunElevationDeg(lat, lon, t);
    out.sunElev = elev;
    if (elev <= 0) {
      out.shortwave = 0;
      return;
    }
    // Clearness of hour k belongs to its middle, t_k − step/2; interpolate between middles.
    const u = (t - this.t0) / this.step + 0.5;
    const last = this.ns - 1;
    const k = u <= 0 ? 0 : u >= last ? last : Math.floor(u);
    const f = u <= 0 || u >= last ? 0 : u - k;
    out.shortwave = this.value(CLEAR, k, f) * Math.sin((elev * Math.PI) / 180);
  }

  precipitates(from: number, to: number): boolean {
    if (this.pinRain) return this.c.rainMmH > 0;
    const last = this.ns - 1;
    const a = Math.max(0, Math.min(last, Math.floor((from - this.t0) / this.step)));
    const b = Math.max(0, Math.min(last, Math.ceil((to - this.t0) / this.step) + 1));
    const rain = this.data[RAIN];
    for (let p = 0; p < this.np; p++) for (let k = a; k <= b; k++) if (rain[p * this.ns + k] > 0) return true;
    return false;
  }

  pressureTrend(s: number, t: number): number {
    this.locate(s);
    const u = (t - this.t0) / this.step;
    const last = this.ns - 1;
    const k = u <= 0 ? 0 : u >= last ? Math.max(0, last - 1) : Math.floor(u);
    const f = u <= 0 ? 0 : u >= last ? (last > 0 ? 1 : 0) : u - k;
    const at = (p: number): number => {
      const base = p * this.ns;
      const y = this.data[PRESS];
      if (this.ns < 2) return y[base];
      const f2 = f * f;
      const f3 = f2 * f;
      return (
        (2 * f3 - 3 * f2 + 1) * y[base + k] +
        (f3 - 2 * f2 + f) * this.slope[base + k] +
        (-2 * f3 + 3 * f2) * y[base + k + 1] +
        (f3 - f2) * this.slope[base + k + 1]
      );
    };
    const left = at(this.j);
    return this.w === 0 ? left : left + (at(this.j + 1) - left) * this.w;
  }
}

/** Fritsch–Carlson tangents for y[base … base+n) on a unit grid, written to m[base …]. */
function monotoneSlopes(y: Float64Array, m: Float64Array, base: number, n: number): void {
  if (n < 2) return;
  for (let k = 0; k < n; k++) {
    const before = k > 0 ? y[base + k] - y[base + k - 1] : NaN;
    const after = k < n - 1 ? y[base + k + 1] - y[base + k] : NaN;
    if (Number.isNaN(before)) m[base + k] = after;
    else if (Number.isNaN(after)) m[base + k] = before;
    else m[base + k] = before * after <= 0 ? 0 : 0.5 * (before + after);
  }
  for (let k = 0; k < n - 1; k++) {
    const delta = y[base + k + 1] - y[base + k];
    if (delta === 0) {
      m[base + k] = 0;
      m[base + k + 1] = 0;
      continue;
    }
    const a = m[base + k] / delta;
    const b = m[base + k + 1] / delta;
    const r = a * a + b * b;
    if (r > 9) {
      const tau = 3 / Math.sqrt(r);
      m[base + k] = tau * a * delta;
      m[base + k + 1] = tau * b * delta;
    }
  }
}
