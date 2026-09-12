import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { haversine } from '../lib/geo';
import type { LngLat, SimulationInput, SimulationResult, SnapProfile, TerrainProfile } from '../lib/types';
import { createActions } from './actions';
import { buildInitialState } from './persistence';
import { startPipeline, type PipelineDeps } from './pipeline';
import { createStore } from './store';
import { startSync } from './sync';

function fakeProfile(route: LngLat[]): TerrainProfile {
  return {
    points: route.map(([lon, lat], i) => ({ d: i * 10, lon, lat, ele: 100, grade: 0 })),
    spacing: 5,
    totalDistance: route.length * 10,
    ascent: 0,
    descent: 0,
    minEle: 100,
    maxEle: 100,
    elevationSource: 'mapterhorn',
  };
}

function fakeResult(input: SimulationInput): SimulationResult {
  const n = input.profile.points.length * 3;
  return { streams: { t: new Float64Array(n) }, summary: { laps: [] }, warnings: [] } as unknown as SimulationResult;
}

function setup(overrides: Partial<PipelineDeps> = {}) {
  const store = createStore(buildInitialState({ stored: null, hash: '', language: 'en', now: Date.UTC(2026, 8, 12, 7) }));
  const actions = createActions(store);
  const signals: AbortSignal[] = [];
  const routeLeg = vi.fn(async (a: LngLat, b: LngLat, profile: SnapProfile, signal: AbortSignal) => {
    signals.push(signal);
    await new Promise((r) => setTimeout(r, 50));
    const mid: LngLat = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2 + 1e-4];
    return { coords: [a, mid, b], distance: haversine(a, b), provider: profile === 'none' ? ('straight' as const) : ('osrm' as const), fallback: false };
  });
  const buildProfile = vi.fn(async (route: LngLat[]) => fakeProfile(route));
  const simulate = vi.fn(fakeResult);
  const stop = startPipeline(store, { routeLeg, buildProfile, simulate, ...overrides });
  return { store, actions, routeLeg, buildProfile, simulate, signals, stop };
}

describe('pipeline', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('routes legs, samples terrain once, then simulates', async () => {
    const { store, actions, routeLeg, buildProfile, simulate, stop } = setup();
    actions.addWaypoint(0, 0);
    actions.addWaypoint(0.01, 0);
    actions.addWaypoint(0.01, 0.01);
    expect(store.get().routing).toEqual({ state: 'busy', done: 0, total: 2 });
    await vi.advanceTimersByTimeAsync(240);
    expect(routeLeg).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(20);
    expect(routeLeg).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(60);
    expect(store.get().routing.state).toBe('done');
    expect(store.get().terrain.state).toBe('busy');
    await vi.advanceTimersByTimeAsync(400);
    expect(buildProfile).toHaveBeenCalledTimes(1);
    expect(buildProfile.mock.calls[0][0]).toHaveLength(5);
    expect(store.get().terrain.state).toBe('done');
    expect(store.get().sim.state).toBe('busy');
    await vi.advanceTimersByTimeAsync(120);
    expect(simulate).toHaveBeenCalledTimes(1);
    expect(store.get().sim).toMatchObject({ state: 'done', seq: 1, activity: 'run' });
    expect(store.get().sim.result).not.toBeNull();
    stop();
  });

  it('re-simulates only on athlete or session edits, and ignores labels', async () => {
    const { store, actions, routeLeg, buildProfile, simulate, stop } = setup();
    actions.addWaypoint(0, 0);
    actions.addWaypoint(0.01, 0);
    await vi.advanceTimersByTimeAsync(2000);
    expect(simulate).toHaveBeenCalledTimes(1);

    actions.updateAthlete({ age: 40 });
    actions.updateAthlete({ age: 41 });
    await vi.advanceTimersByTimeAsync(130);
    expect(simulate).toHaveBeenCalledTimes(2);
    expect(simulate.mock.calls[1][0].athlete.age).toBe(41);

    actions.setName('Label only');
    actions.updateSession({ description: 'no physics here' });
    await vi.advanceTimersByTimeAsync(500);
    expect(simulate).toHaveBeenCalledTimes(2);
    expect(routeLeg).toHaveBeenCalledTimes(1);
    expect(buildProfile).toHaveBeenCalledTimes(1);

    actions.updateSession({ type: 'ride' });
    await vi.advanceTimersByTimeAsync(600);
    expect(buildProfile).toHaveBeenCalledTimes(2);
    expect(store.get().sim.activity).toBe('ride');
    stop();
  });

  it('re-routes only the legs a moved waypoint touches', async () => {
    const { store, actions, routeLeg, stop } = setup();
    [0, 0.01, 0.02, 0.03].forEach((lon) => actions.addWaypoint(lon, 0));
    await vi.advanceTimersByTimeAsync(2000);
    expect(routeLeg).toHaveBeenCalledTimes(3);
    const last = store.get().waypoints[3];
    actions.moveWaypoint(last.id, 0.03, 0.005);
    expect(store.get().routing).toEqual({ state: 'busy', done: 2, total: 3 });
    await vi.advanceTimersByTimeAsync(2000);
    expect(routeLeg).toHaveBeenCalledTimes(4);
    // Undo restores coordinates whose leg is still held, so nothing is requested again.
    actions.undo();
    await vi.advanceTimersByTimeAsync(2000);
    expect(routeLeg).toHaveBeenCalledTimes(4);
    expect(store.get().routing.state).toBe('done');
    stop();
  });

  it('aborts requests for legs that are no longer needed', async () => {
    const { store, actions, signals, stop } = setup();
    actions.addWaypoint(0, 0);
    actions.addWaypoint(0.01, 0);
    await vi.advanceTimersByTimeAsync(260);
    expect(signals).toHaveLength(1);
    actions.moveWaypoint(store.get().waypoints[1].id, 0.02, 0);
    expect(signals[0].aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(2000);
    expect(store.get().legs.size).toBe(1);
    expect(store.get().sim.state).toBe('done');
    stop();
  });

  it('falls back to a straight leg when routing throws, and clears results below two waypoints', async () => {
    const { store, actions, stop } = setup({ routeLeg: vi.fn(async () => Promise.reject(new Error('down'))) });
    actions.addWaypoint(0, 0);
    actions.addWaypoint(0.01, 0);
    await vi.advanceTimersByTimeAsync(2000);
    const [leg] = [...store.get().legs.values()];
    expect(leg).toMatchObject({ provider: 'straight', fallback: true });
    expect(store.get().sim.result).not.toBeNull();
    actions.removeWaypoint(store.get().waypoints[1].id);
    expect(store.get().sim.result).toBeNull();
    expect(store.get().routing.state).toBe('idle');
    stop();
  });

  it('reports elevation failures and retries on request', async () => {
    let fail = true;
    const buildProfile = vi.fn(async (route: LngLat[]) => {
      if (fail) throw new Error('DEM offline');
      return fakeProfile(route);
    });
    const { store, actions, stop } = setup({ buildProfile });
    actions.addWaypoint(0, 0);
    actions.addWaypoint(0.01, 0);
    await vi.advanceTimersByTimeAsync(2000);
    expect(store.get().terrain).toMatchObject({ state: 'error', error: 'DEM offline' });
    fail = false;
    actions.retryTerrain();
    await vi.advanceTimersByTimeAsync(2000);
    expect(store.get().terrain.state).toBe('done');
    expect(store.get().sim.state).toBe('done');
    stop();
  });

  it('reports simulation errors without crashing', async () => {
    const { store, actions, stop } = setup({
      simulate: vi.fn(() => {
        throw new Error('bad input');
      }),
    });
    actions.addWaypoint(0, 0);
    actions.addWaypoint(0.01, 0);
    await vi.advanceTimersByTimeAsync(2000);
    expect(store.get().sim).toMatchObject({ state: 'error', error: 'bad input', result: null });
    stop();
  });
});

describe('sync', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('debounces storage writes and mirrors the route into the hash', async () => {
    const store = createStore(buildInitialState({ stored: null, hash: '', language: 'en', now: 0 }));
    const actions = createActions(store);
    const storage = { setItem: vi.fn() };
    const location = { hash: '', pathname: '/runsketch/', search: '' };
    const history = {
      replaceState: vi.fn((_: unknown, __: string, url: string) => {
        location.hash = new URL(url, 'https://example.test').hash;
      }),
    };
    const stop = startSync(store, { storage, location, history });
    actions.addWaypoint(1, 2);
    actions.addWaypoint(1.01, 2.01);
    actions.setPlayhead(5);
    expect(storage.setItem).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(300);
    expect(storage.setItem).toHaveBeenCalledTimes(1);
    expect(location.hash).toMatch(/^#v=1&r=/);
    expect(history.replaceState.mock.calls[0][2]).toMatch(/^\/runsketch\/#v=1/);
    actions.setPlayhead(6);
    await vi.advanceTimersByTimeAsync(300);
    expect(storage.setItem).toHaveBeenCalledTimes(1);
    actions.clear();
    await vi.advanceTimersByTimeAsync(300);
    expect(location.hash).toBe('');
    stop();
  });
});
