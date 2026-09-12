// Waypoints → legs (only changed ones) → joined route → terrain profile → simulate() → result.
// Each stage is debounced and cancellable; the store carries status for the UI.
import { joinLegs, legKey } from '../lib/route';
import { straightLeg, type LegGeometry } from '../lib/services/routing';
import type {
  ActivityType,
  Athlete,
  LngLat,
  RouteLeg,
  SessionSettings,
  SimulationInput,
  SimulationResult,
  SnapProfile,
  TerrainProfile,
  Waypoint,
} from '../lib/types';
import { DELAYS } from './config';
import type { LegCounts } from './i18n';
import type { AppState, RoutingStatus } from './state';
import type { Store } from './store';

export interface PipelineDeps {
  routeLeg: (a: LngLat, b: LngLat, profile: SnapProfile, signal: AbortSignal) => Promise<LegGeometry>;
  buildProfile: (route: LngLat[], activity: ActivityType, signal: AbortSignal) => Promise<TerrainProfile>;
  simulate: (input: SimulationInput) => SimulationResult;
  delays?: Partial<Record<keyof typeof DELAYS, number>>;
}

export interface NeededLeg {
  key: string;
  from: Waypoint;
  to: Waypoint;
}

export function neededLegs(waypoints: Waypoint[], profile: SnapProfile): NeededLeg[] {
  const out: NeededLeg[] = [];
  for (let i = 1; i < waypoints.length; i++) {
    const from = waypoints[i - 1];
    const to = waypoints[i];
    out.push({ key: legKey([from.lon, from.lat], [to.lon, to.lat], profile), from, to });
  }
  return out;
}

export function countLegs(state: Pick<AppState, 'waypoints' | 'profile' | 'legs'>): LegCounts {
  const counts: LegCounts = { routed: 0, straight: 0, fallback: 0, pending: 0 };
  for (const n of neededLegs(state.waypoints, state.profile)) {
    const leg = state.legs.get(n.key);
    if (!leg) counts.pending++;
    else if (leg.fallback) counts.fallback++;
    else if (leg.provider === 'straight') counts.straight++;
    else counts.routed++;
  }
  return counts;
}

/** Joined route geometry, or null while any leg is missing. */
export function routeCoords(state: Pick<AppState, 'waypoints' | 'profile' | 'legs'>): LngLat[] | null {
  const legs: RouteLeg[] = [];
  for (const n of neededLegs(state.waypoints, state.profile)) {
    const leg = state.legs.get(n.key);
    if (!leg) return null;
    legs.push(leg);
  }
  return legs.length ? joinLegs(legs) : null;
}

/** Inputs that change the simulated streams (name, description and start time only label the file). */
export function simKey(athlete: Athlete, session: SessionSettings): string {
  const { name: _n, description: _d, startTime: _s, utcOffsetMin: _o, ...rest } = session;
  return JSON.stringify([athlete, rest]);
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

export function startPipeline(store: Store<AppState>, deps: PipelineDeps): () => void {
  const delays = { ...DELAYS, ...deps.delays };
  const inflight = new Map<string, AbortController>();
  let routeTimer: ReturnType<typeof setTimeout> | undefined;
  let routeTimerSig = '';
  let terrainTimer: ReturnType<typeof setTimeout> | undefined;
  let simTimer: ReturnType<typeof setTimeout> | undefined;
  let terrain = { key: '', controller: null as AbortController | null, profile: null as TerrainProfile | null };
  let lastSimKey = '';
  let pendingSimKey = '';
  let seen: Pick<AppState, 'waypoints' | 'profile' | 'legs' | 'athlete' | 'session' | 'terrainRetry'> | null = null;
  let running = false;
  let dirty = false;
  let disposed = false;

  const setRouting = (next: RoutingStatus) => {
    const cur = store.get().routing;
    if (cur.state !== next.state || cur.done !== next.done || cur.total !== next.total) store.set({ routing: next });
  };

  function finishLeg(n: NeededLeg, controller: AbortController, geometry: LegGeometry) {
    if (inflight.get(n.key) !== controller) return;
    inflight.delete(n.key);
    const legs = new Map(store.get().legs);
    legs.set(n.key, { ...geometry, fromId: n.from.id, toId: n.to.id });
    store.set({ legs });
  }

  function startLegs() {
    const s = store.get();
    for (const n of neededLegs(s.waypoints, s.profile)) {
      if (s.legs.has(n.key) || inflight.has(n.key)) continue;
      const controller = new AbortController();
      inflight.set(n.key, controller);
      const a: LngLat = [n.from.lon, n.from.lat];
      const b: LngLat = [n.to.lon, n.to.lat];
      deps.routeLeg(a, b, s.profile, controller.signal).then(
        (geometry) => finishLeg(n, controller, geometry),
        () => {
          if (controller.signal.aborted) {
            if (inflight.get(n.key) === controller) inflight.delete(n.key);
            return;
          }
          finishLeg(n, controller, straightLeg(a, b, true));
        },
      );
    }
  }

  function cancelTerrain() {
    clearTimeout(terrainTimer);
    terrain.controller?.abort();
    terrain = { key: '', controller: null, profile: null };
  }

  async function runTerrain(key: string, coords: LngLat[], activity: ActivityType) {
    const controller = new AbortController();
    terrain.controller = controller;
    try {
      const profile = await deps.buildProfile(coords, activity, controller.signal);
      if (disposed || terrain.key !== key) return;
      terrain.profile = profile;
      seen = null;
      store.set({ terrain: { state: 'done', profile } });
    } catch (err) {
      if (disposed || controller.signal.aborted || terrain.key !== key) return;
      seen = null;
      store.set({ terrain: { state: 'error', profile: null, error: message(err) }, sim: { ...store.get().sim, state: 'idle' } });
    }
  }

  function runSim() {
    simTimer = undefined;
    const s = store.get();
    const profile = terrain.profile;
    pendingSimKey = '';
    if (!profile) return;
    lastSimKey = `${terrain.key}|${simKey(s.athlete, s.session)}`;
    try {
      const result = deps.simulate({ profile, athlete: s.athlete, session: s.session });
      const n = result.streams.t.length;
      store.set({
        sim: { state: 'done', result, activity: s.session.type, seq: s.sim.seq + 1 },
        playhead: s.playhead !== null && s.playhead < n ? s.playhead : null,
      });
    } catch (err) {
      store.set({ sim: { state: 'error', result: null, activity: s.session.type, error: message(err), seq: s.sim.seq }, playhead: null });
    }
  }

  function step() {
    const s = store.get();
    if (
      seen &&
      seen.waypoints === s.waypoints &&
      seen.profile === s.profile &&
      seen.legs === s.legs &&
      seen.athlete === s.athlete &&
      seen.session === s.session &&
      seen.terrainRetry === s.terrainRetry
    ) {
      return;
    }
    seen = { waypoints: s.waypoints, profile: s.profile, legs: s.legs, athlete: s.athlete, session: s.session, terrainRetry: s.terrainRetry };

    const needed = neededLegs(s.waypoints, s.profile);
    const neededKeys = new Set(needed.map((n) => n.key));
    for (const [key, controller] of inflight) {
      if (!neededKeys.has(key)) {
        controller.abort();
        inflight.delete(key);
      }
    }

    if (needed.length === 0) {
      clearTimeout(routeTimer);
      routeTimerSig = '';
      clearTimeout(simTimer);
      cancelTerrain();
      lastSimKey = '';
      pendingSimKey = '';
      setRouting({ state: 'idle', done: 0, total: 0 });
      if (s.terrain.state !== 'idle' || s.sim.result || s.sim.state !== 'idle') {
        store.set({ terrain: { state: 'idle', profile: null }, sim: { ...s.sim, state: 'idle', result: null, error: undefined }, playhead: null });
      }
      return;
    }

    const missing = needed.filter((n) => !s.legs.has(n.key));
    if (missing.length > 0) {
      setRouting({ state: 'busy', done: needed.length - missing.length, total: needed.length });
      const toStart = missing.filter((n) => !inflight.has(n.key));
      const sig = toStart.map((n) => n.key).join(';');
      if (toStart.length > 0 && sig !== routeTimerSig) {
        clearTimeout(routeTimer);
        routeTimerSig = sig;
        routeTimer = setTimeout(() => {
          routeTimerSig = '';
          if (!disposed) startLegs();
        }, delays.route);
      }
      return;
    }
    setRouting({ state: 'done', done: needed.length, total: needed.length });

    if (s.legs.size > needed.length + 200) {
      store.set({ legs: new Map([...s.legs].filter(([key]) => neededKeys.has(key))) });
      return;
    }

    const activityClass = s.session.type === 'ride' ? 'ride' : 'foot';
    const terrainKey = `${needed.map((n) => n.key).join(';')}|${activityClass}|${s.terrainRetry}`;
    if (terrainKey !== terrain.key) {
      cancelTerrain();
      clearTimeout(simTimer);
      pendingSimKey = '';
      terrain.key = terrainKey;
      const coords = joinLegs(needed.map((n) => s.legs.get(n.key)!));
      const activity = s.session.type;
      store.set({ terrain: { state: 'busy', profile: s.terrain.profile } });
      terrainTimer = setTimeout(() => void runTerrain(terrainKey, coords, activity), delays.terrain);
      return;
    }
    if (!terrain.profile) return;

    const key = `${terrain.key}|${simKey(s.athlete, s.session)}`;
    if (key !== lastSimKey && key !== pendingSimKey) {
      pendingSimKey = key;
      clearTimeout(simTimer);
      if (s.sim.state !== 'busy') store.set({ sim: { ...s.sim, state: 'busy' } });
      simTimer = setTimeout(runSim, delays.sim);
    }
  }

  function reconcile() {
    if (disposed) return;
    if (running) {
      dirty = true;
      return;
    }
    running = true;
    try {
      do {
        dirty = false;
        step();
      } while (dirty);
    } finally {
      running = false;
    }
  }

  const unsubscribe = store.subscribe(reconcile);
  reconcile();

  return () => {
    disposed = true;
    unsubscribe();
    clearTimeout(routeTimer);
    clearTimeout(simTimer);
    cancelTerrain();
    for (const controller of inflight.values()) controller.abort();
    inflight.clear();
  };
}
