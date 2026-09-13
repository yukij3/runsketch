// Effort presets, heart-rate matching, async simulation and restored legs through the store, actions and pipeline.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { haversine } from '../lib/geo';
import { RouteImportError } from '../lib/import';
import { legKey } from '../lib/route';
import { rollingProfile, simulate, solveEffortPreset, type PresetSolution } from '../lib/sim';
import type { LngLat, SimulationInput, SimulationResult, SnapProfile, TerrainProfile } from '../lib/types';
import { createActions } from './actions';
import { translate } from './i18n';
import { importErrorText } from './importErrors';
import { LegCache, roundLeg } from './legCache';
import { buildInitialState, decodeShare, encodeShare, toPersisted } from './persistence';
import { presetKey, presetTarget, startPipeline, type PipelineDeps } from './pipeline';
import { createStore } from './store';

const NOW = Date.UTC(2026, 8, 12, 7);

function hillyProfile(route: LngLat[]): TerrainProfile {
  const p = rollingProfile(6000, 30, 1500, { origin: route[0] });
  return p;
}

function setup(overrides: Partial<PipelineDeps> = {}) {
  const store = createStore(buildInitialState({ stored: null, hash: '', now: NOW }));
  const actions = createActions(store);
  const routeLeg = vi.fn(async (a: LngLat, b: LngLat, profile: SnapProfile) => {
    const mid: LngLat = [(a[0] + b[0]) / 2 + 1.23456789e-4, (a[1] + b[1]) / 2];
    return { coords: [a, mid, b], distance: haversine(a, b), provider: profile === 'none' ? ('straight' as const) : ('osrm' as const), fallback: false };
  });
  const buildProfile = vi.fn(async (route: LngLat[]) => hillyProfile(route));
  const simulateDep = vi.fn((input: SimulationInput) => simulate(input));
  const solvePreset = vi.fn((input: SimulationInput, preset: Parameters<typeof solveEffortPreset>[1]) => solveEffortPreset(input, preset));
  const stop = startPipeline(store, { routeLeg, buildProfile, simulate: simulateDep, solvePreset, delays: { route: 0, terrain: 0, sim: 0 }, ...overrides });
  return { store, actions, routeLeg, buildProfile, simulate: simulateDep, solvePreset, stop };
}

async function drawRoute(actions: ReturnType<typeof createActions>) {
  actions.addWaypoint(2.15, 41.37);
  actions.addWaypoint(2.16, 41.375);
  await vi.advanceTimersByTimeAsync(50);
}

describe('effort presets in the app', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('switching an untouched run to a ride applies Steady for this route instead of 25 km/h', async () => {
    const { store, actions, solvePreset, stop } = setup();
    await drawRoute(actions);
    expect(store.get().sim.state).toBe('done');
    expect(solvePreset).not.toHaveBeenCalled();
    expect(store.get().session.target).toEqual({ kind: 'pace', secPerKm: 330 });

    actions.updateSession({ type: 'ride' });
    expect(store.get().effortPreset).toBe('steady');
    await vi.advanceTimersByTimeAsync(50);
    expect(solvePreset).toHaveBeenCalledTimes(1);
    const s = store.get();
    expect(s.sim.state).toBe('done');
    expect(s.sim.activity).toBe('ride');
    expect(s.session.target.kind).toBe('speed');
    const kmh = s.session.target.kind === 'speed' ? s.session.target.mps * 3.6 : 0;
    expect(Math.round(kmh * 10) / 10).toBeCloseTo(kmh, 9);
    expect(kmh).not.toBeCloseTo(25, 0);
    expect(s.sim.result!.warnings.some((w) => /VO2 reserve/.test(w))).toBe(false);
    stop();
  });

  it('presets order heart rate, a manual target edit detaches the preset, and nothing re-solves needlessly', async () => {
    const { store, actions, solvePreset, simulate: sim, stop } = setup();
    await drawRoute(actions);
    actions.setEffortPreset('easy');
    await vi.advanceTimersByTimeAsync(50);
    const easy = store.get().sim.result!.summary;
    const easyPace = store.get().session.target;
    actions.setEffortPreset('race');
    await vi.advanceTimersByTimeAsync(50);
    const race = store.get().sim.result!.summary;
    expect(race.avgHr).toBeGreaterThan(easy.avgHr + 8);
    expect(race.avgSpeed).toBeGreaterThan(easy.avgSpeed);
    expect(easyPace.kind === 'pace' && Number.isInteger(easyPace.secPerKm)).toBe(true);
    const calls = solvePreset.mock.calls.length;
    const sims = sim.mock.calls.length;

    actions.setName('Label only');
    await vi.advanceTimersByTimeAsync(50);
    expect(solvePreset.mock.calls.length).toBe(calls);
    expect(sim.mock.calls.length).toBe(sims);

    actions.updateSession({ target: { kind: 'pace', secPerKm: 400 } });
    expect(store.get()).toMatchObject({ effortPreset: null, targetAuto: false });
    actions.updateSession({ type: 'walk' });
    expect(store.get().effortPreset).toBeNull();
    stop();
  });

  it('keeps a duration target a duration and re-solves when the athlete changes', async () => {
    const { store, actions, solvePreset, stop } = setup();
    await drawRoute(actions);
    actions.updateSession({ target: { kind: 'duration', seconds: 2400 } });
    actions.setEffortPreset('steady');
    await vi.advanceTimersByTimeAsync(50);
    const first = store.get().session.target;
    expect(first.kind).toBe('duration');
    actions.updateAthlete({ fitness: 'elite' });
    await vi.advanceTimersByTimeAsync(50);
    const second = store.get().session.target;
    expect(second.kind === 'duration' && first.kind === 'duration' && second.seconds < first.seconds).toBe(true);
    expect(solvePreset).toHaveBeenCalledTimes(2);
    expect(store.get().sim.state).toBe('done');
    stop();
  });

  it('rounds preset targets to what the field shows', () => {
    const solution: PresetSolution = { preset: 'steady', mps: 2.8765, movingTime: 3600.4, effort: 0.7, goal: 0.7, evaluations: 3 };
    const base = buildInitialState({ stored: null, hash: '', now: NOW }).session;
    expect(presetTarget(solution, base, 'metric')).toEqual({ kind: 'pace', secPerKm: 348 });
    const imperial = presetTarget(solution, base, 'imperial');
    expect(imperial.kind === 'pace' && Math.round(imperial.secPerKm * 1.609344)).toBe(559);
    expect(presetTarget(solution, { ...base, type: 'ride', target: { kind: 'speed', mps: 7 } }, 'metric')).toEqual({ kind: 'speed', mps: 10.4 / 3.6 });
    expect(presetTarget(solution, { ...base, target: { kind: 'duration', seconds: 10 } }, 'metric')).toEqual({ kind: 'duration', seconds: 3600 });
    const s = buildInitialState({ stored: null, hash: '', now: NOW });
    expect(presetKey(s)).toBe(presetKey({ ...s, session: { ...s.session, target: { kind: 'pace', secPerKm: 999 }, hrTarget: 150, name: 'x' } }));
  });
});

describe('async simulation', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('applies only the latest result and ignores superseded rejections', async () => {
    const pending: Array<{ input: SimulationInput; resolve: (r: SimulationResult) => void; reject: (e: unknown) => void }> = [];
    const asyncSim = vi.fn(
      (input: SimulationInput) =>
        new Promise<SimulationResult>((resolve, reject) => {
          pending.push({ input, resolve, reject });
        }),
    );
    const { store, actions, stop } = setup({ simulate: asyncSim });
    await drawRoute(actions);
    expect(pending).toHaveLength(1);
    actions.updateAthlete({ age: 50 });
    await vi.advanceTimersByTimeAsync(10);
    expect(pending).toHaveLength(2);
    const superseded = Object.assign(new Error('Superseded'), { name: 'SupersededError' });
    pending[0].reject(superseded);
    pending[1].resolve(simulate(pending[1].input));
    await vi.advanceTimersByTimeAsync(0);
    expect(store.get().sim.state).toBe('done');
    expect(store.get().sim.seq).toBe(1);
    // A late answer for the older request is dropped.
    pending[0].resolve(simulate(pending[0].input));
    await vi.advanceTimersByTimeAsync(0);
    expect(store.get().sim.seq).toBe(1);
    stop();
  });
});

describe('heart-rate matching in the app', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('matches the average without touching pace, persists and shares the target', async () => {
    const { store, actions, stop } = setup();
    await drawRoute(actions);
    const before = store.get().sim.result!;
    actions.setHrTarget(150);
    await vi.advanceTimersByTimeAsync(50);
    const after = store.get().sim.result!;
    expect(Math.abs(after.summary.avgHr - 150)).toBeLessThanOrEqual(0.6);
    expect(after.summary.moving).toBe(before.summary.moving);
    expect(Array.from(after.streams.speed)).toEqual(Array.from(before.streams.speed));
    expect(after.impliedVo2max).toBeGreaterThan(20);

    const hash = `#${encodeShare(store.get())}`;
    expect(hash).toMatch(/&h=150$/);
    expect(decodeShare(hash)?.hrTarget).toBe(150);
    expect(decodeShare(hash.replace('h=150', 'h=999'))?.hrTarget).toBeUndefined();
    const persisted = JSON.parse(JSON.stringify(toPersisted(store.get())));
    const restored = buildInitialState({ stored: persisted, hash, now: NOW + 3_600_000 });
    expect(restored.session.hrTarget).toBe(150);
    actions.setHrTarget(null);
    expect(`#${encodeShare(store.get())}`).not.toMatch(/h=/);
    stop();
  });
});

describe('reload reproduces the route', () => {
  it('restores stored legs, the preset flags and the full-precision target', () => {
    const store = createStore(buildInitialState({ stored: null, hash: '', now: NOW }));
    const actions = createActions(store);
    actions.addWaypoint(2.1496771234, 41.3751029876);
    actions.addWaypoint(2.153216543, 41.368806123);
    actions.setUnits('imperial');
    actions.updateSession({ target: { kind: 'pace', secPerKm: 596 / 1.609344 } });
    actions.setEffortPreset('tempo');
    const [a, b] = store.get().waypoints;
    const key = legKey([a.lon, a.lat], [b.lon, b.lat], store.get().profile);
    const geometry = roundLeg({ coords: [[a.lon, a.lat], [2.151, 41.372], [b.lon, b.lat]], distance: 0, provider: 'osrm', fallback: false });
    const cache = new LegCache();
    cache.remember(new Map([[key, { ...geometry, fromId: a.id, toId: b.id }]]));

    const stored = JSON.parse(JSON.stringify(toPersisted(store.get())));
    const hash = `#${encodeShare(store.get())}`;
    const reloaded = buildInitialState({ stored, hash, now: NOW + 86_400_000, legs: cache });
    expect(reloaded.session.target).toEqual(store.get().session.target);
    expect(reloaded).toMatchObject({ effortPreset: 'tempo', targetAuto: true });
    const [leg] = [...reloaded.legs.values()];
    expect(leg.coords).toEqual(geometry.coords);
    expect(leg.fromId).toBe(reloaded.waypoints[0].id);

    // A link with another target detaches the preset.
    const other = buildInitialState({ stored, hash: hash.replace(/t=p[\d.]+/, 't=p300'), now: NOW });
    expect(other).toMatchObject({ effortPreset: null, targetAuto: false, session: { target: { kind: 'pace', secPerKm: 300 } } });
  });
});

describe('import errors', () => {
  it('are written by code', () => {
    expect(importErrorText(translate, new RouteImportError('unsupported', 'x', 'kml'))).toBe('Unsupported file: expected GPX or TCX, but the document root is <kml>.');
    expect(importErrorText(translate, new RouteImportError('fit', 'x'))).toMatch(/^FIT files cannot be imported/);
    expect(importErrorText(translate, new RouteImportError('invalidXml', 'x'))).toBe('This file is not valid XML.');
    expect(importErrorText(translate, new RouteImportError('invalidXml', 'x', 'line 1'))).toBe('This file is not valid XML (line 1).');
    expect(importErrorText(translate, new RouteImportError('empty', 'x'))).toBe('The file is empty.');
    expect(importErrorText(translate, new Error('plain'))).toBe('plain');
  });
});
