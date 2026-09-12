// Undo/redo over waypoint lists (pure).
import type { Waypoint } from '../lib/types';
import { HISTORY_LIMIT } from './config';

export interface WaypointHistory {
  waypoints: Waypoint[];
  past: Waypoint[][];
  future: Waypoint[][];
}

export function commit(h: WaypointHistory, next: Waypoint[], limit = HISTORY_LIMIT): WaypointHistory {
  if (next === h.waypoints) return h;
  const past = [...h.past, h.waypoints];
  return { waypoints: next, past: past.length > limit ? past.slice(past.length - limit) : past, future: [] };
}

export function undo(h: WaypointHistory): WaypointHistory {
  if (h.past.length === 0) return h;
  const prev = h.past[h.past.length - 1];
  return { waypoints: prev, past: h.past.slice(0, -1), future: [h.waypoints, ...h.future] };
}

export function redo(h: WaypointHistory): WaypointHistory {
  if (h.future.length === 0) return h;
  const [next, ...rest] = h.future;
  return { waypoints: next, past: [...h.past, h.waypoints], future: rest };
}
