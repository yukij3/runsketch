import { describe, expect, it } from 'vitest';
import type { ActivityStreams, ActivityType, SessionSettings, SimulationResult } from '../types';
import { defaultAthlete, defaultSession } from './athlete';
import { climbProfile, flatProfile, rollingProfile } from './scenarios';
import { simulate } from './simulate';
import { indexAtDistance, meanRange } from './testing';

const START = Date.UTC(2026, 5, 1, 6, 30);
const athlete = defaultAthlete();
const session = (type: ActivityType, over: Partial<SessionSettings> = {}): SessionSettings => ({
  ...defaultSession(type, START),
  seed: 1234,
  ...over,
});

const bytes = (a: ArrayBufferView): Uint8Array => new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
const sameBytes = (a: ArrayBufferView, b: ArrayBufferView): boolean => {
  const x = bytes(a);
  const y = bytes(b);
  return x.length === y.length && x.every((v, i) => v === y[i]);
};
const streamKeys = (s: ActivityStreams) => Object.keys(s) as Array<keyof ActivityStreams>;
const avgPaceSecPerKm = (r: SimulationResult): number => (r.summary.moving / r.summary.distance) * 1000;

describe('determinism (a)', () => {
  const input = { profile: rollingProfile(8000, 20, 2500), athlete, session: session('run', { stops: 'urban' }) };

  it('same input twice gives byte-identical streams and identical summaries', () => {
    const a = simulate(input);
    const b = simulate(input);
    for (const key of streamKeys(a.streams)) expect(sameBytes(a.streams[key], b.streams[key]), key).toBe(true);
    expect(JSON.stringify(b.summary)).toBe(JSON.stringify(a.summary));
    expect(b.warnings).toEqual(a.warnings);
  });

  it('a different seed changes the noise while still honouring the target', () => {
    const a = simulate(input);
    const b = simulate({ ...input, session: { ...input.session, seed: 99 } });
    expect(sameBytes(a.streams.hr, b.streams.hr)).toBe(false);
    expect(sameBytes(a.streams.speed, b.streams.speed)).toBe(false);
    expect(sameBytes(a.streams.lat, b.streams.lat)).toBe(false);
    expect(Math.abs(avgPaceSecPerKm(b) / avgPaceSecPerKm(a) - 1)).toBeLessThan(0.01);
  });

  it('noise channels are independent: GPS level or HR sensor changes nothing else', () => {
    const base = simulate(input);
    const gps = simulate({ ...input, session: { ...input.session, gpsNoise: 'high' } });
    for (const key of ['speed', 'dist', 'hr', 'hrDemand', 'cadence', 'power'] as const) {
      expect(sameBytes(base.streams[key], gps.streams[key]), key).toBe(true);
    }
    expect(sameBytes(base.streams.lat, gps.streams.lat)).toBe(false);
    const strap = simulate({ ...input, session: { ...input.session, hrSensor: 'strap' } });
    for (const key of ['speed', 'lat', 'cadence', 'ele', 'hrDemand'] as const) {
      expect(sameBytes(base.streams[key], strap.streams[key]), key).toBe(true);
    }
  });
});

describe('target calibration (b)', () => {
  it('flat 10 km at 5:00/km: average moving pace within ±0.5 %', () => {
    const r = simulate({ profile: flatProfile(10000), athlete, session: session('run', { target: { kind: 'pace', secPerKm: 300 } }) });
    expect(r.summary.distance).toBeCloseTo(10000, 3);
    expect(Math.abs(avgPaceSecPerKm(r) / 300 - 1)).toBeLessThan(0.005);
    expect(r.warnings).toEqual([]);
  });

  it('hilly route: average moving pace within ±0.5 % although climbs are slower and descents faster', () => {
    const profile = rollingProfile(12000, 35, 2000, { smoothSigma: 20 });
    const r = simulate({ profile, athlete, session: session('run', { target: { kind: 'pace', secPerKm: 345 } }) });
    expect(Math.abs(avgPaceSecPerKm(r) / 345 - 1)).toBeLessThan(0.005);
    const s = r.streams;
    let up = 0;
    let upN = 0;
    let down = 0;
    let downN = 0;
    for (let i = 600; i < s.t.length; i++) {
      if (s.grade[i] > 0.06) {
        up += s.speed[i];
        upN++;
      } else if (s.grade[i] < -0.06) {
        down += s.speed[i];
        downN++;
      }
    }
    expect(down / downN).toBeGreaterThan((up / upN) * 1.25);
  });

  it('ride at 27 km/h average moving speed on rolling roads within ±0.5 %', () => {
    const r = simulate({ profile: rollingProfile(60000, 30, 5000), athlete, session: session('ride', { target: { kind: 'speed', mps: 27 / 3.6 } }) });
    expect(Math.abs((r.summary.avgSpeed * 3.6) / 27 - 1)).toBeLessThan(0.005);
    expect(r.summary.avgPower).toBeGreaterThan(80);
    expect(r.summary.avgPower).toBeLessThan(300);
  });

  it('duration target: moving time within ±0.5 % for a hike and for a ride', () => {
    const hike = simulate({ profile: climbProfile({ before: 1000, climb: 3000, grade: 0.12, after: 1000 }, { smoothSigma: 20 }), athlete, session: session('hike', { target: { kind: 'duration', seconds: 7200 } }) });
    expect(Math.abs(hike.summary.moving / 7200 - 1)).toBeLessThan(0.005);
    const ride = simulate({ profile: rollingProfile(40000, 25, 4000), athlete, session: session('ride', { target: { kind: 'duration', seconds: 5400 } }) });
    expect(Math.abs(ride.summary.moving / 5400 - 1)).toBeLessThan(0.005);
  });

  it('stays calibrated with urban stops, a negative split and maximum variability; stops add elapsed time only', () => {
    const r = simulate({
      profile: rollingProfile(21097, 20, 3000),
      athlete,
      session: session('run', { stops: 'urban', pacing: 'negative', variability: 1, target: { kind: 'pace', secPerKm: 330 } }),
    });
    expect(Math.abs(avgPaceSecPerKm(r) / 330 - 1)).toBeLessThan(0.005);
    let stopped = 0;
    for (let i = 1; i < r.streams.t.length; i++) if (!r.streams.moving[i]) stopped++;
    expect(stopped).toBeGreaterThan(200);
    expect(r.summary.elapsed).toBe(r.summary.moving + stopped);
  });

  it('pacing strategies shift speed between halves (negative split faster at the end)', () => {
    // Same seed for all three, so the slow pace wander cancels and only the plan differs
    // (pacingPlan = 1 + s·(x/D − 0.5), s = +0.03 negative, −0.04 positive → halves differ ≈ 1.5 % / 2 %).
    const splitRatio = (pacing: SessionSettings['pacing']) => {
      const r = simulate({ profile: flatProfile(10000), athlete, session: session('run', { pacing, variability: 0.1, target: { kind: 'pace', secPerKm: 330 } }) });
      const mid = indexAtDistance(r.streams, 5000);
      expect(Math.abs(avgPaceSecPerKm(r) / 330 - 1)).toBeLessThan(0.005);
      return meanRange(r.streams.speed, mid, r.streams.t.length) / meanRange(r.streams.speed, 400, mid);
    };
    const negative = splitRatio('negative');
    const even = splitRatio('even');
    const positive = splitRatio('positive');
    expect(negative - even).toBeGreaterThan(0.01);
    expect(even - positive).toBeGreaterThan(0.015);
  });

  it('a 3-hour ride plus a marathon simulate in well under a second', () => {
    const rideInput = { profile: rollingProfile(81000, 25, 4000), athlete, session: session('ride', { target: { kind: 'speed' as const, mps: 7.5 } }) };
    const runInput = { profile: rollingProfile(42195, 15, 3000), athlete, session: session('run', { target: { kind: 'pace' as const, secPerKm: 340 } }) };
    simulate({ profile: flatProfile(3000), athlete, session: session('run') }); // JIT warm-up
    const t0 = performance.now();
    const ride = simulate(rideInput);
    const marathon = simulate(runInput);
    const ms = performance.now() - t0;
    expect(ride.streams.t.length).toBeGreaterThan(10700);
    expect(marathon.summary.distance).toBeCloseTo(42195, 0);
    // A guard against a pathological slowdown, not a benchmark: a shared CI runner is several times slower than a laptop.
    expect(ms).toBeLessThan(1500);
  });
});
