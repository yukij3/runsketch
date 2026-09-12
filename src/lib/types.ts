// Shared contract between routing, simulation, export and UI.
// Coordinates are always [lon, lat] (GeoJSON order). Distances in metres, times in seconds.

export type LngLat = [lon: number, lat: number];

export type ActivityType = 'run' | 'ride' | 'walk' | 'hike';

/** Routing profile used to snap legs between waypoints. */
export type SnapProfile = 'foot' | 'hiking' | 'bike' | 'road-bike' | 'mtb' | 'none';

export type RoutingProvider = 'brouter' | 'osrm' | 'valhalla' | 'straight';

export interface Waypoint {
  id: string;
  lon: number;
  lat: number;
}

/** Geometry between two consecutive waypoints. */
export interface RouteLeg {
  fromId: string;
  toId: string;
  coords: LngLat[];
  /** Metres, from the geometry (not the provider). */
  distance: number;
  provider: RoutingProvider;
  /** True when the provider failed and a straight line was used instead. */
  fallback: boolean;
}

/** Route resampled at a fixed spacing with DEM elevation and grade. */
export interface ProfilePoint {
  /** Cumulative distance from start, metres. */
  d: number;
  lon: number;
  lat: number;
  /** Smoothed elevation, metres. */
  ele: number;
  /** Rise over run on a centred baseline, dimensionless (0.05 = 5 %). */
  grade: number;
}

export interface TerrainProfile {
  points: ProfilePoint[];
  spacing: number;
  totalDistance: number;
  ascent: number;
  descent: number;
  minEle: number;
  maxEle: number;
  /** Which elevation source answered. */
  elevationSource: 'mapterhorn' | 'aws-terrarium' | 'open-meteo' | 'none';
}

export type FitnessLevel = 'beginner' | 'recreational' | 'trained' | 'elite';

export interface Athlete {
  age: number;
  sex: 'male' | 'female';
  weightKg: number;
  heightCm: number;
  restHr: number;
  maxHr: number;
  /** ml/kg/min; when absent, derived from fitness level and sex. */
  vo2max?: number;
  fitness: FitnessLevel;
}

export type HrSensor = 'strap' | 'optical';
export type Units = 'metric' | 'imperial';

export type PacingStrategy = 'even' | 'negative' | 'positive';
export type StopsLevel = 'none' | 'few' | 'urban';
export type GpsNoiseLevel = 'off' | 'low' | 'normal' | 'high';

/**
 * What the simulation is normalised to. Every kind resolves to a target MOVING time for the whole route
 * (stops excluded); the engine varies speed with grade, warm-up, fatigue, pacing, corners and noise, then
 * scales effort so the resulting moving time lands within ±0.5 % of it.
 */
export type TargetSpec =
  /** Average moving pace over the whole route, seconds per km (what Strava shows as avg pace). Moving time = distance·secPerKm/1000. */
  | { kind: 'pace'; secPerKm: number }
  /** Average moving speed over the whole route, m/s (rides; also valid for foot sports). Moving time = distance/mps. */
  | { kind: 'speed'; mps: number }
  /** Total moving time for the route, seconds (stopped time is added on top in elapsed time). */
  | { kind: 'duration'; seconds: number };

export interface SessionSettings {
  type: ActivityType;
  /** Start time as epoch milliseconds (UTC). */
  startTime: number;
  /** Minutes east of UTC for the start location (FIT local_timestamp). */
  utcOffsetMin: number;
  target: TargetSpec;
  /** 0 = metronome, 1 = very uneven. Default 0.35. */
  variability: number;
  pacing: PacingStrategy;
  stops: StopsLevel;
  gpsNoise: GpsNoiseLevel;
  hrSensor: HrSensor;
  /** Ambient temperature °C; affects cardiac drift. */
  temperatureC: number;
  /** Seed for every random draw; same seed + inputs = identical file. */
  seed: number;
  name: string;
  description: string;
  /** Lap length for exports and splits, metres (1000 or 1609.344). */
  lapDistance: number;
  /**
   * Average recorded heart rate to match, bpm. When set, the engine solves the athlete's effective VO2max so the
   * mean HR over moving time lands on it; pace, speed and every other kinematic stream stay unchanged.
   * Absent or null: heart rate follows the athlete profile.
   */
  hrTarget?: number | null;
}

/** 1 Hz simulated streams. Index i is second i from the start (elapsed time). */
export interface ActivityStreams {
  /** Elapsed seconds from start (0,1,2,…). */
  t: Float64Array;
  lat: Float64Array;
  lon: Float64Array;
  /** Recorded elevation (with altimeter noise), metres. */
  ele: Float64Array;
  /** Cumulative distance along the true route, metres. */
  dist: Float64Array;
  /** Instantaneous speed m/s. */
  speed: Float64Array;
  /** Heart rate bpm (recorded, with sensor noise). */
  hr: Float64Array;
  /** Steady-state heart rate the current effort demands (no inertia) — for the demand/response chart. */
  hrDemand: Float64Array;
  /** Steps per minute for foot sports, rpm for cycling. 0 when stopped. */
  cadence: Float64Array;
  /** Watts (cycling model, or running power estimate). */
  power: Float64Array;
  /** Grade at the current position, dimensionless. */
  grade: Float64Array;
  /** 1 moving, 0 stopped. */
  moving: Uint8Array;
}

export interface Lap {
  index: number;
  startIndex: number;
  endIndex: number;
  distance: number;
  elapsed: number;
  moving: number;
  avgSpeed: number;
  avgHr: number;
  maxHr: number;
  avgCadence: number;
  ascent: number;
  descent: number;
}

export interface ActivitySummary {
  distance: number;
  elapsed: number;
  moving: number;
  avgSpeed: number;
  maxSpeed: number;
  avgHr: number;
  maxHr: number;
  avgCadence: number;
  avgPower: number;
  ascent: number;
  descent: number;
  calories: number;
  laps: Lap[];
}

export interface SimulationResult {
  streams: ActivityStreams;
  summary: ActivitySummary;
  /** Human-readable notes, e.g. "Target pace too fast for 18% climb — capped". */
  warnings: string[];
  /** ml/kg/min: the effective VO2max solved for session.hrTarget. Present only when an HR target was matched. */
  impliedVo2max?: number;
}

export interface SimulationInput {
  profile: TerrainProfile;
  athlete: Athlete;
  session: SessionSettings;
}

export type ExportFormat = 'fit' | 'tcx' | 'gpx';

export interface ExportInput {
  result: SimulationResult;
  session: SessionSettings;
  athlete: Athlete;
  appName: string;
  appVersion: string;
}
