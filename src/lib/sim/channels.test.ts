import { describe, expect, it } from 'vitest';
import type { ActivityType, SessionSettings, TerrainProfile } from '../types';
import { defaultAthlete, defaultSession } from './athlete';
import { OuTrack, channelSeed, createRandom } from './rng';
import {
  flatProfile,
  outAndBackProfile,
  rollingProfile,
  segmentProfile,
  squareLoopProfile,
  twoPointProfile,
} from './scenarios';
import { simulate } from './simulate';
import { indexAtDistance, meanRange, nonFiniteStreams, positionJumps } from './testing';

const START = Date.UTC(2026, 5, 1, 6, 30);
const athlete = defaultAthlete();
const session = (type: ActivityType, over: Partial<SessionSettings> = {}): SessionSettings => ({
  ...defaultSession(type, START),
  seed: 2024,
  ...over,
});
const TARGET: Record<ActivityType, SessionSettings['target']> = {
  run: { kind: 'pace', secPerKm: 330 },
  walk: { kind: 'pace', secPerKm: 720 },
  hike: { kind: 'pace', secPerKm: 900 },
  ride: { kind: 'speed', mps: 7.5 },
};

describe('cadence (h)', () => {
  const movingCadence = (type: ActivityType, profile: TerrainProfile) => {
    const r = simulate({ profile, athlete, session: session(type, { target: TARGET[type] }) });
    const values: number[] = [];
    for (let i = 1; i < r.streams.t.length; i++) if (r.streams.moving[i] && r.streams.cadence[i] > 0) values.push(r.streams.cadence[i]);
    return { r, values, mean: values.reduce((a, b) => a + b, 0) / values.length };
  };

  it('running: 140–205 spm, mean 160–185 at 5:30/km', () => {
    const { values, mean } = movingCadence('run', rollingProfile(6000, 20, 2000));
    expect(Math.min(...values)).toBeGreaterThanOrEqual(140);
    expect(Math.max(...values)).toBeLessThanOrEqual(205);
    expect(mean).toBeGreaterThan(160);
    expect(mean).toBeLessThan(185);
  });

  it('walking and hiking: 80–135 spm, brisk walk mean 105–125', () => {
    const walk = movingCadence('walk', flatProfile(3000));
    expect(Math.min(...walk.values)).toBeGreaterThanOrEqual(80);
    expect(Math.max(...walk.values)).toBeLessThanOrEqual(135);
    expect(walk.mean).toBeGreaterThan(105);
    expect(walk.mean).toBeLessThan(125);
    const hike = movingCadence('hike', rollingProfile(4000, 60, 1500, { smoothSigma: 20 }));
    expect(Math.min(...hike.values)).toBeGreaterThanOrEqual(80);
    expect(Math.max(...hike.values)).toBeLessThanOrEqual(135);
  });

  it('cycling: pedalling 55–110 rpm with a mean of 70–95, zero while coasting', () => {
    const { r, values, mean } = movingCadence('ride', rollingProfile(20000, 30, 4000));
    expect(Math.min(...values)).toBeGreaterThanOrEqual(55);
    expect(Math.max(...values)).toBeLessThanOrEqual(110);
    expect(mean).toBeGreaterThan(70);
    expect(mean).toBeLessThan(95);
    const zeros = Array.from(r.streams.cadence).filter((c, i) => i > 0 && r.streams.moving[i] && c === 0).length;
    expect(zeros).toBeGreaterThan(0);
  });

  it('running cadence rises with speed (quicker steps, not only longer ones)', () => {
    const slow = movingCadence('run', flatProfile(4000));
    const fast = simulate({ profile: flatProfile(4000), athlete, session: session('run', { target: { kind: 'pace', secPerKm: 240 } }) });
    expect(fast.summary.avgCadence).toBeGreaterThan(slow.mean + 3);
  });
});

describe('GPS and altitude (h)', () => {
  const loop = squareLoopProfile(500, 5);

  it("'normal' noise changes position-derived distance by < 3 % and never jumps faster than 1.6× true speed", () => {
    for (const type of ['run', 'ride'] as const) {
      const r = simulate({ profile: loop, athlete, session: session(type, { gpsNoise: 'normal', target: TARGET[type] }) });
      const s = r.streams;
      const jumps = positionJumps(s);
      let path = 0;
      for (let i = 1; i < jumps.length; i++) {
        path += jumps[i];
        const trueSpeed = Math.max(s.speed[i - 1], s.speed[i]);
        if (trueSpeed >= 2) expect(jumps[i], `${type} second ${i}`).toBeLessThanOrEqual(1.6 * trueSpeed);
      }
      expect(Math.abs(path / r.summary.distance - 1), type).toBeLessThan(0.03);
    }
  });

  it("'off' records the route exactly and the DEM elevation exactly; noise is correlated, not white", () => {
    const off = simulate({ profile: rollingProfile(3000, 15, 1000), athlete, session: session('run', { gpsNoise: 'off' }) });
    const { points } = rollingProfile(3000, 15, 1000);
    const i = indexAtDistance(off.streams, 1500);
    const d = off.streams.dist[i];
    const j = Math.floor(d / 5);
    const f = (d - points[j].d) / (points[j + 1].d - points[j].d);
    expect(off.streams.lat[i]).toBeCloseTo(points[j].lat + f * (points[j + 1].lat - points[j].lat), 9);
    expect(off.streams.ele[i]).toBeCloseTo(points[j].ele + f * (points[j + 1].ele - points[j].ele), 9);

    const on = simulate({ profile: rollingProfile(3000, 15, 1000), athlete, session: session('run', { gpsNoise: 'normal' }) });
    const err = (k: number) => (on.streams.lat[k] - off.streams.lat[k]) * 111195;
    let lag1 = 0;
    let lag0 = 0;
    for (let k = 1; k < on.streams.t.length; k++) {
      lag0 += err(k) * err(k);
      lag1 += err(k) * err(k - 1);
    }
    expect(lag1 / lag0).toBeGreaterThan(0.9);
    expect(Math.sqrt(lag0 / on.streams.t.length)).toBeLessThan(5);
    for (const e of on.streams.ele) expect(Math.abs(e * 5 - Math.round(e * 5))).toBeLessThan(1e-6);
  });

  it('higher environment multipliers produce larger position error', () => {
    const rms = (level: SessionSettings['gpsNoise']) => {
      const r = simulate({ profile: flatProfile(4000), athlete, session: session('run', { gpsNoise: level }) });
      const ref = simulate({ profile: flatProfile(4000), athlete, session: session('run', { gpsNoise: 'off' }) });
      let sum = 0;
      for (let k = 0; k < r.streams.t.length; k++) sum += ((r.streams.lat[k] - ref.streams.lat[k]) * 111195) ** 2;
      return Math.sqrt(sum / r.streams.t.length);
    };
    expect(rms('high')).toBeGreaterThan(rms('low') * 2);
  });
});

describe('streams and summary consistency', () => {
  const r = simulate({ profile: rollingProfile(10500, 25, 2500), athlete, session: session('run', { stops: 'urban' }) });
  const s = r.streams;

  it('1 Hz elapsed timeline with distance and speed consistent', () => {
    for (let i = 0; i < s.t.length; i++) expect(s.t[i]).toBe(i);
    for (let i = 1; i < s.t.length - 1; i++) {
      const dd = s.dist[i] - s.dist[i - 1];
      expect(dd).toBeGreaterThanOrEqual(0);
      if (s.moving[i] && s.speed[i] > 0) expect(Math.abs(dd - 0.5 * (s.speed[i] + s.speed[i - 1]))).toBeLessThan(1e-9);
    }
    expect(s.dist[s.t.length - 1]).toBeCloseTo(10500, 6);
  });

  it('laps tile the activity: distances and elapsed add up, ranges do not overlap', () => {
    const laps = r.summary.laps;
    expect(laps.length).toBe(11);
    expect(laps.reduce((a, l) => a + l.distance, 0)).toBeCloseTo(r.summary.distance, 6);
    expect(laps.reduce((a, l) => a + l.elapsed, 0)).toBe(r.summary.elapsed);
    expect(laps.reduce((a, l) => a + l.moving, 0)).toBe(r.summary.moving);
    for (let k = 1; k < laps.length; k++) expect(laps[k].startIndex).toBe(laps[k - 1].endIndex + 1);
    // Each lap closes on the first sample past the boundary, so laps are 1000 m ± one second of running.
    for (const lap of laps.slice(0, -1)) expect(Math.abs(lap.distance - 1000)).toBeLessThan(6);
    for (let k = 0; k < laps.length - 1; k++) expect(s.dist[laps[k].endIndex]).toBeGreaterThanOrEqual((k + 1) * 1000);
    expect(laps[10].distance).toBeCloseTo(500, -1);
  });

  it('summary aggregates agree with the streams', () => {
    const sm = r.summary;
    expect(sm.avgSpeed).toBeCloseTo(sm.distance / sm.moving, 9);
    expect(sm.maxHr).toBe(Math.max(...s.hr));
    expect(sm.maxSpeed).toBeGreaterThan(sm.avgSpeed);
    expect(sm.ascent).toBeGreaterThan(80);
    expect(sm.ascent).toBeLessThan(250);
    expect(sm.calories).toBeGreaterThan(600);
    expect(sm.calories).toBeLessThan(900);
    expect(sm.avgPower).toBeGreaterThan(150);
  });

  it('corners slow the athlete before the turn, not after a teleport', () => {
    // At 4:00/km (4.2 m/s) a 90° street corner (R ≈ 3.5 m, a_lat 2.5 m/s²) caps speed near 3 m/s.
    const run = simulate({ profile: squareLoopProfile(400, 3), athlete, session: session('run', { variability: 0, gpsNoise: 'off', target: { kind: 'pace', secPerKm: 240 } }) });
    const rs = run.streams;
    const corner = indexAtDistance(rs, 800);
    const straight = meanRange(rs.speed, indexAtDistance(rs, 550), indexAtDistance(rs, 650));
    const slowest = Math.min(...rs.speed.slice(corner - 3, corner + 3));
    expect(slowest).toBeLessThan(straight - 0.7);
    expect(slowest).toBeGreaterThan(2.5);
    // Braking is anticipated (distance-domain backward pass): the slowest sample is at the corner itself,
    // not a few metres after it as a purely reactive rate limiter would give.
    let slowIdx = corner - 5;
    for (let i = corner - 5; i <= corner + 5; i++) if (rs.speed[i] < rs.speed[slowIdx]) slowIdx = i;
    expect(Math.abs(rs.dist[slowIdx] - 800)).toBeLessThan(6);
    for (let i = 1; i < rs.t.length; i++) {
      expect(rs.speed[i] - rs.speed[i - 1]).toBeLessThanOrEqual(0.6 + 1e-9);
      expect(rs.speed[i - 1] - rs.speed[i]).toBeLessThanOrEqual(1.2 + 1e-9);
    }
    const uTurn = simulate({ profile: outAndBackProfile(1000), athlete, session: session('run', { variability: 0 }) });
    const turn = indexAtDistance(uTurn.streams, 1000);
    expect(Math.min(...uTurn.streams.speed.slice(turn - 3, turn + 3))).toBeLessThan(2.6);
  });
});

describe('robustness (i)', () => {
  const cases: Array<[string, TerrainProfile, ActivityType, Partial<SessionSettings>]> = [
    ['2-point 60 m route', twoPointProfile(60), 'run', {}],
    ['2-point 60 m ride', twoPointProfile(60), 'ride', {}],
    ['40 % grade (run)', segmentProfile([{ length: 300, grade: 0 }, { length: 200, grade: 0.4 }, { length: 200, grade: -0.4 }, { length: 300, grade: 0 }]), 'run', {}],
    ['40 % grade (ride)', segmentProfile([{ length: 300, grade: 0 }, { length: 200, grade: 0.4 }, { length: 200, grade: -0.4 }, { length: 300, grade: 0 }]), 'ride', {}],
    ['40 % grade (hike)', segmentProfile([{ length: 300, grade: 0.4 }, { length: 300, grade: -0.4 }]), 'hike', {}],
    ['200 km ride', rollingProfile(200000, 60, 10000), 'ride', { stops: 'few' }],
    ['zero variability', rollingProfile(5000, 20, 1500), 'run', { variability: 0, stops: 'urban' }],
    ['zero variability ride', rollingProfile(5000, 20, 1500), 'ride', { variability: 0, stops: 'urban' }],
    ['10 m route', twoPointProfile(10), 'walk', {}],
  ];
  for (const [name, profile, type, over] of cases) {
    it(`no NaN: ${name}`, () => {
      const r = simulate({ profile, athlete, session: session(type, { target: TARGET[type], ...over }) });
      expect(nonFiniteStreams(r)).toEqual([]);
      expect(r.streams.t.length).toBeGreaterThan(1);
      expect(r.summary.distance).toBeCloseTo(profile.totalDistance, 6);
      for (const v of Object.values(r.summary)) if (typeof v === 'number') expect(Number.isFinite(v)).toBe(true);
    });
  }

  it('short routes and invalid inputs produce warnings instead of exceptions', () => {
    expect(simulate({ profile: twoPointProfile(20), athlete, session: session('run') }).warnings.join(' ')).toMatch(/only 20 m/);
    const empty = simulate({ profile: { ...flatProfile(100), points: [] }, athlete, session: session('run') });
    expect(empty.streams.t.length).toBe(0);
    expect(empty.warnings.length).toBe(1);
    const broken = flatProfile(2000);
    broken.points[10] = { ...broken.points[10], ele: Number.NaN, grade: Number.NaN };
    const r = simulate({ profile: broken, athlete: { ...athlete, weightKg: Number.NaN }, session: session('run', { target: { kind: 'pace', secPerKm: 0 } }) });
    expect(nonFiniteStreams(r)).toEqual([]);
    expect(r.warnings.some((w) => w.includes('target was missing'))).toBe(true);
  });
});

describe('seeded randomness', () => {
  it('channels derive different seeds and the OU tracks have the requested stationary spread', () => {
    expect(channelSeed(1, 'pace')).not.toBe(channelSeed(1, 'hr-sensor'));
    expect(channelSeed(1, 'pace')).not.toBe(channelSeed(2, 'pace'));
    const a = createRandom(5, 'x');
    const b = createRandom(5, 'x');
    for (let i = 0; i < 100; i++) expect(a.uniform()).toBe(b.uniform());
    const track = new OuTrack(createRandom(3, 'ou'), [[45, 0.02]], 1);
    const n = 200000;
    let sq = 0;
    for (let i = 0; i < n; i++) sq += track.at(i) ** 2;
    expect(Math.sqrt(sq / n)).toBeGreaterThan(0.017);
    expect(Math.sqrt(sq / n)).toBeLessThan(0.023);
    // Reading out of order gives the same values (lazy, sequential generation).
    const again = new OuTrack(createRandom(3, 'ou'), [[45, 0.02]], 1);
    expect(again.at(5000)).toBe(track.at(5000));
  });

  it('defaultSession gives a complete, sensible session', () => {
    const s = defaultSession('ride', START);
    expect(s.type).toBe('ride');
    expect(s.target.kind).toBe('speed');
    expect(s.variability).toBe(0.35);
    expect(s.lapDistance).toBe(1000);
    expect(Number.isInteger(s.seed)).toBe(true);
    expect(s.name).toMatch(/Ride$/);
  });
});
