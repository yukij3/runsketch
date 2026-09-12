import type { LngLat, TerrainProfile } from '../types';
import { cumulativeDistances } from '../geo';
import { HostQueue, HttpError, Semaphore, TimeoutError, abortError, fetchBlob, fetchJson, sleep, throwIfAborted } from './http';
import { LruCache } from './lru';

export interface ElevationSamples {
  /** Metres; NaN where no source answered. */
  ele: Float64Array;
  source: TerrainProfile['elevationSource'];
}

export type ElevationSampler = (coords: LngLat[], signal?: AbortSignal) => Promise<ElevationSamples>;

/** Terrarium formula: (R*256 + G + B/256) - 32768. https://github.com/tilezen/joerd/blob/master/docs/formats.md */
export function decodeTerrarium(r: number, g: number, b: number): number {
  return r * 256 + g + b / 256 - 32768;
}

export type DemSourceId = 'mapterhorn' | 'aws-terrarium';

export interface DemSource {
  id: DemSourceId;
  zoom: number;
  tileSize: number;
  url: (z: number, x: number, y: number) => string;
}

export const MAPTERHORN_Z13: DemSource = {
  id: 'mapterhorn',
  zoom: 13,
  tileSize: 512,
  url: (z, x, y) => `https://tiles.mapterhorn.com/${z}/${x}/${y}.webp`,
};

/** Mapterhorn z13+ exists only where high-resolution DEMs do (404 in Kenya/Sahara/Mongolia, checked 2026-09-12); z12 is global 30 m. */
export const MAPTERHORN_Z12: DemSource = { ...MAPTERHORN_Z13, zoom: 12 };

export const AWS_TERRARIUM_Z13: DemSource = {
  id: 'aws-terrarium',
  zoom: 13,
  tileSize: 256,
  url: (z, x, y) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`,
};

export const DEFAULT_DEM_SOURCES: readonly DemSource[] = [MAPTERHORN_Z13, MAPTERHORN_Z12, AWS_TERRARIUM_Z13];

/** Decoded DEM tile, row-major, `size × size` metres. */
export interface DemTile {
  size: number;
  ele: Float32Array;
}

/** Resolves null when the tile does not exist (4xx); rejects on network/decode errors. */
export type TileLoader = (source: DemSource, z: number, x: number, y: number, signal?: AbortSignal) => Promise<DemTile | null>;

/** Elevation for at most OPEN_METEO_MAX_POINTS coordinates, same order; NaN for unknown. */
export type PointElevationFetcher = (coords: LngLat[], signal?: AbortSignal) => Promise<number[]>;

// ---------------------------------------------------------------------------------------------
// Tile math (Web Mercator, XYZ scheme)

const RAD = Math.PI / 180;
export const MAX_MERCATOR_LAT = 85.0511287798066;

/** Continuous global pixel coordinates at zoom z: pixel (i, j) covers [i, i+1) × [j, j+1), centre at (i+.5, j+.5). */
export function worldPixel(lon: number, lat: number, z: number, tileSize: number): { x: number; y: number } {
  const n = 2 ** z * tileSize;
  const φ = Math.max(-MAX_MERCATOR_LAT, Math.min(MAX_MERCATOR_LAT, lat)) * RAD;
  return {
    x: ((lon + 180) / 360) * n,
    y: ((1 - Math.asinh(Math.tan(φ)) / Math.PI) / 2) * n,
  };
}

export function pixelToLonLat(x: number, y: number, z: number, tileSize: number): LngLat {
  const n = 2 ** z * tileSize;
  return [(x / n) * 360 - 180, Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) / RAD];
}

/** Tile containing the point, plus the fractional pixel inside it where integer values are pixel centres. */
export function lonLatToTile(lon: number, lat: number, z: number, tileSize: number): { x: number; y: number; px: number; py: number } {
  const w = worldPixel(lon, lat, z, tileSize);
  const tiles = 2 ** z;
  const x = Math.min(tiles - 1, Math.max(0, Math.floor(w.x / tileSize)));
  const y = Math.min(tiles - 1, Math.max(0, Math.floor(w.y / tileSize)));
  return { x, y, px: w.x - x * tileSize - 0.5, py: w.y - y * tileSize - 0.5 };
}

/** One of the four pixels a bilinear sample reads. */
export interface Tap {
  tileX: number;
  tileY: number;
  px: number;
  py: number;
  w: number;
}

/**
 * Bilinear taps with the pixel-centre convention. Taps are addressed in global pixel space, so a point
 * near a tile edge reads the neighbour tile instead of clamping. x wraps at the antimeridian, y clamps.
 */
export function bilinearTaps(lon: number, lat: number, source: Pick<DemSource, 'zoom' | 'tileSize'>): Tap[] {
  const { zoom, tileSize } = source;
  const n = 2 ** zoom * tileSize;
  const w = worldPixel(lon, lat, zoom, tileSize);
  const fx = w.x - 0.5;
  const fy = w.y - 0.5;
  const i0 = Math.floor(fx);
  const j0 = Math.floor(fy);
  const tx = fx - i0;
  const ty = fy - j0;
  const corners: Array<[number, number, number]> = [
    [0, 0, (1 - tx) * (1 - ty)],
    [1, 0, tx * (1 - ty)],
    [0, 1, (1 - tx) * ty],
    [1, 1, tx * ty],
  ];
  const taps: Tap[] = [];
  for (const [di, dj, weight] of corners) {
    if (weight === 0) continue;
    const i = (((i0 + di) % n) + n) % n;
    const j = Math.min(n - 1, Math.max(0, j0 + dj));
    const tileX = Math.floor(i / tileSize);
    const tileY = Math.floor(j / tileSize);
    taps.push({ tileX, tileY, px: i - tileX * tileSize, py: j - tileY * tileSize, w: weight });
  }
  return taps;
}

/** Weighted sum of taps; NaN if any needed tile is missing or has an unexpected size. */
export function evalTaps(taps: Tap[], lookup: (tileX: number, tileY: number) => DemTile | null | undefined, tileSize: number): number {
  let v = 0;
  for (const t of taps) {
    const tile = lookup(t.tileX, t.tileY);
    if (!tile || tile.size !== tileSize) return NaN;
    v += t.w * tile.ele[t.py * tile.size + t.px];
  }
  return v;
}

/** RGBA (or RGB with channels=3) bytes → elevation grid. */
export function terrariumFromRgba(data: ArrayLike<number>, width: number, height: number, channels = 4): DemTile {
  if (width !== height) throw new Error(`DEM tile must be square, got ${width}×${height}`);
  const ele = new Float32Array(width * height);
  for (let i = 0, o = 0; i < ele.length; i++, o += channels) ele[i] = decodeTerrarium(data[o], data[o + 1], data[o + 2]);
  return { size: width, ele };
}

// ---------------------------------------------------------------------------------------------
// Browser tile loading

interface Pixels2D {
  drawImage(image: ImageBitmap, dx: number, dy: number): void;
  getImageData(sx: number, sy: number, sw: number, sh: number): ImageData;
}

/** Decode without colour management or premultiplication; either would corrupt the encoded heights. */
async function decodeImage(blob: Blob): Promise<{ data: Uint8ClampedArray; width: number; height: number }> {
  const bmp = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  try {
    const { width, height } = bmp;
    let ctx: Pixels2D | null;
    if (typeof OffscreenCanvas !== 'undefined') {
      ctx = new OffscreenCanvas(width, height).getContext('2d', { willReadFrequently: true });
    } else {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      ctx = canvas.getContext('2d', { willReadFrequently: true });
    }
    if (!ctx) throw new Error('2D canvas is unavailable');
    ctx.drawImage(bmp, 0, 0);
    return { data: ctx.getImageData(0, 0, width, height).data, width, height };
  } finally {
    bmp.close();
  }
}

export const loadTerrariumTile: TileLoader = async (source, z, x, y, signal) => {
  let blob: Blob;
  try {
    blob = await fetchBlob(source.url(z, x, y), { signal, timeoutMs: 10_000 });
  } catch (err) {
    // Mapterhorn answers 404 outside coverage; S3 may answer 403 for absent keys.
    if (err instanceof HttpError && err.status >= 400 && err.status < 500) return null;
    throw err;
  }
  const img = await decodeImage(blob);
  return terrariumFromRgba(img.data, img.width, img.height);
};

// ---------------------------------------------------------------------------------------------
// Open-Meteo point fallback

export const OPEN_METEO_URL = 'https://api.open-meteo.com/v1/elevation';
/** Hard limit: 101 coordinates → HTTP 400. */
export const OPEN_METEO_MAX_POINTS = 100;
const openMeteoQueue = new HostQueue(150);

export function openMeteoUrl(coords: LngLat[]): string {
  const lat = coords.map((c) => c[1].toFixed(5)).join(',');
  const lon = coords.map((c) => c[0].toFixed(5)).join(',');
  return `${OPEN_METEO_URL}?latitude=${lat}&longitude=${lon}`;
}

export function parseOpenMeteoElevation(json: unknown, expected: number): number[] {
  if (!json || typeof json !== 'object') throw new Error('Open-Meteo: response is not an object');
  const j = json as { error?: unknown; reason?: unknown; elevation?: unknown };
  if (j.error) throw new Error(`Open-Meteo: ${String(j.reason ?? 'error')}`);
  if (!Array.isArray(j.elevation) || j.elevation.length !== expected) {
    throw new Error(`Open-Meteo: expected ${expected} elevations`);
  }
  return j.elevation.map((v) => (typeof v === 'number' && Number.isFinite(v) ? v : NaN));
}

export const fetchOpenMeteoElevations: PointElevationFetcher = async (coords, signal) => {
  if (coords.length === 0) return [];
  if (coords.length > OPEN_METEO_MAX_POINTS) throw new Error(`Open-Meteo accepts at most ${OPEN_METEO_MAX_POINTS} points`);
  const url = openMeteoUrl(coords);
  const json = await openMeteoQueue.run(() => fetchJson(url, { signal }), signal);
  return parseOpenMeteoElevation(json, coords.length);
};

function contiguousRuns(indices: number[]): number[][] {
  const runs: number[][] = [];
  for (const i of indices) {
    const run = runs[runs.length - 1];
    if (run && run[run.length - 1] === i - 1) run.push(i);
    else runs.push([i]);
  }
  return runs;
}

/** First, last, and every position at least `stride` metres after the previous pick. */
function pickPositions(cum: number[], stride: number): number[] {
  const n = cum.length;
  if (n === 0) return [];
  const picks = [0];
  const reach = stride * (1 - 1e-9); // 6 × 5 m steps may sum to 29.999999 m
  for (let p = 1; p < n - 1; p++) if (cum[p] - cum[picks[picks.length - 1]] >= reach) picks.push(p);
  if (n > 1) picks.push(n - 1);
  return picks;
}

export interface PointFillOptions {
  /** Target distance between queried points; the 90 m DEM behind Open-Meteo gains nothing from denser sampling. */
  spacingM?: number;
  /** Upper bound on queried points (default 20 calls × 100). The stride doubles until it fits. */
  maxPoints?: number;
}

/**
 * Fills `out[missing]` from a point service: queries a thinned subset of each contiguous run, then
 * interpolates linearly by distance. Returns how many entries received a finite value. Failed chunks
 * leave their stretch NaN rather than extrapolating across it.
 */
export async function fillFromPoints(
  coords: LngLat[],
  out: Float64Array,
  missing: number[],
  fetchPoints: PointElevationFetcher,
  signal?: AbortSignal,
  options: PointFillOptions = {},
): Promise<number> {
  const maxPoints = options.maxPoints ?? 20 * OPEN_METEO_MAX_POINTS;
  const runs = contiguousRuns(missing);
  const cums = runs.map((run) => cumulativeDistances(run.map((i) => coords[i])));

  let stride = options.spacingM ?? 30;
  let picks = runs.map((_, r) => pickPositions(cums[r], stride));
  while (picks.reduce((s, p) => s + p.length, 0) > maxPoints && stride < 1e8) {
    stride *= 2;
    picks = runs.map((_, r) => pickPositions(cums[r], stride));
  }
  const queryIdx = picks.flatMap((p, r) => p.map((pos) => runs[r][pos])).slice(0, maxPoints);

  const known = new Map<number, number>();
  for (let k = 0; k < queryIdx.length; k += OPEN_METEO_MAX_POINTS) {
    throwIfAborted(signal);
    const chunk = queryIdx.slice(k, k + OPEN_METEO_MAX_POINTS);
    try {
      const values = await fetchPoints(chunk.map((i) => coords[i]), signal);
      chunk.forEach((i, m) => {
        if (Number.isFinite(values[m])) known.set(i, values[m]);
      });
    } catch (err) {
      if (signal?.aborted) throw abortError(signal);
      break;
    }
  }

  let filled = 0;
  runs.forEach((run, r) => {
    const cum = cums[r];
    const P = picks[r];
    const V = P.map((pos) => known.get(run[pos]) ?? NaN);
    let k = 0;
    for (let p = 0; p < run.length; p++) {
      while (k < P.length - 1 && P[k + 1] <= p) k++;
      let v = NaN;
      if (P[k] === p) v = V[k];
      else if (k + 1 < P.length) {
        const dA = cum[P[k]];
        const dB = cum[P[k + 1]];
        const vA = V[k];
        const vB = V[k + 1];
        if (Number.isFinite(vA) && Number.isFinite(vB)) v = dB > dA ? vA + ((vB - vA) * (cum[p] - dA)) / (dB - dA) : vA;
        else if (Number.isFinite(vA) && cum[p] - dA <= stride) v = vA;
        else if (Number.isFinite(vB) && dB - cum[p] <= stride) v = vB;
      }
      if (Number.isFinite(v)) {
        out[run[p]] = v;
        filled++;
      }
    }
  });
  return filled;
}

// ---------------------------------------------------------------------------------------------
// Sampler

export interface ElevationSamplerOptions {
  loadTile?: TileLoader;
  /** Tried in order; each only for points the previous ones could not answer. */
  sources?: readonly DemSource[];
  /** Point service for whatever tiles could not answer; null disables. Default Open-Meteo. */
  pointElevations?: PointElevationFetcher | null;
  /** Decoded tiles kept in memory (a 512 px tile is ~1 MB as Float32). */
  cacheSize?: number;
  /** Concurrent tile fetches. */
  concurrency?: number;
  /** Extra attempts per tile after a network/decode error. */
  retries?: number;
  retryDelayMs?: number;
}

/** Tiles resolved per batch; bounds memory for long routes while keeping route-order locality. */
const MAX_TILES_PER_BATCH = 16;
/** A source that fails this many tile loads without a single success is skipped for the rest of the call. */
const BREAKER_FAILURES = 3;
const SKIPPED = Symbol('skipped');

interface SourceHealth {
  failures: number;
  successes: number;
}

function dominantSource(counts: Map<TerrainProfile['elevationSource'], number>): TerrainProfile['elevationSource'] {
  let best: TerrainProfile['elevationSource'] = 'none';
  let bestCount = 0;
  for (const [id, count] of counts) {
    if (count > bestCount) {
      best = id;
      bestCount = count;
    }
  }
  return best;
}

export function createElevationSampler(options: ElevationSamplerOptions = {}): ElevationSampler {
  const loadTile = options.loadTile ?? loadTerrariumTile;
  const sources = options.sources ?? DEFAULT_DEM_SOURCES;
  const pointElevations = options.pointElevations === undefined ? fetchOpenMeteoElevations : options.pointElevations;
  const retries = options.retries ?? 1;
  const retryDelayMs = options.retryDelayMs ?? 300;
  const cache = new LruCache<string, DemTile | null>(options.cacheSize ?? 64);
  const limiter = new Semaphore(options.concurrency ?? 4);

  /** Tile, null when it does not exist, undefined when loading failed. */
  async function getTile(source: DemSource, x: number, y: number, health: SourceHealth, signal?: AbortSignal): Promise<DemTile | null | undefined> {
    const key = `${source.id}/${source.zoom}/${x}/${y}`;
    const cached = cache.get(key);
    if (cached !== undefined) return cached;
    const tripped = () => health.successes === 0 && health.failures >= BREAKER_FAILURES;
    for (let attempt = 0; attempt <= retries; attempt++) {
      if (tripped()) return undefined;
      throwIfAborted(signal);
      try {
        // Health is updated and the breaker re-checked inside the slot, so tiles queued behind the
        // limiter see every earlier outcome and stop fetching once the breaker trips.
        const tile = await limiter.use(async () => {
          throwIfAborted(signal);
          if (tripped()) return SKIPPED;
          try {
            const loaded = await loadTile(source, source.zoom, x, y, signal);
            health.successes++;
            return loaded;
          } catch (err) {
            if (!signal?.aborted) health.failures++;
            throw err;
          }
        });
        if (tile === SKIPPED) return undefined;
        cache.set(key, tile);
        return tile;
      } catch (err) {
        if (signal?.aborted) throw abortError(signal);
        // A stalled tile rarely answers a second time (a cold Mapterhorn z13 tile hung twice for the full
        // 10 s on 2026-09-12, then loaded in 1 s); the next source recovers faster than a retry.
        if (err instanceof TimeoutError) return undefined;
        if (attempt < retries && retryDelayMs > 0) await sleep(retryDelayMs, signal);
      }
    }
    return undefined;
  }

  /** Samples `idx` from one source into `out`; returns the indices still unanswered. */
  async function sampleSource(coords: LngLat[], idx: number[], source: DemSource, out: Float64Array, signal?: AbortSignal): Promise<number[]> {
    const health: SourceHealth = { failures: 0, successes: 0 };
    const missing: number[] = [];
    let batch: Array<{ i: number; taps: Tap[] }> = [];
    let keys = new Set<string>();

    const flush = async () => {
      const tiles = new Map<string, DemTile | null | undefined>();
      await Promise.all(
        [...keys].map(async (key) => {
          const [x, y] = key.split('/').map(Number);
          tiles.set(key, await getTile(source, x, y, health, signal));
        }),
      );
      for (const { i, taps } of batch) {
        const v = evalTaps(taps, (tx, ty) => tiles.get(`${tx}/${ty}`), source.tileSize);
        if (Number.isFinite(v)) out[i] = v;
        else missing.push(i);
      }
      batch = [];
      keys = new Set();
    };

    for (const i of idx) {
      const [lon, lat] = coords[i];
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
      const taps = bilinearTaps(lon, lat, source);
      const tapKeys = taps.map((t) => `${t.tileX}/${t.tileY}`);
      const added = new Set(tapKeys.filter((k) => !keys.has(k))).size;
      if (batch.length > 0 && keys.size + added > MAX_TILES_PER_BATCH) await flush();
      for (const k of tapKeys) keys.add(k);
      batch.push({ i, taps });
    }
    if (batch.length > 0) await flush();
    return missing.sort((a, b) => a - b);
  }

  return async (coords, signal) => {
    throwIfAborted(signal);
    const out = new Float64Array(coords.length).fill(NaN);
    const counts = new Map<TerrainProfile['elevationSource'], number>();
    let remaining = coords.flatMap((c, i) => (Number.isFinite(c[0]) && Number.isFinite(c[1]) ? [i] : []));

    for (const source of sources) {
      if (remaining.length === 0) break;
      const next = await sampleSource(coords, remaining, source, out, signal);
      counts.set(source.id, (counts.get(source.id) ?? 0) + remaining.length - next.length);
      remaining = next;
    }

    if (remaining.length > 0 && pointElevations) {
      try {
        const filled = await fillFromPoints(coords, out, remaining, pointElevations, signal);
        counts.set('open-meteo', (counts.get('open-meteo') ?? 0) + filled);
      } catch (err) {
        if (signal?.aborted) throw abortError(signal);
      }
    }
    return { ele: out, source: dominantSource(counts) };
  };
}

/** Mapterhorn z13 terrarium webp → Mapterhorn z12 → AWS terrarium png z13 → Open-Meteo. Bilinear interpolation, tile cache. */
export const sampleElevations: ElevationSampler = createElevationSampler();
