import { bbox } from '../lib/geo';
import { closeLoop, newWaypointId, outAndBack, reverseWaypoints } from '../lib/route';
import { estimateMaxHr, mountainDefaults, type EffortPreset } from '../lib/sim';
import type { Athlete, LngLat, ManualWeather, SessionSettings, SnapProfile, Units, WeatherPin, WeatherSettings, Waypoint } from '../lib/types';
import { MAX_IMPORT_WAYPOINTS } from './config';
import { decimateTrack } from './decimate';
import { EXAMPLES, exampleStart, exampleTarget } from './example';
import * as history from './history';
import { defaultActivityName } from './i18n';
import { encodeTarget, pickTypeDefaults, toWaypoints, type SharePayload } from './persistence';
import { defaultWeatherSettings, lapDistanceFor, localStartHour, type AppState, type MapView, type Notice } from './state';
import type { Store } from './store';

export type Actions = ReturnType<typeof createActions>;

export function createActions(store: Store<AppState>) {
  let seq = 0;

  const commitWaypoints = (next: Waypoint[], extra: Partial<AppState> = {}) => {
    const s = store.get();
    store.set({ ...history.commit(s, next), ...extra });
  };

  const withAutoName = (session: SessionSettings, nameAuto: boolean): SessionSettings =>
    nameAuto ? { ...session, name: defaultActivityName(session.type, localStartHour(session)) } : session;

  const weatherOf = (session: SessionSettings): WeatherSettings => session.weather ?? defaultWeatherSettings();
  const setWeather = (patch: Partial<WeatherSettings>) => {
    const s = store.get();
    store.set({ session: { ...s.session, weather: { ...weatherOf(s.session), ...patch } } });
  };

  const fitTo = (coords: LngLat[], followRoute = false) => {
    if (coords.length === 0) return;
    const [minLon, minLat, maxLon, maxLat] = bbox(coords);
    store.set({ viewRequest: { seq: ++seq, kind: 'fit', bbox: [minLon, minLat, maxLon, maxLat], followRoute } });
  };

  return {
    addWaypoint(lon: number, lat: number) {
      commitWaypoints([...store.get().waypoints, { id: newWaypointId(), lon, lat }], { selectedId: null });
    },
    moveWaypoint(id: string, lon: number, lat: number) {
      const s = store.get();
      if (!s.waypoints.some((w) => w.id === id)) return;
      commitWaypoints(s.waypoints.map((w) => (w.id === id ? { ...w, lon, lat } : w)));
    },
    removeWaypoint(id: string) {
      const s = store.get();
      if (!s.waypoints.some((w) => w.id === id)) return;
      commitWaypoints(
        s.waypoints.filter((w) => w.id !== id),
        s.selectedId === id ? { selectedId: null } : {},
      );
    },
    undo() {
      const s = store.get();
      store.set({ ...history.undo(s), selectedId: null });
    },
    redo() {
      const s = store.get();
      store.set({ ...history.redo(s), selectedId: null });
    },
    closeLoop() {
      commitWaypoints(closeLoop(store.get().waypoints));
    },
    outAndBack() {
      commitWaypoints(outAndBack(store.get().waypoints));
    },
    reverse() {
      commitWaypoints(reverseWaypoints(store.get().waypoints));
    },
    clear() {
      if (store.get().waypoints.length === 0) return;
      commitWaypoints([], { selectedId: null, playhead: null });
    },
    select(id: string | null) {
      store.set({ selectedId: id });
    },
    setProfile(profile: SnapProfile) {
      store.set({ profile });
    },
    /** Loads an example (Montjuïc by default) with its profile, activity, mountain settings, start, temperature and target; undo restores the waypoints. */
    loadExample(id?: string) {
      const example = EXAMPLES.find((e) => e.id === id) ?? EXAMPLES[0];
      const s = store.get();
      let session = s.session;
      if (example.activity !== session.type) session = { ...session, ...pickTypeDefaults(example.activity, session) };
      // A mountain day loads its own gear and conditions, whatever the previous session carried.
      session = { ...session, ...mountainDefaults(example.activity), ...example.mountain };
      if (example.stops) session = { ...session, stops: example.stops };
      // The example's local start is a wall-clock time at the route; the route's zone refines it once the weather arrives.
      const startFlags: Partial<AppState> = example.start ? { startAuto: false } : {};
      if (example.start) session = { ...session, ...exampleStart(example.start, session.startTime) };
      if (example.temperatureC !== undefined) session = { ...session, temperatureC: example.temperatureC };
      let targetFlags: Partial<AppState>;
      if ('effort' in example.suggest) {
        targetFlags = { effortPreset: example.suggest.effort, targetAuto: true };
      } else {
        session = { ...session, target: exampleTarget(example.suggest.elapsedH) };
        targetFlags = { effortPreset: null, targetAuto: false };
      }
      commitWaypoints(toWaypoints(example.coords), {
        profile: example.profile,
        session: withAutoName(session, s.nameAuto),
        selectedId: null,
        notice: null,
        ...targetFlags,
        ...startFlags,
      });
      fitTo(example.coords, true);
    },
    /** Decimated track becomes waypoints joined by straight legs; returns the waypoint count. */
    importTrack(coords: LngLat[], name: string | undefined): number {
      const points = decimateTrack(coords, MAX_IMPORT_WAYPOINTS);
      const s = store.get();
      const trimmed = name?.trim();
      const session = trimmed ? { ...s.session, name: trimmed.slice(0, 120) } : s.session;
      commitWaypoints(toWaypoints(points), { profile: 'none', selectedId: null, session, nameAuto: trimmed ? false : s.nameAuto });
      fitTo(points);
      return points.length;
    },
    applyShare(payload: SharePayload) {
      const s = store.get();
      let session = s.session;
      let targetFlags: Partial<AppState> = {};
      if (payload.activity && payload.activity !== session.type) session = { ...session, ...pickTypeDefaults(payload.activity, session) };
      // A link names its target explicitly; the same target (at link precision) keeps the full-precision value.
      if (payload.target && encodeTarget(payload.target) !== encodeTarget(session.target)) {
        session = { ...session, target: payload.target };
        targetFlags = { targetAuto: false, effortPreset: null };
      }
      if (payload.seed !== undefined) session = { ...session, seed: payload.seed };
      if (payload.hrTarget !== undefined) session = { ...session, hrTarget: payload.hrTarget };
      if (payload.startTime !== undefined) {
        session = { ...session, startTime: payload.startTime, utcOffsetMin: payload.utcOffsetMin ?? -new Date(payload.startTime).getTimezoneOffset() };
        targetFlags = { ...targetFlags, startAuto: false };
      }
      commitWaypoints(toWaypoints(payload.coords), {
        profile: payload.profile ?? s.profile,
        session: withAutoName(session, s.nameAuto),
        selectedId: null,
        ...targetFlags,
      });
      fitTo(payload.coords, true);
    },
    fitRoute() {
      fitTo(store.get().waypoints.map((w) => [w.lon, w.lat] as LngLat));
    },
    flyTo(center: LngLat, zoom: number, box?: [number, number, number, number]) {
      store.set({ viewRequest: box ? { seq: ++seq, kind: 'fit', bbox: box } : { seq: ++seq, kind: 'fly', center, zoom } });
    },
    setView(view: MapView) {
      store.set({ view });
    },

    updateAthlete(patch: Partial<Athlete>) {
      const s = store.get();
      const athlete = { ...s.athlete, ...patch };
      let maxHrAuto = s.maxHrAuto;
      if (patch.maxHr !== undefined) maxHrAuto = false;
      if (maxHrAuto) athlete.maxHr = estimateMaxHr(athlete.age);
      store.set({ athlete, maxHrAuto });
    },
    useAutoMaxHr() {
      const s = store.get();
      store.set({ maxHrAuto: true, athlete: { ...s.athlete, maxHr: estimateMaxHr(s.athlete.age) } });
    },
    updateSession(patch: Partial<SessionSettings>) {
      const s = store.get();
      let session = { ...s.session, ...patch };
      let targetAuto = s.targetAuto;
      let effortPreset = s.effortPreset;
      // Typing a target (or changing its kind) is a manual edit: it detaches the target from any preset.
      if (patch.target !== undefined) {
        targetAuto = false;
        effortPreset = null;
      }
      if (patch.type && patch.type !== s.session.type) {
        session = { ...session, ...pickTypeDefaults(patch.type, s.session) };
        // An untouched target follows the effort instead of a fixed default (25 km/h is 150 % VO2R on some hills).
        if (targetAuto) effortPreset = effortPreset ?? 'steady';
      }
      const startFlags: Partial<AppState> = patch.startTime !== undefined ? { startAuto: false } : {};
      store.set({ session: withAutoName(session, s.nameAuto), targetAuto, effortPreset, ...startFlags });
    },
    /** The start the user set, with the offset of the zone it was typed in; it no longer follows "now". */
    setStart(startTime: number, utcOffsetMin: number) {
      if (!Number.isFinite(startTime) || !Number.isFinite(utcOffsetMin)) return;
      const s = store.get();
      store.set({ startAuto: false, session: withAutoName({ ...s.session, startTime, utcOffsetMin }, s.nameAuto) });
    },
    setWeatherMode(mode: WeatherSettings['mode']) {
      if (weatherOf(store.get().session).mode !== mode) setWeather({ mode });
    },
    /** Manual conditions: the whole activity in manual mode, the fallback and the pinned values in automatic mode. */
    updateManualWeather(patch: Partial<ManualWeather>) {
      setWeather({ manual: { ...weatherOf(store.get().session).manual, ...patch } });
    },
    toggleWeatherPin(pin: WeatherPin) {
      const pinned = weatherOf(store.get().session).pinned;
      const order: readonly WeatherPin[] = ['temperature', 'wind', 'precipitation'];
      setWeather({ pinned: pinned.includes(pin) ? pinned.filter((p) => p !== pin) : order.filter((p) => p === pin || pinned.includes(p)) });
    },
    retryWeather() {
      store.set({ weatherRetry: store.get().weatherRetry + 1 });
    },
    /** Fetches a fresh forecast for the same route and days, bypassing the stored series. */
    refreshWeather() {
      store.set({ weatherRefresh: store.get().weatherRefresh + 1 });
    },
    /** Solve the target for an effort on this route; the pipeline applies it once the terrain is known. */
    setEffortPreset(effortPreset: EffortPreset) {
      store.set({ effortPreset, targetAuto: true });
    },
    /** Average HR to match (bpm), or null for heart rate from the athlete profile. */
    setHrTarget(hrTarget: number | null) {
      const s = store.get();
      store.set({ session: { ...s.session, hrTarget } });
    },
    setName(name: string) {
      const s = store.get();
      const nameAuto = name.trim() === '';
      store.set({ nameAuto, session: withAutoName({ ...s.session, name }, nameAuto) });
    },
    rerollSeed() {
      const s = store.get();
      const seed = crypto.getRandomValues(new Uint32Array(1))[0];
      store.set({ session: { ...s.session, seed } });
    },
    setUnits(units: Units) {
      const s = store.get();
      store.set({ units, session: { ...s.session, lapDistance: lapDistanceFor(units) } });
    },

    setPlayhead(index: number | null) {
      store.set({ playhead: index });
    },
    retryFallbackLegs() {
      const s = store.get();
      store.set({ legs: new Map([...s.legs].filter(([, leg]) => !leg.fallback)) });
    },
    retryTerrain() {
      store.set({ terrainRetry: store.get().terrainRetry + 1 });
    },
    notify(kind: Notice['kind'], text: string) {
      store.set({ notice: { seq: ++seq, kind, text } });
    },
    dismissNotice() {
      store.set({ notice: null });
    },
  };
}
