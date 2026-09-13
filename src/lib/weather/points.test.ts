import { describe, expect, it } from 'vitest';
import type { WeatherPoint } from '../types';
import { flatProfile, outAndBackProfile, segmentProfile, squareLoopProfile } from '../sim/scenarios';
import { MAX_SAMPLE_POINTS, SPIN_UP_S, weatherSamplePoints, weatherWindow } from './points';

const rounded = (p: WeatherPoint) =>
  Math.abs(p.lon * 100 - Math.round(p.lon * 100)) < 1e-9 && Math.abs(p.lat * 100 - Math.round(p.lat * 100)) < 1e-9 && p.ele % 10 === 0;

describe('weatherSamplePoints', () => {
  it('a point-to-point route gets the start, every 2 km and the finish, rounded to 0.01° and 10 m', () => {
    const points = weatherSamplePoints(flatProfile(10000));
    expect(points.map((p) => p.d)).toEqual([0, 2000, 4000, 6000, 8000, 10000]);
    for (const p of points) expect(rounded(p)).toBe(true);
    expect(points[0].ele).toBe(100);
  });

  it('a loop shares the start and finish weather, and rounding never repeats a point', () => {
    const profile = squareLoopProfile(1000, 3);
    const points = weatherSamplePoints(profile);
    expect(points[0].d).toBe(0);
    expect(points[points.length - 1].d).toBeLessThan(profile.totalDistance);
    const ids = points.map((p) => `${p.lon},${p.lat},${p.ele}`);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('a long route is thinned to 12 points and keeps both ends', () => {
    const profile = flatProfile(400000);
    const points = weatherSamplePoints(profile);
    expect(points.length).toBeLessThanOrEqual(MAX_SAMPLE_POINTS);
    expect(points[0].d).toBe(0);
    expect(points[points.length - 1].d).toBe(profile.totalDistance);
    for (let i = 1; i < points.length; i++) expect(points[i].d).toBeGreaterThan(points[i - 1].d);
    expect(weatherSamplePoints(profile, { maxPoints: 5 }).length).toBeLessThanOrEqual(5);
  });

  it('adds a summit that no regular point is near in height, and the turnaround of an out-and-back', () => {
    const peak = segmentProfile([
      { length: 3500, grade: 0 },
      { length: 1000, grade: 0.3 },
      { length: 1000, grade: -0.3 },
      { length: 2500, grade: 0 },
    ]);
    const summit = weatherSamplePoints(peak).find((p) => p.d === 4500);
    expect(summit?.ele).toBe(400);
    const turnaround = weatherSamplePoints(outAndBackProfile(5000));
    expect(turnaround.some((p) => Math.abs(p.d - 5000) < 1)).toBe(true);
    expect(weatherSamplePoints(outAndBackProfile(5000)).every((p) => p.d < 10000)).toBe(true);
  });

  it('an empty profile has no points', () => {
    expect(weatherSamplePoints({ ...flatProfile(100), points: [] })).toEqual([]);
  });
});

describe('weatherWindow', () => {
  it('covers two spin-up days before the start day and one whole day after the end day', () => {
    const start = Date.UTC(2026, 8, 14, 6);
    expect(weatherWindow(start, 4 * 3600)).toEqual({ from: Date.UTC(2026, 8, 12) / 1000, to: Date.UTC(2026, 8, 16) / 1000 });
    expect(Date.UTC(2026, 8, 14) / 1000 - weatherWindow(start, 0).from).toBe(SPIN_UP_S);
    // Past midnight the end day moves; within the day the window does not.
    expect(weatherWindow(Date.UTC(2026, 8, 14, 22), 3 * 3600).to).toBe(Date.UTC(2026, 8, 17) / 1000);
    expect(weatherWindow(Date.UTC(2026, 8, 14, 1), 3600)).toEqual(weatherWindow(Date.UTC(2026, 8, 14, 20), 3 * 3600));
  });
});
