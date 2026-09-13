// Shared contract between routing, simulation, export and UI.
// Coordinates are always [lon, lat] (GeoJSON order). Distances in metres, times in seconds.

export type LngLat = [lon: number, lat: number];

/** `alpine`: mountaineering, glacier and high-altitude summit days (beyond `hike`). */
export type ActivityType = 'run' | 'ride' | 'walk' | 'hike' | 'alpine';

/** Routing profile used to snap legs between waypoints. `alpine` reaches glacier and scramble routes (SAC T4–T6). */
export type SnapProfile = 'foot' | 'hiking' | 'alpine' | 'bike' | 'road-bike' | 'mtb' | 'none';

export type RoutingProvider = 'brouter' | 'osrm' | 'valhalla' | 'straight';

export interface Waypoint {
  id: string;
  lon: number;
  lat: number;
}

/** OSM way tags over one stretch of a line. */
export interface WaySpan {
  /** Index in `coords` of the stretch's last vertex; the stretch starts at the previous span's `end` (or vertex 0). */
  end: number;
  /** Space-separated `key=value` pairs as the router reported them (see WAY_TAG_KEYS); '' when unknown. */
  tags: string;
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
  /** Way tags along the leg, covering every segment in order. Absent when the router gives none (OSRM, straight lines, older cached legs). */
  ways?: WaySpan[];
}

/**
 * Coarse surface class derived from OSM way tags (surface, highway, tracktype, sac_scale). The mountain classes
 * (snow, ice, scree, rock) come from alpine ways; a consumer without factors for a class treats it as neutral.
 */
export type SurfaceClass = 'paved' | 'compacted' | 'gravel' | 'ground' | 'rough' | 'sand' | 'steps' | 'snow' | 'ice' | 'scree' | 'rock';

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
  /** Surface under this point; absent when the router gave no tags (OSRM, straight lines, old cached legs). */
  surface?: SurfaceClass;
  /** 0 = smooth path … 1 = alpine/technical trail (sac_scale, trail_visibility); absent when unknown. */
  technicality?: number;
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
  /** Metres of route whose grade hit the activity's grade limit (see terrain gradeLimit). */
  gradeClampedM?: number;
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
/** `alpine`: breaks of a mountain day (regular rests, a gear stop where crampons go on, a summit stop). */
export type StopsLevel = 'none' | 'few' | 'urban' | 'alpine';
export type GpsNoiseLevel = 'off' | 'low' | 'normal' | 'high';

/** Time spent at altitude before the activity: arrived within about two days, about a week, three weeks or more. */
export type Acclimatisation = 'none' | 'partial' | 'full';
/** A pair of trail or running shoes (≈0.6 kg), mountain boots (≈2.1 kg) or double boots (≈2.7 kg). */
export type Footwear = 'trail-shoes' | 'mountain-boots' | 'double-boots';
/** Snow underfoot: firm (a footprint of about 3 cm), soft (12 cm) or deep (25 cm). */
export type SnowCondition = 'firm' | 'soft' | 'deep';

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
  /** Manual air temperature °C (the fallback in automatic weather mode, and the value a temperature pin holds). */
  temperatureC: number;
  /**
   * Weather mode, manual conditions and pins. Absent: manual at temperatureC, 60 % humidity, calm and dry, which
   * reproduces the output from before weather existed byte for byte.
   */
  weather?: WeatherSettings;
  /** Seed for every random draw; same seed + inputs = identical file. */
  seed: number;
  name: string;
  description: string;
  /** Lap length for exports and splits, metres (1000 or 1609.344). */
  lapDistance: number;
  /**
   * Average recorded heart rate to match, bpm. When set, the engine solves the athlete's effective VO2max so the
   * mean HR over timer time (auto-paused stop seconds excluded, as in the summary and the files) lands on it; pace, speed and every other kinematic stream stay unchanged.
   * Absent or null: heart rate follows the athlete profile.
   */
  hrTarget?: number | null;
  /**
   * Mountain settings. Absent fields take the activity's defaults (see mountainDefaults): acclimatisation applies to
   * every sport, the pack to walks, hikes and `alpine` days; footwear, crampons, snow and the snowline shape `alpine` days.
   */
  acclimatisation?: Acclimatisation;
  /** Backpack mass, kg. */
  packKg?: number;
  footwear?: Footwear;
  /** Crampons go on where snow or ice starts. */
  crampons?: boolean;
  snow?: SnowCondition;
  /** Altitude above which ground without a known surface counts as snow, m; null or absent: estimated from latitude. */
  snowlineM?: number | null;
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
  /** Device temperature sensor °C (body-warmed on the wrist). */
  temperature: Float64Array;
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
  /** Highest terrain elevation reached, m (absent in summaries not built by the engine). */
  maxEle?: number;
  /** Metres gained per hour of moving time spent climbing; 0 without climbs. */
  climbRate?: number;
}

export interface SimulationResult {
  streams: ActivityStreams;
  summary: ActivitySummary;
  /** Human-readable notes, e.g. "Target pace too fast for 18% climb — capped". */
  warnings: string[];
  /** ml/kg/min: the effective VO2max solved for session.hrTarget. Present only when an HR target was matched. */
  impliedVo2max?: number;
  /** What the athlete met; present when the simulation ran with weather (a series, or manual wind, rain or humidity). */
  weather?: WeatherSummary;
}

export interface SimulationInput {
  profile: TerrainProfile;
  athlete: Athlete;
  session: SessionSettings;
  /**
   * Weather along the route for session.weather in automatic mode. Absent, null, or ignored in manual mode: constant
   * conditions from session.temperatureC and session.weather.manual.
   */
  weather?: WeatherSeries | null;
}

// ---------------------------------------------------------------- weather

/** Where a weather series came from: a forecast, an archived forecast, reanalysis, or a past year standing in for the date. */
export type WeatherSource = 'forecast' | 'historical-forecast' | 'archive' | 'climatology';

/** A route point weather was requested for, rounded exactly as the request sent it. */
export interface WeatherPoint {
  /** Metres along the route. */
  d: number;
  lon: number;
  lat: number;
  /** Elevation the provider downscaled to: the route elevation rounded to 10 m. */
  ele: number;
}

/**
 * Hourly weather at a few points along the route, as plain arrays so it crosses the worker boundary, persists and
 * hashes. Values are quantised when parsed. Arrays are [point][slot]: slot k is valid at t0 + k·stepS for instant
 * variables and covers the preceding step for sums and means. Gaps the service could not fill are null.
 */
export interface WeatherSeries {
  v: 1;
  /** Request key (rounded points, day window, source class); identifies the series in caches and simulation keys. */
  key: string;
  source: WeatherSource;
  /** IANA zone at the first point, e.g. "Europe/Zurich"; '' when unknown. */
  timezone: string;
  /** Epoch seconds (UTC) of slot 0. */
  t0: number;
  /** Slot length, s (3600). */
  stepS: number;
  points: WeatherPoint[];
  /** °C at 2 m, at the point's elevation. */
  temperature: Array<Array<number | null>>;
  /** °C at 2 m. */
  dewPoint: Array<Array<number | null>>;
  /** mm of water (rain and melted snow) over the preceding step. */
  precipitation: Array<Array<number | null>>;
  /** cm of snow over the preceding step (the provider's phase split). */
  snowfall: Array<Array<number | null>>;
  /** m/s at 10 m. */
  windSpeed: Array<Array<number | null>>;
  /** Degrees the wind blows from (0 = north, 90 = east). */
  windFrom: Array<Array<number | null>>;
  /** m/s at 10 m, strongest gust over the preceding step. */
  windGust: Array<Array<number | null>>;
  /** hPa at the point's elevation. */
  surfacePressure: Array<Array<number | null>>;
  /** Global horizontal irradiance, W/m², mean over the preceding step. */
  shortwave: Array<Array<number | null>>;
  /** Cloud cover, %. */
  cloudCover: Array<Array<number | null>>;
  /** Climatology: the past year whose weather stands in for the date. */
  analogYear?: number;
  /** Epoch ms of the fetch. Not read by the engine; part of the app's simulation key. */
  fetchedAt: number;
}

/** Manual conditions, and the values a pin holds over a series (the temperature is SessionSettings.temperatureC). */
export interface ManualWeather {
  /** Relative humidity, %. */
  humidityPct: number;
  /** Wind speed at 10 m, m/s. */
  windMps: number;
  /** Degrees the wind blows from (0 = north). */
  windFromDeg: number;
  /** Rain rate, mm/h (0 = dry). */
  rainMmH: number;
}

/** A quantity held at its manual value in automatic mode for the whole activity ('temperature' holds humidity too). */
export type WeatherPin = 'temperature' | 'wind' | 'precipitation';

export interface WeatherSettings {
  /** 'auto': the series fetched for the route and start time; 'manual': constant conditions. */
  mode: 'auto' | 'manual';
  manual: ManualWeather;
  pinned: WeatherPin[];
}

/** What the athlete met over the activity, at its simulated position and time. */
export interface WeatherSummary {
  /** Series source; absent for manual conditions. */
  source?: WeatherSource;
  analogYear?: number;
  /** °C at the athlete. */
  airTempMin: number;
  airTempMax: number;
  airTempStart: number;
  airTempEnd: number;
  /** Wind at 10 m at the athlete, m/s. */
  windMin: number;
  windMax: number;
  /** Degrees the wind blows from at the start and at the finish. */
  windFromStart: number;
  windFromEnd: number;
  /** Moving-time mean wind along the direction of travel at body height, m/s (negative: tailwind). */
  headWindMean: number;
  /** Elapsed seconds of the first and last second with precipitation at the athlete; null when dry. */
  rainFrom: number | null;
  rainTo: number | null;
  /** Precipitation at the athlete over the activity, mm. */
  rainMm: number;
  /** Share of that precipitation that fell as snow, 0–1. */
  snowShare: number;
  /** Deepest fresh snow under the athlete, cm. */
  snowDepthMaxCm: number;
  /** Metres covered on a wet or snowy surface. */
  wetDistance: number;
  /** Highest core temperature, °C, and sweat lost net of drinking, litres (heat balance). */
  coreTempMax: number;
  sweatLossL: number;
  /** Highest wet-bulb globe temperature at the athlete, °C. */
  wbgtMax: number;
  /** Seconds at the end of the activity past the series (the last hour was held); 0 when covered. */
  uncoveredS: number;
}

export type ExportFormat = 'fit' | 'tcx' | 'gpx';

export interface ExportInput {
  result: SimulationResult;
  session: SessionSettings;
  athlete: Athlete;
  appName: string;
  appVersion: string;
}
