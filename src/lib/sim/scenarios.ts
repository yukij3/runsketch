// Synthetic TerrainProfiles for tests, reviewers and demos. Pure functions, no DEM or network.
// Routes are laid out in local metres (x east, y north) around an origin and resampled like the
// terrain module does: fixed spacing, optional Gaussian elevation smoothing, grade on a centred 40 m baseline.
import type { LngLat, ProfilePoint, TerrainProfile, WeatherPoint, WeatherSeries } from '../types';
import { DEG, M_PER_DEG } from './track';

export interface ScenarioOptions {
  /** Point spacing, metres (default 5). */
  spacing?: number;
  /** [lon, lat] of local (0, 0); default Berlin Tiergarten. */
  origin?: LngLat;
  /** Gaussian σ applied to elevation, metres (default 0 = exact geometry). */
  smoothSigma?: number;
  /** Half-length of the centred grade baseline, metres (default 20). */
  gradeHalfBaseline?: number;
}

export interface GradeSegment {
  length: number;
  /** Rise over run, decimal. */
  grade: number;
}

export type PlanarPath = ReadonlyArray<readonly [x: number, y: number]>;

const DEFAULT_ORIGIN: LngLat = [13.35, 52.515];

/** Resamples a planar path at fixed spacing; `elevation(d)` gives raw height at distance d. */
export function pathProfile(path: PlanarPath, elevation: (d: number) => number, opts: ScenarioOptions = {}): TerrainProfile {
  const spacing = Math.max(0.5, opts.spacing ?? 5);
  const [lon0, lat0] = opts.origin ?? DEFAULT_ORIGIN;
  const xs: number[] = [];
  const ys: number[] = [];
  const ds: number[] = [];
  let acc = 0;
  let nextAt = 0;
  for (let k = 1; k < path.length; k++) {
    const [ax, ay] = path[k - 1];
    const [bx, by] = path[k];
    const len = Math.hypot(bx - ax, by - ay);
    if (len <= 0) continue;
    while (nextAt <= acc + len + 1e-9) {
      const f = (nextAt - acc) / len;
      xs.push(ax + (bx - ax) * f);
      ys.push(ay + (by - ay) * f);
      ds.push(nextAt);
      nextAt += spacing;
    }
    acc += len;
  }
  if (path.length > 0 && (ds.length === 0 || acc - ds[ds.length - 1] > 1e-6)) {
    const [lx, ly] = path[path.length - 1];
    xs.push(lx);
    ys.push(ly);
    ds.push(acc);
  }
  const n = ds.length;
  let ele = ds.map((d) => elevation(d));
  if ((opts.smoothSigma ?? 0) > 0) ele = gaussianSmooth(ele, ds, opts.smoothSigma as number);
  const half = Math.max(1, Math.round((opts.gradeHalfBaseline ?? 20) / spacing));
  const cosLat = Math.cos(lat0 * DEG);
  const points: ProfilePoint[] = [];
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - half);
    const b = Math.min(n - 1, i + half);
    const run = ds[b] - ds[a];
    points.push({
      d: ds[i],
      lon: lon0 + xs[i] / (M_PER_DEG * cosLat),
      lat: lat0 + ys[i] / M_PER_DEG,
      ele: ele[i],
      grade: run > 0 ? (ele[b] - ele[a]) / run : 0,
    });
  }
  return finishProfile(points, spacing);
}

function gaussianSmooth(values: number[], ds: number[], sigma: number): number[] {
  const n = values.length;
  const out = new Array<number>(n);
  const reach = 3 * sigma;
  for (let i = 0; i < n; i++) {
    let wSum = 0;
    let vSum = 0;
    for (let j = i; j >= 0 && ds[i] - ds[j] <= reach; j--) {
      const w = Math.exp(-0.5 * ((ds[i] - ds[j]) / sigma) ** 2);
      wSum += w;
      vSum += w * values[j];
    }
    for (let j = i + 1; j < n && ds[j] - ds[i] <= reach; j++) {
      const w = Math.exp(-0.5 * ((ds[j] - ds[i]) / sigma) ** 2);
      wSum += w;
      vSum += w * values[j];
    }
    out[i] = vSum / wSum;
  }
  return out;
}

function finishProfile(points: ProfilePoint[], spacing: number): TerrainProfile {
  let ascent = 0;
  let descent = 0;
  let minEle = Infinity;
  let maxEle = -Infinity;
  let ref = points.length > 0 ? points[0].ele : 0;
  for (const p of points) {
    minEle = Math.min(minEle, p.ele);
    maxEle = Math.max(maxEle, p.ele);
    if (p.ele - ref >= 3) {
      ascent += p.ele - ref;
      ref = p.ele;
    } else if (ref - p.ele >= 3) {
      descent += ref - p.ele;
      ref = p.ele;
    }
  }
  return {
    points,
    spacing,
    totalDistance: points.length > 0 ? points[points.length - 1].d : 0,
    ascent,
    descent,
    minEle: Number.isFinite(minEle) ? minEle : 0,
    maxEle: Number.isFinite(maxEle) ? maxEle : 0,
    elevationSource: 'none',
  };
}

/** Piecewise-linear elevation along a list of grade segments starting at `startEle`. */
export function segmentElevation(segments: ReadonlyArray<GradeSegment>, startEle = 100): (d: number) => number {
  return (d: number) => {
    let ele = startEle;
    let at = 0;
    for (const seg of segments) {
      if (d <= at + seg.length) return ele + seg.grade * (d - at);
      ele += seg.grade * seg.length;
      at += seg.length;
    }
    return ele;
  };
}

/** Straight eastward route made of grade segments. */
export function segmentProfile(segments: ReadonlyArray<GradeSegment>, opts: ScenarioOptions = {}): TerrainProfile {
  const total = segments.reduce((sum, s) => sum + Math.max(0, s.length), 0);
  return pathProfile(
    [
      [0, 0],
      [total, 0],
    ],
    segmentElevation(segments),
    opts,
  );
}

export function flatProfile(distance = 10000, opts: ScenarioOptions = {}): TerrainProfile {
  return segmentProfile([{ length: distance, grade: 0 }], opts);
}

/** Flat → constant climb → flat (defaults: 2 km, 1 km at +8 %, 2 km). The crest is at before + climb. */
export function climbProfile(
  { before = 2000, climb = 1000, grade = 0.08, after = 2000 }: { before?: number; climb?: number; grade?: number; after?: number } = {},
  opts: ScenarioOptions = {},
): TerrainProfile {
  return segmentProfile(
    [
      { length: before, grade: 0 },
      { length: climb, grade },
      { length: after, grade: 0 },
    ],
    opts,
  );
}

/** Flat → constant descent → flat. */
export function descentProfile(
  { before = 2000, descent = 1000, grade = -0.08, after = 2000 }: { before?: number; descent?: number; grade?: number; after?: number } = {},
  opts: ScenarioOptions = {},
): TerrainProfile {
  return climbProfile({ before, climb: descent, grade: -Math.abs(grade), after }, opts);
}

/** Sinusoidal rolling hills of ±amplitude metres with the given wavelength. */
export function rollingProfile(distance = 50000, amplitude = 20, wavelength = 3000, opts: ScenarioOptions = {}): TerrainProfile {
  return pathProfile(
    [
      [0, 0],
      [distance, 0],
    ],
    (d) => 100 + amplitude * Math.sin((2 * Math.PI * d) / wavelength),
    opts,
  );
}

/** Square loop(s) with 90° corners, flat. */
export function squareLoopProfile(side = 250, laps = 4, opts: ScenarioOptions = {}): TerrainProfile {
  const path: Array<[number, number]> = [[0, 0]];
  for (let l = 0; l < laps; l++) path.push([side, 0], [side, side], [0, side], [0, 0]);
  return pathProfile(path, () => 50, opts);
}

/** Out-and-back with a 180° turn at the far end, flat. */
export function outAndBackProfile(oneWay = 2500, opts: ScenarioOptions = {}): TerrainProfile {
  return pathProfile(
    [
      [0, 0],
      [oneWay, 0],
      [0, 0.01],
    ],
    () => 50,
    opts,
  );
}

/** Hourly values by hour relative to the start (negative before it) and point index. */
export type WeatherCurve = (hour: number, point: number) => number | null;

export interface WeatherScenarioOptions {
  /** Epoch ms of the activity start; slots sit on whole UTC hours around it. */
  start: number;
  /** Route the points lie on (lon, lat and elevation at their distances); a flat origin point when absent. */
  profile?: TerrainProfile;
  /** Route distances of the sampled points, metres (default: the start only). */
  at?: number[];
  /** Hours covered before and after the start (default 48 and 30). */
  before?: number;
  after?: number;
  temperature?: WeatherCurve;
  dewPoint?: WeatherCurve;
  /** mm over the preceding hour. */
  precipitation?: WeatherCurve;
  windSpeed?: WeatherCurve;
  windFrom?: WeatherCurve;
  pressure?: WeatherCurve;
  shortwave?: WeatherCurve;
  cloudCover?: WeatherCurve;
}

/** A synthetic weather series for tests: 15 °C, dew point 7 °C, calm, dry, 1013 hPa and overcast unless overridden. */
export function weatherScenario(o: WeatherScenarioOptions): WeatherSeries {
  const before = o.before ?? 48;
  const after = o.after ?? 30;
  const startHour = Math.floor(o.start / 3_600_000);
  const t0 = (startHour - before) * 3600;
  const slots = before + after + 1;
  const pts = o.profile?.points ?? [];
  const points: WeatherPoint[] = (o.at ?? [0]).map((d) => {
    let best = pts[0];
    for (const p of pts) if (Math.abs(p.d - d) < Math.abs((best?.d ?? 0) - d)) best = p;
    return { d, lon: best?.lon ?? DEFAULT_ORIGIN[0], lat: best?.lat ?? DEFAULT_ORIGIN[1], ele: Math.round((best?.ele ?? 50) / 10) * 10 };
  });
  const grid = (curve: WeatherCurve | undefined, fallback: number): Array<Array<number | null>> =>
    points.map((_, p) => Array.from({ length: slots }, (_, k) => (curve ? curve((t0 + k * 3600 - o.start / 1000) / 3600, p) : fallback)));
  return {
    v: 1,
    key: 'scenario',
    source: 'forecast',
    timezone: 'UTC',
    t0,
    stepS: 3600,
    points,
    temperature: grid(o.temperature, 15),
    dewPoint: grid(o.dewPoint, 7),
    precipitation: grid(o.precipitation, 0),
    snowfall: grid(undefined, 0),
    windSpeed: grid(o.windSpeed, 0),
    windFrom: grid(o.windFrom, 0),
    windGust: grid(o.windSpeed, 0),
    surfacePressure: grid(o.pressure, 1013),
    shortwave: grid(o.shortwave, 0),
    cloudCover: grid(o.cloudCover, 100),
    fetchedAt: 0,
  };
}

/** The smallest valid route: two points `distance` metres apart. */
export function twoPointProfile(distance = 60, opts: ScenarioOptions = {}): TerrainProfile {
  const [lon0, lat0] = opts.origin ?? DEFAULT_ORIGIN;
  const dLon = distance / (M_PER_DEG * Math.cos(lat0 * DEG));
  return finishProfile(
    [
      { d: 0, lon: lon0, lat: lat0, ele: 40, grade: 0 },
      { d: distance, lon: lon0 + dLon, lat: lat0, ele: 40, grade: 0 },
    ],
    distance,
  );
}
