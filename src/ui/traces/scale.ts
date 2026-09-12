// Shared horizontal scale (distance or elapsed time) and pixel → sample index mapping.

export type XAxis = 'distance' | 'time';

export interface XScale {
  axis: XAxis;
  /** Domain maximum in SI units (metres or seconds); the domain always starts at 0. */
  max: number;
  /** Plot width, px. */
  width: number;
  /** Per-sample x in plot pixels. */
  px: Float64Array;
  /** Per-sample domain value (non-decreasing). */
  values: ArrayLike<number>;
}

export function makeXScale(values: ArrayLike<number>, axis: XAxis, width: number, minSpan = 1): XScale {
  const n = values.length;
  const last = n > 0 ? values[n - 1] : 0;
  const max = Math.max(minSpan, Number.isFinite(last) ? last : 0, 1e-9);
  const w = Math.max(1, width);
  const k = w / max;
  const px = new Float64Array(n);
  for (let i = 0; i < n; i++) px[i] = values[i] * k;
  return { axis, max, width: w, px, values };
}

/** First index whose value is ≥ v (n when none). `values` must be non-decreasing. */
export function lowerBound(values: ArrayLike<number>, v: number): number {
  let lo = 0;
  let hi = values.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (values[mid] < v) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Sample nearest to domain value v; ties go to the earlier sample. On a plateau (a stop on the
 * distance axis) this lands on the first second of the plateau. -1 for an empty series.
 */
export function nearestIndex(values: ArrayLike<number>, v: number): number {
  const n = values.length;
  if (n === 0) return -1;
  const lb = lowerBound(values, v);
  if (lb >= n) return n - 1;
  if (lb === 0) return 0;
  return v - values[lb - 1] <= values[lb] - v ? lb - 1 : lb;
}

/** Plot-pixel x → sample index, clamped to the plot. */
export function indexAtPx(scale: XScale, x: number): number {
  const clamped = Math.min(scale.width, Math.max(0, Number.isFinite(x) ? x : 0));
  return nearestIndex(scale.values, (clamped / scale.width) * scale.max);
}

export function toPx(scale: XScale, value: number): number {
  return (value / scale.max) * scale.width;
}
