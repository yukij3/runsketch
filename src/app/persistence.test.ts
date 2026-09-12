import { describe, expect, it } from 'vitest';
import type { LngLat } from '../lib/types';
import { buildInitialState, encodeShare, sameRoute } from './persistence';

const NOW = Date.UTC(2026, 8, 12, 7, 0);
const precise: LngLat[] = [
  [2.1496812345, 41.3751023456],
  [2.1532198765, 41.3688054321],
  [2.1649876543, 41.3632512345],
];

describe('share link vs stored route', () => {
  const stored = { v: 1, waypoints: precise };
  const base = buildInitialState({ stored, hash: '', now: NOW });
  const hash = `#${encodeShare(base)}`;

  it('keeps the stored full-precision waypoints when the link names the same route', () => {
    const state = buildInitialState({ stored, hash, now: NOW });
    expect(state.waypoints.map((w) => [w.lon, w.lat])).toEqual(precise);
  });

  it('takes the link route when it differs', () => {
    const other = buildInitialState({ stored: { v: 1, waypoints: [[10, 50], [10.01, 50.01]] }, hash: '', now: NOW });
    const state = buildInitialState({ stored, hash: `#${encodeShare(other)}`, now: NOW });
    expect(state.waypoints.map((w) => [w.lon, w.lat])).toEqual([
      [10, 50],
      [10.01, 50.01],
    ]);
  });

  it('compares within the polyline rounding only', () => {
    expect(sameRoute([[1.00001, 2]], [[1.000014, 2]])).toBe(true);
    expect(sameRoute([[1.00001, 2]], [[1.00003, 2]])).toBe(false);
    expect(sameRoute([[1, 2]], [])).toBe(false);
  });
});
