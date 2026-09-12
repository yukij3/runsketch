import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { LngLat } from '../types';
import { haversine, polylineLength } from '../geo';
import { HostQueue, HttpError } from './http';
import type { TimedInit } from './http';
import {
  MAX_SNAP_M,
  PROVIDER_CHAINS,
  RouteError,
  brouterRouteUrl,
  createRouter,
  osrmRouteUrl,
  parseBrouterGeojson,
  parseOsrmRoute,
  parseProviderResponse,
  snapDistance,
} from './routing';

const fixture = (name: string) => readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), 'utf8');
const OSRM_FOOT = fixture('osrm-foot-lausanne.json');
const OSRM_FAR = fixture('osrm-foot-far-snap.json');
const BROUTER = fixture('brouter-hiking-mountain-lausanne.json');
const BROUTER_ERROR = fixture('brouter-error.txt');

// Request points used when the fixtures were captured with curl (2026-09-12).
const A: LngLat = [6.6323, 46.519];
const B: LngLat = [6.636, 46.5215];

describe('URL builders', () => {
  it('build the verified OSRM and BRouter URLs', () => {
    expect(osrmRouteUrl({ provider: 'osrm', service: 'routed-foot', profile: 'foot' }, A, B)).toBe(
      'https://routing.openstreetmap.de/routed-foot/route/v1/foot/6.632300,46.519000;6.636000,46.521500?overview=full&geometries=geojson&steps=false',
    );
    expect(brouterRouteUrl({ provider: 'brouter', profile: 'hiking-mountain' }, A, B)).toBe(
      'https://brouter.de/brouter?lonlats=6.632300,46.519000%7C6.636000,46.521500&profile=hiking-mountain&alternativeidx=0&format=geojson',
    );
  });
});

describe('parseOsrmRoute', () => {
  it('parses a real routed-foot response', () => {
    const json = JSON.parse(OSRM_FOOT);
    const coords = parseOsrmRoute(json);
    expect(coords.length).toBeGreaterThan(10);
    // OSRM repeats the first vertex; the parser drops consecutive duplicates.
    expect(coords[0]).toEqual([6.632534, 46.518956]);
    expect(coords[1]).not.toEqual(coords[0]);
    for (const c of coords) expect(c).toHaveLength(2);
    const reported = json.routes[0].distance as number;
    expect(Math.abs(polylineLength(coords) - reported) / reported).toBeLessThan(0.03);
    expect(snapDistance(coords, A, B)).toBeLessThan(MAX_SNAP_M);
  });

  it('parses a far snap that the router must then reject', () => {
    const coords = parseOsrmRoute(JSON.parse(OSRM_FAR));
    expect(coords).toHaveLength(1);
    expect(snapDistance(coords, [-30, 40], [-29.9, 40.1])).toBeGreaterThan(90_000);
  });

  it('throws on error codes and malformed geometry', () => {
    expect(() => parseOsrmRoute({ code: 'NoRoute', message: 'Impossible route' })).toThrow(/NoRoute/);
    expect(() => parseOsrmRoute({ code: 'Ok', routes: [] })).toThrow(RouteError);
    expect(() => parseOsrmRoute({ code: 'Ok', routes: [{ geometry: { coordinates: [[200, 0]] } }] })).toThrow(RouteError);
    expect(() => parseOsrmRoute(null)).toThrow(RouteError);
  });
});

describe('parseBrouterGeojson', () => {
  it('parses a real hiking-mountain response and strips elevation', () => {
    const json = JSON.parse(BROUTER);
    const coords = parseBrouterGeojson(json);
    expect(coords.length).toBe(json.features[0].geometry.coordinates.length);
    for (const c of coords) expect(c).toHaveLength(2);
    expect(coords[0]).toEqual([6.632534, 46.518956]);
    const trackLength = Number(json.features[0].properties['track-length']);
    expect(Math.abs(polylineLength(coords) - trackLength) / trackLength).toBeLessThan(0.03);
  });

  it('rejects BRouter plain-text errors and non-LineString bodies', () => {
    const spec = { provider: 'brouter', profile: 'trekking' } as const;
    expect(() => parseProviderResponse(spec, BROUTER_ERROR)).toThrow(/not mapped/);
    expect(() => parseBrouterGeojson({ type: 'FeatureCollection', features: [] })).toThrow(RouteError);
  });
});

interface FakeResponse {
  match: RegExp;
  body?: string;
  error?: unknown;
}

function setup(responses: FakeResponse[]) {
  const calls: string[] = [];
  const fetchText = async (url: string, init: TimedInit) => {
    calls.push(url);
    const r = responses.find((x) => x.match.test(url));
    if (!r) throw new HttpError(503, url);
    if (r.error === 'hang') {
      return new Promise<string>((_, reject) => {
        init.signal?.addEventListener('abort', () => reject(init.signal?.reason));
      });
    }
    if (r.error) throw r.error;
    return r.body ?? '';
  };
  const router = createRouter({ fetchText, queues: { osrm: new HostQueue(0), brouter: new HostQueue(0) } });
  return { router, calls };
}

describe('createRouter', () => {
  it('foot: OSRM first', async () => {
    const { router, calls } = setup([{ match: /routed-foot/, body: OSRM_FOOT }]);
    const leg = await router(A, B, 'foot');
    expect(leg.provider).toBe('osrm');
    expect(leg.fallback).toBe(false);
    expect(leg.distance).toBeCloseTo(polylineLength(leg.coords), 6);
    expect(calls).toHaveLength(1);
  });

  it('foot: falls back to BRouter hiking-beta when OSRM fails', async () => {
    const { router, calls } = setup([
      { match: /routed-foot/, error: new HttpError(502, 'osrm') },
      { match: /brouter/, body: BROUTER },
    ]);
    const leg = await router(A, B, 'foot');
    expect(leg.provider).toBe('brouter');
    expect(calls[1]).toContain('profile=hiking-beta');
  });

  it.each([
    ['hiking', 'hiking-mountain', 'routed-foot'],
    ['bike', 'trekking', 'routed-bike'],
    ['road-bike', 'fastbike', 'routed-bike'],
    ['mtb', 'mtb', 'routed-bike'],
  ] as const)('%s: BRouter %s, then OSRM %s', async (profile, brouterProfile, osrmService) => {
    const { router, calls } = setup([
      { match: /brouter/, error: new HttpError(500, 'brouter') },
      { match: new RegExp(osrmService), body: OSRM_FOOT },
    ]);
    const leg = await router(A, B, profile);
    expect(calls[0]).toContain(`profile=${brouterProfile}`);
    expect(calls[1]).toContain(`/${osrmService}/`);
    expect(leg.provider).toBe('osrm');
    expect(PROVIDER_CHAINS[profile]).toHaveLength(2);
  });

  it('returns a straight fallback when every provider fails, and does not cache it', async () => {
    const { router, calls } = setup([{ match: /./, error: new TypeError('Failed to fetch') }]);
    const leg = await router(A, B, 'bike');
    expect(leg).toEqual({ coords: [A, B], distance: haversine(A, B), provider: 'straight', fallback: true });
    expect(calls).toHaveLength(2);
    await router(A, B, 'bike');
    expect(calls).toHaveLength(4);
  });

  it('treats a far snap as failure (OSRM Ok 98 km away, BRouter 400 text)', async () => {
    const far: [LngLat, LngLat] = [
      [-30, 40],
      [-29.9, 40.1],
    ];
    const { router } = setup([
      { match: /routed-foot/, body: OSRM_FAR },
      { match: /brouter/, error: new HttpError(400, 'brouter', BROUTER_ERROR) },
    ]);
    const leg = await router(far[0], far[1], 'foot');
    expect(leg.provider).toBe('straight');
    expect(leg.fallback).toBe(true);
  });

  it("profile 'none' draws a straight line without network and without the fallback flag", async () => {
    const { router, calls } = setup([]);
    const leg = await router(A, B, 'none');
    expect(leg.provider).toBe('straight');
    expect(leg.fallback).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it('identical points give a single-point leg', async () => {
    const { router, calls } = setup([]);
    const leg = await router(A, [A[0] + 1e-8, A[1]], 'foot');
    expect(leg).toEqual({ coords: [A], distance: 0, provider: 'straight', fallback: false });
    expect(calls).toHaveLength(0);
  });

  it('caches successful legs by key and returns independent copies', async () => {
    const { router, calls } = setup([{ match: /routed-foot/, body: OSRM_FOOT }]);
    const first = await router(A, B, 'foot');
    first.coords.length = 0;
    const second = await router([A[0] + 1e-8, A[1]], B, 'foot');
    expect(calls).toHaveLength(1);
    expect(second.coords.length).toBeGreaterThan(10);
  });

  it('propagates caller aborts instead of falling back', async () => {
    const { router, calls } = setup([{ match: /./, error: 'hang' }]);
    const ac = new AbortController();
    const p = router(A, B, 'foot', ac.signal);
    await new Promise((r) => setTimeout(r, 5));
    ac.abort();
    const err = await p.catch((e: unknown) => e);
    expect((err as Error).name).toBe('AbortError');
    expect(calls).toHaveLength(1);
  });
});
