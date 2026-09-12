import type { LngLat, RouteLeg, SnapProfile } from '../types';
import { haversine, polylineLength } from '../geo';
import { legKey } from '../route';
import { DEFAULT_TIMEOUT_MS, HostQueue, abortError, fetchText, throwIfAborted } from './http';
import type { TimedInit } from './http';
import { LruCache } from './lru';

export type LegGeometry = Omit<RouteLeg, 'fromId' | 'toId'>;

export const OSRM_BASE = 'https://routing.openstreetmap.de';
export const BROUTER_BASE = 'https://brouter.de/brouter';

/**
 * Both routers snap to the nearest way at any distance (verified 2026-09-12: OSRM answered `Ok` for a
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
}
export type ProviderSpec = OsrmSpec | BrouterSpec;
export type RoutedProfile = Exclude<SnapProfile, 'none'>;

const OSRM_FOOT: OsrmSpec = { provider: 'osrm', service: 'routed-foot', profile: 'foot' };
const OSRM_BIKE: OsrmSpec = { provider: 'osrm', service: 'routed-bike', profile: 'bike' };
const brouter = (profile: string): BrouterSpec => ({ provider: 'brouter', profile });

/** Providers tried in order per snap profile (all profile names verified live with CORS `*`). */
export const PROVIDER_CHAINS: Readonly<Record<RoutedProfile, readonly ProviderSpec[]>> = {
  foot: [OSRM_FOOT, brouter('hiking-beta')],
  hiking: [brouter('hiking-mountain'), OSRM_FOOT],
  bike: [brouter('trekking'), OSRM_BIKE],
  'road-bike': [brouter('fastbike'), OSRM_BIKE],
  mtb: [brouter('mtb'), OSRM_BIKE],
};

/** FOSSGIS asks for at most one request per second; BRouter is a single community server, so one at a time. */
export const ROUTING_QUEUES: Readonly<Record<ProviderSpec['provider'], HostQueue>> = {
  osrm: new HostQueue(1000),
  brouter: new HostQueue(0),
};

/**
 * Per-attempt limits. BRouter took 11.7 s and 9.9 s on 2026-09-12 (1.4 s on the next request); an 8 s
 * limit silently replaced hiking-mountain and fastbike legs with OSRM, which has neither behaviour.
 */
export const PROVIDER_TIMEOUT_MS: Readonly<Record<ProviderSpec['provider'], number>> = {
  osrm: DEFAULT_TIMEOUT_MS,
  brouter: 15_000,
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
  return `${BROUTER_BASE}?lonlats=${fmt(a)}%7C${fmt(b)}&profile=${encodeURIComponent(spec.profile)}&alternativeidx=0&format=geojson`;
}

export function providerUrl(spec: ProviderSpec, a: LngLat, b: LngLat): string {
  return spec.provider === 'osrm' ? osrmRouteUrl(spec, a, b) : brouterRouteUrl(spec, a, b);
}

/** Validates [lon, lat(, ele)] tuples, drops elevation and consecutive duplicates. */
function toLngLatList(raw: unknown, who: string): LngLat[] {
  if (!Array.isArray(raw)) throw new RouteError(`${who}: geometry has no coordinates`);
  const out: LngLat[] = [];
  for (const c of raw) {
    if (!Array.isArray(c) || c.length < 2) throw new RouteError(`${who}: malformed coordinate`);
    const lon = c[0];
    const lat = c[1];
    if (typeof lon !== 'number' || typeof lat !== 'number' || !Number.isFinite(lon) || !Number.isFinite(lat) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
      throw new RouteError(`${who}: coordinate out of range`);
    }
    const prev = out[out.length - 1];
    if (prev && prev[0] === lon && prev[1] === lat) continue;
    out.push([lon, lat]);
  }
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

/** Parses a raw body; BRouter reports errors as plain text (e.g. "from-position not mapped in existing datafile"). */
export function parseProviderResponse(spec: ProviderSpec, body: string): LngLat[] {
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    throw new RouteError(`${spec.provider}: non-JSON response: ${body.slice(0, 120).trim()}`);
  }
  return spec.provider === 'osrm' ? parseOsrmRoute(json) : parseBrouterGeojson(json);
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
  return { ...leg, coords: leg.coords.slice() };
}

export type RouteLegFn = (a: LngLat, b: LngLat, profile: SnapProfile, signal?: AbortSignal) => Promise<LegGeometry>;

export interface RouterOptions {
  /** Injected for tests; must throw on non-2xx. */
  fetchText?: (url: string, init: TimedInit) => Promise<string>;
  queues?: Partial<Record<ProviderSpec['provider'], HostQueue>>;
  /** Per provider attempt (queue wait excluded). */
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

  async function attempt(spec: ProviderSpec, a: LngLat, b: LngLat, signal?: AbortSignal): Promise<LegGeometry> {
    const url = providerUrl(spec, a, b);
    const body = await queueFor(spec).run(() => doFetch(url, { signal, timeoutMs: timeoutFor(spec) }), signal);
    const coords = parseProviderResponse(spec, body);
    const snap = snapDistance(coords, a, b);
    if (snap > MAX_SNAP_M) throw new RouteError(`${spec.provider}: snapped ${Math.round(snap)} m away from the waypoint`);
    return { coords, distance: polylineLength(coords), provider: spec.provider, fallback: false };
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
