import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { LngLat } from '../types';
import { haversine, offsetMeters } from '../geo';
import {
  AWS_TERRARIUM_Z13,
  MAPTERHORN_Z13,
  OPEN_METEO_MAX_POINTS,
  bilinearTaps,
  createElevationSampler,
  decodeTerrarium,
  fillFromPoints,
  lonLatToTile,
  openMeteoUrl,
  parseOpenMeteoElevation,
  pixelToLonLat,
  terrariumFromRgba,
  worldPixel,
} from './elevation';
import type { DemSource, DemTile, PointElevationFetcher, TileLoader } from './elevation';

describe('decodeTerrarium', () => {
  it('matches the verified AWS pixel at Lausanne and the format bounds', () => {
    // AWS z12/2123/1448 RGB (129,240,121) → 496.47 m
    expect(decodeTerrarium(129, 240, 121)).toBeCloseTo(496.47, 2);
    expect(decodeTerrarium(128, 0, 0)).toBe(0);
    expect(decodeTerrarium(0, 0, 0)).toBe(-32768);
    expect(decodeTerrarium(127, 255, 128)).toBe(-0.5);
  });

  it('terrariumFromRgba decodes a grid row-major', () => {
    const rgba = [128, 0, 0, 255, 128, 1, 0, 255, 128, 2, 128, 255, 129, 0, 0, 255];
    const tile = terrariumFromRgba(rgba, 2, 2);
    expect(tile.size).toBe(2);
    expect(Array.from(tile.ele)).toEqual([0, 1, 2.5, 256]);
    expect(Array.from(terrariumFromRgba([128, 0, 0, 128, 0, 64, 127, 255, 0, 129, 0, 0], 2, 2, 3).ele)).toEqual([0, 0.25, -1, 256]);
    expect(() => terrariumFromRgba(rgba, 4, 1)).toThrow();
  });
});

describe('tile math', () => {
  it('maps Lausanne to the tile verified with curl', () => {
    const t12 = lonLatToTile(6.6323, 46.519, 12, 256);
    expect([t12.x, t12.y]).toEqual([2123, 1448]);
    const t13 = lonLatToTile(6.6323, 46.519, 13, 512);
    expect([t13.x, t13.y]).toEqual([4246, 2897]);
    expect(t13.px).toBeGreaterThanOrEqual(-0.5);
    expect(t13.px).toBeLessThan(511.5);
  });

  it('round-trips pixels and places the origin at the top-left', () => {
    expect(worldPixel(-180, 85.0511287798066, 0, 256)).toEqual({ x: 0, y: expect.closeTo(0, 6) });
    expect(worldPixel(0, 0, 0, 256)).toEqual({ x: 128, y: expect.closeTo(128, 9) });
    const [lon, lat] = pixelToLonLat(1234.5, 987.25, 13, 512);
    const back = worldPixel(lon, lat, 13, 512);
    expect(back.x).toBeCloseTo(1234.5, 6);
    expect(back.y).toBeCloseTo(987.25, 6);
  });

  it('uses the pixel-centre convention', () => {
    const src = { zoom: 13, tileSize: 256 };
    const [lon, lat] = pixelToLonLat(4246 * 256 + 10.5, 2897 * 256 + 20.5, 13, 256);
    const taps = bilinearTaps(lon, lat, src);
    const main = taps.reduce((a, b) => (b.w > a.w ? b : a));
    expect(main).toMatchObject({ tileX: 4246, tileY: 2897, px: 10, py: 20 });
    expect(main.w).toBeCloseTo(1, 6);
  });
});

// Synthetic 4 px tiles: a plane defined over global pixel indices, continuous across tile borders.
const TS = 4;
const X0 = 4246;
const Y0 = 2897;
const plane = (gi: number, gj: number) => 200 + 0.5 * (gi - X0 * TS) + 0.25 * (gj - Y0 * TS);

const synthetic = (id: DemSource['id']): DemSource => ({ id, zoom: 13, tileSize: TS, url: () => 'unused' });

function planeTile(x: number, y: number): DemTile {
  const ele = new Float32Array(TS * TS);
  for (let py = 0; py < TS; py++) for (let px = 0; px < TS; px++) ele[py * TS + px] = plane(x * TS + px, y * TS + py);
  return { size: TS, ele };
}

function recordingLoader(behaviour: (source: DemSource, x: number, y: number) => 'ok' | 'missing' | 'error' = () => 'ok') {
  const calls: string[] = [];
  const loader: TileLoader = async (source, z, x, y) => {
    calls.push(`${source.id}/${z}/${x}/${y}`);
    const b = behaviour(source, x, y);
    if (b === 'error') throw new Error('network');
    if (b === 'missing') return null;
    return planeTile(x, y);
  };
  return { loader, calls };
}

/** Coordinate of global pixel position (x, y) where pixel centres sit at +0.5. */
const at = (gx: number, gy: number): LngLat => pixelToLonLat(gx, gy, 13, TS);

describe('createElevationSampler (synthetic tiles)', () => {
  it('returns the exact pixel value at a pixel centre and bilinear values between centres', async () => {
    const { loader, calls } = recordingLoader();
    const sample = createElevationSampler({ loadTile: loader, sources: [synthetic('mapterhorn')], pointElevations: null });
    const centre = at(X0 * TS + 1.5, Y0 * TS + 2.5);
    const between = at(X0 * TS + 2.0, Y0 * TS + 3.0); // midway between pixel centres (1,2),(2,2),(1,3),(2,3)
    const res = await sample([centre, between]);
    expect(res.source).toBe('mapterhorn');
    expect(res.ele[0]).toBeCloseTo(plane(X0 * TS + 1, Y0 * TS + 2), 4);
    expect(res.ele[1]).toBeCloseTo(plane(X0 * TS + 1.5, Y0 * TS + 2.5), 4);
    expect(calls).toEqual([`mapterhorn/13/${X0}/${Y0}`]);
  });

  it('reads neighbour tiles at tile edges instead of clamping', async () => {
    const { loader, calls } = recordingLoader();
    const sample = createElevationSampler({ loadTile: loader, sources: [synthetic('mapterhorn')], pointElevations: null });
    // x exactly on the border between tile X0 and X0+1, y on the border between Y0 and Y0+1
    const res = await sample([at((X0 + 1) * TS, (Y0 + 1) * TS)]);
    expect(res.ele[0]).toBeCloseTo(plane((X0 + 1) * TS - 0.5, (Y0 + 1) * TS - 0.5), 4);
    expect(new Set(calls)).toEqual(
      new Set([`mapterhorn/13/${X0}/${Y0}`, `mapterhorn/13/${X0 + 1}/${Y0}`, `mapterhorn/13/${X0}/${Y0 + 1}`, `mapterhorn/13/${X0 + 1}/${Y0 + 1}`]),
    );
  });

  it('falls back to the next source only for points the first could not answer', async () => {
    const { loader, calls } = recordingLoader((source, x) => (source.id === 'mapterhorn' && x === X0 + 5 ? 'missing' : 'ok'));
    const sample = createElevationSampler({
      loadTile: loader,
      sources: [synthetic('mapterhorn'), synthetic('aws-terrarium')],
      pointElevations: null,
    });
    const pts = [at(X0 * TS + 2, Y0 * TS + 2), at((X0 + 1) * TS + 2, Y0 * TS + 2), at((X0 + 5) * TS + 2, Y0 * TS + 2)];
    const res = await sample(pts);
    expect(res.source).toBe('mapterhorn'); // 2 of 3 points
    expect(Array.from(res.ele).every(Number.isFinite)).toBe(true);
    expect(res.ele[2]).toBeCloseTo(plane((X0 + 5) * TS + 1.5, Y0 * TS + 1.5), 4);
    expect(calls.filter((c) => c.startsWith('aws-terrarium'))).toEqual([`aws-terrarium/13/${X0 + 5}/${Y0}`]);
  });

  it('retries failed tiles, then trips the breaker and moves on', async () => {
    const { loader, calls } = recordingLoader((source) => (source.id === 'mapterhorn' ? 'error' : 'ok'));
    const sample = createElevationSampler({
      loadTile: loader,
      sources: [synthetic('mapterhorn'), synthetic('aws-terrarium')],
      pointElevations: null,
      retryDelayMs: 0,
      concurrency: 1,
    });
    const pts = Array.from({ length: 10 }, (_, k) => at((X0 + k) * TS + 2, Y0 * TS + 2));
    const res = await sample(pts);
    expect(res.source).toBe('aws-terrarium');
    expect(Array.from(res.ele).every(Number.isFinite)).toBe(true);
    expect(calls.filter((c) => c.startsWith('mapterhorn')).length).toBe(3);
  });

  it('caches tiles (LRU) and reports NaN / none when nothing answers', async () => {
    const { loader, calls } = recordingLoader();
    const sample = createElevationSampler({ loadTile: loader, sources: [synthetic('mapterhorn')], pointElevations: null, cacheSize: 1 });
    const p1 = at(X0 * TS + 2, Y0 * TS + 2);
    const p2 = at((X0 + 3) * TS + 2, Y0 * TS + 2);
    await sample([p1]);
    await sample([p1]);
    expect(calls).toHaveLength(1);
    await sample([p2]);
    await sample([p1]);
    expect(calls).toHaveLength(3);

    const dead = createElevationSampler({ loadTile: async () => null, sources: [synthetic('mapterhorn')], pointElevations: null });
    const res = await dead([p1, p2]);
    expect(res.source).toBe('none');
    expect(Number.isNaN(res.ele[0]) && Number.isNaN(res.ele[1])).toBe(true);
  });

  it('limits concurrent tile fetches to 4', async () => {
    let active = 0;
    let maxActive = 0;
    const loader: TileLoader = async (_s, _z, x, y) => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 2));
      active--;
      return planeTile(x, y);
    };
    const sample = createElevationSampler({ loadTile: loader, sources: [synthetic('mapterhorn')], pointElevations: null });
    const pts = Array.from({ length: 40 }, (_, k) => at((X0 + k) * TS + 2, (Y0 + (k % 3)) * TS + 2));
    const res = await sample(pts);
    expect(Array.from(res.ele).every(Number.isFinite)).toBe(true);
    expect(maxActive).toBe(4);
  });

  it('rejects when the caller aborts', async () => {
    const ac = new AbortController();
    ac.abort();
    const sample = createElevationSampler({ loadTile: recordingLoader().loader, sources: [synthetic('mapterhorn')], pointElevations: null });
    await expect(sample([at(X0 * TS + 2, Y0 * TS + 2)], ac.signal)).rejects.toBeDefined();
  });

  it('uses the default source list ids', () => {
    expect(MAPTERHORN_Z13.url(13, 1, 2)).toBe('https://tiles.mapterhorn.com/13/1/2.webp');
    expect(AWS_TERRARIUM_Z13.url(13, 1, 2)).toBe('https://s3.amazonaws.com/elevation-tiles-prod/terrarium/13/1/2.png');
  });
});

describe('Open-Meteo point fallback', () => {
  it('parses the captured response and errors', () => {
    const json = JSON.parse(readFileSync(new URL('./__fixtures__/open-meteo-elevation.json', import.meta.url), 'utf8'));
    expect(parseOpenMeteoElevation(json, 3)).toEqual([496, 594, 37]);
    expect(() => parseOpenMeteoElevation(json, 2)).toThrow();
    expect(() => parseOpenMeteoElevation({ error: true, reason: 'must not exceed 100 coordinates' }, 1)).toThrow(/100/);
    expect(openMeteoUrl([[6.6323, 46.519], [13.405, 52.52]])).toBe(
      'https://api.open-meteo.com/v1/elevation?latitude=46.51900,52.52000&longitude=6.63230,13.40500',
    );
  });

  const start: LngLat = [6.6, 46.5];
  const line = Array.from({ length: 2000 }, (_, i) => offsetMeters(start, 0, i * 5));
  const truth = (c: LngLat) => 400 + 0.05 * haversine(start, c);

  it('samples a thinned subset in ≤100-point calls and interpolates the rest', async () => {
    const chunks: number[] = [];
    const fetcher: PointElevationFetcher = async (coords) => {
      chunks.push(coords.length);
      return coords.map(truth);
    };
    const tiles = createElevationSampler({ loadTile: async () => null, sources: [synthetic('mapterhorn')], pointElevations: fetcher });
    const res = await tiles(line);
    expect(res.source).toBe('open-meteo');
    expect(Math.max(...chunks)).toBeLessThanOrEqual(OPEN_METEO_MAX_POINTS);
    const queried = chunks.reduce((a, b) => a + b, 0);
    expect(queried).toBeGreaterThan(300);
    expect(queried).toBeLessThan(400); // ~10 km at 30 m
    line.forEach((c, i) => expect(res.ele[i]).toBeCloseTo(truth(c), 6));
  });

  it('coarsens the stride to respect maxPoints and leaves failed stretches NaN', async () => {
    const out = new Float64Array(line.length).fill(NaN);
    let calls = 0;
    const fetcher: PointElevationFetcher = async (coords) => {
      calls++;
      if (calls === 2) throw new Error('rate limited');
      return coords.map(truth);
    };
    const missing = line.map((_, i) => i);
    // 10 km: 334 picks at 30 m exceed 250, so the stride doubles to 60 m → ~167 picks in two calls.
    const filled = await fillFromPoints(line, out, missing, fetcher, undefined, { maxPoints: 250 });
    expect(calls).toBe(2);
    expect(filled).toBeGreaterThan(1100);
    expect(filled).toBeLessThan(line.length);
    expect(out[0]).toBeCloseTo(truth(line[0]), 6);
    expect(Number.isNaN(out[line.length - 1])).toBe(true);
  });
});
