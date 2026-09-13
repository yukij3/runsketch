import type {
  ActivityType,
  Athlete,
  LngLat,
  RouteLeg,
  SessionSettings,
  SimulationResult,
  SnapProfile,
  StopsLevel,
  TerrainProfile,
  Units,
  WeatherSeries,
  WeatherSettings,
  Waypoint,
} from '../lib/types';
import type { WeatherErrorKind } from '../lib/services/weather';
import type { EffortPreset } from '../lib/sim';
import type { Lang } from './i18n';

export type StageState = 'idle' | 'busy' | 'done' | 'error';

export interface MapView {
  center: LngLat;
  zoom: number;
}

export type ViewRequest =
  /** followRoute: fit again to the routed geometry once every leg has arrived. */
  | { seq: number; kind: 'fit'; bbox: [number, number, number, number]; followRoute?: boolean }
  | { seq: number; kind: 'fly'; center: LngLat; zoom: number };

export interface Notice {
  seq: number;
  kind: 'error' | 'info';
  text: string;
}

export interface RoutingStatus {
  state: StageState;
  done: number;
  total: number;
}

export interface TerrainStatus {
  state: StageState;
  profile: TerrainProfile | null;
  error?: string;
}

export interface SimStatus {
  state: StageState;
  result: SimulationResult | null;
  /** Activity the result was simulated for (the session may have changed since). */
  activity: ActivityType;
  error?: string;
  /** Increments on every new result; drives the trace reveal. */
  seq: number;
}

export interface WeatherStatus {
  /** idle: manual mode or nothing to fetch yet; error: the manual values stand in. */
  state: StageState;
  /** Request key of the series in use or being fetched ('' when none). */
  key: string;
  series: WeatherSeries | null;
  error?: WeatherErrorKind;
}

export interface AppState {
  waypoints: Waypoint[];
  past: Waypoint[][];
  future: Waypoint[][];
  selectedId: string | null;
  profile: SnapProfile;
  /** Leg geometries by legKey(from, to, profile). */
  legs: ReadonlyMap<string, RouteLeg>;
  athlete: Athlete;
  /** Max HR follows the age estimate until the user edits it. */
  maxHrAuto: boolean;
  session: SessionSettings;
  /** Name follows activity, start hour and language until the user edits it. */
  nameAuto: boolean;
  /**
   * True until the user edits the target by hand. While true, switching the activity applies an effort preset
   * (the chosen one, or Steady) instead of a fixed default.
   */
  targetAuto: boolean;
  /** Effort the target is solved for on the current route and athlete; null when the target is a plain value. */
  effortPreset: EffortPreset | null;
  units: Units;
  lang: Lang;
  playhead: number | null;
  routing: RoutingStatus;
  terrain: TerrainStatus;
  sim: SimStatus;
  /** Bumped to force a new elevation lookup. */
  terrainRetry: number;
  weather: WeatherStatus;
  /** Bumped to fetch the weather again after a failure. */
  weatherRetry: number;
  /** Bumped to fetch a fresh forecast, bypassing the caches. */
  weatherRefresh: number;
  /** IANA zone of the route from the last weather response ('' until known); the start is shown and typed in it. */
  routeZone: string;
  /** True while the start follows "now"; false once the user, a link or an example sets it. */
  startAuto: boolean;
  view: MapView | null;
  viewRequest: ViewRequest | null;
  notice: Notice | null;
}

export const SNAP_PROFILES: readonly SnapProfile[] = ['foot', 'hiking', 'alpine', 'bike', 'road-bike', 'mtb', 'none'];
export const ACTIVITIES: readonly ActivityType[] = ['run', 'ride', 'walk', 'hike', 'alpine'];

/** Stop schedules offered for an activity: mountain breaks for hikes and mountaineering. */
export function stopsLevels(type: ActivityType): readonly StopsLevel[] {
  if (type === 'alpine') return ['none', 'few', 'alpine'];
  return type === 'hike' ? ['none', 'few', 'urban', 'alpine'] : ['none', 'few', 'urban'];
}

/** Weather settings of a new session: automatic, with neutral manual values as the fallback. */
export function defaultWeatherSettings(): WeatherSettings {
  return { mode: 'auto', manual: { humidityPct: 60, windMps: 0, windFromDeg: 0, rainMmH: 0 }, pinned: [] };
}

export function lapDistanceFor(units: Units): number {
  return units === 'imperial' ? 1609.344 : 1000;
}

/** Wall-clock hour at the start location. */
export function localStartHour(session: Pick<SessionSettings, 'startTime' | 'utcOffsetMin'>): number {
  return new Date(session.startTime + session.utcOffsetMin * 60_000).getUTCHours();
}
