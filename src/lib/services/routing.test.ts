import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { LngLat } from '../types';
import { WAY_TAG_KEYS, validWays } from '../route';
import { cumulativeDistances, haversine, polylineLength } from '../geo';
import { HostQueue, HttpError } from './http';
import type { TimedInit } from './http';
import {
  MAX_SNAP_M,
  PROVIDER_CHAINS,
  RouteError,
  VALHALLA_TRACE_URL,
  brouterRouteUrl,
  createRouter,
  osrmRouteUrl,
  parseBrouterGeojson,
  parseBrouterWays,
  parseOsrmRoute,
  parseProviderResponse,
  parseValhallaRoute,
  parseValhallaWays,
  snapDistance,
  valhallaEdgeTags,
  valhallaRouteUrl,
  valhallaTraceBody,
  type ValhallaSpec,
} from './routing';

const fixture = (name: string) => readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), 'utf8');
const OSRM_FOOT = fixture('osrm-foot-lausanne.json');
const OSRM_FAR = fixture('osrm-foot-far-snap.json');
const BROUTER = fixture('brouter-hiking-mountain-lausanne.json');
const BROUTER_ERROR = fixture('brouter-error.txt');
// hiking-mountain on the Hörnli trail above Zermatt, captured 2026-09-13 between two of its vertices.
const BROUTER_HORNLI = fixture('brouter-hiking-mountain-hornli.json');
// Captured 2026-09-13. hiking-mountain with SAC_scale_limit=6 and SAC_scale_preferred=4, Cólera camp → Independencia hut
// on Aconcagua (T5); the HTTP 400 body BRouter sent after 24 s for hiking-mountain with default parameters from the Goûter
// hut to the Dôme du Goûter; Valhalla pedestrian with max_hiking_difficulty 6 from the Betlemi hut to the Kazbek summit,
// trace_attributes (edge_walk) along its shape, and Valhalla's HTTP 400 body for two points in the Atlantic.
const BROUTER_ALPINE = fixture('brouter-alpine-aconcagua.json');
const BROUTER_WATCHDOG = fixture('brouter-watchdog.txt');
const VALHALLA_ROUTE = fixture('valhalla-pedestrian-kazbek.json');
const VALHALLA_TRACE = fixture('valhalla-trace-kazbek.json');
const VALHALLA_ERROR = fixture('valhalla-error.json');

// Request points used when the fixtures were captured with curl (2026-09-12).
const A: LngLat = [6.6323, 46.519];
const B: LngLat = [6.636, 46.5215];
const ACONCAGUA: [LngLat, LngLat] = [
  [-70.0183, -32.63736],
  [-70.01557, -32.64619],
];
const KAZBEK: [LngLat, LngLat] = [
  [44.53383, 42.67988],
  [44.51811, 42.69694],
];
const VALHALLA: ValhallaSpec = { provider: 'valhalla', costing: 'pedestrian', maxHikingDifficulty: 6 };

describe('URL builders', () => {
  it('build the verified OSRM and BRouter URLs', () => {
    expect(osrmRouteUrl({ provider: 'osrm', service: 'routed-foot', profile: 'foot' }, A, B)).toBe(
      'https://routing.openstreetmap.de/routed-foot/route/v1/foot/6.632300,46.519000;6.636000,46.521500?overview=full&geometries=geojson&steps=false',
    );
    expect(brouterRouteUrl({ provider: 'brouter', profile: 'hiking-mountain' }, A, B)).toBe(
      'https://brouter.de/brouter?lonlats=6.632300,46.519000%7C6.636000,46.521500&profile=hiking-mountain&alternativeidx=0&format=geojson',
    );
  });

  it('append BRouter profile parameters as profile:name=value', () => {
    expect(brouterRouteUrl({ provider: 'brouter', profile: 'hiking-mountain', params: { SAC_scale_limit: 6, SAC_scale_preferred: 4 } }, ...ACONCAGUA)).toBe(
      'https://brouter.de/brouter?lonlats=-70.018300,-32.637360%7C-70.015570,-32.646190&profile=hiking-mountain&alternativeidx=0&format=geojson&profile:SAC_scale_limit=6&profile:SAC_scale_preferred=4',
    );
  });

  it('put the Valhalla route request in json= and the trace_attributes request in a body', () => {
    const url = valhallaRouteUrl(VALHALLA, ...KAZBEK);
    expect(url.startsWith('https://valhalla1.openstreetmap.de/route?json=')).toBe(true);
    expect(JSON.parse(decodeURIComponent(url.slice(url.indexOf('json=') + 5)))).toEqual({
      locations: [
        { lon: 44.53383, lat: 42.67988 },
        { lon: 44.51811, lat: 42.69694 },
      ],
      costing: 'pedestrian',
      costing_options: { pedestrian: { max_hiking_difficulty: 6 } },
      directions_type: 'none',
      shape_format: 'polyline6',
    });
    expect(JSON.parse(valhallaTraceBody(VALHALLA, 'shape'))).toMatchObject({
      encoded_polyline: 'shape',
      shape_format: 'polyline6',
      shape_match: 'edge_walk',
      costing_options: { pedestrian: { max_hiking_difficulty: 6 } },
    });
  });
});

describe('provider chains', () => {
  it('lift the SAC limit on trails and alpine legs, try Valhalla next, and send only trails to OSRM foot', () => {
    expect(PROVIDER_CHAINS.hiking).toEqual([
      { provider: 'brouter', profile: 'hiking-mountain', params: { SAC_scale_limit: 6, SAC_scale_preferred: 2 } },
      VALHALLA,
      { provider: 'osrm', service: 'routed-foot', profile: 'foot' },
    ]);
    expect(PROVIDER_CHAINS.alpine).toEqual([{ provider: 'brouter', profile: 'hiking-mountain', params: { SAC_scale_limit: 6, SAC_scale_preferred: 4 } }, VALHALLA]);
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
    expect(() => parseProviderResponse(spec, BROUTER_WATCHDOG)).toThrow(/watchdog/);
    expect(() => parseBrouterGeojson({ type: 'FeatureCollection', features: [] })).toThrow(RouteError);
  });
});

describe('parseBrouterWays', () => {
  it.each([
    ['Lausanne', BROUTER],
    ['Hörnli trail', BROUTER_HORNLI],
    ['Aconcagua, alpine parameters', BROUTER_ALPINE],
  ])('covers every segment of a real response (%s), ending spans where the messages rows end', (_, body) => {
    const json = JSON.parse(body);
    const coords = parseBrouterGeojson(json);
    const ways = parseBrouterWays(json, coords)!;
    expect(validWays(ways, coords.length)).toBe(true);
    const cum = cumulativeDistances(coords);
    const rows = json.features[0].properties.messages.slice(1) as string[][];
    let travelled = 0;
    const rowEnds = rows.map((row) => (travelled += Number(row[3])));
    for (const w of ways) {
      expect(Math.min(...rowEnds.map((x) => Math.abs(x - cum[w.end])))).toBeLessThan(3 + 0.01 * cum[w.end]);
      for (const kv of w.tags.split(' ').filter(Boolean)) expect(WAY_TAG_KEYS.has(kv.split('=')[0])).toBe(true);
    }
  });

  it('keeps the tags of the Hörnli trail in order', () => {
    const json = JSON.parse(BROUTER_HORNLI);
    expect(parseBrouterWays(json, parseBrouterGeojson(json))!.map((w) => w.tags)).toEqual([
      'highway=steps surface=paving_stones',
      'highway=path surface=ground sac_scale=hiking',
      'highway=steps surface=paving_stones',
      'highway=footway surface=wood',
      'highway=path sac_scale=hiking',
      'highway=path surface=ground sac_scale=demanding_mountain_hiking',
      'highway=path surface=ground',
      'highway=path surface=ground sac_scale=demanding_mountain_hiking',
    ]);
  });

  it('places a row whose point is not a vertex by its distance, and gives up on malformed tables', () => {
    const coords: LngLat[] = [
      [0, 0],
      [0.001, 0],
      [0.002, 0],
    ];
    const header = ['Longitude', 'Latitude', 'Elevation', 'Distance', 'WayTags'];
    const json = (messages: unknown) => ({ features: [{ properties: { messages } }] });
    expect(parseBrouterWays(json([header, ['500', '0', '0', '111', 'highway=path'], ['2000', '0', '0', '111', 'highway=track']]), coords)).toEqual([
      { end: 1, tags: 'highway=path' },
      { end: 2, tags: 'highway=track' },
    ]);
    expect(parseBrouterWays(json([['Longitude'], ['1', '2']]), coords)).toBeUndefined();
    expect(parseBrouterWays(json(null), coords)).toBeUndefined();
    expect(parseBrouterWays({}, coords)).toBeUndefined();
  });
});

describe('parseValhallaRoute', () => {
  it('decodes the precision-6 shape of a real pedestrian route', () => {
    const json = JSON.parse(VALHALLA_ROUTE);
    const route = parseValhallaRoute(json);
    expect(route.shape).toBe(json.trip.legs[0].shape);
    expect(route.coords.length).toBeGreaterThan(100);
    expect(route.vertex[route.vertex.length - 1]).toBe(route.coords.length - 1);
    expect(snapDistance(route.coords, ...KAZBEK)).toBeLessThan(MAX_SNAP_M);
    const reported = json.trip.summary.length * 1000;
    expect(Math.abs(polylineLength(route.coords) - reported) / reported).toBeLessThan(0.03);
    expect(parseProviderResponse(VALHALLA, VALHALLA_ROUTE)).toEqual({ coords: route.coords });
  });

  it('throws on Valhalla errors and malformed shapes', () => {
    expect(() => parseValhallaRoute(JSON.parse(VALHALLA_ERROR))).toThrow('Valhalla: No suitable edges near location (171)');
    expect(() => parseValhallaRoute({ trip: { legs: [{}] } })).toThrow(RouteError);
    expect(() => parseValhallaRoute({ trip: { legs: [{ shape: '_' }] } })).toThrow(/malformed shape/);
    expect(() => parseValhallaRoute(null)).toThrow(RouteError);
  });
});

describe('parseValhallaWays', () => {
  it('turns trace_attributes edges of a real route into OSM tag spans', () => {
    const route = parseValhallaRoute(JSON.parse(VALHALLA_ROUTE));
    const ways = parseValhallaWays(JSON.parse(VALHALLA_TRACE), route)!;
    expect(validWays(ways, route.coords.length)).toBe(true);
    expect(ways.map((w) => w.tags)).toEqual([
      'highway=path surface=dirt sac_scale=mountain_hiking',
      'highway=path surface=dirt sac_scale=demanding_mountain_hiking',
      'highway=path sac_scale=demanding_mountain_hiking',
      'highway=path sac_scale=alpine_hiking',
      'highway=path sac_scale=demanding_alpine_hiking',
    ]);
    for (const w of ways) for (const kv of w.tags.split(' ')) expect(WAY_TAG_KEYS.has(kv.split('=')[0])).toBe(true);
  });

  it('maps uses, road classes, surfaces and structures, and gives up on malformed edges', () => {
    expect(valhallaEdgeTags({ use: 'road', road_class: 'tertiary', surface: 'paved_smooth', sac_scale: 0, bridge: true, tunnel: false })).toBe(
      'highway=tertiary surface=paved bridge=yes',
    );
    expect(valhallaEdgeTags({ use: 'steps', road_class: 'service_other', surface: 'impassable', sac_scale: 6 })).toBe(
      'highway=steps smoothness=impassable sac_scale=difficult_alpine_hiking',
    );
    expect(valhallaEdgeTags(null)).toBe('');
    const route = {
      coords: [
        [0, 0],
        [0.001, 0],
        [0.002, 0],
      ] as LngLat[],
      vertex: Int32Array.from([0, 1, 1, 2]),
    };
    expect(parseValhallaWays({ edges: [{ end_shape_index: 2, use: 'path' }, { end_shape_index: 3, use: 'track' }] }, route)).toEqual([
      { end: 1, tags: 'highway=path' },
      { end: 2, tags: 'highway=track' },
    ]);
    expect(parseValhallaWays({ edges: [{ end_shape_index: 7 }] }, route)).toBeUndefined();
    expect(parseValhallaWays({ edges: [] }, route)).toBeUndefined();
    expect(parseValhallaWays(null, route)).toBeUndefined();
  });
});

interface FakeResponse {
  match: RegExp;
  body?: string;
  error?: unknown;
}

function setup(responses: FakeResponse[]) {
  const calls: string[] = [];
  const inits: TimedInit[] = [];
  const fetchText = async (url: string, init: TimedInit) => {
    calls.push(url);
    inits.push(init);
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
  const router = createRouter({ fetchText, queues: { osrm: new HostQueue(0), brouter: new HostQueue(0), valhalla: new HostQueue(0) } });
  return { router, calls, inits };
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
    ['bike', 'trekking', 'routed-bike'],
    ['road-bike', 'fastbike', 'routed-bike'],
    ['mtb', 'mtb', 'routed-bike'],
  ] as const)('%s: BRouter %s, then OSRM %s', async (profile, brouterProfile, osrmService) => {
    const { router, calls } = setup([
      { match: /brouter/, error: new HttpError(500, 'brouter') },
      { match: new RegExp(osrmService), body: OSRM_FOOT },
    ]);
    const leg = await router(A, B, profile);
    expect(calls[0]).toContain(`profile=${brouterProfile}&`);
    expect(calls[1]).toContain(`/${osrmService}/`);
    expect(leg.provider).toBe('osrm');
    expect(PROVIDER_CHAINS[profile]).toHaveLength(2);
  });

  it('hiking: BRouter with SAC limit 6, then Valhalla, then OSRM foot', async () => {
    const { router, calls } = setup([
      { match: /brouter/, error: new HttpError(400, 'brouter', BROUTER_WATCHDOG) },
      { match: /valhalla/, error: new HttpError(400, 'valhalla', VALHALLA_ERROR) },
      { match: /routed-foot/, body: OSRM_FOOT },
    ]);
    const leg = await router(A, B, 'hiking');
    expect(calls).toHaveLength(3);
    expect(calls[0]).toContain('&profile=hiking-mountain&alternativeidx=0&format=geojson&profile:SAC_scale_limit=6&profile:SAC_scale_preferred=2');
    expect(calls[1]).toMatch(/^https:\/\/valhalla1\.openstreetmap\.de\/route\?json=/);
    expect(calls[2]).toContain('/routed-foot/');
    expect(leg.provider).toBe('osrm');
  });

  it('alpine: BRouter legs carry the alpine way tags', async () => {
    const { router, calls } = setup([{ match: /brouter/, body: BROUTER_ALPINE }]);
    const leg = await router(...ACONCAGUA, 'alpine');
    expect(calls[0]).toContain('profile:SAC_scale_limit=6&profile:SAC_scale_preferred=4');
    expect(leg.provider).toBe('brouter');
    expect(validWays(leg.ways, leg.coords.length)).toBe(true);
    expect(leg.ways!.some((w) => w.tags.includes('sac_scale=demanding_alpine_hiking'))).toBe(true);
  });

  it('alpine: a BRouter watchdog error falls through to Valhalla, whose leg gets way tags from trace_attributes', async () => {
    const { router, calls, inits } = setup([
      { match: /brouter/, error: new HttpError(400, 'brouter', BROUTER_WATCHDOG) },
      { match: /trace_attributes/, body: VALHALLA_TRACE },
      { match: /valhalla/, body: VALHALLA_ROUTE },
    ]);
    const leg = await router(...KAZBEK, 'alpine');
    expect(calls).toHaveLength(3);
    expect(calls[1]).toMatch(/\/route\?json=/);
    expect(calls[2]).toBe(VALHALLA_TRACE_URL);
    expect(inits[2]).toMatchObject({ method: 'POST', headers: { 'Content-Type': 'application/json' } });
    expect(JSON.parse(String(inits[2].body)).encoded_polyline).toBe(JSON.parse(VALHALLA_ROUTE).trip.legs[0].shape);
    expect(leg).toMatchObject({ provider: 'valhalla', fallback: false });
    expect(validWays(leg.ways, leg.coords.length)).toBe(true);
    expect(leg.ways!.at(-1)!.tags).toBe('highway=path sac_scale=demanding_alpine_hiking');
  });

  it('alpine: never asks OSRM, and a failed trace lookup keeps the Valhalla leg without tags', async () => {
    const offline = setup([{ match: /./, error: new TypeError('Failed to fetch') }]);
    expect(await offline.router(...KAZBEK, 'alpine')).toMatchObject({ provider: 'straight', fallback: true });
    expect(offline.calls).toHaveLength(2);
    expect(offline.calls.some((url) => url.includes('routed-foot'))).toBe(false);

    const untraced = setup([
      { match: /brouter/, error: new HttpError(500, 'brouter') },
      { match: /trace_attributes/, error: new HttpError(429, 'valhalla') },
      { match: /valhalla/, body: VALHALLA_ROUTE },
    ]);
    const leg = await untraced.router(...KAZBEK, 'alpine');
    expect(leg.provider).toBe('valhalla');
    expect(leg).not.toHaveProperty('ways');
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

  it('BRouter legs carry way tags; OSRM legs do not', async () => {
    const { router } = setup([
      { match: /brouter/, body: BROUTER },
      { match: /routed-foot/, body: OSRM_FOOT },
    ]);
    const hiking = await router(A, B, 'hiking');
    expect(validWays(hiking.ways, hiking.coords.length)).toBe(true);
    expect(hiking.ways!.some((w) => w.tags === 'highway=steps')).toBe(true);
    hiking.ways![0].tags = 'changed';
    expect((await router(A, B, 'hiking')).ways![0].tags).not.toBe('changed');
    expect(await router(A, B, 'foot')).not.toHaveProperty('ways');
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
