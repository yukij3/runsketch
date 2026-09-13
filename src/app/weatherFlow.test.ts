// Automatic weather through the store, actions and pipeline: debounce, abort, caches, fallback, presets and the route zone.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { haversine } from '../lib/geo';
import { WeatherError, weatherKey, type WeatherFetcher, type WeatherRequest } from '../lib/services/weather';
import { weatherScenario, type PresetSolution } from '../lib/sim';
import type { LngLat, SimulationInput, SimulationResult, SnapProfile, TerrainProfile, WeatherSeries } from '../lib/types';
import { createActions } from './actions';
import { buildInitialState, toPersisted } from './persistence';
import { simKey, startPipeline, weatherIdentity, type PipelineDeps } from './pipeline';
import { localStartHour, type AppState } from './state';
import { createStore } from './store';
import { rezoneStart, startFromWallClock } from './zone';

const NOW = Date.UTC(2026, 8, 12, 7);
const A: LngLat = [2.152, 41.372];
const B: LngLat = [2.172, 41.372];
/** Route 250 + terrain 400 ms, and a little for the promises in between. */
const TO_WEATHER = 700;

function fakeProfile(route: LngLat[]): TerrainProfile {
  let d = 0;
  const points = route.map(([lon, lat], i) => {
    if (i > 0) d += haversine(route[i - 1], route[i]);
    return { d, lon, lat, ele: 100, grade: 0 };
  });
  return { points, spacing: 5, totalDistance: d, ascent: 0, descent: 0, minEle: 100, maxEle: 100, elevationSource: 'mapterhorn' };
}

const fakeResult = (input: SimulationInput): SimulationResult =>
  ({ streams: { t: new Float64Array(input.profile.points.length) }, summary: { laps: [], elapsed: 1200 }, warnings: [] }) as unknown as SimulationResult;

function seriesFor(req: WeatherRequest, fetchedAt = NOW, timezone = 'Europe/Madrid'): WeatherSeries {
  return { ...weatherScenario({ start: NOW, at: req.points.map((p) => p.d) }), key: weatherKey(req), timezone, fetchedAt, points: req.points };
}

function setup(overrides: Partial<PipelineDeps> = {}, state?: AppState) {
  const store = createStore(state ?? buildInitialState({ stored: null, hash: '', now: NOW }));
  const actions = createActions(store);
  const routeLeg = vi.fn(async (a: LngLat, b: LngLat, profile: SnapProfile) => ({
    coords: [a, b],
    distance: haversine(a, b),
    provider: profile === 'none' ? ('straight' as const) : ('osrm' as const),
    fallback: false,
  }));
  const buildProfile = vi.fn(async (route: LngLat[]) => fakeProfile(route));
  const simulate = vi.fn(fakeResult);
  const fetchWeather = vi.fn<WeatherFetcher>(async (req) => seriesFor(req));
  const deps: PipelineDeps = { routeLeg, buildProfile, simulate, fetchWeather, now: () => NOW, ...overrides };
  const stop = startPipeline(store, deps);
  return { store, actions, simulate, fetchWeather: (overrides.fetchWeather ?? fetchWeather) as ReturnType<typeof vi.fn<WeatherFetcher>>, stop };
}

const draw = (actions: ReturnType<typeof createActions>) => {
  actions.addWaypoint(...A);
  actions.addWaypoint(...B);
};
const lastInput = (simulate: ReturnType<typeof vi.fn<(input: SimulationInput) => SimulationResult>>) => simulate.mock.calls[simulate.mock.calls.length - 1][0];

describe('automatic weather in the pipeline', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('fetches after the terrain with a debounce, and the simulation waits for the series', async () => {
    const { store, actions, simulate, fetchWeather, stop } = setup();
    draw(actions);
    await vi.advanceTimersByTimeAsync(TO_WEATHER);
    expect(store.get().terrain.state).toBe('done');
    expect(store.get()).toMatchObject({ weather: { state: 'busy' }, sim: { state: 'busy' } });
    // Terrain landed at 650 ms, so the 800 ms debounce ends at 1450 ms.
    await vi.advanceTimersByTimeAsync(740);
    expect(fetchWeather).not.toHaveBeenCalled();
    expect(simulate).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(60);
    expect(fetchWeather).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(200);
    const s = store.get();
    expect(s.weather.state).toBe('done');
    expect(simulate).toHaveBeenCalledTimes(1);
    const input = lastInput(simulate);
    expect(input.weather?.key).toBe(s.weather.key);
    expect(input.weather?.points.map((p) => p.d)).toEqual(fetchWeather.mock.calls[0][0].points.map((p) => p.d));
    // A start that follows "now" keeps its instant and takes the route's offset (Madrid in September: UTC+2).
    expect(s.routeZone).toBe('Europe/Madrid');
    expect(s.session).toMatchObject({ startTime: NOW, utcOffsetMin: 120 });
    stop();
  });

  it('aborts a fetch when the start moves to another day and fetches that day', async () => {
    const fetchWeather = vi.fn<WeatherFetcher>(
      (req, options) =>
        new Promise<WeatherSeries>((resolve, reject) => {
          options?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
          setTimeout(() => resolve(seriesFor(req)), 1000);
        }),
    );
    const { store, actions, simulate, stop } = setup({ fetchWeather });
    draw(actions);
    await vi.advanceTimersByTimeAsync(TO_WEATHER + 820);
    expect(fetchWeather).toHaveBeenCalledTimes(1);
    const first = fetchWeather.mock.calls[0];
    actions.setStart(NOW + 3 * 86_400_000, 120);
    expect(first[1]?.signal?.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(2200);
    expect(fetchWeather).toHaveBeenCalledTimes(2);
    expect(weatherKey(fetchWeather.mock.calls[1][0])).not.toBe(weatherKey(first[0]));
    expect(store.get().weather).toMatchObject({ state: 'done', key: weatherKey(fetchWeather.mock.calls[1][0]) });
    expect(simulate).toHaveBeenCalledTimes(1);
    stop();
  });

  it('keeps the series when a waypoint moves 200 m (same request) and follows the new distances', async () => {
    const { store, actions, simulate, fetchWeather, stop } = setup();
    draw(actions);
    await vi.advanceTimersByTimeAsync(TO_WEATHER + 1100);
    expect(fetchWeather).toHaveBeenCalledTimes(1);
    const finish = store.get().waypoints[1];
    actions.moveWaypoint(finish.id, 2.1745, 41.372);
    await vi.advanceTimersByTimeAsync(2000);
    expect(fetchWeather).toHaveBeenCalledTimes(1);
    expect(simulate).toHaveBeenCalledTimes(2);
    const input = lastInput(simulate);
    expect(input.weather?.points.at(-1)?.d).toBeCloseTo(input.profile.totalDistance, 6);
    stop();
  });

  it('falls back to the manual values on an error, and Retry fetches again', async () => {
    let fail = true;
    const fetchWeather = vi.fn<WeatherFetcher>(async (req) => {
      if (fail) throw new WeatherError('network', 'down');
      return seriesFor(req);
    });
    const { store, actions, simulate, stop } = setup({ fetchWeather });
    draw(actions);
    await vi.advanceTimersByTimeAsync(TO_WEATHER + 1100);
    expect(store.get().weather).toMatchObject({ state: 'error', error: 'network', series: null });
    expect(simulate).toHaveBeenCalledTimes(1);
    expect(lastInput(simulate).weather).toBeNull();
    fail = false;
    actions.retryWeather();
    await vi.advanceTimersByTimeAsync(1100);
    expect(fetchWeather).toHaveBeenCalledTimes(2);
    expect(store.get().weather.state).toBe('done');
    expect(lastInput(simulate).weather).not.toBeNull();
    stop();
  });

  it('offline: no request, the manual values are used', async () => {
    const { store, actions, simulate, fetchWeather, stop } = setup({ online: () => false });
    draw(actions);
    await vi.advanceTimersByTimeAsync(TO_WEATHER + 1100);
    expect(fetchWeather).not.toHaveBeenCalled();
    expect(store.get().weather).toMatchObject({ state: 'error', error: 'offline' });
    expect(lastInput(simulate).weather).toBeNull();
    stop();
  });

  it('a stored series is used at once after a reload; Update forecast fetches a fresh one', async () => {
    const stored = new Map<string, WeatherSeries>();
    const weatherCache = { get: (key: string) => stored.get(key), remember: vi.fn((s: WeatherSeries) => void stored.set(s.key, s)) };
    const first = setup({ weatherCache });
    draw(first.actions);
    await vi.advanceTimersByTimeAsync(TO_WEATHER + 1100);
    expect(weatherCache.remember).toHaveBeenCalledTimes(1);
    const persisted = JSON.parse(JSON.stringify(toPersisted(first.store.get())));
    first.stop();

    const fetchWeather = vi.fn<WeatherFetcher>(async (req) => seriesFor(req, NOW + 60_000));
    const reload = setup({ weatherCache, fetchWeather }, buildInitialState({ stored: persisted, hash: '', now: NOW }));
    await vi.advanceTimersByTimeAsync(TO_WEATHER + 300);
    expect(fetchWeather).not.toHaveBeenCalled();
    expect(lastInput(reload.simulate).weather?.fetchedAt).toBe(NOW);
    reload.actions.refreshWeather();
    await vi.advanceTimersByTimeAsync(1100);
    expect(fetchWeather).toHaveBeenCalledTimes(1);
    expect(fetchWeather.mock.calls[0][1]?.force).toBe(true);
    expect(lastInput(reload.simulate).weather?.fetchedAt).toBe(NOW + 60_000);
    reload.stop();
  });

  it('manual mode never fetches; switching back to automatic reuses the held series', async () => {
    const { actions, simulate, fetchWeather, stop } = setup();
    draw(actions);
    await vi.advanceTimersByTimeAsync(TO_WEATHER + 1100);
    actions.setWeatherMode('manual');
    await vi.advanceTimersByTimeAsync(500);
    expect(lastInput(simulate).weather).toBeNull();
    actions.setWeatherMode('auto');
    await vi.advanceTimersByTimeAsync(500);
    expect(fetchWeather).toHaveBeenCalledTimes(1);
    expect(lastInput(simulate).weather).not.toBeNull();
    stop();
  });

  it('effort presets wait for the weather and solve with it', async () => {
    const solution: PresetSolution = { preset: 'steady', mps: 3, movingTime: 556, effort: 0.7, goal: 0.7, evaluations: 1 };
    const solvePreset = vi.fn((_input: SimulationInput) => solution);
    const { actions, fetchWeather, stop } = setup({ solvePreset });
    actions.setEffortPreset('steady');
    draw(actions);
    await vi.advanceTimersByTimeAsync(TO_WEATHER + 500);
    expect(solvePreset).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(600);
    expect(fetchWeather).toHaveBeenCalledTimes(1);
    expect(solvePreset).toHaveBeenCalled();
    expect(solvePreset.mock.calls[0][0].weather).not.toBeNull();
    stop();
  });

  it('an example start keeps its local clock time once the route zone is known', async () => {
    const winter = Date.UTC(2026, 0, 12, 9);
    const fetchWeather = vi.fn<WeatherFetcher>(async (req) => ({ ...seriesFor(req, winter, 'Europe/Paris'), key: weatherKey(req) }));
    const state = buildInitialState({ stored: null, hash: '', now: winter });
    const { store, actions, stop } = setup({ fetchWeather, now: () => winter }, state);
    actions.loadExample('mont-blanc-gouter');
    // The example's 02:00 is set at its summer offset (UTC+2) until the zone is known.
    expect(store.get()).toMatchObject({ startAuto: false, session: { utcOffsetMin: 120 } });
    expect(localStartHour(store.get().session)).toBe(2);
    await vi.advanceTimersByTimeAsync(4000);
    const s = store.get();
    expect(s.routeZone).toBe('Europe/Paris');
    expect(s.session.utcOffsetMin).toBe(60);
    expect(localStartHour(s.session)).toBe(2);
    stop();
  });
});

describe('weather identity and the route clock', () => {
  const base = buildInitialState({ stored: null, hash: '', now: NOW });
  const later = { ...base.session, startTime: base.session.startTime + 3_600_000 };

  it('the start time enters the simulation key only while a series is active', () => {
    const key = (s: AppState) => simKey(s.athlete, s.session, weatherIdentity(s));
    expect(key(base)).toBe(key({ ...base, session: later }));
    const series = weatherScenario({ start: NOW });
    const done = { ...base, weather: { state: 'done' as const, key: series.key, series } };
    expect(key(done)).not.toBe(key({ ...done, session: later }));
    const manual = { ...done, session: { ...done.session, weather: { ...done.session.weather!, mode: 'manual' as const } } };
    expect(key(manual)).toBe(key({ ...manual, session: { ...later, weather: manual.session.weather } }));
    expect(weatherIdentity({ ...base, weather: { state: 'error', key: 'k', series: null, error: 'timeout' } })).toBe('fallback');
  });

  it('a set start keeps its wall clock in a new zone; a start following now only takes the offset', () => {
    // 03:00 at UTC+2 on a January day is 03:00 in Paris (UTC+1), an hour later in absolute time.
    const set = { startTime: Date.UTC(2026, 0, 10, 1, 0, 30), utcOffsetMin: 120 };
    expect(rezoneStart(set, 'Europe/Paris', false)).toEqual({ startTime: Date.UTC(2026, 0, 10, 2, 0, 30), utcOffsetMin: 60 });
    expect(rezoneStart(set, 'Europe/Paris', true)).toEqual({ startTime: set.startTime, utcOffsetMin: 60 });
    const consistent = { startTime: Date.UTC(2026, 6, 1), utcOffsetMin: 120 };
    expect(rezoneStart(consistent, 'Europe/Paris', false)).toBe(consistent);
    expect(rezoneStart(set, 'Not/AZone', false)).toBe(set);
  });

  it('a typed wall clock is read in the route zone, or at the fixed offset before the zone is known', () => {
    const wall = { year: 2026, month: 3, day: 29, hour: 2, minute: 30 };
    // 02:30 falls in the spring gap in Zurich and moves forward to 03:30 CEST.
    expect(startFromWallClock('Europe/Zurich', wall, 0)).toEqual({ startTime: Date.UTC(2026, 2, 29, 1, 30), utcOffsetMin: 120 });
    expect(startFromWallClock('', wall, 345)).toEqual({ startTime: Date.UTC(2026, 2, 29, 2, 30) - 345 * 60_000, utcOffsetMin: 345 });
  });
});
