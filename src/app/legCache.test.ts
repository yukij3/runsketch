import { describe, expect, it } from 'vitest';
import type { RouteLeg } from '../lib/types';
import { legKey } from '../lib/route';
import { LEG_CACHE_KEY, LegCache, roundCoord, roundLeg } from './legCache';
import { buildInitialState } from './persistence';

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  };
}

const leg = (i: number, extra: Partial<RouteLeg> = {}): RouteLeg => {
  const g = roundLeg({
    coords: [
      [2.1496771234 + i * 1e-3, 41.3751029876],
      [2.15321654321 + i * 1e-3, 41.36880612345],
      [-0.0000015, -33.0000005],
    ],
    distance: 0,
    provider: 'osrm',
    fallback: false,
  });
  return { ...g, fromId: 'a', toId: 'b', ...extra };
};

describe('leg cache', () => {
  it('rounds coordinates to 1e-6 half away from zero and recomputes distance', () => {
    expect(roundCoord(2.1496775)).toBe(2.149678);
    expect(roundCoord(-0.0000015)).toBe(-0.000002);
    const g = leg(0);
    expect(g.coords[0]).toEqual([2.149677, 41.375103]);
    expect(g.distance).toBeGreaterThan(0);
  });

  it('reproduces the exact geometry after a reload', () => {
    const storage = memoryStorage();
    const cache = LegCache.load(storage);
    const legs = new Map([['k0', leg(0)], ['k1', leg(1)]]);
    cache.remember(legs);
    cache.save(storage);
    const reloaded = LegCache.load(storage);
    expect(reloaded.get('k0')).toEqual({ coords: legs.get('k0')!.coords, distance: legs.get('k0')!.distance, provider: 'osrm', fallback: false });
    expect(reloaded.get('k1')!.coords).toEqual(legs.get('k1')!.coords);
    expect(reloaded.get('nope')).toBeUndefined();
  });

  it('skips fallback legs, bounds count and size, and survives corrupt storage', () => {
    const storage = memoryStorage();
    const cache = LegCache.load(storage, 3, 1e9);
    cache.remember(new Map([['f', leg(0, { fallback: true, provider: 'straight' })]]));
    expect(cache.size).toBe(0);
    for (let i = 0; i < 5; i++) cache.remember(new Map([[`k${i}`, leg(i)]]));
    cache.remember(new Map([['k2', leg(2)]]));
    cache.remember(new Map([['k5', leg(5)]]));
    cache.save(storage);
    const reloaded = LegCache.load(storage, 3, 1e9);
    expect(['k2', 'k4', 'k5'].every((k) => reloaded.get(k))).toBe(true);
    expect(reloaded.size).toBe(3);

    const tiny = new LegCache(100, 80);
    tiny.remember(new Map([['a', leg(0)], ['b', leg(1)]]));
    expect(tiny.size).toBe(1);

    storage.data.set(LEG_CACHE_KEY, '{"v":1,"legs":[["x","%%%","osrm"],["y","_p~iF~ps|U","bogus"],3]}');
    expect(LegCache.load(storage).size).toBe(0);
    storage.data.set(LEG_CACHE_KEY, 'not json');
    expect(LegCache.load(storage).size).toBe(0);
  });

  it('drops old entries when storage is full', () => {
    const cache = new LegCache();
    for (let i = 0; i < 8; i++) cache.remember(new Map([[`k${i}`, leg(i)]]));
    let calls = 0;
    const full = {
      setItem: (_k: string, v: string) => {
        calls++;
        if (v.length > 300) throw new Error('QuotaExceededError');
      },
    };
    cache.save(full);
    expect(calls).toBeGreaterThan(1);
    expect(cache.size).toBeLessThan(8);
    expect(cache.get('k7')).toBeDefined();
  });

  it('keeps way tags through rounding, storage and reload; entries without them still load', () => {
    const g = roundLeg({
      coords: [
        [7.1, 46.1],
        [7.1000001, 46.1000001],
        [7.101, 46.1],
        [7.102, 46.1],
      ],
      distance: 0,
      provider: 'brouter',
      fallback: false,
      ways: [
        { end: 1, tags: 'highway=steps' },
        { end: 3, tags: 'highway=path sac_scale=hiking' },
      ],
    });
    // Vertex 1 rounds onto vertex 0, so the steps span has no length left.
    expect(g.coords).toHaveLength(3);
    expect(g.ways).toEqual([{ end: 2, tags: 'highway=path sac_scale=hiking' }]);

    const storage = memoryStorage();
    const cache = LegCache.load(storage);
    cache.remember(
      new Map([
        ['tagged', { ...g, fromId: 'a', toId: 'b' }],
        ['plain', leg(0)],
      ]),
    );
    cache.save(storage);
    const stored = JSON.parse(storage.data.get(LEG_CACHE_KEY)!).legs;
    storage.data.set(LEG_CACHE_KEY, JSON.stringify({ v: 1, legs: [...stored, ['bad', stored[0][1], 'brouter', [[9, 'highway=path']]]] }));
    const reloaded = LegCache.load(storage);
    expect(reloaded.get('tagged')).toEqual({ coords: g.coords, distance: g.distance, provider: 'brouter', fallback: false, ways: g.ways });
    expect(reloaded.get('plain')).not.toHaveProperty('ways');
    expect(reloaded.get('bad')!.coords).toEqual(g.coords);
    expect(reloaded.get('bad')).not.toHaveProperty('ways');
  });

  it('restores tagged legs into the initial state', () => {
    const g = roundLeg({
      coords: [
        [7.1, 46.1],
        [7.102, 46.1],
      ],
      distance: 0,
      provider: 'brouter',
      fallback: false,
      ways: [{ end: 1, tags: 'highway=track' }],
    });
    const state = buildInitialState({
      stored: { v: 1, profile: 'hiking', waypoints: [g.coords[0], g.coords[1]] },
      hash: '',
      now: 0,
      legs: { get: (key) => (key === legKey(g.coords[0], g.coords[1], 'hiking') ? g : undefined) },
    });
    expect([...state.legs.values()][0].ways).toEqual([{ end: 1, tags: 'highway=track' }]);
  });
});
