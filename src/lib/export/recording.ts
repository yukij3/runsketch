// Which 1 Hz samples a device would write: auto-pauses at stops and occasional skipped seconds.
// All three writers share one plan, so a GPX, TCX and FIT of the same activity hold the same points.
import { createRandom } from '../sim/rng';
import { AUTO_PAUSE_MIN_S, timerSamples } from '../sim/summary';
import type { ExportInput } from '../types';
import { exportLaps } from './laps';

export { AUTO_PAUSE_MIN_S };

/**
 * Skipped seconds in 1 s recording. A 1 s Garmin fenix 2 run has 20 gaps in 2833 s (17 × 2 s, 1 × 3 s, 2 × 4 s):
 * about 0.7 % of intervals. `lengths` lists gap seconds to draw from uniformly.
 */
export const RECORD_GAPS = { rate: 0.007, lengths: [2, 2, 2, 2, 2, 2, 2, 2, 3, 4] } as const;

export interface TimerPause {
  /** Sample written at the pause (speed 0); the timer stops at its timestamp. */
  from: number;
  /** First sample after the pause; the timer restarts at its timestamp. */
  to: number;
}

export interface RecordPlan {
  /** 1 where a record or trackpoint is written. */
  written: Uint8Array;
  /** Auto-pauses in time order; no sample strictly between `from` and `to` is written. */
  pauses: TimerPause[];
  /** 1 for samples in timer time (outside auto-pauses, skipped seconds included): what lap and session averages use. */
  timer: Uint8Array;
}

/**
 * Auto-pause every interior stop of AUTO_PAUSE_MIN_S or more stopped samples (a standing start or finish is not a
 * pause), then drop seeded 2–4 s gaps. Gaps are skipped with GPS noise 'off', the exact-geometry setting. The first
 * and last sample of the activity and of every lap, and both pause edges, are always written.
 */
export function recordPlan(input: Pick<ExportInput, 'result' | 'session'>): RecordPlan {
  const s = input.result.streams;
  const n = s.t.length;
  const written = new Uint8Array(n).fill(1);
  const keep = new Uint8Array(n);
  const pauses: TimerPause[] = [];
  const timer = timerSamples(s.moving, n);
  if (n === 0) return { written, pauses, timer };
  keep[0] = 1;
  keep[n - 1] = 1;
  for (const lap of exportLaps(input.result)) {
    keep[lap.start] = 1;
    keep[lap.end - 1] = 1;
  }

  // Samples i … j − 1 are paused: the device writes i − 1 as it pauses and restarts the timer at j. A pause that would
  // swallow a lap's first or last sample (only possible with laps from elsewhere) stays in timer time.
  for (let i = 1; i < n; ) {
    if (timer[i]) {
      i++;
      continue;
    }
    let j = i;
    while (j < n && !timer[j]) j++;
    let inside = false;
    for (let k = i; k < j && !inside; k++) inside = keep[k] === 1;
    if (inside) {
      timer.fill(1, i, j);
    } else {
      pauses.push({ from: i - 1, to: j });
      written.fill(0, i, j);
      keep[i - 1] = 1;
      keep[j] = 1;
    }
    i = j;
  }

  if (input.session.gpsNoise !== 'off') {
    const random = createRandom(input.session.seed, 'record-gaps');
    const lengths = RECORD_GAPS.lengths;
    for (let k = 1; k < n - 1; ) {
      if (random.uniform() >= RECORD_GAPS.rate) {
        k++;
        continue;
      }
      const length = lengths[Math.floor(random.uniform() * lengths.length)];
      // Skipping k … last leaves the written neighbours k − 1 and last + 1 `length` seconds apart.
      const last = k + length - 2;
      let ok = last < n - 1 && written[k - 1] === 1 && written[last + 1] === 1;
      for (let q = k; ok && q <= last; q++) ok = written[q] === 1 && keep[q] === 0;
      if (ok) {
        for (let q = k; q <= last; q++) written[q] = 0;
        k = last + 2;
      } else {
        k++;
      }
    }
  }
  return { written, pauses, timer };
}

/** Timer-paused seconds inside the elapsed span (t[a], t[b]]. */
export function pausedSeconds(plan: RecordPlan, t: Float64Array, a: number, b: number): number {
  let sum = 0;
  for (const p of plan.pauses) sum += Math.max(0, Math.min(t[b], t[p.to]) - Math.max(t[a], t[p.from]));
  return sum;
}

/**
 * Mean, maximum and minimum of finite values over the timer-time samples of [start, end), the way a device's lap and
 * session averages leave out auto-paused seconds; undefined when there are none.
 */
export function timerStats(
  values: ArrayLike<number>,
  plan: RecordPlan,
  start: number,
  end: number,
): { mean: number; max: number; min: number } | undefined {
  let sum = 0;
  let count = 0;
  let max = -Infinity;
  let min = Infinity;
  for (let i = start; i < end; i++) {
    const v = values[i];
    if (!plan.timer[i] || !Number.isFinite(v)) continue;
    sum += v;
    count++;
    if (v > max) max = v;
    if (v < min) min = v;
  }
  return count > 0 ? { mean: sum / count, max, min } : undefined;
}
