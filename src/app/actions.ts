import { bbox } from '../lib/geo';
import { closeLoop, newWaypointId, outAndBack, reverseWaypoints } from '../lib/route';
import { estimateMaxHr } from '../lib/sim';
import type { Athlete, LngLat, SessionSettings, SnapProfile, Units, Waypoint } from '../lib/types';
import { MAX_IMPORT_WAYPOINTS } from './config';
import { decimateTrack } from './decimate';
import { EXAMPLE_ROUTE } from './example';
import * as history from './history';
import { defaultActivityName, type Lang } from './i18n';
import { pickTypeDefaults, toWaypoints, type SharePayload } from './persistence';
import { lapDistanceFor, localStartHour, type AppState, type MapView, type Notice } from './state';
import type { Store } from './store';

export type Actions = ReturnType<typeof createActions>;

export function createActions(store: Store<AppState>) {
  let seq = 0;

  const commitWaypoints = (next: Waypoint[], extra: Partial<AppState> = {}) => {
    const s = store.get();
    store.set({ ...history.commit(s, next), ...extra });
  };

  const withAutoName = (session: SessionSettings, lang: Lang, nameAuto: boolean): SessionSettings =>
    nameAuto ? { ...session, name: defaultActivityName(lang, session.type, localStartHour(session)) } : session;

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
    loadExample() {
      commitWaypoints(toWaypoints(EXAMPLE_ROUTE.coords), { profile: EXAMPLE_ROUTE.profile, selectedId: null, notice: null });
      fitTo(EXAMPLE_ROUTE.coords, true);
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
      if (payload.activity && payload.activity !== session.type) session = { ...session, ...pickTypeDefaults(payload.activity, session) };
      if (payload.target) session = { ...session, target: payload.target };
      if (payload.seed !== undefined) session = { ...session, seed: payload.seed };
      commitWaypoints(toWaypoints(payload.coords), {
        profile: payload.profile ?? s.profile,
        session: withAutoName(session, s.lang, s.nameAuto),
        selectedId: null,
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
      if (patch.type && patch.type !== s.session.type) session = { ...session, ...pickTypeDefaults(patch.type, s.session) };
      store.set({ session: withAutoName(session, s.lang, s.nameAuto) });
    },
    setName(name: string) {
      const s = store.get();
      const nameAuto = name.trim() === '';
      store.set({ nameAuto, session: withAutoName({ ...s.session, name }, s.lang, nameAuto) });
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
    setLang(lang: Lang) {
      const s = store.get();
      store.set({ lang, session: withAutoName(s.session, lang, s.nameAuto) });
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
