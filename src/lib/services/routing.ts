import type { LngLat, RouteLeg, SnapProfile, WaySpan } from '../types';
import { cumulativeDistances, decodePolyline, haversine, polylineLength } from '../geo';
import { filterWayTags, legKey, pushWaySpan, validWays } from '../route';
import { DEFAULT_TIMEOUT_MS, HostQueue, abortError, fetchText, throwIfAborted } from './http';
import type { TimedInit } from './http';
import { LruCache } from './lru';

export type LegGeometry = Omit<RouteLeg, 'fromId' | 'toId'>;

export const OSRM_BASE = 'https://routing.openstreetmap.de';
export const BROUTER_BASE = 'https://brouter.de/brouter';
export const VALHALLA_BASE = 'https://valhalla1.openstreetmap.de';

/**
 * OSRM and BRouter snap to the nearest way at any distance (verified 2026-09-12: OSRM answered `Ok` for a
 * point 98 km out in the Atlantic, BRouter snapped a Lake Geneva point 3.6 km). A leg whose ends land
 * further than this from the requested waypoints is treated as a provider failure.
 */
export const MAX_SNAP_M = 250;

export interface OsrmSpec {
  provider: 'osrm';
  service: 'routed-foot' | 'routed-bike';
  profile: 'foot' | 'bike';
}
export interface BrouterSpec {
  provider: 'brouter';
  profile: string;
  /** Profile variables overridden per request, sent as `profile:name=value`. */
  params?: Readonly<Record<string, string | number>>;
}
export interface ValhallaSpec {
  provider: 'valhalla';
  costing: 'pedestrian';
  /** Highest sac_scale grade the route may use, 0–6; the server default (1) stops at T1 paths. */
  maxHikingDifficulty: number;
}
export type ProviderSpec = OsrmSpec | BrouterSpec | ValhallaSpec;
export type RoutedProfile = Exclude<SnapProfile, 'none'>;

const OSRM_FOOT: OsrmSpec = { provider: 'osrm', service: 'routed-foot', profile: 'foot' };
const OSRM_BIKE: OsrmSpec = { provider: 'osrm', service: 'routed-bike', profile: 'bike' };
const brouter = (profile: string, params?: BrouterSpec['params']): BrouterSpec =>
  params ? { provider: 'brouter', profile, params } : { provider: 'brouter', profile };

/**
 * hiking-mountain does not forbid paths above SAC_scale_limit (default 3), it makes them cost 999: on alpine legs that
 * ended in BRouter's watchdog after 8–54 s or in an 82 km detour (2026-09-13). With the limit at 6 the same legs route
 * in 1–2.5 s; SAC_scale_preferred only breaks ties toward easier (2) or alpine (4) paths.
 */
const TRAIL_BROUTER = brouter('hiking-mountain', { SAC_scale_limit: 6, SAC_scale_preferred: 2 });
const ALPINE_BROUTER = brouter('hiking-mountain', { SAC_scale_limit: 6, SAC_scale_preferred: 4 });
/** FOSSGIS OSRM foot cannot route any path from T2 up, so alpine legs fall back to Valhalla instead. */
const VALHALLA_MOUNTAIN: ValhallaSpec = { provider: 'valhalla', costing: 'pedestrian', maxHikingDifficulty: 6 };

/** Providers tried in order per snap profile (all profile names verified live with CORS `*`). */
export const PROVIDER_CHAINS: Readonly<Record<RoutedProfile, readonly ProviderSpec[]>> = {
  foot: [OSRM_FOOT, brouter('hiking-beta')],
  hiking: [TRAIL_BROUTER, VALHALLA_MOUNTAIN, OSRM_FOOT],
  alpine: [ALPINE_BROUTER, VALHALLA_MOUNTAIN],
  bike: [brouter('trekking'), OSRM_BIKE],
  'road-bike': [brouter('fastbike'), OSRM_BIKE],
  mtb: [brouter('mtb'), OSRM_BIKE],
};

/** FOSSGIS asks for at most one request per second (OSRM and Valhalla); BRouter is a single community server, so one at a time. */
export const ROUTING_QUEUES: Readonly<Record<ProviderSpec['provider'], HostQueue>> = {
  osrm: new HostQueue(1000),
  brouter: new HostQueue(0),
  valhalla: new HostQueue(1000),
};

/**
 * Per-attempt limits. BRouter took 11.7 s and 9.9 s on 2026-09-12 (1.4 s on the next request); an 8 s limit silently
 * replaced hiking-mountain and fastbike legs with OSRM, which has neither behaviour. Its watchdog error for an alpine leg
 * with default parameters arrived only after 24 s (2026-09-13), so this limit is what ends such a request. Valhalla
 * answered alpine legs in 1.1–1.4 s.
 */
export const PROVIDER_TIMEOUT_MS: Readonly<Record<ProviderSpec['provider'], number>> = {
  osrm: DEFAULT_TIMEOUT_MS,
  brouter: 15_000,
  valhalla: 15_000,
};

export class RouteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RouteError';
  }
}

function fmt(p: LngLat): string {
  return `${p[0].toFixed(6)},${p[1].toFixed(6)}`;
}

export function osrmRouteUrl(spec: OsrmSpec, a: LngLat, b: LngLat): string {
  return `${OSRM_BASE}/${spec.service}/route/v1/${spec.profile}/${fmt(a)};${fmt(b)}?overview=full&geometries=geojson&steps=false`;
}

export function brouterRouteUrl(spec: BrouterSpec, a: LngLat, b: LngLat): string {
  const params = Object.entries(spec.params ?? {})
    .map(([name, value]) => `&profile:${encodeURIComponent(name)}=${encodeURIComponent(String(value))}`)
    .join('');
  return `${BROUTER_BASE}?lonlats=${fmt(a)}%7C${fmt(b)}&profile=${encodeURIComponent(spec.profile)}&alternativeidx=0&format=geojson${params}`;
}

const costingOptions = (spec: ValhallaSpec) => ({ [spec.costing]: { max_hiking_difficulty: spec.maxHikingDifficulty } });

/** Valhalla `/route` as a GET with the request in `json=`: a simple CORS request, so no preflight. */
export function valhallaRouteUrl(spec: ValhallaSpec, a: LngLat, b: LngLat): string {
  const request = {
    locations: [a, b].map(([lon, lat]) => ({ lon: Number(lon.toFixed(6)), lat: Number(lat.toFixed(6)) })),
    costing: spec.costing,
    costing_options: costingOptions(spec),
    directions_type: 'none',
    shape_format: 'polyline6',
  };
  return `${VALHALLA_BASE}/route?json=${encodeURIComponent(JSON.stringify(request))}`;
}

export function providerUrl(spec: ProviderSpec, a: LngLat, b: LngLat): string {
  if (spec.provider === 'osrm') return osrmRouteUrl(spec, a, b);
  return spec.provider === 'brouter' ? brouterRouteUrl(spec, a, b) : valhallaRouteUrl(spec, a, b);
}

export const VALHALLA_TRACE_URL = `${VALHALLA_BASE}/trace_attributes`;
const VALHALLA_EDGE_ATTRIBUTES = ['edge.begin_shape_index', 'edge.end_shape_index', 'edge.use', 'edge.road_class', 'edge.surface', 'edge.sac_scale', 'edge.bridge', 'edge.tunnel'];

/** JSON body for `trace_attributes` along a returned route shape. Sent as a POST: long shapes outgrow a URL. */
export function valhallaTraceBody(spec: ValhallaSpec, shape: string): string {
  return JSON.stringify({
    encoded_polyline: shape,
    shape_format: 'polyline6',
    costing: spec.costing,
    costing_options: costingOptions(spec),
    shape_match: 'edge_walk',
    filters: { attributes: VALHALLA_EDGE_ATTRIBUTES, action: 'include' },
  });
}

/**
 * Validates [lon, lat(, ele)] tuples, drops elevation and consecutive duplicates. `vertex`, when given, receives the
 * output index of every input tuple.
 */
function toLngLatList(raw: unknown, who: string, vertex?: Int32Array): LngLat[] {
  if (!Array.isArray(raw)) throw new RouteError(`${who}: geometry has no coordinates`);
  const out: LngLat[] = [];
  raw.forEach((c: unknown, i) => {
    if (!Array.isArray(c) || c.length < 2) throw new RouteError(`${who}: malformed coordinate`);
    const lon = c[0];
    const lat = c[1];
    if (typeof lon !== 'number' || typeof lat !== 'number' || !Number.isFinite(lon) || !Number.isFinite(lat) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
      throw new RouteError(`${who}: coordinate out of range`);
    }
    const prev = out[out.length - 1];
    if (!prev || prev[0] !== lon || prev[1] !== lat) out.push([lon, lat]);
    if (vertex) vertex[i] = out.length - 1;
  });
  if (out.length === 0) throw new RouteError(`${who}: empty geometry`);
  return out;
}

/** OSRM `/route/v1` with `geometries=geojson&overview=full`. */
export function parseOsrmRoute(json: unknown): LngLat[] {
  if (!json || typeof json !== 'object') throw new RouteError('OSRM: response is not an object');
  const j = json as { code?: unknown; message?: unknown; routes?: Array<{ geometry?: { coordinates?: unknown } }> };
  if (j.code !== 'Ok') {
    throw new RouteError(`OSRM: ${String(j.code)}${typeof j.message === 'string' ? ` (${j.message})` : ''}`);
  }
  return toLngLatList(j.routes?.[0]?.geometry?.coordinates, 'OSRM');
}

/** BRouter `format=geojson`: FeatureCollection with one LineString of [lon, lat, ele]. */
export function parseBrouterGeojson(json: unknown): LngLat[] {
  if (!json || typeof json !== 'object') throw new RouteError('BRouter: response is not an object');
  const j = json as { features?: Array<{ geometry?: { type?: unknown; coordinates?: unknown } }> };
  const geom = j.features?.[0]?.geometry;
  if (!geom || geom.type !== 'LineString') throw new RouteError('BRouter: no LineString feature');
  return toLngLatList(geom.coordinates, 'BRouter');
}

export interface ValhallaRoute {
  coords: LngLat[];
  /** The leg's shape as returned, for trace_attributes. */
  shape: string;
  /** Index in `coords` of every vertex of the decoded shape (consecutive duplicates are dropped). */
  vertex: Int32Array;
}

/** Valhalla `/route` with `shape_format=polyline6`: one leg whose shape is a precision-6 polyline. Errors come as `{ error_code, error }`. */
export function parseValhallaRoute(json: unknown): ValhallaRoute {
  if (!json || typeof json !== 'object') throw new RouteError('Valhalla: response is not an object');
  const j = json as { error?: unknown; error_code?: unknown; trip?: { legs?: Array<{ shape?: unknown }> } };
  if (j.error !== undefined || !j.trip) {
    throw new RouteError(`Valhalla: ${String(j.error ?? 'no trip')}${j.error_code !== undefined ? ` (${String(j.error_code)})` : ''}`);
  }
  const shape = j.trip.legs?.[0]?.shape;
  if (typeof shape !== 'string' || shape === '') throw new RouteError('Valhalla: leg has no shape');
  let decoded: LngLat[];
  try {
    decoded = decodePolyline(shape, 6);
  } catch {
    throw new RouteError('Valhalla: malformed shape');
  }
  const vertex = new Int32Array(decoded.length);
  return { coords: toLngLatList(decoded, 'Valhalla', vertex), shape, vertex };
}

const VALHALLA_SAC = ['', 'hiking', 'mountain_hiking', 'demanding_mountain_hiking', 'alpine_hiking', 'demanding_alpine_hiking', 'difficult_alpine_hiking'];
/** Edge uses that name a way class of their own; any other use (road, ramp, …) takes the road class. */
const VALHALLA_USE: Readonly<Record<string, string>> = {
  steps: 'steps',
  path: 'path',
  mountain_bike: 'path',
  footway: 'footway',
  sidewalk: 'footway',
  pedestrian_crossing: 'footway',
  elevator: 'footway',
  pedestrian: 'pedestrian',
  living_street: 'living_street',
  track: 'track',
  cycleway: 'cycleway',
  bridleway: 'bridleway',
  driveway: 'service',
  alley: 'service',
  parking_aisle: 'service',
  service_road: 'service',
  culdesac: 'residential',
};
const VALHALLA_ROAD_CLASS: Readonly<Record<string, string>> = {
  motorway: 'motorway',
  trunk: 'trunk',
  primary: 'primary',
  secondary: 'secondary',
  tertiary: 'tertiary',
  unclassified: 'unclassified',
  residential: 'residential',
  service_other: 'service',
};
/** Valhalla's coarse surface grades. `path` (a path without a surface tag) says nothing beyond the way class. */
const VALHALLA_SURFACE: Readonly<Record<string, string>> = {
  paved_smooth: 'surface=paved',
  paved: 'surface=paved',
  paved_rough: 'surface=paved',
  compacted: 'surface=compacted',
  dirt: 'surface=dirt',
  gravel: 'surface=gravel',
  impassable: 'smoothness=impassable',
};

/** One trace_attributes edge as OSM tags in the keys terrain reads (see WAY_TAG_RULES). */
export function valhallaEdgeTags(edge: unknown): string {
  const e = (edge ?? {}) as { use?: unknown; road_class?: unknown; surface?: unknown; sac_scale?: unknown; bridge?: unknown; tunnel?: unknown };
  const tags: string[] = [];
  const highway = VALHALLA_USE[String(e.use)] ?? VALHALLA_ROAD_CLASS[String(e.road_class)];
  if (highway) tags.push(`highway=${highway}`);
  const surface = VALHALLA_SURFACE[String(e.surface)];
  if (surface) tags.push(surface);
  const sac = typeof e.sac_scale === 'number' ? VALHALLA_SAC[e.sac_scale] : undefined;
  if (sac) tags.push(`sac_scale=${sac}`);
  if (e.bridge === true) tags.push('bridge=yes');
  if (e.tunnel === true) tags.push('tunnel=yes');
  return tags.join(' ');
}

/**
 * Way tags from `trace_attributes` along a Valhalla route (verified 2026-09-13: with `shape_match: edge_walk` the edges
 * index the route's own shape). Valhalla reports edge attributes rather than OSM tags: use and road class, a coarse
 * surface grade, sac_scale 0–6, bridge and tunnel; valhallaEdgeTags rewrites them into OSM keys. Undefined when the edges
 * are missing or do not cover the line in order.
 */
export function parseValhallaWays(json: unknown, route: Pick<ValhallaRoute, 'coords' | 'vertex'>): WaySpan[] | undefined {
  const edges = (json as { edges?: unknown } | null)?.edges;
  if (!Array.isArray(edges) || edges.length === 0 || route.coords.length < 2) return undefined;
  const spans: WaySpan[] = [];
  for (const edge of edges) {
    const end = (edge as { end_shape_index?: unknown } | null)?.end_shape_index;
    if (typeof end !== 'number' || !Number.isInteger(end) || end < 0 || end >= route.vertex.length) return undefined;
    pushWaySpan(spans, route.vertex[end], valhallaEdgeTags(edge));
  }
  pushWaySpan(spans, route.coords.length - 1, '');
  return validWays(spans, route.coords.length) ? spans : undefined;
}

/**
 * Way tags from BRouter's `messages` table: a header row (Longitude, Latitude, Elevation, Distance, …, WayTags, …), then
 * one row per stretch of unchanged tags with the stretch's last point in integer microdegrees and its length in metres
 * (verified 2026-09-13 on hiking-mountain and trekking responses; bridge and tunnel keys are not among the tags). A row
 * ends at the first vertex on its point after the previous row's end, or failing that at the vertex nearest its
 * cumulative distance. `coords` is the parsed geometry. Undefined when the table is missing or malformed.
 */
export function parseBrouterWays(json: unknown, coords: LngLat[]): WaySpan[] | undefined {
  const rows = (json as { features?: Array<{ properties?: { messages?: unknown } }> } | null)?.features?.[0]?.properties?.messages;
  if (!Array.isArray(rows) || rows.length < 2 || !Array.isArray(rows[0]) || coords.length < 2) return undefined;
  const header = rows[0] as unknown[];
  const lonAt = header.indexOf('Longitude');
  const latAt = header.indexOf('Latitude');
  const distAt = header.indexOf('Distance');
  const tagsAt = header.indexOf('WayTags');
  if (lonAt < 0 || latAt < 0 || tagsAt < 0) return undefined;
  const cum = cumulativeDistances(coords);
  const spans: WaySpan[] = [];
  let at = 0;
  let travelled = 0;
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (!Array.isArray(row)) return undefined;
    const lon = Number(row[lonAt]) / 1e6;
    const lat = Number(row[latAt]) / 1e6;
    if (distAt >= 0) travelled += Number(row[distAt]) || 0;
    let end = -1;
    for (let k = at; k < coords.length && end < 0; k++) {
      if (Math.abs(coords[k][0] - lon) < 5e-7 && Math.abs(coords[k][1] - lat) < 5e-7) end = k;
    }
    if (end < 0) {
      end = at;
      for (let k = at + 1; k < coords.length; k++) if (Math.abs(cum[k] - travelled) < Math.abs(cum[end] - travelled)) end = k;
    }
    pushWaySpan(spans, end, filterWayTags(String(row[tagsAt] ?? '')));
    at = end;
  }
  if (spans.length === 0) return undefined;
  pushWaySpan(spans, coords.length - 1, '');
  return spans;
}

function parseJson(spec: ProviderSpec, body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    throw new RouteError(`${spec.provider}: non-JSON response: ${body.slice(0, 120).trim()}`);
  }
}

/**
 * Parses a raw body; BRouter reports errors as plain text (e.g. "from-position not mapped in existing datafile"). Valhalla
 * way tags need a second request (see createRouter), so a Valhalla body gives the geometry only.
 */
export function parseProviderResponse(spec: ProviderSpec, body: string): Pick<LegGeometry, 'coords' | 'ways'> {
  const json = parseJson(spec, body);
  if (spec.provider === 'osrm') return { coords: parseOsrmRoute(json) };
  if (spec.provider === 'valhalla') return { coords: parseValhallaRoute(json).coords };
  const coords = parseBrouterGeojson(json);
  const ways = parseBrouterWays(json, coords);
  return ways ? { coords, ways } : { coords };
}

/** Larger of the two distances between requested endpoints and geometry endpoints, metres. */
export function snapDistance(coords: LngLat[], a: LngLat, b: LngLat): number {
  return Math.max(haversine(a, coords[0]), haversine(b, coords[coords.length - 1]));
}

export function straightLeg(a: LngLat, b: LngLat, fallback: boolean): LegGeometry {
  return { coords: [[a[0], a[1]], [b[0], b[1]]], distance: haversine(a, b), provider: 'straight', fallback };
}

function samePoint(a: LngLat, b: LngLat): boolean {
  return Math.round(a[0] * 1e6) === Math.round(b[0] * 1e6) && Math.round(a[1] * 1e6) === Math.round(b[1] * 1e6);
}

function cloneLeg(leg: LegGeometry): LegGeometry {
  const copy = { ...leg, coords: leg.coords.slice() };
  if (leg.ways) copy.ways = leg.ways.map((w) => ({ ...w }));
  return copy;
}

export type RouteLegFn = (a: LngLat, b: LngLat, profile: SnapProfile, signal?: AbortSignal) => Promise<LegGeometry>;

export interface RouterOptions {
  /** Injected for tests; must throw on non-2xx. Valhalla way tags arrive through a POST (init carries method and body). */
  fetchText?: (url: string, init: TimedInit) => Promise<string>;
  queues?: Partial<Record<ProviderSpec['provider'], HostQueue>>;
  /** Per provider request (queue wait excluded). */
  timeoutMs?: number;
  cacheSize?: number;
  chains?: Partial<Record<RoutedProfile, readonly ProviderSpec[]>>;
  onProviderError?: (spec: ProviderSpec, error: unknown) => void;
}

export function createRouter(options: RouterOptions = {}): RouteLegFn {
  const doFetch = options.fetchText ?? fetchText;
  const timeoutFor = (spec: ProviderSpec) => options.timeoutMs ?? PROVIDER_TIMEOUT_MS[spec.provider];
  const cache = new LruCache<string, LegGeometry>(options.cacheSize ?? 500);
  const queueFor = (spec: ProviderSpec) => options.queues?.[spec.provider] ?? ROUTING_QUEUES[spec.provider];
  const chainFor = (profile: RoutedProfile) => options.chains?.[profile] ?? PROVIDER_CHAINS[profile];
  const request = (spec: ProviderSpec, url: string, init: TimedInit, signal?: AbortSignal) =>
    queueFor(spec).run(() => doFetch(url, { ...init, signal, timeoutMs: timeoutFor(spec) }), signal);

  /** Way tags for a Valhalla leg through the same queue; a failed lookup leaves the leg without tags instead of failing it. */
  async function valhallaWays(spec: ValhallaSpec, route: ValhallaRoute, signal?: AbortSignal): Promise<WaySpan[] | undefined> {
    try {
      const init: TimedInit = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: valhallaTraceBody(spec, route.shape) };
      return parseValhallaWays(JSON.parse(await request(spec, VALHALLA_TRACE_URL, init, signal)), route);
    } catch (err) {
      if (signal?.aborted) throw abortError(signal);
      options.onProviderError?.(spec, err);
      return undefined;
    }
  }

  async function attempt(spec: ProviderSpec, a: LngLat, b: LngLat, signal?: AbortSignal): Promise<LegGeometry> {
    const body = await request(spec, providerUrl(spec, a, b), {}, signal);
    const valhalla = spec.provider === 'valhalla' ? parseValhallaRoute(parseJson(spec, body)) : null;
    const { coords, ways: tags }: Pick<LegGeometry, 'coords' | 'ways'> = valhalla ?? parseProviderResponse(spec, body);
    const snap = snapDistance(coords, a, b);
    if (snap > MAX_SNAP_M) throw new RouteError(`${spec.provider}: snapped ${Math.round(snap)} m away from the waypoint`);
    // Valhalla tags cost a second request, so they are fetched only for a leg that passed the snap check.
    const ways = valhalla && spec.provider === 'valhalla' ? await valhallaWays(spec, valhalla, signal) : tags;
    const leg: LegGeometry = { coords, distance: polylineLength(coords), provider: spec.provider, fallback: false };
    if (ways) leg.ways = ways;
    return leg;
  }

  return async (a, b, profile, signal) => {
    throwIfAborted(signal);
    if (samePoint(a, b)) return { coords: [[a[0], a[1]]], distance: 0, provider: 'straight', fallback: false };
    if (profile === 'none') return straightLeg(a, b, false);

    const key = legKey(a, b, profile);
    const hit = cache.get(key);
    if (hit) return cloneLeg(hit);

    for (const spec of chainFor(profile)) {
      try {
        const leg = await attempt(spec, a, b, signal);
        cache.set(key, leg);
        return cloneLeg(leg);
      } catch (err) {
        if (signal?.aborted) throw abortError(signal);
        options.onProviderError?.(spec, err);
      }
    }
    // Fallbacks are not cached: the next request retries the providers.
    return straightLeg(a, b, true);
  };
}

const defaultRouter = createRouter();

/** Route between two points. Chain per profile (see PROVIDER_CHAINS) → straight line (fallback: true). Cached by leg key. */
export async function routeLeg(a: LngLat, b: LngLat, profile: SnapProfile, signal?: AbortSignal): Promise<LegGeometry> {
  return defaultRouter(a, b, profile, signal);
}
