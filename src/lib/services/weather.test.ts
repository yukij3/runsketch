import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { WeatherPoint, WeatherSeries } from '../types';
import { weatherWindow } from '../weather/points';
import { HttpError, TimeoutError, type TimedInit } from './http';
import {
  ARCHIVE_URL,
  FORECAST_URL,
  HISTORICAL_FORECAST_URL,
  HOURLY_VARIABLES,
  WeatherError,
  analogYear,
  createWeatherFetcher,
  mergeWeather,
  parseClimatology,
  parseOpenMeteoWeather,
  planWeather,
  weatherGrid,
  weatherKey,
  weatherUrl,
  type WeatherPlanStep,
  type WeatherRequest,
} from './weather';

// Captured 2026-09-13 with timezone=auto&timeformat=unixtime&wind_speed_unit=ms and the ten hourly variables:
// forecast for Lausanne 500 m and the Matterhorn 4480 m on 2026-09-14 (six hours); the historical forecast for Zurich
// on 2026-01-10, once with timezone=auto (six hours) and once with timezone=GMT (temperature, four hours); the archive
// for Lausanne on 2021-12-31; the archive for Lausanne with per-location dates 2023/2024/2025-10-01 (six hours each);
// ERA5 around the hour its data ended (today − 6 d); and the archive's HTTP 400 body for a date after today.
const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), 'utf8')) as unknown;
const FORECAST_2PT = fixture('open-meteo-forecast-2pt.json') as Array<{ hourly: Record<string, number[]> }>;
const HISTORICAL_DST = fixture('open-meteo-historical-dst.json') as { utc_offset_seconds: number; hourly: Record<string, number[]> };
const HISTORICAL_GMT = fixture('open-meteo-historical-gmt.json');
const ARCHIVE_2021 = fixture('open-meteo-archive-2021.json');
const CLIMATOLOGY_3YR = fixture('open-meteo-climatology-3yr.json') as Array<{ hourly: Record<string, number[]> }>;
const ERA5_NULLS = fixture('open-meteo-archive-era5-nulls.json');
const ERROR_RANGE = fixture('open-meteo-error-range.json');

/** Today is 2026-09-13 (09:00 UTC). */
const NOW = Date.UTC(2026, 8, 13, 9);
const DAY = 86400;
const PTS: WeatherPoint[] = [
  { d: 0, lon: 6.63, lat: 46.52, ele: 500 },
  { d: 12000, lon: 7.66, lat: 45.98, ele: 4480 },
];
const request = (startIso: string, elapsedS = 4 * 3600, points = PTS, now = NOW): WeatherRequest => ({
  points,
  ...weatherWindow(Date.parse(startIso), elapsedS),
  now,
});
const slotOf = (req: WeatherRequest, epoch: number) => (epoch - weatherGrid(req).t0) / 3600;
const q1 = (v: number) => Math.round(v * 10) / 10;

describe('planWeather', () => {
  it('uses the forecast from yesterday to 15 days ahead, the analog year after that, and two steps across the horizon', () => {
    expect(planWeather(request('2026-09-12T06:00Z')).map((s) => s.source)).toEqual(['forecast']);
    const last = planWeather(request('2026-09-28T06:00Z'));
    expect(last).toEqual([{ source: 'forecast', startDate: '2026-09-26', endDate: '2026-09-28' }]);
    // An activity past the horizon takes its spin-up days from the same analog year, so ground state and weather agree.
    const beyond = planWeather(request('2026-09-29T06:00Z'));
    expect(beyond).toMatchObject([{ source: 'climatology', startDate: '2026-09-27', endDate: '2026-09-30' }]);
    const crossing = planWeather(request('2026-09-28T22:00Z', 6 * 3600));
    expect(crossing.map((s) => s.source)).toEqual(['forecast', 'climatology']);
    expect(crossing[1]).toMatchObject({ startDate: '2026-09-29', endDate: '2026-09-30' });
    const far = planWeather(request('2026-10-13T06:00Z'));
    expect(far).toHaveLength(1);
    expect(far[0]).toMatchObject({ source: 'climatology', years: [2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025] });
  });

  it('uses the historical forecast before yesterday and since 2022, the archive before 2022', () => {
    expect(planWeather(request('2026-09-11T06:00Z')).map((s) => s.source)).toEqual(['historical-forecast']);
    expect(planWeather(request('2022-01-01T06:00Z')).map((s) => s.source)).toEqual(['historical-forecast']);
    expect(planWeather(request('2021-12-31T06:00Z'))).toEqual([{ source: 'archive', startDate: '2021-12-29', endDate: '2022-01-01' }]);
  });
});

describe('weatherUrl', () => {
  it('sends every point with its elevation, the ten variables, epochs in m/s and dates padded a day each side', () => {
    const req = request('2026-09-14T06:00Z', 4 * 3600, [{ d: 0, lon: 6.6349, lat: 46.5151, ele: 504 }, PTS[1]]);
    const url = weatherUrl(planWeather(req)[0], req);
    expect(url).toBe(
      `${FORECAST_URL}?latitude=46.52,45.98&longitude=6.63,7.66&elevation=500,4480&hourly=${HOURLY_VARIABLES.join(',')}` +
        '&timezone=auto&timeformat=unixtime&wind_speed_unit=ms&start_date=2026-09-11&end_date=2026-09-16',
    );
    expect(HOURLY_VARIABLES).toHaveLength(10);
  });

  it('clamps the forecast to its horizon and the archive to today, and asks the archive for best_match', () => {
    const late = request('2026-09-28T06:00Z');
    expect(weatherUrl(planWeather(late)[0], late)).toContain('&start_date=2026-09-25&end_date=2026-09-28');
    const step: WeatherPlanStep = { source: 'archive', startDate: '2026-09-11', endDate: '2026-09-14' };
    const archive = weatherUrl(step, request('2026-09-13T06:00Z'));
    expect(archive.startsWith(`${ARCHIVE_URL}?`)).toBe(true);
    expect(archive).toContain('&start_date=2026-09-10&end_date=2026-09-13&models=best_match');
    expect(weatherUrl({ ...step, source: 'historical-forecast' }, request('2026-08-13T06:00Z')).startsWith(`${HISTORICAL_FORECAST_URL}?`)).toBe(true);
  });

  it('repeats each point once per year for climatology with per-location dates, 29 February falling back to the 28th', () => {
    const req = request('2028-03-02T06:00Z');
    const [step] = planWeather(req);
    expect(step.source).toBe('climatology');
    const url = new URL(weatherUrl(step, req));
    const years = step.source === 'climatology' ? step.years : [];
    expect(years).toHaveLength(10);
    // 2027's dates are still in the future on 2026-09-13; 2026's are already archived.
    expect(years[years.length - 1]).toBe(2026);
    expect(url.searchParams.get('latitude')!.split(',')).toHaveLength(2 * years.length);
    const starts = url.searchParams.get('start_date')!.split(',');
    expect(starts).toHaveLength(2 * years.length);
    expect(starts).toContain('2026-02-27');
    expect(starts).toContain('2024-02-28');
    expect(url.searchParams.get('models')).toBe('best_match');
  });
});

describe('parseOpenMeteoWeather', () => {
  const forecastStep: WeatherPlanStep = { source: 'forecast', startDate: '2026-09-12', endDate: '2026-09-15' };

  it('parses the live two-point forecast onto the epoch grid in location order, quantised', () => {
    const req = request('2026-09-14T06:00Z');
    const series = parseOpenMeteoWeather(FORECAST_2PT, req, forecastStep, 123);
    expect(series).toMatchObject({ v: 1, source: 'forecast', timezone: 'Europe/Zurich', stepS: 3600, fetchedAt: 123, key: weatherKey(req) });
    expect(series.points).toEqual(PTS);
    const k = slotOf(req, Date.UTC(2026, 8, 14, 4) / 1000);
    expect(k).toBe(52);
    for (let p = 0; p < 2; p++) {
      const h = FORECAST_2PT[p].hourly;
      expect(series.temperature[p].slice(k, k + 6)).toEqual(h.temperature_2m.map(q1));
      expect(series.windSpeed[p].slice(k, k + 6)).toEqual(h.wind_speed_10m.map(q1));
      expect(series.surfacePressure[p].slice(k, k + 6)).toEqual(h.surface_pressure.map(q1));
      expect(series.windFrom[p][k]).toBe(h.wind_direction_10m[0] % 360);
    }
    expect(series.temperature[1][k]).toBeLessThan(series.temperature[0][k]! - 15);
    expect(series.temperature[0][k - 1]).toBeNull();
    expect(series.temperature[0]).toHaveLength(weatherGrid(req).slots);
  });

  it('indexes by epoch although the local-day window is shifted and utc_offset_seconds is wrong (Zurich in January)', () => {
    const zurich: WeatherPoint[] = [{ d: 0, lon: 8.54, lat: 47.37, ele: 410 }];
    const req = request('2026-01-10T09:00Z', 3600, zurich, Date.UTC(2026, 0, 20));
    const step: WeatherPlanStep = { source: 'historical-forecast', startDate: '2026-01-08', endDate: '2026-01-11' };
    expect(HISTORICAL_DST.utc_offset_seconds).toBe(7200);
    const auto = parseOpenMeteoWeather(HISTORICAL_DST, req, step, 0);
    const gmt = parseOpenMeteoWeather(HISTORICAL_GMT, req, step, 0);
    const first = slotOf(req, Date.UTC(2026, 0, 9, 22) / 1000);
    expect(auto.temperature[0][first]).toBe(q1(HISTORICAL_DST.hourly.temperature_2m[0]));
    const midnight = slotOf(req, Date.UTC(2026, 0, 10) / 1000);
    expect(gmt.temperature[0].slice(midnight, midnight + 4)).toEqual(auto.temperature[0].slice(midnight, midnight + 4));
    expect(auto.temperature[0][midnight]).not.toBeNull();
  });

  it('keeps nulls as null, rounds to the transport grid and reads an archive object', () => {
    const req = request('2026-09-08T06:00Z', 3600, [PTS[0]]);
    const era5 = parseOpenMeteoWeather(ERA5_NULLS, req,{ source: 'archive', startDate: '2026-09-06', endDate: '2026-09-09' }, 0);
    const k = slotOf(req, Date.UTC(2026, 8, 7, 21) / 1000);
    expect(era5.temperature[0].slice(k, k + 6)).toEqual([23, 22.4, 21.9, null, null, null]);
    expect(era5.windSpeed[0].every((v) => v === null)).toBe(true);

    const t = Date.UTC(2026, 8, 8, 12) / 1000;
    const synthetic = {
      timezone: 'Europe/Zurich',
      hourly: {
        time: [t, t + 1800],
        temperature_2m: [12.345, 99],
        wind_direction_10m: [359.6, 1],
        snowfall: [0.123, 1],
        surface_pressure: [966.44, 1],
        shortwave_radiation: [12.6, 1],
        precipitation: [Number.NaN, 1],
      },
    };
    const s = parseOpenMeteoWeather(synthetic, req,{ source: 'archive', startDate: '2026-09-06', endDate: '2026-09-09' }, 0);
    const j = slotOf(req, t);
    expect([s.temperature[0][j], s.windFrom[0][j], s.snowfall[0][j], s.surfacePressure[0][j], s.shortwave[0][j], s.precipitation[0][j]]).toEqual([
      12.3, 0, 0.12, 966.4, 13, null,
    ]);
    // A half-hour epoch is off the hourly grid and ignored.
    expect(s.temperature[0].filter((v) => v !== null)).toEqual([12.3]);

    const winter = request('2021-12-31T06:00Z', 3600, [PTS[0]], NOW);
    const archived = parseOpenMeteoWeather(ARCHIVE_2021, winter, planWeather(winter)[0], 0);
    expect(archived.source).toBe('archive');
    expect(archived.temperature[0].filter((v) => v !== null)).toHaveLength(6);
  });

  it('turns provider error bodies into typed errors', () => {
    const req = request('2026-09-14T06:00Z');
    const parse = (json: unknown) => () => parseOpenMeteoWeather(json, req, forecastStep, 0);
    expect(parse(ERROR_RANGE)).toThrow(expect.objectContaining({ kind: 'range' }));
    expect(parse({ error: true, reason: 'Cannot initialize WeatherVariable from invalid String value x' })).toThrow(expect.objectContaining({ kind: 'parse' }));
    expect(parse([FORECAST_2PT[0]])).toThrow(WeatherError);
    expect(parse(null)).toThrow(expect.objectContaining({ kind: 'parse' }));
  });

  it('shifts past years onto the requested dates and picks a typical one deterministically', () => {
    const req = request('2026-10-01T09:00Z', 3600, [PTS[0]]);
    const planned = planWeather(req)[0];
    const step = { ...planned, source: 'climatology' as const, years: [2023, 2024, 2025] };
    const years = parseClimatology(CLIMATOLOGY_3YR, req, step, 0);
    const k = slotOf(req, Date.UTC(2026, 9, 1, 8) / 1000);
    years.forEach((s, y) => {
      expect(s.analogYear).toBe(step.years[y]);
      expect(s.temperature[0].slice(k, k + 6)).toEqual(CLIMATOLOGY_3YR[y].hourly.temperature_2m.map(q1));
    });
    const chosen = parseOpenMeteoWeather(CLIMATOLOGY_3YR, req, step, 0);
    expect(chosen.source).toBe('climatology');
    expect(chosen.t0).toBe(weatherGrid(req).t0);
    const index = step.years.indexOf(chosen.analogYear!);
    expect(index).toBeGreaterThanOrEqual(0);
    expect(chosen.temperature[0].slice(k, k + 6)).toEqual(years[index].temperature[0].slice(k, k + 6));
    expect(analogYear([...years].reverse(), req).analogYear).toBe(chosen.analogYear);
  });
});

/** A series on the request grid with every variable constant per point. */
function constant(req: WeatherRequest, source: WeatherSeries['source'], values: Partial<Record<'temperature' | 'precipitation' | 'windSpeed', number>>, year?: number): WeatherSeries {
  const { t0, slots } = weatherGrid(req);
  const row = (v: number | null) => req.points.map(() => new Array<number | null>(slots).fill(v));
  return {
    v: 1,
    key: weatherKey(req),
    source,
    timezone: 'Europe/Zurich',
    t0,
    stepS: 3600,
    points: req.points,
    temperature: row(values.temperature ?? 10),
    dewPoint: row(5),
    precipitation: row(values.precipitation ?? 0),
    snowfall: row(0),
    windSpeed: row(values.windSpeed ?? 3),
    windFrom: row(270),
    windGust: row(6),
    surfacePressure: row(960),
    shortwave: row(0),
    cloudCover: row(50),
    fetchedAt: 1,
    ...(year !== undefined ? { analogYear: year } : {}),
  };
}

describe('analogYear and mergeWeather', () => {
  const req = request('2026-11-10T06:00Z', 3600, [PTS[0]]);

  it('picks the year nearest the median, ties going to the most recent', () => {
    const years = [constant(req, 'climatology', { temperature: 10 }, 2020), constant(req, 'climatology', { temperature: 20 }, 2021), constant(req, 'climatology', { temperature: 12 }, 2022)];
    expect(analogYear(years, req).analogYear).toBe(2022);
    const tie = [constant(req, 'climatology', { temperature: 10 }, 2018), constant(req, 'climatology', { temperature: 10 }, 2019)];
    expect(analogYear(tie, req).analogYear).toBe(2019);
    expect(analogYear(tie.reverse(), req).analogYear).toBe(2019);
  });

  it('takes the first part with a value, fills gaps up to 3 h from the nearest hour and leaves longer gaps', () => {
    const a = constant(req, 'historical-forecast', {});
    const row = a.temperature[0];
    for (let k = 0; k < row.length; k++) row[k] = k;
    row[2] = null;
    row[3] = null;
    for (let k = 10; k <= 17; k++) row[k] = null;
    const b = constant(req, 'archive', {});
    b.temperature[0].fill(null);
    b.temperature[0][3] = 100;
    const merged = mergeWeather([a, b], req);
    const m = merged.temperature[0];
    expect(merged.source).toBe('historical-forecast');
    expect([m[1], m[2], m[3], m[4]]).toEqual([1, 1, 100, 4]);
    expect(m.slice(9, 19)).toEqual([9, 9, 9, 9, null, null, 18, 18, 18, 18]);
  });

  it('blends from the last forecast hour into the analog year over three hours', () => {
    const forecast = constant(req, 'forecast', { temperature: 10 });
    for (let k = 6; k < forecast.temperature[0].length; k++) {
      forecast.temperature[0][k] = null;
      forecast.windFrom[0][k] = null;
    }
    const analog = constant(req, 'climatology', { temperature: 20 }, 2024);
    analog.windFrom[0].fill(90);
    const merged = mergeWeather([forecast, analog], req);
    expect(merged.temperature[0].slice(5, 11)).toEqual([10, 12.5, 15, 17.5, 20, 20]);
    expect(merged.windFrom[0].slice(5, 9)).toEqual([270, 270, 90, 90]);
    expect(merged.analogYear).toBe(2024);
  });
});

describe('weatherKey', () => {
  it('ignores a 300 m move and the distance along the route, but not the day or the elevation bucket', () => {
    const base = request('2026-09-14T06:00Z');
    const moved = { ...base, points: [{ d: 50, lon: 6.634, lat: 46.5227, ele: 503 }, { ...PTS[1], d: 12500 }] };
    expect(weatherKey(moved)).toBe(weatherKey(base));
    expect(weatherKey(request('2026-09-14T18:00Z'))).toBe(weatherKey(base));
    expect(weatherKey(request('2026-09-15T06:00Z'))).not.toBe(weatherKey(base));
    expect(weatherKey({ ...base, points: [{ ...PTS[0], ele: 520 }, PTS[1]] })).not.toBe(weatherKey(base));
  });
});

// ---------------------------------------------------------------------------------------------
// Fetcher with a fake network

type Value = (variable: string, point: number, epoch: number) => number | null;
const defaultValue: Value = (variable, point) => (variable === 'temperature_2m' ? 10 + point : 1);

/** An Open-Meteo-shaped body for whatever the URL asked (hourly epochs over the requested UTC dates). */
function fakeBody(url: string, value: Value = defaultValue): unknown {
  const params = new URL(url).searchParams;
  const lats = params.get('latitude')!.split(',');
  const starts = params.get('start_date')!.split(',');
  const ends = params.get('end_date')!.split(',');
  const variables = params.get('hourly')!.split(',');
  return lats.map((lat, i) => {
    const from = Date.parse(`${starts[i] ?? starts[0]}T00:00:00Z`) / 1000;
    const to = Date.parse(`${ends[i] ?? ends[0]}T00:00:00Z`) / 1000 + DAY;
    const time: number[] = [];
    for (let t = from; t < to; t += 3600) time.push(t);
    const hourly: Record<string, Array<number | null>> = { time };
    for (const v of variables) hourly[v] = time.map((t) => value(v, i, t));
    return { latitude: Number(lat), timezone: 'Europe/Zurich', utc_offset_seconds: 7200, ...(i > 0 ? { location_id: i } : {}), hourly };
  });
}

const RANGE_BODY = JSON.stringify(ERROR_RANGE);
const LIMIT_BODY = '{"reason":"Minutely API request limit exceeded. Please try again in one minute.","error":true}';

function fakeNetwork(handler: (url: string, init: TimedInit | undefined) => unknown) {
  const calls: Array<{ url: string; init: TimedInit | undefined }> = [];
  const fetchJson = async (url: string, init?: TimedInit) => {
    calls.push({ url, init });
    return handler(url, init);
  };
  return { calls, fetchJson };
}

describe('createWeatherFetcher', () => {
  it('sends one request per step for every point, caches by key and refetches on force', async () => {
    const net = fakeNetwork((url) => fakeBody(url));
    const fetcher = createWeatherFetcher({ fetchJson: net.fetchJson, now: () => 555, online: () => true });
    const req = request('2026-09-14T06:00Z');
    const series = await fetcher(req);
    expect(net.calls).toHaveLength(1);
    expect(net.calls[0].url.startsWith(`${FORECAST_URL}?latitude=46.52,45.98`)).toBe(true);
    expect(net.calls[0].init?.timeoutMs).toBe(10_000);
    expect(series).toMatchObject({ key: weatherKey(req), fetchedAt: 555, source: 'forecast', timezone: 'Europe/Zurich' });
    expect(series.temperature[1][30]).toBe(11);
    const again = await fetcher({ ...req, points: [{ ...PTS[0], d: 7 }, PTS[1]] });
    expect(net.calls).toHaveLength(1);
    expect(again.points[0].d).toBe(7);
    await fetcher(req, { force: true });
    expect(net.calls).toHaveLength(2);
  });

  it('on HTTP 429 fails with rate-limit and sends nothing for a minute', async () => {
    let clock = NOW;
    let limited = true;
    const net = fakeNetwork((url) => {
      if (limited) throw new HttpError(429, url, LIMIT_BODY);
      return fakeBody(url);
    });
    const fetcher = createWeatherFetcher({ fetchJson: net.fetchJson, now: () => clock, online: () => true });
    const req = request('2026-09-14T06:00Z');
    await expect(fetcher(req)).rejects.toMatchObject({ kind: 'rate-limit' });
    limited = false;
    clock += 10_000;
    await expect(fetcher(req)).rejects.toMatchObject({ kind: 'rate-limit' });
    expect(net.calls).toHaveLength(1);
    clock += 60_000;
    await expect(fetcher(req)).resolves.toMatchObject({ source: 'forecast' });
    expect(net.calls).toHaveLength(2);
  });

  it('falls back to the historical forecast when the forecast refuses the dates, and fills its gaps from the archive once', async () => {
    const net = fakeNetwork((url) => {
      if (url.startsWith(FORECAST_URL)) throw new HttpError(400, url, RANGE_BODY);
      if (url.startsWith(HISTORICAL_FORECAST_URL)) return fakeBody(url, (v, p, t) => (v === 'temperature_2m' && (t / 3600) % 24 === 12 ? null : defaultValue(v, p, t)));
      return fakeBody(url, (v, p, t) => (v === 'temperature_2m' ? 30 : defaultValue(v, p, t)));
    });
    const fetcher = createWeatherFetcher({ fetchJson: net.fetchJson, online: () => true });
    const req = request('2026-09-14T06:00Z');
    const series = await fetcher(req);
    expect(net.calls.map((c) => new URL(c.url).host)).toEqual(['api.open-meteo.com', 'historical-forecast-api.open-meteo.com', 'archive-api.open-meteo.com']);
    expect(net.calls[2].url).toContain('models=best_match');
    expect(series.source).toBe('historical-forecast');
    const noon = slotOf(req, Date.UTC(2026, 8, 13, 12) / 1000);
    expect(series.temperature[0][noon]).toBe(30);
    expect(series.temperature[0][noon + 1]).toBe(10);
  });

  it('keeps the forecast when the analog year after it fails, and types timeouts, HTTP and network errors', async () => {
    const crossing = request('2026-09-28T22:00Z', 6 * 3600);
    const net = fakeNetwork((url) => {
      if (url.startsWith(ARCHIVE_URL)) throw new TypeError('Failed to fetch');
      return fakeBody(url);
    });
    const series = await createWeatherFetcher({ fetchJson: net.fetchJson, online: () => true })(crossing);
    expect(series.source).toBe('forecast');
    expect(net.calls).toHaveLength(2);

    const req = request('2026-09-14T06:00Z');
    const failing = (err: unknown) =>
      createWeatherFetcher({
        fetchJson: async () => {
          throw err;
        },
        online: () => true,
      })(req);
    await expect(failing(new TimeoutError(10_000))).rejects.toMatchObject({ kind: 'timeout' });
    await expect(failing(new HttpError(502, 'x', 'Bad gateway'))).rejects.toMatchObject({ kind: 'http' });
    await expect(failing(new TypeError('Failed to fetch'))).rejects.toMatchObject({ kind: 'network' });
    await expect(failing(new SyntaxError('Unexpected token'))).rejects.toMatchObject({ kind: 'parse' });
  });

  it('propagates aborts unchanged and does not touch the network while offline', async () => {
    const req = request('2026-09-14T06:00Z');
    const waiting = fakeNetwork(
      (_url, init) =>
        new Promise((_, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal!.reason));
        }),
    );
    const controller = new AbortController();
    const pending = createWeatherFetcher({ fetchJson: waiting.fetchJson, online: () => true })(req, { signal: controller.signal });
    await new Promise((r) => setTimeout(r, 200));
    controller.abort();
    const err = await pending.catch((e: unknown) => e);
    expect(err).not.toBeInstanceOf(WeatherError);
    expect((err as Error).name).toBe('AbortError');

    const offline = fakeNetwork((url) => fakeBody(url));
    await expect(createWeatherFetcher({ fetchJson: offline.fetchJson, online: () => false })(req)).rejects.toMatchObject({ kind: 'offline' });
    expect(offline.calls).toHaveLength(0);
  });
});
