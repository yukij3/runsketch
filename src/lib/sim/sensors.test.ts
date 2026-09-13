// What the watch records: corner caps on router polylines, GPS texture, barometer, device temperature, recorded speed,
// cadence and HR sensor texture, and signal-timed urban stops.
import { describe, expect, it } from 'vitest';
import type { ActivityType, SessionSettings, SimulationResult, TerrainProfile } from '../types';
import { defaultAthlete, defaultSession } from './athlete';
import { elevationStream, temperatureStream } from './channels';
import { createRandom } from './rng';
import { flatProfile, pathProfile, rollingProfile, segmentProfile } from './scenarios';
import { simulate } from './simulate';
import { planStops } from './stops';
import { hysteresisIncrements } from './summary';
import { indexAtDistance, meanRange, positionJumps } from './testing';
import { Cursor, buildTrack, cornerCaps } from './track';

const START = Date.UTC(2026, 5, 1, 6, 30);
const athlete = defaultAthlete();
const session = (type: ActivityType, over: Partial<SessionSettings> = {}): SessionSettings => ({
  ...defaultSession(type, START),
  seed: 7,
  ...over,
});
const run = (profile: TerrainProfile, type: ActivityType, over: Partial<SessionSettings> = {}) =>
  simulate({ profile, athlete, session: session(type, over) });

const mean = (a: ArrayLike<number>) => Array.from(a).reduce((s, v) => s + v, 0) / Math.max(1, a.length);
const sd = (a: number[]) => Math.sqrt(mean(a.map((v) => (v - mean(a)) ** 2)));
const acf1 = (a: number[]) => {
  const m = mean(a);
  let num = 0;
  let den = 0;
  for (let i = 0; i < a.length; i++) {
    den += (a[i] - m) ** 2;
    if (i > 0) num += (a[i] - m) * (a[i - 1] - m);
  }
  return num / den;
};
/** Seconds of the steady middle: after 10 min, before the last 5 min, running faster than 2 m/s. */
const steady = (r: SimulationResult) => {
  const s = r.streams;
  const out: number[] = [];
  for (let i = 601; i < s.t.length - 300; i++) if (s.speed[i] > 2) out.push(i);
  return out;
};

/** 10 km of city blocks: 200 m straights with alternating 90° turns, rolling ±10 m every 2 km. */
function cityBlocks(): TerrainProfile {
  const path: Array<[number, number]> = [[0, 0]];
  let x = 0;
  let y = 0;
  let heading = 0;
  let turn = 1;
  for (let d = 200; d <= 10000; d += 200) {
    x += 200 * Math.cos(heading);
    y += 200 * Math.sin(heading);
    path.push([x, y]);
    heading += (turn * Math.PI) / 2;
    turn = -turn;
  }
  return pathProfile(path, (d) => 50 + 10 * Math.sin((2 * Math.PI * d) / 2000));
}

describe('corner caps on router polylines', () => {
  /** 3 km flat, 3 km at −6 %, 1 km flat, drawn with a vertex every 50 m that turns by `deg` alternately left and right. */
  const kinkedDescent = (deg: number) => {
    const path: Array<[number, number]> = [[0, 0]];
    let x = 0;
    let y = 0;
    let heading = 0;
    let sign = 1;
    for (let d = 0; d < 7000; d += 50) {
      x += 50 * Math.cos(heading);
      y += 50 * Math.sin(heading);
      path.push([x, y]);
      heading = (sign * deg * Math.PI) / 360;
      sign = -sign;
    }
    return pathProfile(path, (d) => (d < 3000 ? 400 : d < 6000 ? 400 - 0.06 * (d - 3000) : 220), { smoothSigma: 20 });
  };

  it('a ride descends a road with ±15° vertices every 50 m as fast as a straight one', () => {
    const descent = (deg: number) => {
      const s = run(kinkedDescent(deg), 'ride', { target: { kind: 'speed', mps: 30 / 3.6 } }).streams;
      const v = Array.from(s.speed.slice(indexAtDistance(s, 3500), indexAtDistance(s, 5800)));
      return { mean: mean(v), min: Math.min(...v) };
    };
    const straight = descent(0);
    const kinked = descent(15);
    expect(straight.mean * 3.6).toBeGreaterThan(45);
    expect(kinked.mean / straight.mean).toBeGreaterThan(0.97);
    expect(kinked.min / straight.min).toBeGreaterThan(0.9);
  });

  it('a 150 m radius drawn with 50 m vertices does not cap a ride below 60 km/h', () => {
    const path: Array<[number, number]> = [];
    const step = 2 * Math.asin(50 / 300);
    for (let k = 0; k <= 110; k++) path.push([150 * Math.cos(k * step), 150 * Math.sin(k * step)]);
    const track = buildTrack(pathProfile(path, () => 100), 0.35);
    const caps = cornerCaps(track, 4, 2.5, 0, 22.5);
    let lowest = Infinity;
    for (let i = 20; i < track.n - 20; i++) lowest = Math.min(lowest, caps[i]);
    expect(lowest * 3.6).toBeGreaterThan(60);
  });

  it('90° street corners and a 10 m hairpin still slow runners and riders', () => {
    const square = buildTrack(pathProfile([[0, 0], [400, 0], [400, 400], [0, 400]], () => 50), 0.45);
    const corner = Math.round(400 / 5);
    expect(cornerCaps(square, 2.5, 1.2, 0.6, 12)[corner]).toBeLessThan(3.1);
    expect(cornerCaps(square, 4, 2.5, 0, 22.5)[corner] * 3.6).toBeLessThan(22);
    expect(cornerCaps(square, 4, 2.5, 0, 22.5)[corner - 40]).toBe(22.5);

    const hairpin: Array<[number, number]> = [[0, 0], [500, 0]];
    for (let a = 20; a <= 160; a += 20) hairpin.push([500 + 10 * Math.sin((a * Math.PI) / 180), 10 - 10 * Math.cos((a * Math.PI) / 180)]);
    hairpin.push([500, 20], [0, 20]);
    const ride = cornerCaps(buildTrack(pathProfile(hairpin, () => 50), 0.35), 4, 2.5, 0, 22.5);
    expect(Math.min(...ride) * 3.6).toBeLessThan(26);
  });
});

describe('GPS as recorded', () => {
  it("'normal' 1 s steps jitter like a 1 Hz single-band watch without inflating the track", () => {
    const r = run(cityBlocks(), 'run', { gpsNoise: 'normal', target: { kind: 'pace', secPerKm: 290 } });
    const jumps = positionJumps(r.streams);
    const steps = steady(r).map((i) => jumps[i]);
    expect(sd(steps)).toBeGreaterThan(0.7);
    expect(sd(steps)).toBeLessThan(1.1);
    expect(acf1(steps)).toBeGreaterThan(0.5);
    for (const [profile, type] of [
      [cityBlocks(), 'run'],
      [flatProfile(8000), 'run'],
      [flatProfile(4000), 'walk'],
    ] as const) {
      const s = run(profile, type).streams;
      const path = positionJumps(s).reduce((a, b) => a + b, 0);
      expect(path / s.dist[s.t.length - 1] - 1, `${type}`).toBeGreaterThan(-0.01);
      expect(path / s.dist[s.t.length - 1] - 1, `${type}`).toBeLessThan(0.015);
    }
  });

  it('a seeded share of activities starts with a settling receiver: fixes repeat into the first seconds of movement, then one 10–40 m jump', () => {
    let settling = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const s = run(flatProfile(1500), 'run', { seed }).streams;
      const exact = run(flatProfile(1500), 'run', { seed, gpsNoise: 'off' }).streams;
      const error = (i: number) =>
        Math.hypot((s.lat[i] - exact.lat[i]) * 111195, (s.lon[i] - exact.lon[i]) * 111195 * Math.cos((s.lat[i] * Math.PI) / 180));
      const moved = s.dist.findIndex((d) => d > 0);
      const jumps = positionJumps(s);
      if (error(moved) > 8) {
        settling++;
        expect([s.lat[moved + 1], s.lon[moved + 1]]).toEqual([s.lat[0], s.lon[0]]);
        // After the stale fixes catch up (at most 4 s after setting off), exactly one big correction.
        const big = Array.from(jumps.slice(moved + 5, moved + 20)).filter((j) => j > 8);
        expect(big).toHaveLength(1);
        expect(big[0]).toBeGreaterThan(9);
        expect(big[0]).toBeLessThan(45);
      } else {
        expect(Math.max(...jumps.slice(1, moved + 20))).toBeLessThan(6.5);
      }
    }
    expect(settling).toBeGreaterThanOrEqual(2);
    expect(settling).toBeLessThanOrEqual(12);
  });
});

describe('barometric altitude', () => {
  it('1 s steps: about half unchanged, most ±0.2 m, a few ≥ 0.4 m; a flat 10 km gains only a few metres', () => {
    const r = run(cityBlocks(), 'run', { target: { kind: 'pace', secPerKm: 290 } });
    const steps = steady(r).map((i) => Math.round(Math.abs(r.streams.ele[i] - r.streams.ele[i - 1]) * 5));
    const share = (k: (x: number) => boolean) => steps.filter(k).length / steps.length;
    expect(share((x) => x === 0)).toBeGreaterThan(0.4);
    expect(share((x) => x === 0)).toBeLessThan(0.58);
    expect(share((x) => x === 1)).toBeGreaterThan(0.38);
    expect(share((x) => x >= 2)).toBeGreaterThan(0.02);
    expect(share((x) => x >= 2)).toBeLessThan(0.12);
    for (const seed of [1, 2, 3, 4, 5]) {
      const flat = run(flatProfile(10000), 'run', { seed }).streams;
      expect(hysteresisIncrements(flat.ele, flat.t.length, 3).up.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(10);
    }
  });

  it('the summary totals the recorded altitude, which over-reads the terrain modestly', () => {
    const profile = rollingProfile(12000, 20, 1500, { smoothSigma: 10 });
    const ratios = [1, 2, 3, 4, 5].map((seed) => {
      const r = run(profile, 'run', { seed });
      const recorded = hysteresisIncrements(r.streams.ele, r.streams.t.length, 3).up.reduce((a, b) => a + b, 0);
      expect(r.summary.ascent).toBeCloseTo(recorded, 6);
      expect(r.summary.laps.reduce((a, lap) => a + lap.ascent, 0)).toBeCloseTo(recorded, 6);
      return recorded / run(profile, 'run', { seed, gpsNoise: 'off' }).summary.ascent;
    });
    for (const q of ratios) expect(q).toBeGreaterThan(0.95);
    for (const q of ratios) expect(q).toBeLessThan(1.15);
    expect(mean(ratios)).toBeGreaterThan(1);
    expect(mean(ratios)).toBeLessThan(1.1);
  });

  it('weather drifts a few metres per hour, and a per-second pressure offset replaces it', () => {
    const track = buildTrack(flatProfile(25000), 0.45);
    const n = 7200;
    const dist = Float64Array.from({ length: n }, (_, i) => i * 3);
    const tail = (ele: Float64Array) => meanRange(ele, n - 600, n) - meanRange(ele, 0, 60);
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      expect(Math.abs(tail(elevationStream(track, dist, n, 'normal', seed)))).toBeLessThan(2 + 4 * 2);
      const pressureOffset = Float64Array.from({ length: n }, (_, i) => (-10 * i) / n);
      expect(tail(elevationStream(track, dist, n, 'normal', seed, { pressureOffset }))).toBeCloseTo(-10, -1);
    }
  });
});

describe('device temperature', () => {
  it('a wrist unit reads whole degrees, starts near air temperature and settles 4–7 °C above it on a run', () => {
    const s = run(flatProfile(10000), 'run', { temperatureC: 15, target: { kind: 'pace', secPerKm: 300 } }).streams;
    const n = s.t.length;
    let changes = 0;
    for (let i = 0; i < n; i++) {
      expect(Number.isInteger(s.temperature[i])).toBe(true);
      if (i > 0 && s.temperature[i] !== s.temperature[i - 1]) {
        changes++;
        expect(Math.abs(s.temperature[i] - s.temperature[i - 1])).toBe(1);
      }
    }
    expect(s.temperature[0]).toBeGreaterThanOrEqual(15);
    expect(s.temperature[0]).toBeLessThanOrEqual(17);
    expect(meanRange(s.temperature, n - 600, n) - 15).toBeGreaterThanOrEqual(4);
    expect(meanRange(s.temperature, n - 600, n) - 15).toBeLessThanOrEqual(7);
    expect(changes).toBeLessThan(n / 60);
  });

  it('a bar-mounted ride unit stays near air temperature, and the per-second air temperature is followed', () => {
    const s = run(flatProfile(25000), 'ride', { temperatureC: 15 }).streams;
    const n = s.t.length;
    expect(meanRange(s.temperature, n - 600, n)).toBeGreaterThanOrEqual(14);
    expect(meanRange(s.temperature, n - 600, n)).toBeLessThanOrEqual(17);
    const m = 5400;
    const speed = new Float64Array(m).fill(3);
    const air = Float64Array.from({ length: m }, (_, i) => (i < 1800 ? 10 : 20));
    const t = temperatureStream(speed, air, m, 'run', createRandom(1, 'device-temp'));
    expect(meanRange(t, m - 300, m) - meanRange(t, 1500, 1800)).toBeGreaterThan(6);
  });
});

describe('recorded speed and cadence', () => {
  it('speed is smoothed to watch texture at 0.01 m/s, 0 while stopped, and distance keeps the exact motion', () => {
    const r = run(flatProfile(10000), 'run', { stops: 'urban', target: { kind: 'pace', secPerKm: 300 } });
    const s = r.streams;
    const idx = steady(r).filter((i) => s.moving[i - 30] && s.moving[i + 30]);
    const v = idx.map((i) => s.speed[i]);
    const trend = idx.map((i) => meanRange(s.speed, i - 30, i + 31));
    expect(acf1(v.map((x, k) => x - trend[k]))).toBeGreaterThan(0.85);
    for (let i = 0; i < s.t.length; i++) {
      if (!s.moving[i]) expect(s.speed[i]).toBe(0);
      else if (i > 0) expect(s.speed[i]).toBeGreaterThan(0);
    }
    expect(r.summary.distance).toBeCloseTo(10000, 6);
    expect(Math.abs(r.summary.moving / 3000 - 1)).toBeLessThan(0.005);
  });

  it('whole strides/min stay unchanged in about 80 % of seconds, and setting off counts walking steps', () => {
    const r = run(cityBlocks(), 'run', { stops: 'urban', target: { kind: 'pace', secPerKm: 290 } });
    const s = r.streams;
    const idx = steady(r).filter((i) => s.cadence[i] > 0 && s.cadence[i - 1] > 0);
    const same = idx.filter((i) => Math.floor(s.cadence[i] / 2) === Math.floor(s.cadence[i - 1] / 2)).length / idx.length;
    expect(same).toBeGreaterThan(0.7);
    expect(same).toBeLessThan(0.9);
    let starts = 0;
    for (let i = 1; i < s.t.length; i++) {
      if (s.cadence[i] > 0 && s.speed[i] > 0 && s.speed[i] < 1) {
        starts++;
        expect(s.cadence[i], `t${i}`).toBeLessThanOrEqual(135);
      }
    }
    expect(starts).toBeGreaterThan(3);
  });
});

describe('heart-rate sensor texture', () => {
  it('a chest strap leaves about two thirds of seconds unchanged with ≈ 0.6 bpm 1 s differences', () => {
    const r = run(cityBlocks(), 'run', { hrSensor: 'strap', target: { kind: 'pace', secPerKm: 290 } });
    const d = steady(r).map((i) => r.streams.hr[i] - r.streams.hr[i - 1]);
    expect(d.filter((x) => x === 0).length / d.length).toBeGreaterThan(0.55);
    expect(d.filter((x) => x === 0).length / d.length).toBeLessThan(0.75);
    expect(sd(d)).toBeGreaterThan(0.45);
    expect(sd(d)).toBeLessThan(0.75);
  });

  it('a wrist sensor under-reads the first ramp by 10–15 bpm on average and has caught up after 15 minutes', () => {
    const early: number[] = [];
    const late: number[] = [];
    for (let seed = 1; seed <= 8; seed++) {
      const over = { seed, target: { kind: 'pace', secPerKm: 330 } } as const;
      const strap = run(flatProfile(6000), 'run', { ...over, hrSensor: 'strap' }).streams.hr;
      const optical = run(flatProfile(6000), 'run', { ...over, hrSensor: 'optical' }).streams.hr;
      early.push(meanRange(strap, 30, 180) - meanRange(optical, 30, 180));
      late.push(meanRange(strap, 900, 1200) - meanRange(optical, 900, 1200));
    }
    expect(mean(early)).toBeGreaterThan(10);
    expect(mean(early)).toBeLessThan(16);
    expect(Math.abs(mean(late))).toBeLessThan(2);
  });
});

describe('signal-timed urban stops', () => {
  it('a red light stops the athlete about three times in four and holds them U(0, C − g) s', () => {
    const total = 300000;
    const stops = planStops('urban', total, 3, createRandom(1, 'stops'));
    const crossings = total / 650;
    expect(stops.length / crossings).toBeGreaterThan(0.68);
    expect(stops.length / crossings).toBeLessThan(0.86);
    const waits = stops.map((e) => e.duration);
    expect(Math.min(...waits)).toBeGreaterThanOrEqual(1);
    expect(Math.max(...waits)).toBeLessThanOrEqual(110);
    expect(mean(waits)).toBeGreaterThan(30);
    expect(mean(waits)).toBeLessThan(40);
    expect(waits.filter((w) => w > 45).length / waits.length).toBeGreaterThan(0.2);
  });

  it('urban stops are not placed on grades steeper than 6 %', () => {
    const segments = [];
    for (let k = 0; k < 20; k++) segments.push({ length: 400, grade: 0.1 }, { length: 150, grade: 0 });
    const track = buildTrack(segmentProfile(segments), 0.45);
    const cur = new Cursor(track);
    const stops = planStops('urban', track.total, 3, createRandom(3, 'stops'), track);
    expect(stops.length).toBeGreaterThan(3);
    for (const stop of stops) {
      cur.seek(stop.s);
      expect(Math.abs(cur.lerp(track.grade))).toBeLessThanOrEqual(0.06);
    }
  });
});
