// OSM way tags along route geometry: which keys are kept, and how tag spans follow vertex edits and leg joins.
import type { WaySpan } from '../types';

/**
 * Way tag keys kept from router responses; everything else (access, oneway, cycle lanes, route relations) is dropped
 * before a leg is stored. Terrain reads these (see WAY_TAG_RULES); add a key here when a rule needs it.
 */
export const WAY_TAG_KEYS: ReadonlySet<string> = new Set([
  'highway',
  'surface',
  'tracktype',
  'smoothness',
  'sac_scale',
  'trail_visibility',
  'mtb:scale',
  'mtb:scale:uphill',
  'via_ferrata_scale',
  'natural',
  'incline',
  'bridge',
  'tunnel',
  'layer',
  'man_made',
  'embankment',
  'cutting',
  'ford',
]);

/** Keeps the WAY_TAG_KEYS pairs of a space-separated `key=value` list, in their original order. */
export function filterWayTags(raw: string): string {
  return raw
    .split(/\s+/)
    .filter((kv) => {
      const eq = kv.indexOf('=');
      return eq > 0 && WAY_TAG_KEYS.has(kv.slice(0, eq));
    })
    .join(' ');
}

/** `key=value` pairs as a map; a repeated key keeps its last value. */
export function parseWayTags(tags: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const kv of tags.split(/\s+/)) {
    const eq = kv.indexOf('=');
    if (eq > 0) out.set(kv.slice(0, eq), kv.slice(eq + 1));
  }
  return out;
}

/** Appends a span ending at vertex `end`, merged into the previous span when the tags match; empty spans are skipped. */
export function pushWaySpan(spans: WaySpan[], end: number, tags: string): void {
  const last = spans[spans.length - 1];
  if (end <= (last ? last.end : 0)) return;
  if (last && last.tags === tags) last.end = end;
  else spans.push({ end, tags });
}

/** Spans for a line whose vertices were renumbered (duplicates dropped): old vertex i is now vertex `index[i]`. */
export function remapWays(ways: readonly WaySpan[], index: ArrayLike<number>): WaySpan[] {
  const out: WaySpan[] = [];
  for (const w of ways) pushWaySpan(out, index[w.end], w.tags);
  return out;
}

/** True when `ways` is a well-formed span list for a line of `vertexCount` vertices. */
export function validWays(ways: unknown, vertexCount: number): ways is WaySpan[] {
  if (!Array.isArray(ways) || ways.length === 0) return false;
  let prev = 0;
  for (const w of ways) {
    if (!w || typeof w !== 'object') return false;
    const { end, tags } = w as Partial<WaySpan>;
    if (typeof end !== 'number' || !Number.isInteger(end) || end <= prev || typeof tags !== 'string') return false;
    prev = end;
  }
  return prev === vertexCount - 1;
}
