// Routed leg geometries persisted across reloads, so a stored route reproduces its exact geometry without asking
// the routers again. Keyed by legKey (profile + endpoints at 1e-6°): a moved waypoint or another profile is a
// different key. Bounded by count and by stored size, least recently used first out.
import { decodePolyline, encodePolyline, polylineLength } from '../lib/geo';
import { remapWays, validWays } from '../lib/route';
import type { LegGeometry } from '../lib/services/routing';
import type { LngLat, RouteLeg, RoutingProvider } from '../lib/types';

export const LEG_CACHE_KEY = 'runsketch:legs:v1';
export const LEG_CACHE_LIMIT = 200;
/** Serialized characters kept at most (localStorage allows ≈5 M per origin, shared with preferences). */
export const LEG_CACHE_CHARS = 1_500_000;
const PRECISION = 6;

const PROVIDERS: readonly RoutingProvider[] = ['brouter', 'osrm', 'valhalla', 'straight'];

/** Rounds half away from zero at 1e-6°, matching the precision-6 polyline codec exactly. */
export function roundCoord(x: number): number {
  return (Math.sign(x) * Math.floor(Math.abs(x) * 1e6 + 0.5)) / 1e6;
}

/**
 * Leg geometry as the app keeps it: coordinates at 1e-6° (≈0.1 m), consecutive duplicates dropped, distance
 * from the rounded line, way tags renumbered to the kept vertices. Stored and freshly routed legs are therefore
 * byte-identical.
 */
export function roundLeg(geometry: LegGeometry): LegGeometry {
  const coords: LngLat[] = [];
  const index = new Int32Array(geometry.coords.length);
  geometry.coords.forEach(([lon, lat], i) => {
    const c: LngLat = [roundCoord(lon), roundCoord(lat)];
    const last = coords[coords.length - 1];
    if (!last || last[0] !== c[0] || last[1] !== c[1]) coords.push(c);
    index[i] = coords.length - 1;
  });
  if (coords.length === 1 && geometry.coords.length > 1) coords.push([...coords[0]] as LngLat);
  const leg: LegGeometry = { coords, distance: polylineLength(coords), provider: geometry.provider, fallback: geometry.fallback };
  const ways = geometry.ways ? remapWays(geometry.ways, index) : null;
  if (validWays(ways, coords.length)) leg.ways = ways;
  return leg;
}

type StoredWays = Array<[end: number, tags: string]>;
type Entry = { geometry: LegGeometry; line: string; ways?: StoredWays; chars: number };
type StoredEntry = [key: string, line: string, provider: RoutingProvider, ways?: StoredWays];

function entry(geometry: LegGeometry, line: string): Entry {
  const ways = geometry.ways?.map((w): [number, string] => [w.end, w.tags]);
  return { geometry, line, ways, chars: line.length + (ways ? JSON.stringify(ways).length : 0) + 16 };
}

export class LegCache {
  private readonly entries = new Map<string, Entry>();
  private dirty = false;

  constructor(
    private readonly limit = LEG_CACHE_LIMIT,
    private readonly maxChars = LEG_CACHE_CHARS,
  ) {}

  static load(storage: Pick<Storage, 'getItem'> | undefined, limit?: number, maxChars?: number): LegCache {
    const cache = new LegCache(limit, maxChars);
    try {
      const raw = JSON.parse(storage?.getItem(LEG_CACHE_KEY) ?? 'null') as unknown;
      const list = raw && typeof raw === 'object' && (raw as { v?: unknown }).v === 1 ? (raw as { legs?: unknown }).legs : null;
      if (!Array.isArray(list)) return cache;
      for (const item of list) {
        if (!Array.isArray(item) || typeof item[0] !== 'string' || typeof item[1] !== 'string') continue;
        const provider = PROVIDERS.includes(item[2]) ? (item[2] as RoutingProvider) : null;
        if (!provider) continue;
        let coords: LngLat[];
        try {
          coords = decodePolyline(item[1], PRECISION);
        } catch {
          continue;
        }
        if (coords.length < 2 || coords.some(([lon, lat]) => !(Math.abs(lon) <= 180 && Math.abs(lat) <= 90))) continue;
        const geometry: LegGeometry = { coords, distance: polylineLength(coords), provider, fallback: false };
        // Way tags are optional (entries written before they existed have none); malformed tags drop, the geometry stays.
        const ways = Array.isArray(item[3]) ? item[3].map((w: unknown) => (Array.isArray(w) ? { end: w[0], tags: w[1] } : null)) : null;
        if (validWays(ways, coords.length)) geometry.ways = ways;
        cache.entries.set(item[0], entry(geometry, item[1]));
      }
      cache.evict();
    } catch {
      // Corrupt storage: start empty.
    }
    cache.dirty = false;
    return cache;
  }

  get size(): number {
    return this.entries.size;
  }

  get(key: string): LegGeometry | undefined {
    return this.entries.get(key)?.geometry;
  }

  /** Records the legs in use (most recent last). Fallback straight lines are not kept: a reload retries routing. */
  remember(legs: ReadonlyMap<string, RouteLeg>): void {
    for (const [key, leg] of legs) {
      if (leg.fallback || leg.coords.length < 2) continue;
      const existing = this.entries.get(key);
      if (existing) {
        this.entries.delete(key);
        this.entries.set(key, existing);
        continue;
      }
      const geometry: LegGeometry = { coords: leg.coords, distance: leg.distance, provider: leg.provider, fallback: false };
      if (validWays(leg.ways, leg.coords.length)) geometry.ways = leg.ways;
      this.entries.set(key, entry(geometry, encodePolyline(leg.coords, PRECISION)));
      this.dirty = true;
    }
    // Recency changes are worth a write only together with new geometry; evict keeps the bounds.
    if (this.evict()) this.dirty = true;
  }

  forget(key: string): void {
    if (this.entries.delete(key)) this.dirty = true;
  }

  save(storage: Pick<Storage, 'setItem'> | undefined, force = false): void {
    if (!storage || (!this.dirty && !force)) return;
    for (let attempt = 0; attempt < 4; attempt++) {
      const legs = [...this.entries].map(([key, e]): StoredEntry => (e.ways ? [key, e.line, e.geometry.provider, e.ways] : [key, e.line, e.geometry.provider]));
      try {
        storage.setItem(LEG_CACHE_KEY, JSON.stringify({ v: 1, legs }));
        this.dirty = false;
        return;
      } catch {
        // Quota: drop the older half and try again.
        const drop = Math.ceil(this.entries.size / 2);
        if (drop === 0) return;
        [...this.entries.keys()].slice(0, drop).forEach((key) => this.entries.delete(key));
      }
    }
  }

  private evict(): boolean {
    let evicted = false;
    let chars = 0;
    for (const [key, e] of this.entries) chars += key.length + e.chars;
    for (const [key, e] of this.entries) {
      if (this.entries.size <= this.limit && chars <= this.maxChars) break;
      this.entries.delete(key);
      chars -= key.length + e.chars;
      evicted = true;
    }
    return evicted;
  }
}
