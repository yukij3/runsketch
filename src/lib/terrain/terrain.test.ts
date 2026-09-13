import { describe, expect, it } from 'vitest';
import type { LngLat, TerrainProfile, WaySpan } from '../types';
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
  removeDemPatches,
  smoothingSigma,
  traitsAlong,
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
    expect(Math.max(...ride.points.map((p) => p.grade))).toBeCloseTo(0.35, 9);
    expect(run.gradeClampedM).toBeGreaterThan(0);
    expect(ride.gradeClampedM).toBeGreaterThanOrEqual(run.gradeClampedM!);
    expect(gradeLimit('ride')).toBe(0.35);
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

/** A DEM of `size` m pixels holding the truth at their centres, linear in between (how a 30 m surface model is sampled). */
function pixels(fn: (d: number) => number, size = 30): (d: number) => number {
  return (d) => {
    const k = Math.floor(d / size);
    const t = d / size - k;
    return fn(k * size) * (1 - t) + fn((k + 1) * size) * t;
  };
}

/** Twelve canopy or roof patches 6–16 m high and 40–240 m wide, one per 800 m of a 10 km route. */
function patches(seed: number): Array<[from: number, to: number, height: number]> {
  const rnd = lcg(seed);
  const unit = () => (rnd() + 1) / 2;
  return Array.from({ length: 12 }, (_, k) => {
    const width = 40 + 200 * unit();
    const height = 6 + 10 * unit();
    const from = 400 + k * 800 + (700 - width) * unit();
    return [from, from + width, height];
  });
}

const raised = (list: Array<[number, number, number]>, d: number) => list.reduce((s, [a, b, h]) => s + (d >= a && d <= b ? h : 0), 0);
const maxGrade = (profile: TerrainProfile) => Math.max(...profile.points.map((p) => Math.abs(p.grade)));

/** 300 m at +12 % from 4 km, 400 m level, 300 m at −12 %. */
function climb(d: number): number {
  if (d < 4000) return 400;
  if (d < 4300) return 400 + 0.12 * (d - 4000);
  if (d < 4700) return 436;
  if (d < 5000) return 436 - 0.12 * (d - 4700);
  return 400;
}

describe('DEM artefacts', () => {
  const route: LngLat[] = [start, offsetMeters(start, 0, 10_000)];

  // Before the patch filter this case gave 118–123 m of ascent and grades of 20–28 %.
  it.each([
    ['mapterhorn', 1],
    ['mapterhorn', 2],
    ['aws-terrarium', 3],
    ['aws-terrarium', 4],
  ] as const)('canopy and roofs do not turn a flat route into hills (%s, layout %i)', async (source, seed) => {
    const list = patches(seed);
    const profile = await buildTerrainProfile(route, samplerFrom(pixels((d) => 400 + raised(list, d)), source));
    expect(profile.ascent).toBeLessThan(20);
    expect(maxGrade(profile)).toBeLessThan(0.08);
  });

  it.each(['mapterhorn', 'aws-terrarium'] as const)('a real 300 m climb at 12 %% keeps its ascent and grade, patches or not (%s)', async (source) => {
    const list = patches(5);
    for (const fn of [climb, (d: number) => climb(d) + raised(list, d)]) {
      const profile = await buildTerrainProfile(route, samplerFrom(pixels(fn), source));
      expect(Math.abs(profile.ascent - 36)).toBeLessThan(36 * 0.05);
      const peak = Math.max(...profile.points.filter((p) => p.d > 3900 && p.d < 5100).map((p) => Math.abs(p.grade)));
      expect(Math.abs(peak - 0.12)).toBeLessThan(0.12 * 0.15);
    }
  });

  it('keeps a steep step onto ground that stays higher', async () => {
    const profile = await buildTerrainProfile(route, samplerFrom(pixels((d) => (d < 5000 ? 400 : 410)), 'aws-terrarium'));
    expect(Math.abs(profile.ascent - 10)).toBeLessThan(1);
  });

  it('treats a knoll with short steep ramps on a road as a DEM patch', async () => {
    const short: LngLat[] = [start, offsetMeters(start, 0, 2000)];
    // 8 m up and down over 32 m ramps, 176 m apart.
    const knoll = (d: number) => 400 + Math.max(0, Math.min(8, 0.25 * (d - 900), 0.25 * (1140 - d)));
    const road = await buildTerrainProfile(short, samplerFrom(pixels(knoll, 10), 'mapterhorn'), {
      ways: [{ end: 1, tags: 'highway=residential surface=asphalt' }],
    });
    expect(road.ascent).toBeLessThan(1);
  });

  // Steep ways used to skip the patch filter: these gave about 130 m of ascent and 22–30 % grades.
  it.each([
    ['T2', 'highway=path sac_scale=mountain_hiking', 'mapterhorn', 1],
    ['T2', 'highway=path sac_scale=mountain_hiking', 'aws-terrarium', 2],
    ['T3', 'highway=path surface=ground sac_scale=demanding_mountain_hiking', 'mapterhorn', 3],
    ['T3', 'highway=path surface=ground sac_scale=demanding_mountain_hiking', 'aws-terrarium', 4],
  ] as const)('canopy and roofs do not turn a flat %s path into hills (%s, layout %i)', async (_, tags, source, seed) => {
    const list = patches(seed);
    const profile = await buildTerrainProfile(route, samplerFrom(pixels((d) => 400 + raised(list, d)), source), {
      activity: 'hike',
      ways: [{ end: 1, tags }],
    });
    expect(profile.ascent).toBeLessThan(20);
    expect(maxGrade(profile)).toBeLessThan(0.08);
  });

  it.each([
    ['mapterhorn', 10, 11],
    ['aws-terrarium', 30, 12],
  ] as const)('a steep switchback trail keeps its ascent (%s)', async (source, size, seed) => {
    // 3 km of ramps 40–120 m long at 25–35 %, each followed by a flat turn of 8–20 m.
    const rnd = lcg(seed);
    const unit = () => (rnd() + 1) / 2;
    const knots: Array<[number, number]> = [
      [0, 1000],
      [200, 1000],
    ];
    while (knots[knots.length - 1][0] < 2800) {
      const [x, z] = knots[knots.length - 1];
      const ramp = 40 + 80 * unit();
      const top: [number, number] = [x + ramp, z + (0.25 + 0.1 * unit()) * ramp];
      knots.push(top, [top[0] + 8 + 12 * unit(), top[1]]);
    }
    const climb = knots[knots.length - 1][1] - 1000;
    const trail = (d: number) => {
      const i = knots.findIndex(([x]) => x >= d);
      if (i < 0) return knots[knots.length - 1][1];
      if (i === 0) return knots[0][1];
      const [x0, z0] = knots[i - 1];
      const [x1, z1] = knots[i];
      return z0 + ((z1 - z0) * (d - x0)) / (x1 - x0);
    };
    const profile = await buildTerrainProfile([start, offsetMeters(start, 0, 3000)], samplerFrom(pixels(trail, size), source), {
      activity: 'hike',
      ways: [{ end: 1, tags: 'highway=path surface=ground sac_scale=demanding_mountain_hiking' }],
    });
    expect(climb).toBeGreaterThan(500);
    expect(Math.abs(profile.ascent - climb)).toBeLessThan(0.05 * climb);
  });

  it('removeDemPatches subtracts a raised patch and leaves the slope under it', () => {
    const d = Float64Array.from({ length: 401 }, (_, i) => i * 5);
    const ele = Array.from(d, (x) => 100 + 0.05 * x + (x >= 800 && x < 1000 ? 12 : 0));
    const out = removeDemPatches(ele, d, 0.15);
    out.forEach((v, i) => expect(v).toBeCloseTo(100 + 0.05 * d[i], 6));
    expect(Array.from(removeDemPatches([1, 2], [0, 5], 0.15))).toEqual([1, 2]);
  });
});

describe('bridges and tunnels', () => {
  const route: LngLat[] = [start, offsetMeters(start, 0, 840), offsetMeters(start, 0, 1160), offsetMeters(start, 0, 2000)];
  const across = (tag: string): WaySpan[] => [
    { end: 1, tags: 'highway=secondary surface=asphalt' },
    { end: 2, tags: `highway=secondary surface=asphalt ${tag}` },
    { end: 3, tags: 'highway=secondary surface=asphalt' },
  ];
  // 25 m deep or high with 100 m walls: too long to pass for a DEM patch.
  const valley = (d: number) => 400 - Math.max(0, Math.min(25, 0.25 * (d - 850), 0.25 * (1150 - d)));
  const ridge = (d: number) => 800 - valley(d);

  it.each([
    ['bridge=yes', valley],
    ['man_made=bridge', valley],
    ['tunnel=yes', ridge],
  ] as const)('%s: the way runs straight between the ends', async (tag, fn) => {
    const sampler = samplerFrom(fn, 'mapterhorn');
    const untagged = await buildTerrainProfile(route, sampler);
    const tagged = await buildTerrainProfile(route, sampler, { ways: across(tag) });
    expect(untagged.ascent).toBeGreaterThan(20);
    expect(tagged.ascent).toBeLessThan(0.5);
    expect(maxGrade(tagged)).toBeLessThan(0.005);
    expect(tagged.points.every((p) => p.surface === 'paved' && p.technicality === 0)).toBe(true);
  });
});

describe('grade limits by way', () => {
  it('clamps implausible grades for the way class and reports the clamped metres', async () => {
    const short: LngLat[] = [start, offsetMeters(start, 0, 1000)];
    const ramp = (d: number) => 400 + 0.3 * Math.max(0, Math.min(200, d - 400));
    const sampler = samplerFrom(ramp, 'mapterhorn');
    const untagged = await buildTerrainProfile(short, sampler);
    const road = await buildTerrainProfile(short, sampler, { ways: [{ end: 1, tags: 'highway=residential' }] });
    const steps = await buildTerrainProfile(short, sampler, { ways: [{ end: 1, tags: 'highway=steps' }] });
    expect(maxGrade(untagged)).toBeCloseTo(0.3, 2);
    expect(untagged.gradeClampedM).toBe(0);
    expect(maxGrade(road)).toBe(0.25);
    expect(road.gradeClampedM).toBeGreaterThan(150);
    expect(road.gradeClampedM).toBeLessThan(220);
    expect(maxGrade(steps)).toBeCloseTo(0.3, 2);
    expect(steps.gradeClampedM).toBe(0);
  });
});

describe('surfaces along the route', () => {
  const route: LngLat[] = [start, offsetMeters(start, 0, 100), offsetMeters(start, 0, 104), offsetMeters(start, 0, 200), offsetMeters(start, 0, 300)];
  const ways: WaySpan[] = [
    { end: 1, tags: 'highway=path surface=ground sac_scale=demanding_mountain_hiking' },
    { end: 2, tags: '' },
    { end: 3, tags: 'highway=steps' },
    { end: 4, tags: '' },
  ];

  it('resamples way traits onto profile points; untagged stretches borrow within 10 m', async () => {
    const profile = await buildTerrainProfile(route, samplerFrom(() => 500, 'mapterhorn'), { ways, activity: 'hike' });
    const at = (d: number) => pointAt(profile, d);
    expect(at(50)).toMatchObject({ surface: 'ground', technicality: 0.4 });
    expect(at(100)).toMatchObject({ surface: 'ground', technicality: 0.4 });
    expect(at(150)).toMatchObject({ surface: 'steps', technicality: 0 });
    expect(at(205)).toMatchObject({ surface: 'steps', technicality: 0 });
    expect(at(215)).not.toHaveProperty('surface');
    expect(at(250)).not.toHaveProperty('technicality');
  });

  it('ignores spans that do not describe the route, and leaves untagged routes without traits', async () => {
    const { d } = resampleLine(route, 5);
    expect(traitsAlong(route, [{ end: 2, tags: 'highway=path' }], d)).toBeNull();
    const profile = await buildTerrainProfile(route, samplerFrom(() => 500, 'mapterhorn'));
    expect(profile.points.some((p) => 'surface' in p || 'technicality' in p)).toBe(false);
  });
});
