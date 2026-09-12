// Pure GeoJSON builders for the map plate.
import type { Feature, FeatureCollection, LineString, Point } from 'geojson';
import { neededLegs } from '../../app/pipeline';
import { cumulativeDistances, interpolateAlong } from '../../lib/geo';
import type { ActivityStreams, LngLat, RouteLeg, SnapProfile, Waypoint } from '../../lib/types';

export type LegKind = 'routed' | 'straight' | 'fallback' | 'pending';

export interface DragOverride {
  id: string;
  lon: number;
  lat: number;
}

/** One LineString per leg; legs touching a dragged waypoint are drawn as pending straight lines. */
export function routeFeatures(
  waypoints: Waypoint[],
  profile: SnapProfile,
  legs: ReadonlyMap<string, RouteLeg>,
  drag?: DragOverride,
): FeatureCollection<LineString, { kind: LegKind }> {
  const wps = drag ? waypoints.map((w) => (w.id === drag.id ? { ...w, lon: drag.lon, lat: drag.lat } : w)) : waypoints;
  const features = neededLegs(wps, profile).map((n): Feature<LineString, { kind: LegKind }> => {
    const touched = drag !== undefined && (n.from.id === drag.id || n.to.id === drag.id);
    const leg = touched ? undefined : legs.get(n.key);
    const kind: LegKind = !leg ? 'pending' : leg.fallback ? 'fallback' : leg.provider === 'straight' ? 'straight' : 'routed';
    const coordinates: LngLat[] =
      leg && leg.coords.length >= 2
        ? leg.coords
        : [
            [n.from.lon, n.from.lat],
            [n.to.lon, n.to.lat],
          ];
    return { type: 'Feature', properties: { kind }, geometry: { type: 'LineString', coordinates } };
  });
  return { type: 'FeatureCollection', features };
}

/** Labelled points every `step` metres ("1", "2", …), thinned on long routes; none at the finish. */
export function distanceTicks(coords: LngLat[] | null, step: number): FeatureCollection<Point, { label: string }> {
  const features: Array<Feature<Point, { label: string }>> = [];
  if (coords && coords.length >= 2 && step > 0) {
    const cum = cumulativeDistances(coords);
    const total = cum[cum.length - 1];
    const count = Math.floor(total / step - 1e-6);
    const every = count > 100 ? 10 : count > 40 ? 5 : 1;
    for (let k = every; k <= count; k += every) {
      const p = interpolateAlong(coords, cum, k * step);
      features.push({ type: 'Feature', properties: { label: String(k) }, geometry: { type: 'Point', coordinates: p } });
    }
  }
  return { type: 'FeatureCollection', features };
}

/** Index of the recorded sample closest to a map position (coarse pass, then local refinement). */
export function nearestSample(streams: Pick<ActivityStreams, 'lat' | 'lon'>, lon: number, lat: number): number {
  const n = streams.lat.length;
  if (n === 0) return -1;
  const k = Math.cos((lat * Math.PI) / 180);
  const dist = (i: number) => {
    const dx = (streams.lon[i] - lon) * k;
    const dy = streams.lat[i] - lat;
    return dx * dx + dy * dy;
  };
  const stride = Math.max(1, Math.floor(n / 4000));
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < n; i += stride) {
    const d = dist(i);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  for (let i = Math.max(0, best - stride); i <= Math.min(n - 1, best + stride); i++) {
    const d = dist(i);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}
