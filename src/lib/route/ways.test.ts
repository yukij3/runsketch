import { describe, expect, it } from 'vitest';
import type { LngLat, RouteLeg } from '../types';
import { joinLegs } from './index';
import { WAY_TAG_KEYS, filterWayTags, parseWayTags, pushWaySpan, remapWays, validWays } from './ways';

const leg = (coords: LngLat[], ways?: RouteLeg['ways']): RouteLeg => ({
  fromId: 'a',
  toId: 'b',
  coords,
  distance: 0,
  provider: ways ? 'brouter' : 'osrm',
  fallback: false,
  ...(ways && { ways }),
});

describe('way tags', () => {
  it('keeps only the keys terrain reads, in order', () => {
    expect(filterWayTags('reversedirection=yes highway=path surface=ground foot=yes sac_scale=hiking route_hiking_lwn=yes')).toBe(
      'highway=path surface=ground sac_scale=hiking',
    );
    expect(filterWayTags('')).toBe('');
    expect(WAY_TAG_KEYS.has('bridge')).toBe(true);
    expect([...parseWayTags('highway=track tracktype=grade2 mtb:scale=2+')]).toEqual([
      ['highway', 'track'],
      ['tracktype', 'grade2'],
      ['mtb:scale', '2+'],
    ]);
  });

  it('merges equal neighbours, skips empty spans, and renumbers after dropped vertices', () => {
    const spans: RouteLeg['ways'] = [];
    pushWaySpan(spans, 0, 'a');
    pushWaySpan(spans, 2, 'a');
    pushWaySpan(spans, 3, 'a');
    pushWaySpan(spans, 3, 'b');
    pushWaySpan(spans, 5, 'b');
    expect(spans).toEqual([
      { end: 3, tags: 'a' },
      { end: 5, tags: 'b' },
    ]);
    // Vertices 1 and 2 duplicate vertex 0: the first span vanishes.
    expect(remapWays([{ end: 2, tags: 'steps' }, { end: 4, tags: 'path' }], [0, 0, 0, 1, 2])).toEqual([{ end: 2, tags: 'path' }]);
  });

  it('validates span lists against the vertex count', () => {
    expect(validWays([{ end: 1, tags: '' }, { end: 3, tags: 'x' }], 4)).toBe(true);
    expect(validWays([{ end: 1, tags: '' }, { end: 2, tags: 'x' }], 4)).toBe(false);
    expect(validWays([{ end: 2, tags: '' }, { end: 2, tags: 'x' }], 3)).toBe(false);
    expect(validWays([{ end: 2, tags: 3 }], 3)).toBe(false);
    expect(validWays([], 1)).toBe(false);
    expect(validWays(undefined, 3)).toBe(false);
  });
});

describe('joinLegs with way tags', () => {
  it('carries spans across joints; untagged legs and gaps between legs get empty tags', () => {
    const { coords, ways } = joinLegs([
      leg(
        [
          [0, 0],
          [1, 0],
          [2, 0],
          [3, 0],
        ],
        [
          { end: 2, tags: 'highway=path' },
          { end: 3, tags: 'highway=steps' },
        ],
      ),
      leg([
        [3, 0],
        [4, 0],
      ]),
      leg(
        [
          [4.5, 0],
          [5, 0],
          [5, 0],
          [6, 0],
        ],
        [{ end: 3, tags: 'surface=gravel' }],
      ),
    ]);
    expect(coords).toEqual([
      [0, 0],
      [1, 0],
      [2, 0],
      [3, 0],
      [4, 0],
      [4.5, 0],
      [5, 0],
      [6, 0],
    ]);
    expect(ways).toEqual([
      { end: 2, tags: 'highway=path' },
      { end: 3, tags: 'highway=steps' },
      { end: 5, tags: '' },
      { end: 7, tags: 'surface=gravel' },
    ]);
    expect(validWays(ways, coords.length)).toBe(true);
  });

  it('has no ways when no leg is tagged', () => {
    const line = joinLegs([
      leg([
        [0, 0],
        [1, 1],
      ]),
    ]);
    expect(line).toEqual({
      coords: [
        [0, 0],
        [1, 1],
      ],
    });
  });
});
