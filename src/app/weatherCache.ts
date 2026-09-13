// Fetched weather series persisted across reloads, so a stored route and start reproduce the same file even after the
// forecast has moved on. Keyed by the request key; bounded by count and by stored size, least recently used first out.
import { MAX_WEATHER_POINTS, WEATHER_FIELDS, WEATHER_SOURCES } from '../lib/services/weather';
import type { WeatherPoint, WeatherSeries } from '../lib/types';

export const WEATHER_CACHE_KEY = 'runsketch:weather:v1';
export const WEATHER_CACHE_LIMIT = 8;
/** Serialised characters kept at most (localStorage allows ≈5 M per origin, shared with preferences and legs). */
export const WEATHER_CACHE_CHARS = 400_000;

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** A stored series checked field by field, or null when anything is malformed. */
export function validSeries(raw: unknown): WeatherSeries | null {
  if (!isObject(raw) || raw.v !== 1) return null;
  if (typeof raw.key !== 'string' || raw.key === '' || typeof raw.timezone !== 'string') return null;
  if (!WEATHER_SOURCES.includes(raw.source as WeatherSeries['source'])) return null;
  if (!finite(raw.t0) || !finite(raw.stepS) || raw.stepS <= 0 || !finite(raw.fetchedAt)) return null;
  if (!Array.isArray(raw.points) || raw.points.length === 0 || raw.points.length > MAX_WEATHER_POINTS) return null;
  const points: WeatherPoint[] = [];
  for (const p of raw.points) {
    if (!isObject(p) || !finite(p.d) || !finite(p.lon) || !finite(p.lat) || !finite(p.ele)) return null;
    points.push({ d: p.d, lon: p.lon, lat: p.lat, ele: p.ele });
  }
  const series = {
    v: 1,
    key: raw.key,
    source: raw.source,
    timezone: raw.timezone,
    t0: raw.t0,
    stepS: raw.stepS,
    points,
    fetchedAt: raw.fetchedAt,
  } as Partial<WeatherSeries> as WeatherSeries;
  let slots = -1;
  for (const field of WEATHER_FIELDS) {
    const rows = raw[field];
    if (!Array.isArray(rows) || rows.length !== points.length) return null;
    const copy: Array<Array<number | null>> = [];
    for (const row of rows) {
      if (!Array.isArray(row) || row.length === 0 || (slots >= 0 && row.length !== slots)) return null;
      slots = row.length;
      for (const v of row) if (v !== null && !finite(v)) return null;
      copy.push(row.slice() as Array<number | null>);
    }
    series[field] = copy;
  }
  if (raw.analogYear !== undefined) {
    if (!finite(raw.analogYear) || !Number.isInteger(raw.analogYear)) return null;
    series.analogYear = raw.analogYear;
  }
  return series;
}

interface Entry {
  series: WeatherSeries;
  chars: number;
}

const entry = (series: WeatherSeries): Entry => ({ series, chars: JSON.stringify(series).length });

export class WeatherCache {
  private readonly entries = new Map<string, Entry>();
  private dirty = false;

  constructor(
    private readonly limit = WEATHER_CACHE_LIMIT,
    private readonly maxChars = WEATHER_CACHE_CHARS,
  ) {}

  static load(storage: Pick<Storage, 'getItem'> | undefined, limit?: number, maxChars?: number): WeatherCache {
    const cache = new WeatherCache(limit, maxChars);
    try {
      const raw = JSON.parse(storage?.getItem(WEATHER_CACHE_KEY) ?? 'null') as unknown;
      const list = isObject(raw) && raw.v === 1 ? raw.series : null;
      if (!Array.isArray(list)) return cache;
      for (const item of list) {
        const series = validSeries(item);
        if (series) cache.entries.set(series.key, entry(series));
      }
      cache.evict();
    } catch {
      // Corrupt storage: start empty.
    }
    cache.dirty = false;
    return cache;
  }

  get size(): number {
    return this.entries.size;
  }

  get(key: string): WeatherSeries | undefined {
    return this.entries.get(key)?.series;
  }

  /** Records a series in use (most recent last); writing is worth it only for a new key or a newer fetch. */
  remember(series: WeatherSeries): void {
    const existing = this.entries.get(series.key);
    this.entries.delete(series.key);
    if (existing && existing.series.fetchedAt === series.fetchedAt) {
      this.entries.set(series.key, existing);
      return;
    }
    this.entries.set(series.key, entry(series));
    this.dirty = true;
    this.evict();
  }

  forget(key: string): void {
    if (this.entries.delete(key)) this.dirty = true;
  }

  save(storage: Pick<Storage, 'setItem'> | undefined, force = false): void {
    if (!storage || (!this.dirty && !force)) return;
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        storage.setItem(WEATHER_CACHE_KEY, JSON.stringify({ v: 1, series: [...this.entries.values()].map((e) => e.series) }));
        this.dirty = false;
        return;
      } catch {
        // Quota: drop the older half and try again.
        const drop = Math.ceil(this.entries.size / 2);
        if (drop === 0) return;
        [...this.entries.keys()].slice(0, drop).forEach((key) => this.entries.delete(key));
      }
    }
  }

  private evict(): boolean {
    let evicted = false;
    let chars = 0;
    for (const [key, e] of this.entries) chars += key.length + e.chars;
    for (const [key, e] of this.entries) {
      if (this.entries.size <= this.limit && chars <= this.maxChars) break;
      this.entries.delete(key);
      chars -= key.length + e.chars;
      evicted = true;
    }
    return evicted;
  }
}
