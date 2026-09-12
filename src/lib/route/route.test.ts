import { describe, expect, it } from 'vitest';
import type { LngLat, RouteLeg, Waypoint } from '../types';
import { closeLoop, joinLegs, legKey, newWaypointId, outAndBack, reverseWaypoints } from './index';

const wp = (id: string, lon: number, lat: number): Waypoint => ({ id, lon, lat });
const leg = (fromId: string, toId: string, coords: LngLat[]): RouteLeg => ({
  fromId,
  toId,
  coords,
  distance: 0,
  provider: 'straight',
  fallback: false,
});

describe('newWaypointId', () => {
  it('produces unique non-empty ids', () => {
    const ids = new Set(Array.from({ length: 1000 }, () => newWaypointId()));
    expect(ids.size).toBe(1000);
    for (const id of ids) expect(id.length).toBeGreaterThan(0);
  });
});

describe('joinLegs', () => {
  it('drops duplicated joints between legs and consecutive duplicates', () => {
    const coords = joinLegs([
      leg('a', 'b', [
        [0, 0],
        [0, 0],
        [1, 1],
      ]),
      leg('b', 'c', [
        [1, 1],
        [2, 2],
      ]),
      leg('c', 'd', [[2, 2]]),
      leg('d', 'e', [
        [2.5, 2.5],
        [3, 3],
      ]),
    ]);
    expect(coords).toEqual([
      [0, 0],
      [1, 1],
      [2, 2],
      [2.5, 2.5],
      [3, 3],
    ]);
  });

  it('returns an empty line for no legs', () => {
    expect(joinLegs([])).toEqual([]);
  });
});

describe('closeLoop', () => {
  const a = wp('a', 13.4, 52.5);
  const b = wp('b', 13.41, 52.51);

  it('appends a copy of the start with a new id', () => {
    const out = closeLoop([a, b]);
    expect(out).toHaveLength(3);
    expect(out[2]).toMatchObject({ lon: a.lon, lat: a.lat });
    expect(out[2].id).not.toBe(a.id);
  });

  it('is a no-op when already closed or too short', () => {
    expect(closeLoop([a])).toEqual([a]);
    expect(closeLoop([])).toEqual([]);
    const closed = [a, b, wp('c', a.lon, a.lat)];
    expect(closeLoop(closed)).toEqual(closed);
  });

  it('does not mutate the input', () => {
    const input = [a, b];
    closeLoop(input);
    expect(input).toHaveLength(2);
  });
});

describe('outAndBack', () => {
  it('mirrors [a,b,c] to [a,b,c,b′,a′] with fresh ids', () => {
    const a = wp('a', 0, 0);
    const b = wp('b', 1, 0);
    const c = wp('c', 2, 0);
    const out = outAndBack([a, b, c]);
    expect(out.map((w) => [w.lon, w.lat])).toEqual([
      [0, 0],
      [1, 0],
      [2, 0],
      [1, 0],
      [0, 0],
    ]);
    expect(out.slice(0, 3)).toEqual([a, b, c]);
    const ids = out.map((w) => w.id);
    expect(new Set(ids).size).toBe(5);
  });

  it('leaves fewer than two points untouched', () => {
    expect(outAndBack([wp('a', 0, 0)])).toEqual([wp('a', 0, 0)]);
  });
});

describe('reverseWaypoints', () => {
  it('reverses without mutating and keeps ids', () => {
    const input = [wp('a', 0, 0), wp('b', 1, 1)];
    expect(reverseWaypoints(input)).toEqual([wp('b', 1, 1), wp('a', 0, 0)]);
    expect(input[0].id).toBe('a');
  });
});

describe('legKey', () => {
  it('rounds to 6 decimals and includes the profile', () => {
    const k1 = legKey([6.63230004, 46.5190001], [6.636, 46.5215], 'foot');
    const k2 = legKey([6.6323, 46.519], [6.636, 46.5215], 'foot');
    expect(k1).toBe(k2);
    expect(k1).toBe('foot|6.632300,46.519000|6.636000,46.521500');
    expect(legKey([6.6323, 46.519], [6.636, 46.5215], 'bike')).not.toBe(k1);
    expect(legKey([6.636, 46.5215], [6.6323, 46.519], 'foot')).not.toBe(k1);
  });

  it('treats -0 and tiny negatives as 0', () => {
    expect(legKey([-0.0000001, 0], [1, 1], 'foot')).toBe(legKey([0, 0], [1, 1], 'foot'));
  });
});
