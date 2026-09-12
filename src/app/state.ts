import type {
  ActivityType,
  Athlete,
  LngLat,
  RouteLeg,
  SessionSettings,
  SimulationResult,
  SnapProfile,
  TerrainProfile,
  Units,
  Waypoint,
} from '../lib/types';
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
  view: MapView | null;
  viewRequest: ViewRequest | null;
  notice: Notice | null;
}

export const SNAP_PROFILES: readonly SnapProfile[] = ['foot', 'hiking', 'bike', 'road-bike', 'mtb', 'none'];
export const ACTIVITIES: readonly ActivityType[] = ['run', 'ride', 'walk', 'hike'];

export function lapDistanceFor(units: Units): number {
  return units === 'imperial' ? 1609.344 : 1000;
}

/** Wall-clock hour at the start location. */
export function localStartHour(session: Pick<SessionSettings, 'startTime' | 'utcOffsetMin'>): number {
  return new Date(session.startTime + session.utcOffsetMin * 60_000).getUTCHours();
}
