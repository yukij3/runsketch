import { describe, expect, it } from 'vitest';
import type { LngLat, TerrainProfile } from '../types';
import { haversine, offsetMeters, resampleLine } from '../geo';
import type { ElevationSampler } from '../services/elevation';
import {
  ascentDescent,
  buildTerrainProfile,
  centredGrade,
  computeProfile,
  fillGaps,
  gaussianSmooth,
  gradeLimit,
  medianFilter,
  smoothingSigma,
} from './index';

const start: LngLat = [6.6, 46.5];

/** 1 km flat at 400 m, 800 m at +8 %, 800 m at −8 %, then flat. */
function hill(d: number): number {
  if (d <= 1000) return 400;
  if (d <= 1800) return 400 + 0.08 * (d - 1000);
  if (d <= 2600) return 464 - 0.08 * (d - 1800);
  return 400;
}

function samplerFrom(fn: (d: number, i: number) => number, source: TerrainProfile['elevationSource']): ElevationSampler {
  return async (coords) => ({ ele: Float64Array.from(coords, (c, i) => fn(haversine(start, c), i)), source });
}

const pointAt = (profile: TerrainProfile, d: number) =>
  profile.points.reduce((best, p) => (Math.abs(p.d - d) < Math.abs(best.d - d) ? p : best));

/** Deterministic noise in [-1, 1]. */
function lcg(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return (s / 2 ** 32) * 2 - 1;
  };
}

describe('buildTerrainProfile on a synthetic hill', () => {
  const route: LngLat[] = [start, offsetMeters(start, 0, 3200)];

  it('recovers grade, ascent and extremes', async () => {
    const profile = await buildTerrainProfile(route, samplerFrom(hill, 'mapterhorn'), { spacing: 5, activity: 'run' });
    expect(profile.elevationSource).toBe('mapterhorn');
    expect(profile.spacing).toBe(5);
    expect(profile.points).toHaveLength(641);
    expect(profile.totalDistance).toBeCloseTo(3200, 0);
    expect(profile.points[profile.points.length - 1].d).toBe(profile.totalDistance);

    expect(pointAt(profile, 1400).grade).toBeCloseTo(0.08, 2);
    expect(Math.abs(pointAt(profile, 1400).grade - 0.08)).toBeLessThan(0.005);
    expect(Math.abs(pointAt(profile, 2200).grade + 0.08)).toBeLessThan(0.005);
    expect(Math.abs(pointAt(profile, 500).grade)).toBeLessThan(0.005);
    expect(Math.abs(pointAt(profile, 3000).grade)).toBeLessThan(0.005);
    expect(Math.abs(pointAt(profile, 1400).ele - 432)).toBeLessThan(0.5);

    expect(Math.abs(profile.ascent - 64)).toBeLessThan(3);
    expect(Math.abs(profile.descent - 64)).toBeLessThan(3);
    expect(profile.minEle).toBeCloseTo(400, 0);
    expect(profile.maxEle).toBeGreaterThan(461);
    expect(profile.maxEle).toBeLessThanOrEqual(464);
  });

  it('survives DEM noise and single-sample spikes', async () => {
    const rnd = lcg(42);
    const noisy = (d: number, i: number) => hill(d) + 0.4 * rnd() + (i % 97 === 50 ? 25 : 0);
    const profile = await buildTerrainProfile(route, samplerFrom(noisy, 'aws-terrarium'));
    expect(Math.abs(profile.ascent - 64)).toBeLessThan(3);
    expect(Math.abs(profile.descent - 64)).toBeLessThan(3);
    expect(Math.abs(pointAt(profile, 1400).grade - 0.08)).toBeLessThan(0.01);
    const flat = profile.points.filter((p) => p.d > 100 && p.d < 900);
    expect(Math.max(...flat.map((p) => Math.abs(p.grade)))).toBeLessThan(0.02);
    expect(profile.maxEle).toBeLessThan(466);
  });

  it('clamps grade per activity', async () => {
    const wall = (d: number) => (d < 500 ? 0 : d < 510 ? (d - 500) * 5 : 50);
    const short: LngLat[] = [start, offsetMeters(start, 0, 1000)];
    const run = await buildTerrainProfile(short, samplerFrom(wall, 'mapterhorn'), { activity: 'run' });
    const ride = await buildTerrainProfile(short, samplerFrom(wall, 'mapterhorn'), { activity: 'ride' });
    expect(Math.max(...run.points.map((p) => p.grade))).toBeCloseTo(0.45, 9);
    expect(Math.max(...ride.points.map((p) => p.grade))).toBeCloseTo(0.25, 9);
    expect(gradeLimit('hike')).toBe(0.45);
    expect(gradeLimit('walk')).toBe(0.45);
  });

  it('passes the abort signal to the sampler', async () => {
    const ac = new AbortController();
    let seen: AbortSignal | undefined;
    const sampler: ElevationSampler = async (coords, signal) => {
      seen = signal;
      return { ele: new Float64Array(coords.length), source: 'open-meteo' };
    };
    await buildTerrainProfile(route, sampler, { signal: ac.signal });
    expect(seen).toBe(ac.signal);
  });

  it('handles empty and single-point routes', async () => {
    const sampler = samplerFrom(() => 123, 'mapterhorn');
    const empty = await buildTerrainProfile([], sampler);
    expect(empty).toMatchObject({ points: [], totalDistance: 0, elevationSource: 'none' });
    const single = await buildTerrainProfile([start], sampler);
    expect(single.points).toEqual([{ d: 0, lon: start[0], lat: start[1], ele: 123, grade: 0 }]);
    expect(single.ascent).toBe(0);
  });
});

describe('computeProfile', () => {
  const { coords, d } = resampleLine([start, offsetMeters(start, 0, 500)], 5);

  it('interpolates NaNs (edges take the nearest value)', () => {
    const raw = d.map((x) => 100 + 0.02 * x);
    for (const i of [0, 1, 2, 40, 41, 42, 43, coords.length - 1]) raw[i] = NaN;
    const profile = computeProfile(coords, raw, 5, 'run', 'aws-terrarium');
    expect(profile.elevationSource).toBe('aws-terrarium');
    expect(profile.points.every((p) => Number.isFinite(p.ele) && Number.isFinite(p.grade))).toBe(true);
    expect(pointAt(profile, 210).ele).toBeCloseTo(104.2, 1);
    expect(Math.abs(pointAt(profile, 250).grade - 0.02)).toBeLessThan(0.002);
  });

  it('all-NaN input → zeros and source none', () => {
    const profile = computeProfile(coords, new Float64Array(coords.length).fill(NaN), 5, 'ride', 'mapterhorn');
    expect(profile.elevationSource).toBe('none');
    expect(profile.points.every((p) => p.ele === 0 && p.grade === 0)).toBe(true);
    expect([profile.ascent, profile.descent, profile.minEle, profile.maxEle]).toEqual([0, 0, 0, 0]);
  });

  it('derives distances from even spacing when none are given', () => {
    const profile = computeProfile(coords, new Float64Array(coords.length), 5, 'run', 'mapterhorn');
    expect(profile.points[10].d).toBe(50);
    expect(profile.totalDistance).toBeCloseTo(500, 3);
    expect(() => computeProfile(coords, [1, 2], 5, 'run', 'mapterhorn')).toThrow();
  });
});

describe('filters', () => {
  const d = Float64Array.from({ length: 200 }, (_, i) => i * 5);

  it('fillGaps', () => {
    expect(Array.from(fillGaps([NaN, 1, NaN, 3, NaN], [0, 1, 2, 3, 4]) ?? [])).toEqual([1, 1, 2, 3, 3]);
    expect(fillGaps([NaN, NaN], [0, 1])).toBeNull();
    expect(Array.from(fillGaps([0, NaN, NaN, 30], [0, 10, 20, 30]) ?? [])).toEqual([0, 10, 20, 30]);
  });

  it('medianFilter removes single spikes and keeps monotone ramps', () => {
    const ramp = Array.from(d, (x) => x * 0.1);
    expect(Array.from(medianFilter(ramp))).toEqual(ramp);
    const spiky = Array.from(d, () => 10);
    spiky[50] = 90;
    spiky[51] = -40;
    expect(Math.max(...medianFilter(spiky))).toBe(10);
    expect(Math.min(...medianFilter(spiky))).toBe(10);
  });

  it('gaussianSmooth preserves linear trends including at the edges', () => {
    const line = Array.from(d, (x) => 50 + 0.07 * x);
    const out = gaussianSmooth(line, d, 25);
    out.forEach((v, i) => expect(v).toBeCloseTo(line[i], 8));
  });

  it('gaussianSmooth reduces noise', () => {
    const rnd = lcg(7);
    const noise = Array.from(d, () => rnd());
    const out = gaussianSmooth(noise, d, 15);
    const rms = (a: ArrayLike<number>) => Math.sqrt(Array.from(a).reduce((s, v) => s + v * v, 0) / a.length);
    expect(rms(out)).toBeLessThan(rms(noise) * 0.6);
  });

  it('centredGrade uses a centred baseline and clamps', () => {
    const e = Array.from(d, (x) => (x < 500 ? 0 : (x - 500) * 0.1));
    const g = centredGrade(e, d, 40, 0.45);
    expect(g[100]).toBeCloseTo(0.05, 9); // d = 500 m, window [480, 520]: rise 2 m over 40 m
    expect(g[120]).toBeCloseTo(0.1, 9);
    expect(g[0]).toBe(0);
    expect(centredGrade(e, d, 40, 0.06)[120]).toBe(0.06);
  });

  it('ascentDescent applies hysteresis', () => {
    const saw = Array.from({ length: 100 }, (_, i) => (i % 2 ? 2 : 0));
    expect(ascentDescent(saw, 3)).toEqual({ ascent: 0, descent: 0 });
    expect(ascentDescent([0, 10, 5, 20, 0], 3)).toEqual({ ascent: 25, descent: 25 });
    expect(ascentDescent([0, 10, 8, 20], 3)).toEqual({ ascent: 20, descent: 0 });
    expect(ascentDescent([100, 98, 110, 90], 3)).toEqual({ ascent: 12, descent: 20 });
  });

  it('smoothing sigma depends on source resolution', () => {
    expect(smoothingSigma('mapterhorn')).toBe(15);
    expect(smoothingSigma('aws-terrarium')).toBe(25);
    expect(smoothingSigma('open-meteo')).toBe(25);
  });
});
