// Imported tracks carry thousands of points; the editor wants a few dozen waypoints that keep the shape.
import type { LngLat } from '../lib/types';

type Segment = { i: number; j: number; k: number; dist: number };

/**
 * Ranked Douglas–Peucker: repeatedly keeps the point farthest from its current chord until `maxPoints`
 * are kept. Distances use a local equirectangular projection (metres), fine for route-sized extents.
 */
export function decimateTrack(coords: LngLat[], maxPoints: number): LngLat[] {
  const n = coords.length;
  const limit = Math.max(2, Math.floor(maxPoints));
  if (n <= limit) return coords.map((c) => [c[0], c[1]] as LngLat);

  const kx = 111_320 * Math.cos((coords[0][1] * Math.PI) / 180);
  const ky = 110_540;
  const xs = coords.map((c) => c[0] * kx);
  const ys = coords.map((c) => c[1] * ky);

  const farthest = (i: number, j: number): Segment => {
    const dx = xs[j] - xs[i];
    const dy = ys[j] - ys[i];
    const len2 = dx * dx + dy * dy;
    let best = i + 1;
    let bestDist = -1;
    for (let p = i + 1; p < j; p++) {
      let t = len2 > 0 ? ((xs[p] - xs[i]) * dx + (ys[p] - ys[i]) * dy) / len2 : 0;
      t = Math.max(0, Math.min(1, t));
      const ex = xs[i] + t * dx - xs[p];
      const ey = ys[i] + t * dy - ys[p];
      const d = ex * ex + ey * ey;
      if (d > bestDist) {
        bestDist = d;
        best = p;
      }
    }
    return { i, j, k: best, dist: bestDist };
  };

  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  let count = 2;
  const segments: Segment[] = [farthest(0, n - 1)];
  while (count < limit && segments.length > 0) {
    let top = 0;
    for (let s = 1; s < segments.length; s++) if (segments[s].dist > segments[top].dist) top = s;
    const { i, j, k } = segments[top];
    segments.splice(top, 1);
    keep[k] = 1;
    count++;
    if (k - i >= 2) segments.push(farthest(i, k));
    if (j - k >= 2) segments.push(farthest(k, j));
  }
  const out: LngLat[] = [];
  for (let p = 0; p < n; p++) if (keep[p]) out.push([coords[p][0], coords[p][1]]);
  return out;
}
