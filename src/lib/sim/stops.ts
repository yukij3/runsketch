// Stop schedule in the distance domain (independent of the calibrated speed, so root finding stays smooth).
import type { StopsLevel } from '../types';
import type { Random } from './rng';

export interface StopEvent {
  /** Distance along the route where the athlete stands still, metres. */
  s: number;
  /** Whole seconds stopped. */
  duration: number;
}

const MIN_GAP = 60;

/**
 * 'few': 0–2 stops of 20–90 s per hour of expected moving time, none in the first 10 min.
 * 'urban': a short stop every ~400–900 m, 5–45 s, lognormal with median 15 s (traffic lights, crossings).
 * `expectedSpeed` (m/s) converts the time rules to distance.
 */
export function planStops(level: StopsLevel, total: number, expectedSpeed: number, random: Random): StopEvent[] {
  if (level === 'none' || !(total > 150)) return [];
  const out: StopEvent[] = [];
  const endGuard = Math.max(50, Math.min(150, total * 0.1));
  if (level === 'urban') {
    let pos = 250 + random.uniform() * 650;
    while (pos < total - endGuard) {
      const dur = Math.exp(Math.log(15) + 0.6 * random.normal());
      out.push({ s: pos, duration: Math.round(Math.max(5, Math.min(45, dur))) });
      pos += 400 + random.uniform() * 500;
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

/** Validates caller-supplied stops: sorted, inside the route, positive whole durations. */
export function normaliseStops(stops: ReadonlyArray<StopEvent>, total: number): StopEvent[] {
  return stops
    .filter((e) => Number.isFinite(e.s) && Number.isFinite(e.duration) && e.s > 1 && e.s < total - 1 && e.duration >= 1)
    .map((e) => ({ s: e.s, duration: Math.round(e.duration) }))
    .sort((a, b) => a.s - b.s);
}
