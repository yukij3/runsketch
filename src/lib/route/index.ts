// Waypoint-list operations and leg assembly (pure).
import type { LngLat, RouteLeg, Waypoint } from '../types';

const NI = (): never => { throw new Error('not implemented'); };

export function newWaypointId(): string { return NI(); }
/** Concatenate leg geometries, dropping duplicated joints. */
export function joinLegs(_legs: RouteLeg[]): LngLat[] { return NI(); }
/** Append the first waypoint to the end (closed loop). No-op if already closed or < 2 points. */
export function closeLoop(_wps: Waypoint[]): Waypoint[] { return NI(); }
/** Mirror the route back to the start. */
export function outAndBack(_wps: Waypoint[]): Waypoint[] { return NI(); }
export function reverseWaypoints(_wps: Waypoint[]): Waypoint[] { return NI(); }
/** Key identifying a leg geometry request, for caching. */
export function legKey(_a: LngLat, _b: LngLat, _profile: string): string { return NI(); }
