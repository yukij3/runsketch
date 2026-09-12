import { describe, expect, it } from 'vitest';
import type { LngLat } from '../types';
import {
  EARTH_RADIUS_M,
  bbox,
  bearing,
  cumulativeDistances,
  decodePolyline,
  encodePolyline,
  haversine,
  interpolateAlong,
  offsetMeters,
  polylineLength,
  resampleLine,
} from './index';

const ONE_DEG_M = (EARTH_RADIUS_M * Math.PI) / 180; // ≈ 111 195 m

describe('haversine', () => {
  it('measures one degree along the equator and a meridian', () => {
    expect(haversine([0, 0], [1, 0])).toBeCloseTo(ONE_DEG_M, 3);
    expect(haversine([10, 45], [10, 46])).toBeCloseTo(ONE_DEG_M, 3);
  });

  it('is symmetric and zero for identical points', () => {
    const a: LngLat = [13.3777, 52.5163];
    const b: LngLat = [6.6323, 46.519];
    expect(haversine(a, b)).toBeCloseTo(haversine(b, a), 6);
    expect(haversine(a, a)).toBe(0);
    // Berlin Mitte → Lausanne, great-circle ≈ 825 km
    expect(haversine(a, b) / 1000).toBeGreaterThan(815);
    expect(haversine(a, b) / 1000).toBeLessThan(835);
  });
});

describe('bearing', () => {
  it('returns compass bearings in [0, 360)', () => {
    expect(bearing([0, 0], [0, 1])).toBeCloseTo(0, 9);
    expect(bearing([0, 0], [1, 0])).toBeCloseTo(90, 9);
    expect(bearing([0, 1], [0, 0])).toBeCloseTo(180, 9);
    expect(bearing([1, 0], [0, 0])).toBeCloseTo(270, 9);
    const b = bearing([0, 0], [-1, 1]);
    expect(b).toBeGreaterThan(300);
    expect(b).toBeLessThan(360);
  });
});

describe('distances along a line', () => {
  const line: LngLat[] = [
    [0, 0],
    [0.001, 0],
    [0.001, 0.001],
  ];

  it('cumulativeDistances starts at 0 and matches polylineLength', () => {
    const cum = cumulativeDistances(line);
    expect(cum).toHaveLength(3);
    expect(cum[0]).toBe(0);
    expect(cum[1]).toBeCloseTo(haversine(line[0], line[1]), 9);
    expect(cum[2]).toBeCloseTo(polylineLength(line), 9);
    expect(cumulativeDistances([])).toEqual([]);
    expect(polylineLength([[1, 1]])).toBe(0);
  });

  it('interpolateAlong finds the segment and clamps', () => {
    const cum = cumulativeDistances(line);
    const mid = interpolateAlong(line, cum, cum[1] / 2);
    expect(mid[0]).toBeCloseTo(0.0005, 9);
    expect(mid[1]).toBeCloseTo(0, 9);
    const onSecond = interpolateAlong(line, cum, cum[1] + (cum[2] - cum[1]) * 0.25);
    expect(onSecond[0]).toBeCloseTo(0.001, 9);
    expect(onSecond[1]).toBeCloseTo(0.00025, 6);
    expect(interpolateAlong(line, cum, -5)).toEqual([0, 0]);
    expect(interpolateAlong(line, cum, 1e9)).toEqual([0.001, 0.001]);
  });

  it('interpolateAlong uses binary search on long lines and survives zero-length segments', () => {
    const long: LngLat[] = [];
    for (let i = 0; i < 10_000; i++) long.push([i * 1e-4, 0]);
    long.splice(5000, 0, [4999e-4, 0]); // duplicate vertex
    const cum = cumulativeDistances(long);
    const p = interpolateAlong(long, cum, cum[7000] + 3);
    expect(haversine(long[7000], p)).toBeCloseTo(3, 6);
  });
});

describe('resampleLine', () => {
  const start: LngLat = [6.6, 46.5];

  it('keeps fixed spacing and the exact last point', () => {
    const end = offsetMeters(start, 0, 102);
    const { coords, d } = resampleLine([start, end], 5);
    expect(coords).toHaveLength(22); // 0..100 every 5 m, plus 102
    expect(d[1]).toBe(5);
    expect(d[20]).toBe(100);
    expect(d[21]).toBeCloseTo(102, 6);
    expect(coords[21]).toEqual(end);
    for (let i = 1; i < 21; i++) expect(haversine(coords[i - 1], coords[i])).toBeCloseTo(5, 3);
  });

  it('does not add a sliver when the length is a multiple of the spacing', () => {
    const end: LngLat = [start[0], start[1] + (100 / EARTH_RADIUS_M) * (180 / Math.PI)];
    const { coords, d } = resampleLine([start, end], 5);
    expect(haversine(start, end)).toBeCloseTo(100, 6);
    expect(coords).toHaveLength(21);
    expect(d[20]).toBeCloseTo(100, 6);
    expect(coords[20]).toEqual(end);
  });

  it('follows corners by distance along the path', () => {
    const corner = offsetMeters(start, 0, 12);
    const end = offsetMeters(corner, 12, 0);
    const { coords, d } = resampleLine([start, corner, end], 5);
    expect(d).toEqual([0, 5, 10, 15, 20, expect.closeTo(24, 3)]);
    // 15 m along = 3 m east of the corner
    expect(haversine(corner, coords[3])).toBeCloseTo(3, 2);
  });

  it('handles degenerate input', () => {
    expect(resampleLine([], 5)).toEqual({ coords: [], d: [] });
    expect(resampleLine([start], 5)).toEqual({ coords: [start], d: [0] });
    expect(resampleLine([start, start], 5)).toEqual({ coords: [start], d: [0] });
    expect(() => resampleLine([start], 0)).toThrow();
  });
});

describe('offsetMeters and bbox', () => {
  it('moves by the requested metres', () => {
    const p: LngLat = [13.4, 52.5];
    const q = offsetMeters(p, 300, 400);
    expect(haversine(p, q)).toBeCloseTo(500, 0);
    expect(bearing(p, q)).toBeCloseTo(36.87, 0);
  });

  it('computes min/max extents', () => {
    expect(
      bbox([
        [1, 5],
        [-2, 3],
        [4, -1],
      ]),
    ).toEqual([-2, -1, 4, 5]);
    expect(bbox([])).toEqual([Infinity, Infinity, -Infinity, -Infinity]);
  });
});

describe('encoded polyline', () => {
  // Google's documented vector, given as (lat, lng) pairs; our coords are [lon, lat].
  const vector: LngLat[] = [
    [-120.2, 38.5],
    [-120.95, 40.7],
    [-126.453, 43.252],
  ];
  const encoded = '_p~iF~ps|U_ulLnnqC_mqNvxq`@';

  it('encodes the reference vector', () => {
    expect(encodePolyline(vector)).toBe(encoded);
  });

  it('decodes the reference vector', () => {
    const decoded = decodePolyline(encoded);
    expect(decoded).toHaveLength(3);
    decoded.forEach((p, i) => {
      expect(p[0]).toBeCloseTo(vector[i][0], 9);
      expect(p[1]).toBeCloseTo(vector[i][1], 9);
    });
  });

  it('round-trips at precision 6 with negative and tiny deltas', () => {
    const line: LngLat[] = [
      [6.632534, 46.518956],
      [6.632534, 46.518956],
      [-0.000001, -0.000001],
      [179.999999, -89.999999],
      [-179.999999, 89.999999],
    ];
    const back = decodePolyline(encodePolyline(line, 6), 6);
    back.forEach((p, i) => {
      expect(p[0]).toBeCloseTo(line[i][0], 6);
      expect(p[1]).toBeCloseTo(line[i][1], 6);
    });
    expect(encodePolyline([])).toBe('');
    expect(decodePolyline('')).toEqual([]);
    expect(() => decodePolyline('_p~iF~ps|U_')).toThrow();
  });
});
