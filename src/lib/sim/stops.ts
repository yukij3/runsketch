// Stop schedule in the distance domain (independent of the calibrated speed, so root finding stays smooth).
import type { StopsLevel } from '../types';
import type { Random } from './rng';
import { Cursor, type Track } from './track';

export interface StopEvent {
  /** Distance along the route where the athlete stands still, metres. */
  s: number;
  /** Whole seconds stopped. */
  duration: number;
}

const MIN_GAP = 60;

/**
 * Pedestrian signal timing for 'urban' crossings. Cycle and effective walk time ranges are HEURISTIC. With random
 * arrival the Highway Capacity Manual 2010 pedestrian delay d = (C − g)² / 2C (p. 18-69) implies stopping with
 * probability (C − g)/C and then waiting U(0, C − g) s.
 */
export const SIGNAL = { cycle: [60, 120], walk: [10, 30] } as const;

/** Urban stops move off grades steeper than this (nobody waits for lights mid-climb), searching up to `reach` m on. */
export const STOP_GRADE = { max: 0.06, reach: 150, step: 10, around: 10 } as const;

const between = (range: readonly [number, number], u: number): number => range[0] + (range[1] - range[0]) * u;

/** First distance at or after `s` (before `limit`, within STOP_GRADE.reach) where |grade| ≤ max within ±around m; null if none. */
function levelSpot(s: number, limit: number, gradeAt: ((d: number) => number) | null): number | null {
  if (!gradeAt) return s;
  for (let at = s; at <= s + STOP_GRADE.reach && at < limit; at += STOP_GRADE.step) {
    const g = Math.max(gradeAt(at - STOP_GRADE.around), gradeAt(at), gradeAt(at + STOP_GRADE.around));
    if (g <= STOP_GRADE.max) return at;
  }
  return null;
}

/**
 * Breaks of a mountain day (HEURISTIC, anchored on guided summit days: Rainier guides take four 15-min breaks on the way
 * up and two or three on the way down, with 10-min breaks every 1–2 h; Munter planning adds 15–20 % for breaks). On the
 * way up 10 min after every 60 min of moving time, every 50 min above 5000 m and every 45 min above 6000 m ([m, s]
 * pairs); 15 min at the highest point; 8 min every 75 min on the way down; 12 min where snow or ice starts, to put
 * crampons on, and no regular break in the `markLeadS` before either of those. Durations vary lognormally by about
 * ±30 %, within `range` of the planned length.
 */
export const ALPINE_BREAKS = {
  every: [
    [0, 3600],
    [5000, 3000],
    [6000, 2700],
  ],
  breakS: 600,
  descentEveryS: 4500,
  descentBreakS: 480,
  summitS: 900,
  gearS: 720,
  markLeadS: 1200,
  spread: 0.3,
  range: [0.6, 1.6],
} as const;

export interface AlpineBreakInput {
  /** Expected moving time at each track point, s, from the terrain alone (see expectedMovingTime). */
  time: ArrayLike<number>;
  /** Distance where crampons go on, m; null when they never do. */
  gearAt: number | null;
}

/**
 * 'few': 0–2 stops of 20–90 s per hour of expected moving time, none in the first 10 min.
 * 'urban': a signalised crossing every ~400–900 m (see SIGNAL); a red light means a wait of U(0, C − g) s,
 * never on grades steeper than 6 % (moved up to 150 m on, or skipped).
 * 'alpine': the breaks of a mountain day (see ALPINE_BREAKS), laid on `alpine.time`, or on a constant expected speed.
 * `expectedSpeed` (m/s) converts the time rules to distance; `terrain` supplies grade for urban placement.
 */
export function planStops(
  level: StopsLevel,
  total: number,
  expectedSpeed: number,
  random: Random,
  terrain?: Track,
  alpine?: AlpineBreakInput,
): StopEvent[] {
  if (level === 'none' || !(total > 150)) return [];
  const out: StopEvent[] = [];
  const endGuard = Math.max(50, Math.min(150, total * 0.1));
  if (level === 'alpine') {
    if (terrain && terrain.n >= 2) {
      const v = expectedSpeed > 0.02 ? expectedSpeed : 1;
      return alpineBreaks(total, terrain, alpine ?? { time: Float64Array.from(terrain.d, (d) => d / v), gearAt: null }, random, endGuard);
    }
    return [];
  }
  if (level === 'urban') {
    const cur = terrain && terrain.n >= 2 ? new Cursor(terrain) : null;
    const gradeAt = cur
      ? (d: number) => {
          cur.seek(Math.max(0, Math.min(terrain!.total, d)));
          return Math.abs(cur.lerp(terrain!.grade));
        }
      : null;
    let pos = 250 + random.uniform() * 650;
    while (pos < total - endGuard) {
      // Fixed draws per crossing, so moving one stop off a climb never reshuffles the rest of the schedule.
      const cycle = between(SIGNAL.cycle, random.uniform());
      const red = cycle - between(SIGNAL.walk, random.uniform());
      const stopped = random.uniform() < red / cycle;
      const wait = Math.round(random.uniform() * red);
      const spacing = 400 + random.uniform() * 500;
      if (stopped && wait >= 1) {
        const at = levelSpot(pos, total - endGuard, gradeAt);
        if (at !== null && (out.length === 0 || at - out[out.length - 1].s >= MIN_GAP)) out.push({ s: at, duration: wait });
      }
      pos += spacing;
    }
    return out;
  }
  const v = expectedSpeed > 0.2 ? expectedSpeed : 1;
  const first = 600 * v;
  const hour = 3600 * v;
  for (let w = first; w < total - endGuard; w += hour) {
    const span = Math.min(hour, total - endGuard - w);
    const count = Math.min(2, Math.floor(random.uniform() * 3 * (span / hour) + random.uniform() * (span / hour)));
    const picks: number[] = [];
    for (let c = 0; c < count; c++) picks.push(w + random.uniform() * span);
    picks.sort((a, b) => a - b);
    for (const s of picks) {
      const duration = Math.round(20 + random.uniform() * 70);
      if (out.length === 0 || s - out[out.length - 1].s >= MIN_GAP) out.push({ s, duration });
    }
  }
  return out;
}

/** Break interval on the way up at elevation `ele`, s. */
function climbInterval(ele: number): number {
  let every: number = ALPINE_BREAKS.every[0][1];
  for (const [from, seconds] of ALPINE_BREAKS.every) if (ele >= from) every = seconds;
  return every;
}

/**
 * Mountain-day breaks in distance order: the gear stop and the summit stop where they fall, and regular breaks whenever
 * the expected moving time since the last stop reaches the interval (up to the highest point, then the descent rule).
 * One lognormal draw per event, in order, so the schedule is fixed by the seed.
 */
function alpineBreaks(total: number, track: Track, input: AlpineBreakInput, random: Random, endGuard: number): StopEvent[] {
  const B = ALPINE_BREAKS;
  const { n, d, ele } = track;
  const time = input.time;
  let top = 0;
  for (let j = 1; j < n; j++) if (ele[j] > ele[top]) top = j;
  const summit = d[top];
  const interior = (s: number) => s > endGuard && s < total - endGuard;
  /** Expected moving time at distance s. */
  const timeAt = (s: number): number => {
    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (d[mid] <= s) lo = mid;
      else hi = mid;
    }
    const span = d[hi] - d[lo];
    return span > 0 ? time[lo] + (time[hi] - time[lo]) * Math.min(1, Math.max(0, (s - d[lo]) / span)) : time[lo];
  };
  const marks: Array<{ s: number; base: number; t: number }> = [];
  if (input.gearAt !== null && interior(input.gearAt)) marks.push({ s: input.gearAt, base: B.gearS, t: timeAt(input.gearAt) });
  if (interior(summit)) marks.push({ s: summit, base: B.summitS, t: timeAt(summit) });
  marks.sort((a, b) => a.s - b.s);
  const out: StopEvent[] = [];
  const push = (s: number, base: number): void => {
    const factor = Math.exp(B.spread * random.normal() - (B.spread * B.spread) / 2);
    const duration = Math.max(1, Math.round(base * Math.min(B.range[1], Math.max(B.range[0], factor))));
    if (out.length === 0 || s - out[out.length - 1].s >= MIN_GAP) out.push({ s, duration });
  };
  let last = 0;
  let m = 0;
  for (let j = 1; j < n; j++) {
    while (m < marks.length && marks[m].s <= d[j]) {
      push(marks[m].s, marks[m].base);
      last = marks[m].t;
      m++;
    }
    if (!interior(d[j])) continue;
    const descending = d[j] > summit;
    const beforeMark = m < marks.length && marks[m].t - time[j] < B.markLeadS;
    if (!beforeMark && time[j] - last >= (descending ? B.descentEveryS : climbInterval(ele[j]))) {
      push(d[j], descending ? B.descentBreakS : B.breakS);
      last = time[j];
    }
  }
  return out;
}

/** Validates caller-supplied stops: sorted, inside the route, positive whole durations. */
export function normaliseStops(stops: ReadonlyArray<StopEvent>, total: number): StopEvent[] {
  return stops
    .filter((e) => Number.isFinite(e.s) && Number.isFinite(e.duration) && e.s > 1 && e.s < total - 1 && e.duration >= 1)
    .map((e) => ({ s: e.s, duration: Math.round(e.duration) }))
    .sort((a, b) => a.s - b.s);
}
