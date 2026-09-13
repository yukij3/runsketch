import { describe, expect, it } from 'vitest';
import type { WeatherSeries } from '../lib/types';
import { WEATHER_CACHE_KEY, WeatherCache, validSeries } from './weatherCache';

function memoryStorage(maxChars = Infinity) {
  const data = new Map<string, string>();
  let writes = 0;
  return {
    data,
    get writes() {
      return writes;
    },
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => {
      if (v.length > maxChars) throw new Error('QuotaExceededError');
      writes++;
      data.set(k, v);
    },
  };
}

function series(key: string, fetchedAt = 1, slots = 4): WeatherSeries {
  const rows = (v: number | null) => [new Array<number | null>(slots).fill(v), new Array<number | null>(slots).fill(v)];
  return {
    v: 1,
    key,
    source: 'forecast',
    timezone: 'Europe/Zurich',
    t0: 1789171200,
    stepS: 3600,
    points: [
      { d: 0, lon: 6.63, lat: 46.52, ele: 500 },
      { d: 12000, lon: 7.66, lat: 45.98, ele: 4480 },
    ],
    temperature: rows(12.3),
    dewPoint: rows(null),
    precipitation: rows(0),
    snowfall: rows(0),
    windSpeed: rows(2.5),
    windFrom: rows(270),
    windGust: rows(6),
    surfacePressure: rows(966.4),
    shortwave: rows(0),
    cloudCover: rows(50),
    fetchedAt,
  };
}

describe('weather cache', () => {
  it('reproduces a stored series exactly after a reload, nulls included', () => {
    const storage = memoryStorage();
    const cache = WeatherCache.load(storage);
    const a = { ...series('a'), analogYear: 2021, source: 'climatology' as const };
    cache.remember(a);
    cache.remember(series('b'));
    cache.save(storage);
    const reloaded = WeatherCache.load(storage);
    expect(reloaded.size).toBe(2);
    expect(reloaded.get('a')).toEqual(a);
    expect(reloaded.get('b')!.dewPoint[1]).toEqual([null, null, null, null]);
    expect(reloaded.get('nope')).toBeUndefined();
  });

  it('keeps the most recently used series within the count and size bounds', () => {
    const storage = memoryStorage();
    const cache = WeatherCache.load(storage, 3, 1e9);
    for (let i = 0; i < 5; i++) cache.remember(series(`k${i}`));
    cache.remember(series('k2'));
    cache.remember(series('k5'));
    cache.save(storage);
    const reloaded = WeatherCache.load(storage, 3, 1e9);
    expect(['k0', 'k1', 'k2', 'k3', 'k4', 'k5'].filter((k) => reloaded.get(k))).toEqual(['k2', 'k4', 'k5']);

    const one = JSON.stringify(series('s0')).length + 8;
    const small = WeatherCache.load(undefined, 8, 2 * one);
    for (let i = 0; i < 4; i++) small.remember(series(`s${i}`));
    expect(small.size).toBe(2);
    expect(small.get('s3')).toBeDefined();
  });

  it('writes only for a new key or a newer fetch', () => {
    const storage = memoryStorage();
    const cache = WeatherCache.load(storage);
    cache.remember(series('a', 1));
    cache.save(storage);
    expect(storage.writes).toBe(1);
    cache.remember(series('a', 1));
    cache.save(storage);
    expect(storage.writes).toBe(1);
    cache.remember(series('a', 2));
    cache.save(storage);
    expect(storage.writes).toBe(2);
    expect(WeatherCache.load(storage).get('a')!.fetchedAt).toBe(2);
  });

  it('drops malformed entries and survives corrupt storage', () => {
    const good = series('good');
    const bad: unknown[] = [
      { ...good, key: 'v2', v: 2 },
      { ...good, key: 'source', source: 'radar' },
      { ...good, key: 'rows', temperature: [[1, 2, 3, 4]] },
      { ...good, key: 'ragged', windSpeed: [[1, 2, 3, 4], [1, 2, 3]] },
      { ...good, key: 'text', cloudCover: [[1, 2, 3, '4'], [1, 2, 3, 4]] },
      { ...good, key: 'points', points: new Array(13).fill(good.points[0]) },
      { ...good, key: 't0', t0: 'soon' },
      { ...good, key: 'year', analogYear: 2021.5 },
      null,
    ];
    const storage = memoryStorage();
    storage.data.set(WEATHER_CACHE_KEY, JSON.stringify({ v: 1, series: [...bad, good] }));
    const cache = WeatherCache.load(storage);
    expect(cache.size).toBe(1);
    expect(cache.get('good')).toEqual(good);
    for (const item of bad) expect(validSeries(item)).toBeNull();
    storage.data.set(WEATHER_CACHE_KEY, '{not json');
    expect(WeatherCache.load(storage).size).toBe(0);
  });

  it('halves the stored series until they fit the quota', () => {
    const one = JSON.stringify(series('q0')).length;
    const storage = memoryStorage(3 * one);
    const cache = WeatherCache.load(storage, 8, 1e9);
    for (let i = 0; i < 8; i++) cache.remember(series(`q${i}`));
    cache.save(storage);
    const reloaded = WeatherCache.load(storage);
    expect(reloaded.size).toBeGreaterThan(0);
    expect(reloaded.size).toBeLessThanOrEqual(3);
    expect(reloaded.get('q7')).toBeDefined();
  });
});
