// Waypoints → legs (only changed ones) → joined route → terrain profile → weather → simulate() → result.
// Each stage is debounced and cancellable; the store carries status for the UI.
import { joinLegs, legKey, type RouteLine } from '../lib/route';
import { straightLeg, type LegGeometry } from '../lib/services/routing';
import { WeatherError, weatherKey, type WeatherFetcher, type WeatherRequest } from '../lib/services/weather';
import { weatherSamplePoints, weatherWindow } from '../lib/weather/points';
import { isTimeZone } from '../lib/weather/time';
import type { EffortPreset, PresetSolution } from '../lib/sim';
import type {
  ActivityType,
  Athlete,
  LngLat,
  RouteLeg,
  SessionSettings,
  SimulationInput,
  SimulationResult,
  SnapProfile,
  StopsLevel,
  TargetSpec,
  TerrainProfile,
  Units,
  WaySpan,
  Waypoint,
  WeatherSeries,
} from '../lib/types';
import { DELAYS } from './config';
import { defaultActivityName, type LegCounts } from './i18n';
import { roundLeg } from './legCache';
import { localStartHour, type AppState, type RoutingStatus } from './state';
import type { Store } from './store';
import { rezoneStart } from './zone';

type MaybePromise<T> = T | Promise<T>;

export interface PipelineDeps {
  routeLeg: (a: LngLat, b: LngLat, profile: SnapProfile, signal: AbortSignal) => Promise<LegGeometry>;
  /** `ways`: way tags along the route when any leg carries them (see joinLegs). */
  buildProfile: (route: LngLat[], activity: ActivityType, signal: AbortSignal, ways?: WaySpan[]) => Promise<TerrainProfile>;
  /** Synchronous, or asynchronous with latest-request-wins (a superseded promise rejects with name 'SupersededError'). */
  simulate: (input: SimulationInput) => MaybePromise<SimulationResult>;
  /** Solves the average speed for an effort preset; without it presets are not applied. */
  solvePreset?: (input: SimulationInput, preset: EffortPreset) => MaybePromise<PresetSolution | null>;
  /** Fetches weather for automatic mode; without it the weather stage is off and the engine gets the manual conditions. */
  fetchWeather?: WeatherFetcher;
  /** Series kept across reloads, so a stored route and start simulate at once and identically. */
  weatherCache?: { get(key: string): WeatherSeries | undefined; remember(series: WeatherSeries): void };
  /** False skips the request and leaves the manual values in use. */
  online?: () => boolean;
  /** Clock that decides between forecast and archive, epoch ms. */
  now?: () => number;
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
  return legs.length ? joinLegs(legs).coords : null;
}

const STOP_ALLOWANCE: Readonly<Record<StopsLevel, number>> = { none: 0, few: 0.05, urban: 0.2, alpine: 0.25 };

/** Elapsed seconds the weather should cover: the target's moving time plus a stop allowance, with 15 % to spare. */
export function expectedElapsed(session: Pick<SessionSettings, 'target' | 'stops'>, distance: number): number {
  const t = session.target;
  let moving = t.kind === 'duration' ? t.seconds : t.kind === 'pace' ? (distance * t.secPerKm) / 1000 : distance / t.mps;
  if (!(Number.isFinite(moving) && moving > 0)) moving = 3600;
  return moving * (1 + (STOP_ALLOWANCE[session.stops] ?? 0)) * 1.15;
}

/** The weather request for a profile and start: sampled points and whole days around the activity (widened by `elapsedHint`, s). */
export function weatherRequest(profile: TerrainProfile, session: SessionSettings, now: number, elapsedHint = 0): WeatherRequest {
  const elapsed = Math.max(expectedElapsed(session, profile.totalDistance), 1.1 * elapsedHint);
  return { points: weatherSamplePoints(profile), ...weatherWindow(session.startTime, elapsed), now };
}

/**
 * What of the weather the simulated streams depend on: in automatic mode with a series, the series and the start (to
 * the minute, with its offset); 'fallback' when automatic mode fell back to the manual values; '' otherwise.
 */
export function weatherIdentity(s: Pick<AppState, 'session' | 'weather'>): string {
  if (s.session.weather?.mode !== 'auto') return '';
  const w = s.weather;
  if (w.state === 'done' && w.series) return `${w.series.key}|${w.series.fetchedAt}|${Math.floor(s.session.startTime / 60_000)}|${s.session.utcOffsetMin}`;
  return w.state === 'error' ? 'fallback' : '';
}

/**
 * Inputs that change the simulated streams: name and description only label the file, and so does the start time unless
 * a weather series is active (pass weatherIdentity as `weather`).
 */
export function simKey(athlete: Athlete, session: SessionSettings, weather = ''): string {
  const { name: _n, description: _d, startTime: _s, utcOffsetMin: _o, ...rest } = session;
  return JSON.stringify(weather ? [athlete, rest, weather] : [athlete, rest]);
}

/** Inputs that change what an effort preset solves to (everything the kinematics, weather and VO2max see, not the target). */
export function presetKey(s: Pick<AppState, 'athlete' | 'session' | 'effortPreset' | 'units'> & Partial<Pick<AppState, 'weather'>>): string {
  const { name: _n, description: _d, startTime: _s, utcOffsetMin: _o, target, hrTarget: _h, lapDistance: _l, ...rest } = s.session;
  const weather = s.weather ? weatherIdentity({ session: s.session, weather: s.weather }) : '';
  return JSON.stringify([s.athlete, rest, s.effortPreset, s.units, presetKind(s.session.type, target), ...(weather ? [weather] : [])]);
}

function presetKind(type: ActivityType, target: TargetSpec): TargetSpec['kind'] {
  if (target.kind === 'duration') return 'duration';
  return type === 'ride' ? 'speed' : 'pace';
}

/**
 * A preset's average speed as a target of the current kind, rounded to what the target field shows: whole seconds
 * per km or mile, 0.1 km/h or mph, or whole seconds of moving time.
 */
export function presetTarget(solution: PresetSolution, session: SessionSettings, units: Units): TargetSpec {
  const kind = presetKind(session.type, session.target);
  if (kind === 'duration') return { kind, seconds: Math.max(10, Math.round(solution.movingTime)) };
  const perUnit = units === 'imperial' ? 1.609344 : 1;
  if (kind === 'pace') return { kind, secPerKm: Math.min(3600, Math.max(90, Math.round((1000 * perUnit) / solution.mps))) / perUnit };
  const factor = units === 'imperial' ? 3600 / 1609.344 : 3.6;
  return { kind, mps: Math.max(1, Math.round(solution.mps * factor * 10) / 10) / factor };
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));
const superseded = (err: unknown) => err instanceof Error && err.name === 'SupersededError';
const isPromise = <T>(value: MaybePromise<T>): value is Promise<T> => typeof (value as Promise<T>)?.then === 'function';

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
  /** Increments whenever a started simulation must not land any more (newer request, new terrain, cleared route). */
  let simToken = 0;
  const preset = { done: '', pending: '' };
  const now = deps.now ?? (() => Date.now());
  const initial = store.get();
  /** The weather request in use: its key, the retry and refresh counters it answered, and the pending fetch. */
  const weather = {
    key: '',
    retry: initial.weatherRetry,
    refresh: initial.weatherRefresh,
    controller: null as AbortController | null,
    timer: undefined as ReturnType<typeof setTimeout> | undefined,
  };
  /** Longest elapsed time simulated on the current terrain, s: a target that runs long widens the weather window once. */
  let elapsedHint = { terrain: '', seconds: 0 };
  let seen: Pick<
    AppState,
    'waypoints' | 'profile' | 'legs' | 'athlete' | 'session' | 'terrainRetry' | 'effortPreset' | 'units' | 'weather' | 'weatherRetry' | 'weatherRefresh'
  > | null = null;
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
    // Rounded exactly as the leg cache stores it, so a reload reproduces this geometry bit for bit.
    legs.set(n.key, { ...roundLeg(geometry), fromId: n.from.id, toId: n.to.id });
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

  async function runTerrain(key: string, line: RouteLine, activity: ActivityType) {
    const controller = new AbortController();
    terrain.controller = controller;
    try {
      const profile = await deps.buildProfile(line.coords, activity, controller.signal, line.ways);
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

  function cancelWeather() {
    clearTimeout(weather.timer);
    weather.timer = undefined;
    weather.controller?.abort();
    weather.controller = null;
  }

  /** The series the engine simulates with: automatic mode with a series for the current request, otherwise none (manual values). */
  const engineWeather = (s: AppState): WeatherSeries | null =>
    deps.fetchWeather && s.session.weather?.mode === 'auto' && s.weather.state === 'done' && s.weather.key === weather.key ? s.weather.series : null;

  /** A simulation started with other weather must not land. */
  function dropPendingSim() {
    clearTimeout(simTimer);
    pendingSimKey = '';
    simToken++;
  }

  /** Puts a series in use: points at the current route distances, and the start moved into the route's time zone. */
  function applyWeather(key: string, req: WeatherRequest, series: WeatherSeries) {
    const s = store.get();
    const patch: Partial<AppState> = { weather: { state: 'done', key, series: { ...series, points: req.points.map((p) => ({ ...p })) } } };
    if (isTimeZone(series.timezone)) {
      if (series.timezone !== s.routeZone) patch.routeZone = series.timezone;
      let session = rezoneStart(s.session, series.timezone, s.startAuto);
      if (session !== s.session && s.nameAuto) session = { ...session, name: defaultActivityName(session.type, localStartHour(session)) };
      if (session !== s.session) patch.session = session;
    }
    store.set(patch);
  }

  async function runWeather(key: string, req: WeatherRequest, force: boolean) {
    weather.timer = undefined;
    const fetchWeather = deps.fetchWeather;
    if (!fetchWeather) return;
    const controller = new AbortController();
    weather.controller = controller;
    try {
      const series = await fetchWeather(req, { signal: controller.signal, force });
      if (disposed || controller.signal.aborted || weather.key !== key) return;
      weather.controller = null;
      deps.weatherCache?.remember(series);
      applyWeather(key, req, series);
    } catch (err) {
      if (disposed || controller.signal.aborted || weather.key !== key) return;
      weather.controller = null;
      store.set({ weather: { state: 'error', key, series: null, error: err instanceof WeatherError ? err.kind : 'network' } });
    }
  }

  /**
   * Automatic weather for the route and start: a held or cached series is applied at once, otherwise it is fetched after
   * a debounce. Returns false while presets and the simulation must wait. Errors leave the manual values in use.
   */
  function weatherStage(s: AppState, profile: TerrainProfile): boolean {
    if (!deps.fetchWeather || s.session.weather?.mode !== 'auto') {
      if (weather.key) {
        cancelWeather();
        weather.key = '';
        if (s.weather.state === 'busy') {
          store.set({ weather: { ...s.weather, state: 'idle' } });
          return false;
        }
      }
      return true;
    }
    const hint = elapsedHint.terrain === terrain.key ? elapsedHint.seconds : 0;
    const req = weatherRequest(profile, s.session, now(), hint);
    const key = weatherKey(req);
    const refresh = s.weatherRefresh !== weather.refresh;
    if (key !== weather.key || refresh || s.weatherRetry !== weather.retry) {
      cancelWeather();
      weather.key = key;
      weather.retry = s.weatherRetry;
      weather.refresh = s.weatherRefresh;
      dropPendingSim();
      const held = s.weather.key === key && s.weather.state === 'done' ? s.weather.series : null;
      const cached = refresh ? null : (held ?? deps.weatherCache?.get(key) ?? null);
      if (cached) {
        applyWeather(key, req, cached);
        return false;
      }
      if (deps.online && !deps.online()) {
        store.set({ weather: { state: 'error', key, series: null, error: 'offline' } });
        return false;
      }
      store.set({ weather: { state: 'busy', key, series: null }, ...(s.sim.state !== 'busy' ? { sim: { ...s.sim, state: 'busy' as const } } : {}) });
      weather.timer = setTimeout(() => void runWeather(key, req, refresh), delays.weather);
      return false;
    }
    if (s.weather.key !== key || s.weather.state === 'busy') {
      if (s.sim.state !== 'busy') store.set({ sim: { ...s.sim, state: 'busy' } });
      return false;
    }
    // The same series on an edited route: its points take the current distances along the route.
    const series = s.weather.series;
    if (s.weather.state === 'done' && series && series.points.some((p, i) => p.d !== req.points[i]?.d)) {
      store.set({ weather: { ...s.weather, series: { ...series, points: req.points.map((p) => ({ ...p })) } } });
      return false;
    }
    return true;
  }

  function runSim() {
    simTimer = undefined;
    const s = store.get();
    const profile = terrain.profile;
    pendingSimKey = '';
    if (!profile) return;
    const terrainKey = terrain.key;
    lastSimKey = `${terrainKey}|${simKey(s.athlete, s.session, weatherIdentity(s))}`;
    const token = ++simToken;
    const activity = s.session.type;
    const apply = (result: SimulationResult) => {
      if (disposed || token !== simToken) return;
      const elapsed = result.summary?.elapsed;
      if (typeof elapsed === 'number' && Number.isFinite(elapsed)) {
        elapsedHint = { terrain: terrainKey, seconds: elapsedHint.terrain === terrainKey ? Math.max(elapsedHint.seconds, elapsed) : elapsed };
      }
      const cur = store.get();
      const n = result.streams.t.length;
      store.set({
        sim: { state: 'done', result, activity, seq: cur.sim.seq + 1 },
        playhead: cur.playhead !== null && cur.playhead < n ? cur.playhead : null,
      });
    };
    const fail = (err: unknown) => {
      if (disposed || token !== simToken || superseded(err)) return;
      store.set({ sim: { state: 'error', result: null, activity, error: message(err), seq: store.get().sim.seq }, playhead: null });
    };
    try {
      const out = deps.simulate({ profile, athlete: s.athlete, session: s.session, weather: engineWeather(s) });
      if (isPromise(out)) out.then(apply, fail);
      else apply(out);
    } catch (err) {
      fail(err);
    }
  }

  /** Solves the active effort preset for the current terrain and applies it as the target. */
  function runPreset(key: string, s: AppState, profile: TerrainProfile, solve: NonNullable<PipelineDeps['solvePreset']>) {
    preset.pending = key;
    const chosen = s.effortPreset as EffortPreset;
    const current = () => {
      const cur = store.get();
      return cur.effortPreset && terrain.profile ? `${terrain.key}|${presetKey(cur)}` : '';
    };
    const finish = (solution: PresetSolution | null) => {
      if (disposed || preset.pending !== key) return;
      preset.pending = '';
      if (current() !== key) {
        seen = null;
        reconcile();
        return;
      }
      preset.done = key;
      const cur = store.get();
      seen = null;
      if (solution) {
        const target = presetTarget(solution, cur.session, cur.units);
        if (JSON.stringify(target) !== JSON.stringify(cur.session.target)) {
          store.set({ session: { ...cur.session, target } });
          return;
        }
      }
      reconcile();
    };
    const fail = (err: unknown) => {
      if (superseded(err)) return;
      finish(null);
    };
    try {
      const out = solve({ profile, athlete: s.athlete, session: s.session, weather: engineWeather(s) }, chosen);
      if (isPromise(out)) out.then(finish, fail);
      else finish(out);
    } catch (err) {
      fail(err);
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
      seen.terrainRetry === s.terrainRetry &&
      seen.effortPreset === s.effortPreset &&
      seen.units === s.units &&
      seen.weather === s.weather &&
      seen.weatherRetry === s.weatherRetry &&
      seen.weatherRefresh === s.weatherRefresh
    ) {
      return;
    }
    seen = {
      waypoints: s.waypoints,
      profile: s.profile,
      legs: s.legs,
      athlete: s.athlete,
      session: s.session,
      terrainRetry: s.terrainRetry,
      effortPreset: s.effortPreset,
      units: s.units,
      weather: s.weather,
      weatherRetry: s.weatherRetry,
      weatherRefresh: s.weatherRefresh,
    };

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
      cancelWeather();
      weather.key = '';
      lastSimKey = '';
      pendingSimKey = '';
      simToken++;
      preset.pending = '';
      setRouting({ state: 'idle', done: 0, total: 0 });
      const weatherIdle = s.weather.state === 'busy' ? { weather: { ...s.weather, state: 'idle' as const } } : {};
      if (s.terrain.state !== 'idle' || s.sim.result || s.sim.state !== 'idle' || s.weather.state === 'busy') {
        store.set({ terrain: { state: 'idle', profile: null }, sim: { ...s.sim, state: 'idle', result: null, error: undefined }, playhead: null, ...weatherIdle });
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
      simToken++;
      terrain.key = terrainKey;
      const line = joinLegs(needed.map((n) => s.legs.get(n.key)!));
      const activity = s.session.type;
      store.set({ terrain: { state: 'busy', profile: s.terrain.profile } });
      terrainTimer = setTimeout(() => void runTerrain(terrainKey, line, activity), delays.terrain);
      return;
    }
    if (!terrain.profile) return;
    if (!weatherStage(s, terrain.profile)) return;

    // An effort preset is solved for this terrain and weather before the session is simulated with its target.
    if (s.effortPreset && deps.solvePreset) {
      const pk = `${terrain.key}|${presetKey(s)}`;
      if (pk !== preset.done) {
        clearTimeout(simTimer);
        pendingSimKey = '';
        // Any simulation started before the preset lands is stale; forget it so the solved target runs afresh.
        simToken++;
        lastSimKey = '';
        if (s.sim.state !== 'busy') store.set({ sim: { ...s.sim, state: 'busy' } });
        if (pk !== preset.pending) runPreset(pk, s, terrain.profile, deps.solvePreset);
        return;
      }
    }

    const key = `${terrain.key}|${simKey(s.athlete, s.session, weatherIdentity(s))}`;
    if (key !== lastSimKey && key !== pendingSimKey) {
      pendingSimKey = key;
      clearTimeout(simTimer);
      simToken++;
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
    cancelWeather();
    for (const controller of inflight.values()) controller.abort();
    inflight.clear();
  };
}
