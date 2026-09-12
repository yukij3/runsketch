// Synthetic 120 s activity (independent of src/lib/sim): moves, stands still at a traffic light
// for 15 s, moves again, and splits into two laps.
import type {
  ActivityStreams,
  ActivitySummary,
  ActivityType,
  Athlete,
  ExportInput,
  Lap,
  SessionSettings,
} from '../../types';

export const FIXTURE_START = Date.UTC(2026, 8, 12, 7, 0, 0); // 09:00 at UTC+2
export const FIXTURE_UTC_OFFSET_MIN = 120;
export const FIXTURE_SAMPLES = 120;
/** Inclusive seconds with zero speed. */
export const FIXTURE_STOP = { from: 50, to: 64 } as const;
export const FIXTURE_CALORIES = 27;
export const FIXTURE_NAME = 'Tempo <Run> & "Hills"';
export const FIXTURE_DESCRIPTION = "Easy 'shakeout' & strides — утро";

const BASE_SPEED: Record<ActivityType, number> = { run: 3.2, ride: 7.5, walk: 1.4, hike: 1.2 };
/** Odd values so foot-sport halving produces x.5 on even seconds. */
const BASE_CADENCE: Record<ActivityType, number> = { run: 171, ride: 88, walk: 117, hike: 105 };
const BASE_POWER: Record<ActivityType, number> = { run: 290, ride: 210, walk: 110, hike: 150 };

const LAT0 = 52.52;
const LON0 = 13.405;
const BEARING = (60 * Math.PI) / 180;
const M_PER_DEG = 111_320;

export const FIXTURE_ATHLETE: Athlete = {
  age: 35,
  sex: 'male',
  weightKg: 72,
  heightCm: 178,
  restHr: 55,
  maxHr: 188,
  fitness: 'recreational',
};

function buildStreams(type: ActivityType): ActivityStreams {
  const n = FIXTURE_SAMPLES;
  const s: ActivityStreams = {
    t: new Float64Array(n),
    lat: new Float64Array(n),
    lon: new Float64Array(n),
    ele: new Float64Array(n),
    dist: new Float64Array(n),
    speed: new Float64Array(n),
    hr: new Float64Array(n),
    hrDemand: new Float64Array(n),
    cadence: new Float64Array(n),
    power: new Float64Array(n),
    grade: new Float64Array(n),
    moving: new Uint8Array(n),
  };
  let hr = 92.4;
  for (let i = 0; i < n; i++) {
    const moving = i < FIXTURE_STOP.from || i > FIXTURE_STOP.to;
    const speed = moving ? BASE_SPEED[type] * (1 + 0.05 * Math.sin(i / 6)) : 0;
    const dist = i === 0 ? 0 : s.dist[i - 1] + speed;
    const demand = moving ? 158 : 104;
    hr += (demand - hr) / (moving ? 30 : 50);
    s.t[i] = i;
    s.moving[i] = moving ? 1 : 0;
    s.speed[i] = speed;
    s.dist[i] = dist;
    s.lat[i] = LAT0 + (dist * Math.cos(BEARING)) / M_PER_DEG;
    s.lon[i] = LON0 + (dist * Math.sin(BEARING)) / (M_PER_DEG * Math.cos((LAT0 * Math.PI) / 180));
    s.ele[i] = 34 + 8 * Math.sin(dist / 90);
    s.grade[i] = (8 / 90) * Math.cos(dist / 90);
    s.hrDemand[i] = demand;
    s.hr[i] = hr;
    s.cadence[i] = moving ? BASE_CADENCE[type] - (i % 2) : 0;
    s.power[i] = moving ? BASE_POWER[type] + 25 * Math.sin(i / 7) : 0;
  }
  return s;
}

function aggregate(s: ActivityStreams, first: number, last: number) {
  let moving = 0;
  let hrSum = 0;
  let maxHr = 0;
  let cadenceSum = 0;
  let powerSum = 0;
  let maxSpeed = 0;
  let ascent = 0;
  let descent = 0;
  for (let i = first; i <= last; i++) {
    moving += s.moving[i];
    hrSum += s.hr[i];
    maxHr = Math.max(maxHr, s.hr[i]);
    maxSpeed = Math.max(maxSpeed, s.speed[i]);
    if (s.moving[i]) {
      cadenceSum += s.cadence[i];
      powerSum += s.power[i];
    }
    if (i > 0) {
      const d = s.ele[i] - s.ele[i - 1];
      if (d > 0) ascent += d;
      else descent -= d;
    }
  }
  const before = first === 0 ? 0 : first - 1;
  const distance = s.dist[last] - s.dist[before];
  const elapsed = s.t[last] - s.t[before];
  return {
    distance,
    elapsed,
    moving,
    avgSpeed: distance / Math.max(moving, 1),
    maxSpeed,
    avgHr: hrSum / (last - first + 1),
    maxHr,
    avgCadence: cadenceSum / Math.max(moving, 1),
    avgPower: powerSum / Math.max(moving, 1),
    ascent,
    descent,
  };
}

/** Index of the first sample of the second lap. */
export function fixtureLapBoundary(input: ExportInput): number {
  return input.result.summary.laps[1].startIndex;
}

export function makeExportInput(type: ActivityType = 'run', session: Partial<SessionSettings> = {}): ExportInput {
  const s = buildStreams(type);
  const n = FIXTURE_SAMPLES;
  const lapDistance = Math.round((s.dist[n - 1] * 0.6) / 10) * 10;
  const boundary = s.dist.findIndex((d) => d >= lapDistance);
  const lap = (index: number, first: number, last: number): Lap => {
    const a = aggregate(s, first, last);
    return {
      index,
      startIndex: first,
      endIndex: last,
      distance: a.distance,
      elapsed: a.elapsed,
      moving: a.moving,
      avgSpeed: a.avgSpeed,
      avgHr: a.avgHr,
      maxHr: a.maxHr,
      avgCadence: a.avgCadence,
      ascent: a.ascent,
      descent: a.descent,
    };
  };
  const total = aggregate(s, 0, n - 1);
  const summary: ActivitySummary = {
    distance: s.dist[n - 1],
    elapsed: s.t[n - 1] - s.t[0],
    moving: total.moving,
    avgSpeed: total.avgSpeed,
    maxSpeed: total.maxSpeed,
    avgHr: total.avgHr,
    maxHr: total.maxHr,
    avgCadence: total.avgCadence,
    avgPower: total.avgPower,
    ascent: total.ascent,
    descent: total.descent,
    calories: FIXTURE_CALORIES,
    laps: [lap(0, 0, boundary - 1), lap(1, boundary, n - 1)],
  };
  const settings: SessionSettings = {
    type,
    startTime: FIXTURE_START,
    utcOffsetMin: FIXTURE_UTC_OFFSET_MIN,
    target: type === 'ride' ? { kind: 'speed', mps: 7.5 } : { kind: 'pace', secPerKm: 330 },
    variability: 0.35,
    pacing: 'even',
    stops: 'few',
    gpsNoise: 'normal',
    hrSensor: 'strap',
    temperatureC: 18,
    seed: 424242,
    name: FIXTURE_NAME,
    description: FIXTURE_DESCRIPTION,
    lapDistance,
    ...session,
  };
  return {
    result: { streams: s, summary, warnings: [] },
    session: settings,
    athlete: FIXTURE_ATHLETE,
    appName: 'Runsketch',
    appVersion: '0.1.0',
  };
}
