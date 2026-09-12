import type { LngLat } from '../types';
import { HostQueue, fetchJson } from './http';

export interface PlaceResult {
  id: string;
  name: string;
  /** Secondary line: city, region, country. */
  detail: string;
  lon: number;
  lat: number;
  bbox?: [number, number, number, number];
}

export const PHOTON_API = 'https://photon.komoot.io/api/';
export const PHOTON_LIMIT = 6;

/** Photon rejects any other language with HTTP 400 ("Supported are: default, de, en, fr"). */
const PHOTON_LANGS = new Set(['en', 'de', 'fr']);

/** Autocomplete callers abort superseded requests; the queue keeps at most one in flight. */
const photonQueue = new HostQueue(0);

export function photonLang(lang?: string): string {
  const base = lang?.trim().toLowerCase().split(/[-_]/)[0];
  return base && PHOTON_LANGS.has(base) ? base : 'default';
}

export function photonUrl(q: string, opts: { bias?: LngLat; lang?: string } = {}): string {
  let url = `${PHOTON_API}?q=${encodeURIComponent(q)}&limit=${PHOTON_LIMIT}`;
  const bias = opts.bias;
  if (bias && Number.isFinite(bias[0]) && Number.isFinite(bias[1])) {
    const lon = ((((bias[0] + 180) % 360) + 360) % 360) - 180;
    const lat = Math.max(-90, Math.min(90, bias[1]));
    url += `&lat=${lat.toFixed(5)}&lon=${lon.toFixed(5)}`;
  }
  return `${url}&lang=${photonLang(opts.lang)}`;
}

function text(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

/** Photon `extent` arrives as [west, north, east, south]; normalise to [minLon, minLat, maxLon, maxLat]. */
function extentToBbox(extent: unknown): [number, number, number, number] | undefined {
  if (!Array.isArray(extent) || extent.length !== 4) return undefined;
  const [a, b, c, d] = extent;
  if (![a, b, c, d].every((v) => typeof v === 'number' && Number.isFinite(v))) return undefined;
  return [Math.min(a, c), Math.min(b, d), Math.max(a, c), Math.max(b, d)];
}

interface PhotonProperties {
  osm_type?: unknown;
  osm_id?: unknown;
  name?: unknown;
  housenumber?: unknown;
  street?: unknown;
  city?: unknown;
  state?: unknown;
  country?: unknown;
  extent?: unknown;
}

/** Photon GeoJSON FeatureCollection → PlaceResult[] (invalid features skipped, duplicate OSM objects dropped). */
export function mapPhotonFeatures(json: unknown): PlaceResult[] {
  const features = (json as { features?: unknown } | null)?.features;
  if (!Array.isArray(features)) return [];
  const out: PlaceResult[] = [];
  const seen = new Set<string>();
  for (const f of features) {
    const coords = (f as { geometry?: { coordinates?: unknown } } | null)?.geometry?.coordinates;
    if (!Array.isArray(coords) || typeof coords[0] !== 'number' || typeof coords[1] !== 'number') continue;
    const [lon, lat] = coords as [number, number];
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    const p = ((f as { properties?: PhotonProperties }).properties ?? {}) as PhotonProperties;

    const street = text(p.street);
    const housenumber = text(p.housenumber);
    const streetLine = street && housenumber ? `${street} ${housenumber}` : street;
    const name = text(p.name) ?? streetLine ?? text(p.city) ?? text(p.state) ?? text(p.country) ?? `${lat.toFixed(5)}, ${lon.toFixed(5)}`;

    const parts: string[] = [];
    for (const part of [streetLine, text(p.city), text(p.state), text(p.country)]) {
      if (!part) continue;
      const lower = part.toLowerCase();
      if (lower === name.toLowerCase() || parts.some((x) => x.toLowerCase() === lower)) continue;
      parts.push(part);
    }

    const osmType = text(p.osm_type);
    const osmId = typeof p.osm_id === 'number' || typeof p.osm_id === 'string' ? String(p.osm_id) : undefined;
    const id = osmType && osmId ? `${osmType}${osmId}` : `${lon.toFixed(6)},${lat.toFixed(6)}`;
    if (seen.has(id)) continue;
    seen.add(id);

    const result: PlaceResult = { id, name, detail: parts.join(', '), lon, lat };
    const bbox = extentToBbox(p.extent);
    if (bbox) result.bbox = bbox;
    out.push(result);
  }
  return out;
}

/** Photon autocomplete. Caller debounces; pass an AbortSignal to cancel. */
export async function searchPlaces(q: string, opts?: { bias?: LngLat; lang?: string; signal?: AbortSignal }): Promise<PlaceResult[]> {
  const query = q.trim();
  if (!query) return [];
  const url = photonUrl(query, opts);
  const json = await photonQueue.run(() => fetchJson(url, { signal: opts?.signal }), opts?.signal);
  return mapPhotonFeatures(json);
}
