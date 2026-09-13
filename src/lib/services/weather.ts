// Weather along a route from Open-Meteo: which endpoint serves a date, request URLs, parsing, merging, the analog year
// for far dates, and a cached fetcher. Epochs are the only time axis: the provider's utc_offset_seconds is the zone's
// offset today, not on the requested date (Zurich in January comes back as +2 h), so it is never read.
import type { WeatherPoint, WeatherSeries, WeatherSource } from '../types';
import { HttpError, TimeoutError, abortError, fetchJson, isAbort, throwIfAborted, type TimedInit } from './http';
import { LruCache } from './lru';
import { openMeteoQueue } from './openMeteo';

export const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
export const HISTORICAL_FORECAST_URL = 'https://historical-forecast-api.open-meteo.com/v1/forecast';
export const ARCHIVE_URL = 'https://archive-api.open-meteo.com/v1/archive';
/** 10 variables = one call unit per point per ≤ 2 weeks (Open-Meteo pricing). */
export const HOURLY_VARIABLES = [
  'temperature_2m',
  'dew_point_2m',
  'precipitation',
  'snowfall',
  'wind_speed_10m',
  'wind_direction_10m',
  'wind_gusts_10m',
  'surface_pressure',
  'shortwave_radiation',
  'cloud_cover',
] as const;
export const MAX_WEATHER_POINTS = 12;
/** Last forecast day after today (the API serves 16 days including today). */
export const FORECAST_DAYS_AHEAD = 15;
/** Oldest day the forecast API is asked for; its past hours are filled back about two months. */
export const FORECAST_DAYS_BACK = 60;
export const HISTORICAL_FORECAST_FROM = '2022-01-01';
export const CLIMATOLOGY_YEARS = 10;
/** Per request, body included, ms. */
export const WEATHER_TIMEOUT_MS = 10_000;
/** After HTTP 429 no request is sent for this long ("Please try again in one minute"), ms. */
export const RATE_LIMIT_COOLDOWN_MS = 60_000;
/** Gaps up to this many slots are filled from the nearest valid hour. */
export const GAP_FILL_SLOTS = 3;
/** Bumped whenever the variables or the parsing change, so cached series from older code are not reused. */
export const WEATHER_KEY_VERSION = 'wx1';

export const WEATHER_SOURCES: readonly WeatherSource[] = ['forecast', 'historical-forecast', 'archive', 'climatology'];

/** Series fields in the order of HOURLY_VARIABLES. */
export const WEATHER_FIELDS = [
  'temperature',
  'dewPoint',
  'precipitation',
  'snowfall',
  'windSpeed',
  'windFrom',
  'windGust',
  'surfacePressure',
  'shortwave',
  'cloudCover',
] as const;
export type WeatherField = (typeof WEATHER_FIELDS)[number];

/** Values per unit the series keeps: T 0.1 °C, precipitation 0.1 mm, snowfall 0.01 cm, wind 0.1 m/s, 1°, 0.1 hPa, 1 W/m², 1 %. */
const QUANTUM: Readonly<Record<WeatherField, number>> = {
  temperature: 10,
  dewPoint: 10,
  precipitation: 10,
  snowfall: 100,
  windSpeed: 10,
  windFrom: 1,
  windGust: 10,
  surfacePressure: 10,
  shortwave: 1,
  cloudCover: 1,
};
/** Fields valid at an instant, blended where a far-date series takes over from the forecast. */
const INSTANT: ReadonlySet<WeatherField> = new Set(['temperature', 'dewPoint', 'windSpeed', 'windGust', 'surfacePressure', 'cloudCover']);

const STEP_S = 3600;
const DAY_S = 86400;
/** Days before the start the window reserves for spin-up (see weatherWindow). */
const SPIN_UP_DAYS = 2;

export interface WeatherRequest {
  points: WeatherPoint[];
  /** Epoch seconds to cover, spin-up included. */
  from: number;
  to: number;
  /** Epoch ms; chooses the endpoints (injected in tests). */
  now: number;
}

export type WeatherPlanStep =
  | { source: 'forecast' | 'historical-forecast' | 'archive'; startDate: string; endDate: string }
  | { source: 'climatology'; years: number[]; startDate: string; endDate: string };

export type WeatherErrorKind = 'rate-limit' | 'range' | 'http' | 'parse' | 'network' | 'timeout' | 'offline';

export class WeatherError extends Error {
  readonly kind: WeatherErrorKind;
  constructor(kind: WeatherErrorKind, message: string) {
    super(message);
    this.name = 'WeatherError';
    this.kind = kind;
  }
}

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const round2 = (x: number): number => Math.round(x * 100) / 100;
const round10 = (x: number): number => Math.round(x / 10) * 10;
const dayOf = (epochS: number): number => Math.floor(epochS / DAY_S) * DAY_S;

/** 'YYYY-MM-DD' of the UTC day containing `epochS`. */
export function isoDate(epochS: number): string {
  return new Date(dayOf(epochS) * 1000).toISOString().slice(0, 10);
}

function parseIsoDate(date: string): number {
  return Date.parse(`${date}T00:00:00Z`) / 1000;
}

const HISTORICAL_FORECAST_FROM_S = parseIsoDate(HISTORICAL_FORECAST_FROM);

/** The hourly grid a request fills: from the hour of `from` through `to`. */
export function weatherGrid(req: Pick<WeatherRequest, 'from' | 'to'>): { t0: number; slots: number } {
  const t0 = Math.floor(req.from / STEP_S) * STEP_S;
  return { t0, slots: Math.max(1, Math.floor((req.to - t0) / STEP_S) + 1) };
}

/** Same month and day `years` later; 29 February becomes the 28th in a common year. */
function shiftYears(epochDay: number, years: number): number {
  const d = new Date(epochDay * 1000);
  const year = d.getUTCFullYear() + years;
  const month = d.getUTCMonth();
  let day = d.getUTCDate();
  if (month === 1 && day === 29 && new Date(Date.UTC(year, 1, 29)).getUTCMonth() !== 1) day = 28;
  return Date.UTC(year, month, day) / 1000;
}

/** Whole-day shift from the target dates to the same dates in `year`. */
function yearShift(startDate: string, year: number): number {
  const start = parseIsoDate(startDate);
  return shiftYears(start, year - new Date(start * 1000).getUTCFullYear()) - start;
}

/** The most recent complete past years whose same dates (padding included) are already in the archive. */
function climatologyYears(startDay: number, lastDay: number, today: number): number[] {
  const target = new Date(startDay * 1000).getUTCFullYear();
  const years: number[] = [];
  for (let year = target - 1; year >= 1950 && years.length < CLIMATOLOGY_YEARS; year--) {
    const shift = yearShift(isoDate(startDay), year);
    if (lastDay + DAY_S + shift <= today) years.push(year);
  }
  return years.reverse();
}

/**
 * Endpoints covering the request, by date class (UTC days, today from `now`). The window is read as weatherWindow
 * builds it: two spin-up days, the activity days, one padding day. Activity starting before 2022 → archive (ERA5 and
 * IFS reanalysis); before yesterday → historical forecast (the same model family a forecast used, stitched from the
 * first hours of each run); from yesterday to 15 days ahead → forecast, with any activity days past its horizon from the
 * analog year; later → the analog year alone. Steps are in priority order for merging.
 */
export function planWeather(req: WeatherRequest): WeatherPlanStep[] {
  const today = dayOf(Math.floor(req.now / 1000));
  const firstDay = dayOf(req.from);
  const lastDay = Math.max(firstDay, dayOf(req.to - 1));
  const activityFirst = Math.min(lastDay, firstDay + SPIN_UP_DAYS * DAY_S);
  const activityLast = Math.max(activityFirst, lastDay - DAY_S);
  const forecastFirst = today - DAY_S;
  const forecastLast = today + FORECAST_DAYS_AHEAD * DAY_S;
  const plain = (source: 'forecast' | 'historical-forecast' | 'archive', a: number, b: number): WeatherPlanStep => ({
    source,
    startDate: isoDate(a),
    endDate: isoDate(b),
  });
  const climatology = (a: number, b: number): WeatherPlanStep => ({
    source: 'climatology',
    years: climatologyYears(a, b, today),
    startDate: isoDate(a),
    endDate: isoDate(b),
  });

  if (activityFirst > forecastLast) return [climatology(firstDay, lastDay)];
  if (activityFirst >= forecastFirst) {
    const recentFrom = Math.max(firstDay, today - FORECAST_DAYS_BACK * DAY_S);
    const steps: WeatherPlanStep[] = [plain('forecast', recentFrom, Math.min(lastDay, forecastLast))];
    if (firstDay < recentFrom) {
      steps.push(plain(firstDay >= HISTORICAL_FORECAST_FROM_S ? 'historical-forecast' : 'archive', firstDay, recentFrom - DAY_S));
    }
    if (activityLast > forecastLast) steps.push(climatology(forecastLast + DAY_S, lastDay));
    return steps;
  }
  if (activityFirst < HISTORICAL_FORECAST_FROM_S) return [plain('archive', firstDay, lastDay)];
  return [plain('historical-forecast', firstDay, lastDay)];
}

const BASE_URL: Readonly<Record<WeatherSource, string>> = {
  forecast: FORECAST_URL,
  'historical-forecast': HISTORICAL_FORECAST_URL,
  archive: ARCHIVE_URL,
  climatology: ARCHIVE_URL,
};

const COMMON_PARAMS = `&hourly=${HOURLY_VARIABLES.join(',')}&timezone=auto&timeformat=unixtime&wind_speed_unit=ms`;

/**
 * Request URL for a plan step: every point in one request with its route elevation (the provider lapses temperature
 * and pressure to it and picks a grid cell of similar height), local time zone detected, epoch timestamps, m/s. Dates
 * are padded one day each side because the provider cuts days in the zone's current offset; the forecast is clamped to
 * the dates it serves and the archive to today. Climatology repeats each point once per year with per-location dates.
 */
export function weatherUrl(step: WeatherPlanStep, req: WeatherRequest): string {
  const today = dayOf(Math.floor(req.now / 1000));
  const start = parseIsoDate(step.startDate) - DAY_S;
  const end = parseIsoDate(step.endDate) + DAY_S;
  const base = BASE_URL[step.source];
  if (step.source === 'climatology') {
    const lat: string[] = [];
    const lon: string[] = [];
    const ele: string[] = [];
    const starts: string[] = [];
    const ends: string[] = [];
    for (const year of step.years) {
      const shift = yearShift(step.startDate, year);
      for (const p of req.points) {
        lat.push(String(round2(p.lat)));
        lon.push(String(round2(p.lon)));
        ele.push(String(round10(p.ele)));
        starts.push(isoDate(start + shift));
        ends.push(isoDate(Math.min(end + shift, today)));
      }
    }
    return (
      `${base}?latitude=${lat.join(',')}&longitude=${lon.join(',')}&elevation=${ele.join(',')}${COMMON_PARAMS}` +
      `&start_date=${starts.join(',')}&end_date=${ends.join(',')}&models=best_match`
    );
  }
  let from = start;
  let to = end;
  if (step.source === 'forecast') {
    from = Math.max(from, today - 92 * DAY_S);
    to = Math.min(to, today + FORECAST_DAYS_AHEAD * DAY_S);
  } else if (step.source === 'archive') {
    to = Math.min(to, today);
  }
  const lat = req.points.map((p) => round2(p.lat)).join(',');
  const lon = req.points.map((p) => round2(p.lon)).join(',');
  const ele = req.points.map((p) => round10(p.ele)).join(',');
  return (
    `${base}?latitude=${lat}&longitude=${lon}&elevation=${ele}${COMMON_PARAMS}&start_date=${isoDate(from)}&end_date=${isoDate(Math.max(from, to))}` +
    (step.source === 'archive' ? '&models=best_match' : '')
  );
}

/** Cache and simulation key: rounded points (not their distance along the route), whole days, source classes, code version. */
export function weatherKey(req: WeatherRequest): string {
  const points = req.points.map((p) => `${round2(p.lat)},${round2(p.lon)},${round10(p.ele)}`).join(';');
  const sources = planWeather(req)
    .map((s) => s.source)
    .join('+');
  return `${WEATHER_KEY_VERSION}|${points}|${isoDate(req.from)}/${isoDate(req.to - 1)}|${sources}`;
}

function emptySeries(req: WeatherRequest, source: WeatherSource, t0: number, slots: number, fetchedAt: number, timezone: string): WeatherSeries {
  const matrix = () => req.points.map(() => new Array<number | null>(slots).fill(null));
  return {
    v: 1,
    key: weatherKey(req),
    source,
    timezone,
    t0,
    stepS: STEP_S,
    points: req.points.map((p) => ({ ...p })),
    temperature: matrix(),
    dewPoint: matrix(),
    precipitation: matrix(),
    snowfall: matrix(),
    windSpeed: matrix(),
    windFrom: matrix(),
    windGust: matrix(),
    surfacePressure: matrix(),
    shortwave: matrix(),
    cloudCover: matrix(),
    fetchedAt,
  };
}

function quantise(field: WeatherField, value: number): number {
  const q = QUANTUM[field];
  const v = Math.round(value * q) / q;
  if (field === 'windFrom') return ((v % 360) + 360) % 360;
  return v === 0 ? 0 : v;
}

const RANGE_REASON = /out of allowed range/i;

function providerError(reason: unknown): WeatherError {
  const text = typeof reason === 'string' ? reason : 'Open-Meteo reported an error';
  return new WeatherError(RANGE_REASON.test(text) ? 'range' : 'parse', `Open-Meteo: ${text}`);
}

/** Response locations in request order (location_id is absent on the first element, 1, 2, … after it). */
function responseElements(json: unknown): Json[] {
  if (isObject(json) && json.error) throw providerError(json.reason);
  const list = Array.isArray(json) ? json : [json];
  const indexed = list.map((e, i) => {
    if (!isObject(e) || !isObject(e.hourly) || !Array.isArray((e.hourly as Json).time)) {
      if (isObject(e) && e.error) throw providerError(e.reason);
      throw new WeatherError('parse', 'Open-Meteo: a location has no hourly data');
    }
    return { e, i, id: finite(e.location_id) ? e.location_id : 0 };
  });
  indexed.sort((a, b) => a.id - b.id || a.i - b.i);
  return indexed.map((x) => x.e);
}

function fillLocation(series: WeatherSeries, point: number, element: Json): void {
  const hourly = element.hourly as Json;
  const time = hourly.time as unknown[];
  for (let f = 0; f < WEATHER_FIELDS.length; f++) {
    const field = WEATHER_FIELDS[f];
    const values = hourly[HOURLY_VARIABLES[f]];
    if (!Array.isArray(values)) continue;
    const row = series[field][point];
    for (let k = 0; k < time.length; k++) {
      const epoch = time[k];
      if (!finite(epoch)) continue;
      const slot = (epoch - series.t0) / series.stepS;
      if (!Number.isInteger(slot) || slot < 0 || slot >= row.length) continue;
      const v = values[k];
      row[slot] = finite(v) ? quantise(field, v) : null;
    }
  }
}

const timezoneOf = (elements: Json[]): string => (typeof elements[0]?.timezone === 'string' ? (elements[0].timezone as string) : '');

/**
 * Open-Meteo JSON (one object or an array) → series on the request's hourly grid, quantised, with nulls where the
 * provider has none. A provider error body becomes WeatherError 'range' (dates it does not serve) or 'parse'.
 * A climatology step is reduced to its analog year.
 */
export function parseOpenMeteoWeather(json: unknown, req: WeatherRequest, step: WeatherPlanStep, fetchedAt: number): WeatherSeries {
  if (step.source === 'climatology') return analogYear(parseClimatology(json, req, step, fetchedAt), req);
  const elements = responseElements(json);
  if (elements.length !== req.points.length) {
    throw new WeatherError('parse', `Open-Meteo: expected ${req.points.length} locations, got ${elements.length}`);
  }
  const { t0, slots } = weatherGrid(req);
  const series = emptySeries(req, step.source, t0, slots, fetchedAt, timezoneOf(elements));
  elements.forEach((e, p) => fillLocation(series, p, e));
  return series;
}

/** A climatology response → one series per year, each on the request grid moved to that year's dates. */
export function parseClimatology(
  json: unknown,
  req: WeatherRequest,
  step: Extract<WeatherPlanStep, { source: 'climatology' }>,
  fetchedAt: number,
): WeatherSeries[] {
  const elements = responseElements(json);
  const n = req.points.length;
  if (n === 0 || elements.length !== step.years.length * n) {
    throw new WeatherError('parse', `Open-Meteo: expected ${step.years.length * n} locations, got ${elements.length}`);
  }
  const { t0, slots } = weatherGrid(req);
  const timezone = timezoneOf(elements);
  return step.years.map((year, y) => {
    const series = emptySeries(req, 'climatology', t0 + yearShift(step.startDate, year), slots, fetchedAt, timezone);
    series.analogYear = year;
    for (let p = 0; p < n; p++) fillLocation(series, p, elements[y * n + p]);
    return series;
  });
}

function median(values: number[]): number {
  const s = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (s.length === 0) return NaN;
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : 0.5 * (s[m - 1] + s[m]);
}

function meanOf(rows: Array<Array<number | null>>): number {
  let sum = 0;
  let count = 0;
  for (const row of rows) {
    for (const v of row) {
      if (v === null) continue;
      sum += v;
      count++;
    }
  }
  return count > 0 ? sum / count : NaN;
}

/**
 * The past year whose weather stands in for a far date: the one whose mean temperature, daily precipitation and mean
 * wind over the window (all points) lie closest to the multi-year median, each difference scaled by the median
 * absolute deviation across years; ties go to the most recent year. A real year keeps the within-day dynamics that a
 * per-hour median would smooth away. Its epochs move by whole days onto the requested dates.
 */
export function analogYear(years: WeatherSeries[], req: WeatherRequest): WeatherSeries {
  if (years.length === 0) throw new WeatherError('parse', 'Open-Meteo: no past years to choose a typical one from');
  const stats = years.map((s) => {
    const precipitation = meanOf(s.precipitation);
    return [meanOf(s.temperature), Number.isFinite(precipitation) ? precipitation * 24 : NaN, meanOf(s.windSpeed)];
  });
  const centre = [0, 1, 2].map((m) => median(stats.map((x) => x[m])));
  const scale = [0, 1, 2].map((m) => {
    const dev = median(stats.map((x) => Math.abs(x[m] - centre[m])));
    return dev > 1e-9 ? dev : 1;
  });
  let best = 0;
  let bestDistance = Infinity;
  years.forEach((s, i) => {
    let distance = 0;
    for (let m = 0; m < 3; m++) if (Number.isFinite(stats[i][m]) && Number.isFinite(centre[m])) distance += Math.abs(stats[i][m] - centre[m]) / scale[m];
    const recent = (s.analogYear ?? i) >= (years[best].analogYear ?? best);
    if (distance < bestDistance - 1e-12 || (Math.abs(distance - bestDistance) <= 1e-12 && recent)) {
      best = i;
      bestDistance = distance;
    }
  });
  const chosen = years[best];
  const copy = (rows: Array<Array<number | null>>) => rows.map((r) => r.slice());
  const out: WeatherSeries = { ...chosen, points: chosen.points.map((p) => ({ ...p })), t0: weatherGrid(req).t0, source: 'climatology', key: weatherKey(req) };
  for (const field of WEATHER_FIELDS) out[field] = copy(chosen[field]);
  out.analogYear = chosen.analogYear ?? new Date(chosen.t0 * 1000).getUTCFullYear();
  return out;
}

/**
 * Joins parts on the epoch axis: per variable, point and hour the first part with a value wins (parts are in priority
 * order). Where an analog year takes over after the forecast ends, instant variables blend from the last forecast hour
 * over three hours. Remaining gaps take the nearest valid hour within three hours; longer gaps stay null.
 */
export function mergeWeather(parts: WeatherSeries[], req: WeatherRequest): WeatherSeries {
  if (parts.length === 0) throw new WeatherError('parse', 'Open-Meteo: nothing to merge');
  const step = STEP_S;
  let t0 = Infinity;
  let end = -Infinity;
  for (const s of parts) {
    const slotsOf = s.temperature[0]?.length ?? 0;
    t0 = Math.min(t0, s.t0);
    end = Math.max(end, s.t0 + (slotsOf - 1) * step);
  }
  const slots = Math.max(1, Math.round((end - t0) / step) + 1);
  const first = parts[0];
  const out = emptySeries(
    { ...req, points: req.points.length === first.points.length ? req.points : first.points },
    first.source,
    t0,
    slots,
    Math.max(...parts.map((s) => s.fetchedAt)),
    parts.find((s) => s.timezone)?.timezone ?? '',
  );
  out.key = first.key;
  const analog = parts.find((s) => s.source === 'climatology' && s.analogYear !== undefined);
  if (analog) out.analogYear = analog.analogYear;
  const nPoints = out.points.length;

  for (const field of WEATHER_FIELDS) {
    for (let p = 0; p < nPoints; p++) {
      const row = out[field][p];
      const from = new Int8Array(slots).fill(-1);
      for (let k = 0; k < slots; k++) {
        const epoch = t0 + k * step;
        for (let i = 0; i < parts.length; i++) {
          const src = parts[i];
          const idx = (epoch - src.t0) / step;
          const v = Number.isInteger(idx) ? src[field][p]?.[idx] : undefined;
          if (finite(v)) {
            row[k] = v;
            from[k] = i;
            break;
          }
        }
      }
      if (INSTANT.has(field) || field === 'windFrom') blendIntoAnalog(row, from, parts, field);
      fillGaps(row);
    }
  }
  return out;
}

/** The three hours after the last forecast hour move from the forecast value toward the analog year (¼, ½, ¾). */
function blendIntoAnalog(row: Array<number | null>, from: Int8Array, parts: WeatherSeries[], field: WeatherField): void {
  let lastOwn = -1;
  for (let k = 0; k < row.length; k++) {
    const part = from[k] >= 0 ? parts[from[k]] : null;
    if (part && part.source !== 'climatology') {
      lastOwn = k;
      continue;
    }
    if (!part || lastOwn < 0 || k - lastOwn > GAP_FILL_SLOTS) continue;
    const base = row[lastOwn] as number;
    const w = (k - lastOwn) / (GAP_FILL_SLOTS + 1);
    const v = row[k] as number;
    if (field === 'windFrom') {
      if (w < 0.5) row[k] = base;
    } else {
      row[k] = Math.round((base + (v - base) * w) * QUANTUM[field]) / QUANTUM[field];
    }
  }
}

/** Nulls take the nearest valid value within GAP_FILL_SLOTS (earlier first on ties), read from the unfilled row. */
function fillGaps(row: Array<number | null>): void {
  const original = row.slice();
  for (let k = 0; k < row.length; k++) {
    if (original[k] !== null) continue;
    for (let d = 1; d <= GAP_FILL_SLOTS; d++) {
      const before = k - d >= 0 ? original[k - d] : null;
      if (before !== null) {
        row[k] = before;
        break;
      }
      const after = k + d < row.length ? original[k + d] : null;
      if (after !== null) {
        row[k] = after;
        break;
      }
    }
  }
}

function hasGaps(series: WeatherSeries): boolean {
  return WEATHER_FIELDS.some((field) => series[field].some((row) => row.some((v) => v === null)));
}

export interface WeatherFetchOptions {
  signal?: AbortSignal;
  /** Skip the in-memory cache (the "Update forecast" button). */
  force?: boolean;
}

export type WeatherFetcher = (req: WeatherRequest, options?: WeatherFetchOptions) => Promise<WeatherSeries>;

/** JSON GET with timeout and abort (fetchJson fits). */
export type WeatherJsonFetch = (url: string, init?: TimedInit) => Promise<unknown>;

export interface WeatherFetcherOptions {
  fetchJson?: WeatherJsonFetch;
  /** Per request, body included. Default WEATHER_TIMEOUT_MS. */
  timeoutMs?: number;
  /** Series kept in memory by key. Default 16. */
  cacheSize?: number;
  /** Clock for fetchedAt and the rate-limit cool-down, epoch ms. */
  now?: () => number;
  /** False skips the network (defaults to navigator.onLine where it exists). */
  online?: () => boolean;
}

const NEXT_SOURCE: Partial<Record<WeatherSource, 'historical-forecast' | 'archive'>> = { forecast: 'historical-forecast', 'historical-forecast': 'archive' };

/**
 * Fetcher: one request per plan step carrying every point, through the host's queue. HTTP 429 fails with 'rate-limit'
 * and nothing is sent for a minute; dates a host does not serve fall back to the next class (forecast → historical
 * forecast → archive); gaps in an archived forecast are filled from the archive once; an analog-year step after the
 * forecast is best effort. Aborts propagate unchanged.
 */
export function createWeatherFetcher(options: WeatherFetcherOptions = {}): WeatherFetcher {
  const getJson: WeatherJsonFetch = options.fetchJson ?? fetchJson;
  const timeoutMs = options.timeoutMs ?? WEATHER_TIMEOUT_MS;
  const cache = new LruCache<string, WeatherSeries>(options.cacheSize ?? 16);
  const now = options.now ?? (() => Date.now());
  const online = options.online ?? (() => typeof navigator === 'undefined' || (navigator as { onLine?: boolean }).onLine !== false);
  let coolUntil = -Infinity;

  const rateLimited = () => new WeatherError('rate-limit', 'Minutely API request limit exceeded. Please try again in one minute.');

  function classify(err: unknown): WeatherError {
    if (err instanceof WeatherError) return err;
    if (err instanceof HttpError) {
      if (err.status === 429) {
        coolUntil = now() + RATE_LIMIT_COOLDOWN_MS;
        return rateLimited();
      }
      if (RANGE_REASON.test(err.body)) return new WeatherError('range', err.message);
      return new WeatherError('http', err.message);
    }
    if (err instanceof TimeoutError) return new WeatherError('timeout', err.message);
    if (err instanceof SyntaxError) return new WeatherError('parse', err.message);
    return new WeatherError('network', err instanceof Error ? err.message : String(err));
  }

  async function request(url: string, signal?: AbortSignal): Promise<unknown> {
    if (now() < coolUntil) throw rateLimited();
    try {
      return await openMeteoQueue(url).run(() => getJson(url, { signal, timeoutMs }), signal);
    } catch (err) {
      if (isAbort(err, signal)) throw signal?.aborted ? abortError(signal) : err;
      throw classify(err);
    }
  }

  async function fetchStep(step: WeatherPlanStep, req: WeatherRequest, fetchedAt: number, signal?: AbortSignal): Promise<WeatherSeries> {
    let current = step;
    for (;;) {
      try {
        const series = parseOpenMeteoWeather(await request(weatherUrl(current, req), signal), req, current, fetchedAt);
        if (current.source !== 'historical-forecast' || !hasGaps(series)) return series;
        const archiveStep: WeatherPlanStep = { source: 'archive', startDate: current.startDate, endDate: current.endDate };
        try {
          const archive = parseOpenMeteoWeather(await request(weatherUrl(archiveStep, req), signal), req, archiveStep, fetchedAt);
          return mergeWeather([series, archive], req);
        } catch (err) {
          if (signal?.aborted || (err instanceof WeatherError && err.kind === 'rate-limit')) throw err;
          return series;
        }
      } catch (err) {
        const next = current.source === 'climatology' ? undefined : NEXT_SOURCE[current.source];
        if (err instanceof WeatherError && err.kind === 'range' && next) {
          current = { source: next, startDate: current.startDate, endDate: current.endDate };
          continue;
        }
        throw err;
      }
    }
  }

  return async (req, fetchOptions = {}) => {
    const { signal, force } = fetchOptions;
    throwIfAborted(signal);
    const key = weatherKey(req);
    const withPoints = (s: WeatherSeries): WeatherSeries => ({ ...s, points: req.points.map((p) => ({ ...p })) });
    if (!force) {
      const hit = cache.get(key);
      if (hit) return withPoints(hit);
    }
    if (!online()) throw new WeatherError('offline', 'The browser is offline');
    if (now() < coolUntil) throw rateLimited();
    const fetchedAt = now();
    const steps = planWeather(req);
    const parts: WeatherSeries[] = [];
    for (let i = 0; i < steps.length; i++) {
      try {
        parts.push(await fetchStep(steps[i], req, fetchedAt, signal));
      } catch (err) {
        const optional = i > 0 && steps[i].source === 'climatology' && !signal?.aborted && !(err instanceof WeatherError && err.kind === 'rate-limit');
        if (!optional) throw err;
      }
    }
    const merged = mergeWeather(parts, req);
    const series = withPoints({ ...merged, key, fetchedAt });
    cache.set(key, series);
    return withPoints(series);
  };
}

export const fetchWeather: WeatherFetcher = createWeatherFetcher();
