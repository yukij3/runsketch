// SVG path strings from decimated series.
import type { Decimated } from './decimate';
import type { Domain } from './series';

export type YMap = (v: number) => number;

const r1 = (v: number) => Math.round(v * 10) / 10;

/** Linear y mapping into a panel box, `inset` px kept clear at top and bottom. Inverted puts lo at the top. */
export function linearY(domain: Domain, top: number, height: number, inverted = false, inset = 3): YMap {
  const span = domain.hi - domain.lo || 1;
  const usable = Math.max(1, height - 2 * inset);
  const y0 = top + inset;
  return inverted
    ? (v) => y0 + ((v - domain.lo) / span) * usable
    : (v) => y0 + usable - ((v - domain.lo) / span) * usable;
}

/** Polyline; NaN entries lift the pen. Single isolated points are dropped (no zero-length segments). */
export function linePath(d: Decimated, y: YMap): string {
  const parts: string[] = [];
  let runLen = 0;
  let pending = '';
  for (let k = 0; k < d.x.length; k++) {
    const x = d.x[k];
    const v = d.y[k];
    if (!Number.isFinite(x) || !Number.isFinite(v)) {
      runLen = 0;
      pending = '';
      continue;
    }
    const py = y(v);
    if (!Number.isFinite(py)) continue;
    const pt = `${r1(x)} ${r1(py)}`;
    if (runLen === 0) pending = `M${pt}`;
    else {
      if (runLen === 1) parts.push(pending);
      parts.push(`L${pt}`);
    }
    runLen++;
  }
  return parts.join('');
}

/** Filled area from each contiguous run down to `baseY`. */
export function areaPath(d: Decimated, y: YMap, baseY: number): string {
  const parts: string[] = [];
  let run: string[] = [];
  let firstX = 0;
  let lastX = 0;
  const close = () => {
    if (run.length >= 2) parts.push(`M${r1(firstX)} ${r1(baseY)}${run.join('')}L${r1(lastX)} ${r1(baseY)}Z`);
    run = [];
  };
  for (let k = 0; k < d.x.length; k++) {
    const x = d.x[k];
    const v = d.y[k];
    const py = Number.isFinite(v) ? y(v) : Number.NaN;
    if (!Number.isFinite(x) || !Number.isFinite(py)) {
      close();
      continue;
    }
    if (run.length === 0) firstX = x;
    lastX = x;
    run.push(`L${r1(x)} ${r1(py)}`);
  }
  close();
  return parts.join('');
}

/** Closed polygon forward along `a` and back along `b` (the band between two lines). */
export function bandPath(a: Decimated, b: Decimated, y: YMap): string {
  const pts: string[] = [];
  for (let k = 0; k < a.x.length; k++) {
    if (Number.isFinite(a.x[k]) && Number.isFinite(a.y[k])) pts.push(`${r1(a.x[k])} ${r1(y(a.y[k]))}`);
  }
  for (let k = b.x.length - 1; k >= 0; k--) {
    if (Number.isFinite(b.x[k]) && Number.isFinite(b.y[k])) pts.push(`${r1(b.x[k])} ${r1(y(b.y[k]))}`);
  }
  return pts.length >= 3 ? `M${pts.join('L')}Z` : '';
}
