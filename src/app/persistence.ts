// localStorage preferences and the share link in location.hash. Everything read back is validated.
import { decodePolyline, encodePolyline } from '../lib/geo';
import { legKey, newWaypointId } from '../lib/route';
import { EFFORT_PRESETS, defaultAthlete, defaultSession, estimateMaxHr, type EffortPreset } from '../lib/sim';
import type { LegGeometry } from '../lib/services/routing';
import type {
  ActivityType,
  Athlete,
  FitnessLevel,
  GpsNoiseLevel,
  HrSensor,
  LngLat,
  PacingStrategy,
  RouteLeg,
  SessionSettings,
  SnapProfile,
  StopsLevel,
  TargetSpec,
  Units,
  Waypoint,
} from '../lib/types';
import { STORAGE_KEY } from './config';
import { defaultActivityName, detectLang, type Lang } from './i18n';
import { ACTIVITIES, SNAP_PROFILES, lapDistanceFor, localStartHour, type AppState, type MapView } from './state';

type Json = Record<string, unknown>;

const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown, lo: number, hi: number, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : fallback;
const oneOf = <T extends string>(v: unknown, options: readonly T[], fallback: T): T =>
  typeof v === 'string' && (options as readonly string[]).includes(v) ? (v as T) : fallback;
const str = (v: unknown, max: number, fallback: string): string => (typeof v === 'string' ? v.slice(0, max) : fallback);

const FITNESS: readonly FitnessLevel[] = ['beginner', 'recreational', 'trained', 'elite'];
const PACING: readonly PacingStrategy[] = ['even', 'negative', 'positive'];
const STOPS: readonly StopsLevel[] = ['none', 'few', 'urban'];
const GPS: readonly GpsNoiseLevel[] = ['off', 'low', 'normal', 'high'];
const SENSORS: readonly HrSensor[] = ['strap', 'optical'];

export function sanitizeAthlete(raw: unknown, fallback: Athlete = defaultAthlete()): Athlete {
  const r = isObject(raw) ? raw : {};
  const age = Math.round(num(r.age, 10, 99, fallback.age));
  const athlete: Athlete = {
    age,
    sex: oneOf(r.sex, ['male', 'female'] as const, fallback.sex),
    weightKg: num(r.weightKg, 25, 250, fallback.weightKg),
    heightCm: num(r.heightCm, 110, 230, fallback.heightCm),
    restHr: Math.round(num(r.restHr, 30, 110, fallback.restHr)),
    maxHr: Math.round(num(r.maxHr, 100, 230, estimateMaxHr(age))),
    fitness: oneOf(r.fitness, FITNESS, fallback.fitness),
  };
  if (athlete.restHr > athlete.maxHr - 40) athlete.restHr = athlete.maxHr - 40;
  return athlete;
}

export function sanitizeTarget(raw: unknown, fallback: TargetSpec): TargetSpec {
  if (!isObject(raw)) return fallback;
  if (raw.kind === 'pace' && typeof raw.secPerKm === 'number' && raw.secPerKm >= 60 && raw.secPerKm <= 3600) {
    return { kind: 'pace', secPerKm: raw.secPerKm };
  }
  if (raw.kind === 'speed' && typeof raw.mps === 'number' && raw.mps >= 0.3 && raw.mps <= 30) return { kind: 'speed', mps: raw.mps };
  if (raw.kind === 'duration' && typeof raw.seconds === 'number' && raw.seconds >= 10 && raw.seconds <= 7 * 86400) {
    return { kind: 'duration', seconds: Math.round(raw.seconds) };
  }
  return fallback;
}

/** Average HR target, whole bpm in 40–230, or null (heart rate from the athlete profile). */
export function sanitizeHrTarget(raw: unknown): number | null {
  return typeof raw === 'number' && Number.isFinite(raw) && raw >= 40 && raw <= 230 ? Math.round(raw) : null;
}

/** Stored session preferences over today's defaults; start time is always "now". */
export function sanitizeSession(raw: unknown, base: SessionSettings): SessionSettings {
  const r = isObject(raw) ? raw : {};
  const type = oneOf(r.type, ACTIVITIES, base.type);
  const typed = type === base.type ? base : { ...defaultSession(type, base.startTime), startTime: base.startTime, utcOffsetMin: base.utcOffsetMin };
  return {
    ...typed,
    type,
    target: sanitizeTarget(r.target, typed.target),
    variability: num(r.variability, 0, 1, typed.variability),
    pacing: oneOf(r.pacing, PACING, typed.pacing),
    stops: oneOf(r.stops, STOPS, typed.stops),
    gpsNoise: oneOf(r.gpsNoise, GPS, typed.gpsNoise),
    hrSensor: oneOf(r.hrSensor, SENSORS, typed.hrSensor),
    temperatureC: num(r.temperatureC, -40, 50, typed.temperatureC),
    seed: Math.trunc(num(r.seed, 0, 0xffffffff, typed.seed)),
    name: str(r.name, 120, typed.name),
    description: str(r.description, 2000, typed.description),
    hrTarget: sanitizeHrTarget(r.hrTarget),
  };
}

function sanitizeCoords(raw: unknown, max = 500): LngLat[] {
  if (!Array.isArray(raw)) return [];
  const out: LngLat[] = [];
  for (const c of raw.slice(0, max)) {
    if (!Array.isArray(c) || c.length < 2) continue;
    const [lon, lat] = c;
    if (typeof lon !== 'number' || typeof lat !== 'number' || !Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
    out.push([lon, lat]);
  }
  return out;
}

function sanitizeView(raw: unknown): MapView | null {
  if (!isObject(raw)) return null;
  const center = sanitizeCoords([raw.center])[0];
  const zoom = num(raw.zoom, 0, 22, NaN);
  return center && Number.isFinite(zoom) ? { center, zoom } : null;
}

export const toWaypoints = (coords: LngLat[]): Waypoint[] => coords.map(([lon, lat]) => ({ id: newWaypointId(), lon, lat }));

export interface PersistedState {
  v: 1;
  athlete: Athlete;
  maxHrAuto: boolean;
  session: Omit<SessionSettings, 'startTime' | 'utcOffsetMin' | 'lapDistance'>;
  nameAuto: boolean;
  targetAuto: boolean;
  effortPreset: EffortPreset | null;
  units: Units;
  lang: Lang;
  profile: SnapProfile;
  waypoints: LngLat[];
  view: MapView | null;
}

export function toPersisted(s: AppState): PersistedState {
  const { startTime: _start, utcOffsetMin: _offset, lapDistance: _lap, ...session } = s.session;
  return {
    v: 1,
    athlete: s.athlete,
    maxHrAuto: s.maxHrAuto,
    session: { ...session, hrTarget: session.hrTarget ?? null },
    nameAuto: s.nameAuto,
    targetAuto: s.targetAuto,
    effortPreset: s.effortPreset,
    units: s.units,
    lang: s.lang,
    profile: s.profile,
    waypoints: s.waypoints.map((w) => [w.lon, w.lat]),
    view: s.view,
  };
}

// ---------------------------------------------------------------------------------------------
// Share link: #v=1&r=<polyline>&p=<profile>&a=<activity>&t=<p330|s6.944|d3600>&s=<seed>[&h=<avg HR bpm>]

export interface SharePayload {
  coords: LngLat[];
  profile?: SnapProfile;
  activity?: ActivityType;
  target?: TargetSpec;
  seed?: number;
  /** Average HR to match; absent when the link follows the athlete profile. */
  hrTarget?: number;
}

export function encodeTarget(t: TargetSpec): string {
  if (t.kind === 'pace') return `p${Math.round(t.secPerKm * 10) / 10}`;
  if (t.kind === 'speed') return `s${Math.round(t.mps * 1000) / 1000}`;
  return `d${Math.round(t.seconds)}`;
}

export function decodeTarget(text: string | null): TargetSpec | undefined {
  if (!text) return undefined;
  const value = Number(text.slice(1));
  const raw = text[0] === 'p' ? { kind: 'pace', secPerKm: value } : text[0] === 's' ? { kind: 'speed', mps: value } : text[0] === 'd' ? { kind: 'duration', seconds: value } : null;
  const none = { kind: 'duration', seconds: -1 } as TargetSpec;
  const t = sanitizeTarget(raw, none);
  return t === none ? undefined : t;
}

export function encodeShare(s: Pick<AppState, 'waypoints' | 'profile' | 'session'>): string {
  const params = new URLSearchParams();
  params.set('v', '1');
  params.set('r', encodePolyline(s.waypoints.map((w) => [w.lon, w.lat])));
  params.set('p', s.profile);
  params.set('a', s.session.type);
  params.set('t', encodeTarget(s.session.target));
  params.set('s', String(s.session.seed));
  const hr = sanitizeHrTarget(s.session.hrTarget);
  if (hr !== null) params.set('h', String(hr));
  return params.toString();
}

export function decodeShare(hash: string): SharePayload | null {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  if (params.get('v') !== '1') return null;
  let coords: LngLat[] = [];
  try {
    coords = sanitizeCoords(decodePolyline(params.get('r') ?? ''));
  } catch {
    return null;
  }
  const payload: SharePayload = { coords };
  const profile = params.get('p');
  if (profile && (SNAP_PROFILES as readonly string[]).includes(profile)) payload.profile = profile as SnapProfile;
  const activity = params.get('a');
  if (activity && (ACTIVITIES as readonly string[]).includes(activity)) payload.activity = activity as ActivityType;
  const target = decodeTarget(params.get('t'));
  if (target) payload.target = target;
  const seed = Number(params.get('s'));
  if (params.has('s') && Number.isInteger(seed) && seed >= 0 && seed <= 0xffffffff) payload.seed = seed;
  const hr = params.has('h') ? sanitizeHrTarget(Number(params.get('h'))) : null;
  if (hr !== null) payload.hrTarget = hr;
  return payload;
}

// ---------------------------------------------------------------------------------------------

/**
 * The share polyline keeps 1e-5° (about 1 m). When it names the stored route, the stored full-precision
 * copy wins so a reload re-routes the exact same legs and reproduces the same file.
 */
export function sameRoute(shared: LngLat[], stored: LngLat[]): boolean {
  const tolerance = 6e-6;
  return (
    shared.length === stored.length &&
    shared.every((c, i) => Math.abs(c[0] - stored[i][0]) <= tolerance && Math.abs(c[1] - stored[i][1]) <= tolerance)
  );
}

export interface InitialEnv {
  stored: unknown;
  hash: string;
  language?: string;
  now: number;
  /** Persisted routed legs by legKey; matching legs are restored so a reload does not route again. */
  legs?: { get(key: string): LegGeometry | undefined };
}

function restoreLegs(waypoints: Waypoint[], profile: SnapProfile, cache: InitialEnv['legs']): Map<string, RouteLeg> {
  const legs = new Map<string, RouteLeg>();
  if (!cache) return legs;
  for (let i = 1; i < waypoints.length; i++) {
    const from = waypoints[i - 1];
    const to = waypoints[i];
    const key = legKey([from.lon, from.lat], [to.lon, to.lat], profile);
    const geometry = cache.get(key);
    if (geometry) legs.set(key, { ...geometry, fromId: from.id, toId: to.id });
  }
  return legs;
}

export function buildInitialState(env: InitialEnv): AppState {
  const stored = isObject(env.stored) && env.stored.v === 1 ? env.stored : {};
  const share = decodeShare(env.hash);
  const lang = oneOf(stored.lang, ['en', 'ru'] as const, detectLang(env.language));
  const units = oneOf(stored.units, ['metric', 'imperial'] as const, 'metric');

  const base = defaultSession('run', Math.floor(env.now / 60_000) * 60_000);
  let session = sanitizeSession(stored.session, base);
  if (share?.activity && share.activity !== session.type) {
    session = { ...session, ...pickTypeDefaults(share.activity, session) };
  }
  let targetAuto = stored.targetAuto !== false;
  let effortPreset: EffortPreset | null =
    targetAuto && typeof stored.effortPreset === 'string' && (EFFORT_PRESETS as readonly string[]).includes(stored.effortPreset)
      ? (stored.effortPreset as EffortPreset)
      : null;
  // The link rounds the target; when it names the stored target, the stored full-precision value wins (a reload
  // must reproduce the same moving time).
  if (share?.target && encodeTarget(share.target) !== encodeTarget(session.target)) {
    session = { ...session, target: share.target };
    targetAuto = false;
    effortPreset = null;
  }
  if (share?.seed !== undefined) session = { ...session, seed: share.seed };
  if (share?.hrTarget !== undefined) session = { ...session, hrTarget: share.hrTarget };
  session.lapDistance = lapDistanceFor(units);

  const nameAuto = stored.nameAuto !== false || !session.name.trim();
  if (nameAuto) session.name = defaultActivityName(lang, session.type, localStartHour(session));

  const athlete = sanitizeAthlete(stored.athlete);
  const maxHrAuto = stored.maxHrAuto !== false;
  if (maxHrAuto) athlete.maxHr = estimateMaxHr(athlete.age);

  const storedCoords = sanitizeCoords(stored.waypoints);
  const coords = share && share.coords.length > 0 && !sameRoute(share.coords, storedCoords) ? share.coords : storedCoords;
  const profile = share?.profile ?? oneOf(stored.profile, SNAP_PROFILES, 'foot');
  const waypoints = toWaypoints(coords);

  return {
    waypoints,
    past: [],
    future: [],
    selectedId: null,
    profile,
    legs: restoreLegs(waypoints, profile, env.legs),
    athlete,
    maxHrAuto,
    session,
    nameAuto,
    targetAuto,
    effortPreset,
    units,
    lang,
    playhead: null,
    routing: { state: 'idle', done: 0, total: 0 },
    terrain: { state: 'idle', profile: null },
    sim: { state: 'idle', result: null, activity: session.type, seq: 0 },
    terrainRetry: 0,
    view: sanitizeView(stored.view),
    viewRequest: null,
    notice: null,
  };
}

/** Target and name defaults when the activity type changes (a duration target is kept). */
export function pickTypeDefaults(type: ActivityType, current: SessionSettings): Pick<SessionSettings, 'type' | 'target'> {
  const target = current.target.kind === 'duration' ? current.target : defaultSession(type, current.startTime).target;
  return { type, target };
}

export function loadStored(storage: Pick<Storage, 'getItem'> | undefined): unknown {
  try {
    const text = storage?.getItem(STORAGE_KEY);
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

export function saveStored(storage: Pick<Storage, 'setItem'> | undefined, state: AppState): void {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(toPersisted(state)));
  } catch {
    // Private mode or quota: preferences simply do not persist.
  }
}
