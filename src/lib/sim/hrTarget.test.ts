// "Match average HR": the engine solves the effective VO2max so mean moving HR equals the target; kinematics stay put.
import { describe, expect, it } from 'vitest';
import type { ActivityStreams, ActivityType, SessionSettings, SimulationResult } from '../types';
import { defaultAthlete, defaultSession } from './athlete';
import { climbProfile, rollingProfile } from './scenarios';
import { HR_MATCH_TOLERANCE, simulate } from './simulate';

const START = Date.UTC(2026, 5, 1, 6, 30);
const athlete = defaultAthlete();
const session = (type: ActivityType, over: Partial<SessionSettings> = {}): SessionSettings => ({ ...defaultSession(type, START), seed: 77, ...over });

const bytes = (a: ArrayBufferView) => new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
const sameBytes = (a: ArrayBufferView, b: ArrayBufferView) => {
  const x = bytes(a);
  const y = bytes(b);
  return x.length === y.length && x.every((v, i) => v === y[i]);
};
function movingMeanHr(r: SimulationResult): number {
  let sum = 0;
  let count = 0;
  for (let i = 0; i < r.streams.hr.length; i++) {
    if (!r.streams.moving[i]) continue;
    sum += r.streams.hr[i];
    count++;
  }
  return sum / count;
}
const KINEMATIC: ReadonlyArray<keyof ActivityStreams> = ['t', 'dist', 'speed', 'grade', 'moving', 'cadence', 'power', 'lat', 'lon', 'ele'];

describe('hrTarget: calibrate to an average heart rate', () => {
  const profile = rollingProfile(8000, 25, 2000);

  it('lands the moving-time mean HR within ±0.5 bpm and leaves every kinematic stream byte-identical', () => {
    const base = simulate({ profile, athlete, session: session('run', { stops: 'few' }) });
    const matched = simulate({ profile, athlete, session: session('run', { stops: 'few', hrTarget: 150 }) });
    expect(Math.abs(movingMeanHr(matched) - 150)).toBeLessThanOrEqual(HR_MATCH_TOLERANCE);
    for (const key of KINEMATIC) expect(sameBytes(base.streams[key], matched.streams[key]), key).toBe(true);
    expect(sameBytes(base.streams.hr, matched.streams.hr)).toBe(false);
    expect(matched.summary.moving).toBe(base.summary.moving);
    expect(matched.impliedVo2max).toBeGreaterThan(20);
    expect(matched.impliedVo2max).toBeLessThan(90);
    expect(base.impliedVo2max).toBeUndefined();
  });

  it('a higher target implies a lower VO2max, and null behaves like the profile mode', () => {
    const low = simulate({ profile, athlete, session: session('run', { hrTarget: 140 }) });
    const high = simulate({ profile, athlete, session: session('run', { hrTarget: 165 }) });
    expect(low.impliedVo2max!).toBeGreaterThan(high.impliedVo2max!);
    expect(Math.abs(movingMeanHr(high) - 165)).toBeLessThanOrEqual(HR_MATCH_TOLERANCE);
    const plain = simulate({ profile, athlete, session: session('run') });
    const none = simulate({ profile, athlete, session: session('run', { hrTarget: null }) });
    expect(sameBytes(plain.streams.hr, none.streams.hr)).toBe(true);
    expect(none.impliedVo2max).toBeUndefined();
  });

  it('matches rides too, deterministically', () => {
    const input = { profile: climbProfile({ before: 3000, climb: 4000, grade: 0.05, after: 3000 }), athlete, session: session('ride', { target: { kind: 'speed', mps: 6 }, hrTarget: 138 }) } as const;
    const a = simulate(input);
    const b = simulate(input);
    expect(Math.abs(movingMeanHr(a) - 138)).toBeLessThanOrEqual(HR_MATCH_TOLERANCE);
    expect(sameBytes(a.streams.hr, b.streams.hr)).toBe(true);
    expect(a.impliedVo2max).toBe(b.impliedVo2max);
  });

  it('warns when the target is outside rest+10…max−2 or cannot be matched', () => {
    const r = simulate({ profile, athlete, session: session('run', { hrTarget: 190 }) });
    expect(r.warnings.some((w) => /^The target average heart rate of 190 bpm is outside this athlete's plausible range of 65–182 bpm\.$/.test(w))).toBe(true);
    expect(r.warnings.some((w) => /could not be matched on this route/.test(w))).toBe(true);
    expect(r.impliedVo2max).toBe(20);
  });

  it('warns when the implied VO2max is outside 25–85', () => {
    // A slow jog at a very high average heart rate needs a tiny VO2max; a fast run at a low one a huge VO2max.
    const fit = simulate({ profile, athlete, session: session('run', { target: { kind: 'pace', secPerKm: 240 }, hrTarget: 125 }) });
    expect(fit.impliedVo2max).toBe(90);
    const r = simulate({ profile, athlete, session: session('run', { target: { kind: 'pace', secPerKm: 600 }, hrTarget: 178 }) });
    expect(Math.abs(movingMeanHr(r) - 178)).toBeLessThanOrEqual(HR_MATCH_TOLERANCE);
    expect(r.impliedVo2max!).toBeLessThan(25);
    expect(r.warnings.some((w) => /^Matching an average heart rate of 178 bpm at this pace implies a VO2max of about \d+ ml\/kg\/min, outside the usual range of 25–85\.$/.test(w))).toBe(true);
  });

  it('judges effort warnings against the implied VO2max', () => {
    // 3:30/km is far beyond this recreational profile, but an average of 160 bpm says the athlete is much fitter.
    const fast = session('run', { target: { kind: 'pace', secPerKm: 210 } });
    expect(simulate({ profile, athlete, session: fast }).warnings.some((w) => /VO2 reserve/.test(w))).toBe(true);
    const matched = simulate({ profile, athlete, session: { ...fast, hrTarget: 160 } });
    expect(matched.warnings.some((w) => /VO2 reserve/.test(w))).toBe(false);
  });

  it('stays fast for a 6 h ride', () => {
    const long = rollingProfile(160000, 30, 3000);
    const t0 = performance.now();
    const r = simulate({ profile: long, athlete, session: session('ride', { target: { kind: 'duration', seconds: 6 * 3600 }, hrTarget: 135 }) });
    expect(performance.now() - t0).toBeLessThan(3000);
    expect(Math.abs(movingMeanHr(r) - 135)).toBeLessThanOrEqual(HR_MATCH_TOLERANCE);
  });
});
