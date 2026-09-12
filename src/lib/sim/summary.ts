// Totals, laps and calories from the finished 1 Hz streams.
import type { ActivityStreams, ActivitySummary, ActivityType, Lap } from '../types';
import { GAIT_WALK, type KinRecord } from './kinematics';
import { costRun, costWalk, walkSpeedCostFactor } from './models';

/** Dead band for ascent/descent on recorded altitude, metres (same order as the terrain module). */
export const ASCENT_HYSTERESIS = 3;

/** Per-sample climb/descent registered by a dead-band filter; increment i belongs to the interval ending at i. */
export function hysteresisIncrements(ele: Float64Array, n: number, threshold: number): { up: Float64Array; down: Float64Array } {
  const up = new Float64Array(n);
  const down = new Float64Array(n);
  if (n === 0) return { up, down };
  let ref = ele[0];
  for (let i = 1; i < n; i++) {
    const dz = ele[i] - ref;
    if (dz >= threshold) {
      up[i] = dz;
      ref = ele[i];
    } else if (dz <= -threshold) {
      down[i] = -dz;
      ref = ele[i];
    }
  }
  return { up, down };
}

/** 1.219 W/kg ≈ 3.5 ml O2/kg/min × 20.9 J/ml. */
const RESTING_W_PER_KG = (3.5 * 20.9) / 60;

/**
 * kcal. Foot: net Minetti cost (Cr on the running gait, Cw × speed penalty when walking) over the distance
 * actually covered, plus resting metabolism over the elapsed time. Ride: mechanical work at 24 % gross
 * efficiency (the familiar kJ ≈ kcal rule), which already includes resting metabolism.
 */
export function calories(rec: KinRecord, streams: ActivityStreams, n: number, sport: ActivityType, bodyKg: number): number {
  if (n < 2) return 0;
  if (sport === 'ride') {
    let work = 0;
    for (let i = 1; i < n; i++) work += streams.power[i];
    return work / 0.24 / 4184;
  }
  let joules = 0;
  for (let i = 1; i < n; i++) {
    const dd = streams.dist[i] - streams.dist[i - 1];
    if (dd <= 0) continue;
    const g = streams.grade[i];
    const cost = rec.gait[i] === GAIT_WALK ? costWalk(g) * walkSpeedCostFactor(dd) : costRun(g);
    joules += cost * bodyKg * dd;
  }
  joules += RESTING_W_PER_KG * bodyKg * streams.t[n - 1];
  return joules / 4184;
}

/**
 * Laps every `lapDistance` metres. A lap ends at the first sample whose distance reaches the boundary;
 * sample ranges do not overlap (next lap starts at endIndex + 1). Lap elapsed/distance are measured from
 * the previous lap's last sample, so they add up to the totals. A final remainder under 1 m is merged.
 */
export function buildLaps(s: ActivityStreams, n: number, lapDistance: number, up: Float64Array, down: Float64Array): Lap[] {
  if (n < 2) return [];
  const ranges: Array<[number, number]> = [];
  let start = 0;
  let boundary = lapDistance;
  for (let i = 1; i < n; i++) {
    if (s.dist[i] >= boundary - 1e-6) {
      ranges.push([start, i]);
      start = i + 1;
      while (boundary <= s.dist[i] + 1e-6) boundary += lapDistance;
    }
  }
  if (start <= n - 1) {
    const prev = start - 1;
    if (ranges.length > 0 && s.dist[n - 1] - s.dist[prev] < 1) ranges[ranges.length - 1][1] = n - 1;
    else ranges.push([start, n - 1]);
  }
  return ranges.map(([a, b], index) => lapStats(s, index, a, b, up, down));
}

function lapStats(s: ActivityStreams, index: number, a: number, b: number, up: Float64Array, down: Float64Array): Lap {
  const prev = a === 0 ? 0 : a - 1;
  let moving = 0;
  let hrSum = 0;
  let hrMax = 0;
  let cadSum = 0;
  let cadCount = 0;
  let ascent = 0;
  let descent = 0;
  for (let i = a; i <= b; i++) {
    hrSum += s.hr[i];
    if (s.hr[i] > hrMax) hrMax = s.hr[i];
    if (i > 0 && s.moving[i]) moving++;
    if (s.moving[i] && s.cadence[i] > 0) {
      cadSum += s.cadence[i];
      cadCount++;
    }
    ascent += up[i];
    descent += down[i];
  }
  const distance = s.dist[b] - s.dist[prev];
  return {
    index,
    startIndex: a,
    endIndex: b,
    distance,
    elapsed: s.t[b] - s.t[prev],
    moving,
    avgSpeed: moving > 0 ? distance / moving : 0,
    avgHr: hrSum / (b - a + 1),
    maxHr: hrMax,
    avgCadence: cadCount > 0 ? cadSum / cadCount : 0,
    ascent,
    descent,
  };
}

/**
 * `ascentEle` (default: the recorded altitude) is the elevation used for ascent/descent. The engine passes the
 * noise-free DEM elevation so barometric wander does not inflate the totals (as Strava's basemap correction).
 */
export function summarise(
  rec: KinRecord,
  s: ActivityStreams,
  n: number,
  sport: ActivityType,
  bodyKg: number,
  lapDistance: number,
  ascentEle: Float64Array = s.ele,
): ActivitySummary {
  const { up, down } = hysteresisIncrements(ascentEle, n, ASCENT_HYSTERESIS);
  let moving = 0;
  let maxSpeed = 0;
  let hrSum = 0;
  let hrMax = 0;
  let cadSum = 0;
  let cadCount = 0;
  let powSum = 0;
  let ascent = 0;
  let descent = 0;
  for (let i = 0; i < n; i++) {
    hrSum += s.hr[i];
    if (s.hr[i] > hrMax) hrMax = s.hr[i];
    ascent += up[i];
    descent += down[i];
    if (!s.moving[i]) continue;
    if (s.speed[i] > maxSpeed) maxSpeed = s.speed[i];
    if (s.cadence[i] > 0) {
      cadSum += s.cadence[i];
      cadCount++;
    }
    if (i > 0) {
      moving++;
      powSum += s.power[i];
    }
  }
  const distance = n > 0 ? s.dist[n - 1] : 0;
  return {
    distance,
    elapsed: n > 0 ? s.t[n - 1] : 0,
    moving,
    avgSpeed: moving > 0 ? distance / moving : 0,
    maxSpeed,
    avgHr: n > 0 ? hrSum / n : 0,
    maxHr: hrMax,
    avgCadence: cadCount > 0 ? cadSum / cadCount : 0,
    avgPower: moving > 0 ? powSum / moving : 0,
    ascent,
    descent,
    calories: Math.round(calories(rec, s, n, sport, bodyKg)),
    laps: buildLaps(s, n, lapDistance, up, down),
  };
}
