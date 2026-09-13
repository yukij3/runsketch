import { describe, expect, it } from 'vitest';
import type { LngLat } from '../types';
import { AWS_TERRARIUM_Z13, MAPTERHORN_Z13, createElevationSampler, type TileLoader } from './elevation';
import { DEFAULT_TIMEOUT_MS, HostQueue, TimeoutError } from './http';
import { PROVIDER_TIMEOUT_MS, createRouter } from './routing';

describe('elevation timeouts', () => {
  it('does not retry a tile that timed out and lets the next source answer', async () => {
    const calls: string[] = [];
    const loader: TileLoader = async (source, z, x, y) => {
      calls.push(`${source.id}/${z}/${x}/${y}`);
      if (source.id === 'mapterhorn') throw new TimeoutError(10_000);
      return { size: source.tileSize, ele: new Float32Array(source.tileSize * source.tileSize).fill(42) };
    };
    const sample = createElevationSampler({
      loadTile: loader,
      sources: [MAPTERHORN_Z13, AWS_TERRARIUM_Z13],
      pointElevations: null,
      retries: 2,
      retryDelayMs: 0,
    });
    const res = await sample([[2.1601, 41.3693]]);
    const mapterhorn = calls.filter((c) => c.startsWith('mapterhorn'));
    expect(new Set(mapterhorn).size).toBe(mapterhorn.length);
    expect(res.source).toBe('aws-terrarium');
    expect(res.ele[0]).toBe(42);
  });
});

describe('routing timeouts', () => {
  it('gives BRouter and Valhalla a longer per-attempt limit than OSRM', async () => {
    const seen: Array<[string, number | undefined]> = [];
    const route = createRouter({
      fetchText: async (url, init) => {
        seen.push([url.includes('brouter') ? 'brouter' : url.includes('valhalla') ? 'valhalla' : 'osrm', init.timeoutMs]);
        throw new Error('offline');
      },
      queues: { osrm: new HostQueue(0), brouter: new HostQueue(0), valhalla: new HostQueue(0) },
    });
    const a: LngLat = [6.63, 46.52];
    const b: LngLat = [6.64, 46.53];
    const leg = await route(a, b, 'hiking');
    expect(leg.fallback).toBe(true);
    expect(seen).toEqual([
      ['brouter', PROVIDER_TIMEOUT_MS.brouter],
      ['valhalla', PROVIDER_TIMEOUT_MS.valhalla],
      ['osrm', DEFAULT_TIMEOUT_MS],
    ]);
    expect(PROVIDER_TIMEOUT_MS.brouter).toBeGreaterThanOrEqual(15_000);
    expect(PROVIDER_TIMEOUT_MS.valhalla).toBeGreaterThan(DEFAULT_TIMEOUT_MS);
  });
});
