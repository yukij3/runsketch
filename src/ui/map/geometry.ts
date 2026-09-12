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

export interface TickProps {
  /** Whole units along the route: "1", "2", … */
  label: string;
  /** Label as drawn, with its unit: "1 km". */
  text: string;
  /** Degrees clockwise from north of the route at the tick; the hairline is drawn across it. */
  rotate: number;
  /** Label offset in ems, to the right of travel and clear of the hairline. */
  offset: [number, number];
}

/** Metres either side of a tick used to read the route direction. */
const BEARING_SPAN_M = 12;

/** Screen bearing (degrees clockwise from north) from a to b, on a local equirectangular plane. */
function bearing(a: LngLat, b: LngLat): number {
  const k = Math.cos((((a[1] + b[1]) / 2) * Math.PI) / 180);
  const deg = (Math.atan2((b[0] - a[0]) * k, b[1] - a[1]) * 180) / Math.PI;
  return Number.isFinite(deg) ? deg : 0;
}

/**
 * Distance ticks every `step` metres ("1 km", "2 km", …), thinned on long routes; none at the finish.
 * Each is a hairline across the route with its label beside it, so it never reads as a waypoint handle.
 */
export function distanceTicks(coords: LngLat[] | null, step: number, unit = ''): FeatureCollection<Point, TickProps> {
  const features: Array<Feature<Point, TickProps>> = [];
  if (coords && coords.length >= 2 && step > 0) {
    const cum = cumulativeDistances(coords);
    const total = cum[cum.length - 1];
    const count = Math.floor(total / step - 1e-6);
    const every = count > 100 ? 10 : count > 40 ? 5 : 1;
    for (let k = every; k <= count; k += every) {
      const d = k * step;
      const p = interpolateAlong(coords, cum, d);
      const rotate = bearing(interpolateAlong(coords, cum, d - BEARING_SPAN_M), interpolateAlong(coords, cum, d + BEARING_SPAN_M));
      const rad = (rotate * Math.PI) / 180;
      // Right of travel on screen is (cos θ, sin θ); a horizontal offset needs extra room for the label's half-width.
      const r = 1.5 + 1.0 * Math.abs(Math.cos(rad));
      const offset: [number, number] = [Math.round(Math.cos(rad) * r * 100) / 100, Math.round(Math.sin(rad) * r * 100) / 100];
      const label = String(k);
      features.push({
        type: 'Feature',
        properties: { label, text: unit ? `${label} ${unit}` : label, rotate: Math.round(rotate), offset },
        geometry: { type: 'Point', coordinates: p },
      });
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

/** A screen point in CSS pixels. */
export type ScreenPoint = [number, number];

export interface LabelObstacles {
  /** Route polylines already projected to the screen. */
  lines: ReadonlyArray<ReadonlyArray<ScreenPoint>>;
  /** Round markers drawn over the map (waypoint handles, the playhead) with their radius in px. */
  discs: ReadonlyArray<{ at: ScreenPoint; r: number }>;
}

interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Tick label text size in px; offsets are expressed in ems of this size. */
export const TICK_TEXT_PX = 11;
/** Half the drawn tick hairline, casing included. */
const TICK_HALF_PX = 10;
/** Half the widest route stroke (casing) plus a hair of paper. */
const ROUTE_CLEAR_PX = 7;
const DISC_CLEAR_PX = 3;
const LABEL_CLEAR_PX = 4;
const SEARCH_PX = 90;
/** Right of travel first, then left, then diagonals: a label beside its hairline reads as the tick's. */
const ANGLES = [0, 180, 30, -30, 150, -150, 60, -60, 120, -120];

function pointBoxDist(px: number, py: number, b: Box): number {
  const dx = Math.max(b.x0 - px, 0, px - b.x1);
  const dy = Math.max(b.y0 - py, 0, py - b.y1);
  return Math.hypot(dx, dy);
}

function pointSegDist(px: number, py: number, a: ScreenPoint, b: ScreenPoint): number {
  const vx = b[0] - a[0];
  const vy = b[1] - a[1];
  const len = vx * vx + vy * vy;
  const t = len > 0 ? Math.max(0, Math.min(1, ((px - a[0]) * vx + (py - a[1]) * vy) / len)) : 0;
  return Math.hypot(px - (a[0] + t * vx), py - (a[1] + t * vy));
}

function segmentsCross(a: ScreenPoint, b: ScreenPoint, c: ScreenPoint, d: ScreenPoint): boolean {
  const cross = (o: ScreenPoint, p: ScreenPoint, q: ScreenPoint) => (p[0] - o[0]) * (q[1] - o[1]) - (p[1] - o[1]) * (q[0] - o[0]);
  const d1 = cross(c, d, a);
  const d2 = cross(c, d, b);
  const d3 = cross(a, b, c);
  const d4 = cross(a, b, d);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/** Distance from a segment to a box; zero when it touches or crosses it. */
export function segmentBoxDist(a: ScreenPoint, b: ScreenPoint, box: Box): number {
  const inside = (p: ScreenPoint) => p[0] >= box.x0 && p[0] <= box.x1 && p[1] >= box.y0 && p[1] <= box.y1;
  if (inside(a) || inside(b)) return 0;
  const corners: ScreenPoint[] = [
    [box.x0, box.y0],
    [box.x1, box.y0],
    [box.x1, box.y1],
    [box.x0, box.y1],
  ];
  for (let k = 0; k < 4; k++) if (segmentsCross(a, b, corners[k], corners[(k + 1) % 4])) return 0;
  return Math.min(pointBoxDist(a[0], a[1], box), pointBoxDist(b[0], b[1], box), ...corners.map((c) => pointSegDist(c[0], c[1], a, b)));
}

function boxGap(a: Box, b: Box): number {
  return Math.hypot(Math.max(0, a.x0 - b.x1, b.x0 - a.x1), Math.max(0, a.y0 - b.y1, b.y0 - a.y1));
}

/** Rough width of a tick label in the map's sans at TICK_TEXT_PX, halo included. */
function labelSize(text: string): [number, number] {
  let w = 0;
  for (const ch of text) w += ch === ' ' ? 3 : /[0-9]/.test(ch) ? 6.3 : /[mw]/i.test(ch) ? 9.5 : 6;
  return [w + 4, TICK_TEXT_PX + 5];
}

/**
 * Moves each distance label to the nearest spot, in screen space, that clears the route line, every
 * tick hairline, the round markers and the labels already placed. Right of travel is tried first.
 */
export function placeTickLabels(
  ticks: FeatureCollection<Point, TickProps>,
  anchors: ReadonlyArray<ScreenPoint>,
  obstacles: LabelObstacles,
): FeatureCollection<Point, TickProps> {
  const bars = ticks.features.map((f, k): [ScreenPoint, ScreenPoint] => {
    const rad = (f.properties.rotate * Math.PI) / 180;
    const [x, y] = anchors[k];
    const ux = Math.cos(rad) * TICK_HALF_PX;
    const uy = Math.sin(rad) * TICK_HALF_PX;
    return [
      [x - ux, y - uy],
      [x + ux, y + uy],
    ];
  });
  const placed: Box[] = [];

  const features = ticks.features.map((f, k) => {
    const [ax, ay] = anchors[k];
    if (!Number.isFinite(ax) || !Number.isFinite(ay)) return f;
    const [w, h] = labelSize(f.properties.text);
    const near = (p: ScreenPoint) => Math.abs(p[0] - ax) < SEARCH_PX && Math.abs(p[1] - ay) < SEARCH_PX;
    // A long straight leg can pass the tick with both ends far away: test the segment's box, not its ends.
    const nearSegment = (a: ScreenPoint, b: ScreenPoint) =>
      Math.min(a[0], b[0]) < ax + SEARCH_PX &&
      Math.max(a[0], b[0]) > ax - SEARCH_PX &&
      Math.min(a[1], b[1]) < ay + SEARCH_PX &&
      Math.max(a[1], b[1]) > ay - SEARCH_PX;
    const segments: Array<[ScreenPoint, ScreenPoint]> = [];
    for (const line of obstacles.lines) {
      for (let i = 1; i < line.length; i++) if (nearSegment(line[i - 1], line[i])) segments.push([line[i - 1], line[i]]);
    }
    const discs = obstacles.discs.filter((d) => near(d.at));

    const clearance = (box: Box) => {
      let c = Infinity;
      for (const [a, b] of segments) c = Math.min(c, segmentBoxDist(a, b, box) - ROUTE_CLEAR_PX);
      for (const [a, b] of bars) c = Math.min(c, segmentBoxDist(a, b, box) - 2);
      for (const d of discs) c = Math.min(c, pointBoxDist(d.at[0], d.at[1], box) - d.r - DISC_CLEAR_PX);
      for (const p of placed) c = Math.min(c, boxGap(p, box) - LABEL_CLEAR_PX);
      return c;
    };

    const base = (f.properties.rotate * Math.PI) / 180;
    let best: { dx: number; dy: number; box: Box; c: number } | null = null;
    search: for (let extra = 3; extra <= 42; extra += 3) {
      for (const angle of ANGLES) {
        const rad = base + (angle * Math.PI) / 180;
        const ux = Math.cos(rad);
        const uy = Math.sin(rad);
        const reach = (w / 2) * Math.abs(ux) + (h / 2) * Math.abs(uy) + extra;
        const dx = ux * reach;
        const dy = uy * reach;
        const box = { x0: ax + dx - w / 2, y0: ay + dy - h / 2, x1: ax + dx + w / 2, y1: ay + dy + h / 2 };
        const c = clearance(box);
        if (!best || c > best.c) best = { dx, dy, box, c };
        if (c >= 0) break search;
      }
    }
    if (!best) return f;
    placed.push(best.box);
    const offset: [number, number] = [Math.round((best.dx / TICK_TEXT_PX) * 100) / 100, Math.round((best.dy / TICK_TEXT_PX) * 100) / 100];
    return { ...f, properties: { ...f.properties, offset } };
  });
  return { type: 'FeatureCollection', features };
}
