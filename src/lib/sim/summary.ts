// Totals, laps and calories from the finished 1 Hz streams.
import type { ActivityStreams, ActivitySummary, ActivityType, Lap } from '../types';
import { ASCENT_THRESHOLD_M, ascentIncrements, climbingSamples } from '../geo';
import { GAIT_WALK, type KinRecord } from './kinematics';
import { costRun, costWalk, walkSpeedCostFactor } from './models';

/** Per-sample climb and descent over the first `n` samples: the turning-point counter the terrain profile uses too. */
export function hysteresisIncrements(ele: ArrayLike<number>, n: number, threshold: number): { up: Float64Array; down: Float64Array } {
  return ascentIncrements(ele, n, threshold);
}

/**
 * A stop of at least this many stopped seconds is an auto-pause: its seconds after the first fall outside timer time.
 * Shorter halts, a standing start and a standing finish stay in timer time, as a watch needs a few seconds under its
 * speed threshold before it pauses (HEURISTIC).
 */
export const AUTO_PAUSE_MIN_S = 3;

/**
 * 1 for samples recorded during timer time, 0 inside auto-pauses (every stopped sample of an interior stop of
 * AUTO_PAUSE_MIN_S or more except its first, which the device writes as it pauses). Average heart rate, power and
 * temperature in the summary, in HR matching and in the exported files are all taken over these samples, as Garmin
 * lap and session averages exclude auto-paused time.
 */
export function timerSamples(moving: ArrayLike<number>, n: number): Uint8Array {
  const out = new Uint8Array(n).fill(1);
  for (let i = 1; i < n; ) {
    if (moving[i] || !moving[i - 1]) {
      i++;
      continue;
    }
    let j = i;
    while (j < n && !moving[j]) j++;
    if (j < n && j - i >= AUTO_PAUSE_MIN_S) for (let k = i + 1; k < j; k++) out[k] = 0;
    i = j;
  }
  return out;
}

/** 1.219 W/kg ≈ 3.5 ml O2/kg/min × 20.9 J/ml. */
const RESTING_W_PER_KG = (3.5 * 20.9) / 60;

/**
 * kcal. Foot: net Minetti cost (Cr on the running gait, Cw × speed penalty when walking) over the distance
 * actually covered, plus resting metabolism over the elapsed time; mountaineering adds the gear and ground cost the
 * kinematics recorded. Ride: mechanical work at 24 % gross efficiency (the familiar kJ ≈ kcal rule), which already
 * includes resting metabolism.
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
    joules += cost * (sport === 'alpine' ? rec.cost[i] : 1) * bodyKg * dd;
  }
  joules += RESTING_W_PER_KG * bodyKg * streams.t[n - 1];
  return joules / 4184;
}

/**
 * Laps every `lapDistance` metres. A lap ends at the first sample whose distance reaches the boundary;
 * sample ranges do not overlap (next lap starts at endIndex + 1). Lap elapsed/distance are measured from
 * the previous lap's last sample, so they add up to the totals. A final remainder under 1 m is merged.
 */
export function buildLaps(
  s: ActivityStreams,
  n: number,
  lapDistance: number,
  up: Float64Array,
  down: Float64Array,
  timer: Uint8Array = timerSamples(s.moving, n),
): Lap[] {
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
  return ranges.map(([a, b], index) => lapStats(s, index, a, b, up, down, timer));
}

function lapStats(s: ActivityStreams, index: number, a: number, b: number, up: Float64Array, down: Float64Array, timer: Uint8Array): Lap {
  const prev = a === 0 ? 0 : a - 1;
  let moving = 0;
  let hrSum = 0;
  let hrCount = 0;
  let hrMax = 0;
  let cadSum = 0;
  let cadCount = 0;
  let ascent = 0;
  let descent = 0;
  for (let i = a; i <= b; i++) {
    if (timer[i]) {
      hrSum += s.hr[i];
      hrCount++;
      if (s.hr[i] > hrMax) hrMax = s.hr[i];
    }
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
    avgHr: hrCount > 0 ? hrSum / hrCount : 0,
    maxHr: hrMax,
    avgCadence: cadCount > 0 ? cadSum / cadCount : 0,
    ascent,
    descent,
  };
}

/**
 * `ascentEle` (default: the recorded altitude) is the elevation used for ascent/descent. The engine keeps the default:
 * a watch totals the climb of its own barometric altitude, so the summary, laps and files report the recorded climb
 * (a few percent above the terrain), while the route panel shows the terrain profile's own ascent.
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
  const { up, down } = ascentIncrements(ascentEle, n, ASCENT_THRESHOLD_M);
  // Climb rate uses the same confirmed climbing legs as the ascent total, so a quantised altimeter does not inflate it.
  const climbing = climbingSamples(ascentEle, n, ASCENT_THRESHOLD_M);
  const timer = timerSamples(s.moving, n);
  let moving = 0;
  let maxSpeed = 0;
  let hrSum = 0;
  let hrCount = 0;
  let hrMax = 0;
  let cadSum = 0;
  let cadCount = 0;
  let powSum = 0;
  let powCount = 0;
  let ascent = 0;
  let descent = 0;
  let maxEle = n > 0 ? ascentEle[0] : 0;
  let climbSeconds = 0;
  for (let i = 0; i < n; i++) {
    ascent += up[i];
    descent += down[i];
    // Heart rate and power average over timer time; cadence over moving seconds with a cadence.
    if (timer[i]) {
      hrSum += s.hr[i];
      hrCount++;
      if (s.hr[i] > hrMax) hrMax = s.hr[i];
      if (i > 0) {
        powSum += s.power[i];
        powCount++;
      }
    }
    if (ascentEle[i] > maxEle) maxEle = ascentEle[i];
    if (!s.moving[i]) continue;
    if (i > 0 && climbing[i]) climbSeconds++;
    if (s.speed[i] > maxSpeed) maxSpeed = s.speed[i];
    if (s.cadence[i] > 0) {
      cadSum += s.cadence[i];
      cadCount++;
    }
    if (i > 0) moving++;
  }
  const distance = n > 0 ? s.dist[n - 1] : 0;
  return {
    distance,
    elapsed: n > 0 ? s.t[n - 1] : 0,
    moving,
    avgSpeed: moving > 0 ? distance / moving : 0,
    maxSpeed,
    avgHr: hrCount > 0 ? hrSum / hrCount : 0,
    maxHr: hrMax,
    avgCadence: cadCount > 0 ? cadSum / cadCount : 0,
    avgPower: powCount > 0 ? powSum / powCount : 0,
    ascent,
    descent,
    calories: Math.round(calories(rec, s, n, sport, bodyKg)),
    laps: buildLaps(s, n, lapDistance, up, down, timer),
    maxEle,
    // Over moving seconds that gain height; a minute of climbing at least, so a bump does not read as a rate.
    climbRate: climbSeconds >= 60 ? (ascent * 3600) / climbSeconds : 0,
  };
}
