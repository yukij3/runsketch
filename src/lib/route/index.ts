// Waypoint-list operations and leg assembly (pure).
import type { LngLat, RouteLeg, WaySpan, Waypoint } from '../types';
import { pushWaySpan } from './ways';

export { WAY_TAG_KEYS, filterWayTags, parseWayTags, pushWaySpan, remapWays, validWays } from './ways';

let fallbackCounter = 0;

export function newWaypointId(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  fallbackCounter = (fallbackCounter + 1) % 1e9;
  return `wp-${Date.now().toString(36)}-${fallbackCounter.toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function samePoint(a: LngLat, b: LngLat): boolean {
  return a[0] === b[0] && a[1] === b[1];
}

/** A joined route: geometry, plus way tags when any leg carried them. */
export interface RouteLine {
  coords: LngLat[];
  /** Covers every segment; stretches of untagged legs, and joints between legs that do not touch, have tags ''. */
  ways?: WaySpan[];
}

/** Concatenate leg geometries, dropping duplicated joints (and any consecutive duplicate vertex), with their way tags. */
export function joinLegs(legs: RouteLeg[]): RouteLine {
  const coords: LngLat[] = [];
  const ways: WaySpan[] = [];
  let tagged = false;
  for (const leg of legs) {
    const spans = leg.ways;
    if (spans) tagged = true;
    let span = 0;
    leg.coords.forEach((p, i) => {
      if (coords.length === 0 || !samePoint(coords[coords.length - 1], p)) coords.push(p);
      if (spans) while (span < spans.length - 1 && spans[span].end < i) span++;
      // Vertex i closes the leg's segment i − 1; its first vertex closes the joint from the previous leg.
      pushWaySpan(ways, coords.length - 1, i > 0 && spans ? spans[span].tags : '');
    });
  }
  return tagged ? { coords, ways } : { coords };
}

// 1e-7° ≈ 1 cm: a waypoint placed back on the start counts as closed.
function sameLocation(a: Waypoint, b: Waypoint): boolean {
  return Math.abs(a.lon - b.lon) < 1e-7 && Math.abs(a.lat - b.lat) < 1e-7;
}

/** Append the first waypoint to the end (closed loop). No-op if already closed or < 2 points. */
export function closeLoop(wps: Waypoint[]): Waypoint[] {
  if (wps.length < 2) return wps.slice();
  const first = wps[0];
  if (sameLocation(first, wps[wps.length - 1])) return wps.slice();
  return [...wps, { id: newWaypointId(), lon: first.lon, lat: first.lat }];
}

/** Mirror the route back to the start: [a,b,c] → [a,b,c,b',a'] where primed points get new ids. */
export function outAndBack(wps: Waypoint[]): Waypoint[] {
  if (wps.length < 2) return wps.slice();
  const back = wps
    .slice(0, -1)
    .reverse()
    .map((w) => ({ id: newWaypointId(), lon: w.lon, lat: w.lat }));
  return [...wps, ...back];
}

export function reverseWaypoints(wps: Waypoint[]): Waypoint[] {
  return wps.slice().reverse();
}

function fixed6(x: number): string {
  // `|| 0` folds -0 into 0 so keys do not differ by sign of zero.
  return ((Math.round(x * 1e6) || 0) / 1e6).toFixed(6);
}

/** Key identifying a leg geometry request, for caching. */
export function legKey(a: LngLat, b: LngLat, profile: string): string {
  return `${profile}|${fixed6(a[0])},${fixed6(a[1])}|${fixed6(b[0])},${fixed6(b[1])}`;
}
