import { describe, expect, it } from 'vitest';
import { decimateMinMax } from './decimate';

/** Deterministic spiky series: slow wave, fast ripple and isolated spikes. */
function series(n: number): Float64Array {
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    y[i] = 50 * Math.sin(i / 400) + 5 * Math.sin(i * 1.3) + (i % 997 === 0 ? 40 : 0) - (i % 1231 === 0 ? 35 : 0);
  }
  return y;
}

function pixels(n: number, width: number): Float64Array {
  const px = new Float64Array(n);
  for (let i = 0; i < n; i++) px[i] = (i / (n - 1)) * width;
  return px;
}

describe('decimateMinMax', () => {
  const n = 20_000;
  const width = 300;
  const y = series(n);
  const px = pixels(n, width);
  const out = decimateMinMax(px, y);

  it('keeps about two points per pixel', () => {
    expect(out.x.length).toBeLessThanOrEqual(2 * (width + 1) + 2);
    expect(out.x.length).toBeGreaterThan(width);
  });

  it('keeps the global extrema', () => {
    let min = Infinity;
    let max = -Infinity;
    for (const v of y) {
      min = Math.min(min, v);
      max = Math.max(max, v);
    }
    expect(Math.min(...out.y)).toBe(min);
    expect(Math.max(...out.y)).toBe(max);
  });

  it('keeps the minimum and maximum of every pixel bucket', () => {
    const buckets = new Map<number, { min: number; max: number }>();
    for (let i = 0; i < n; i++) {
      const b = Math.floor(px[i]);
      const cur = buckets.get(b) ?? { min: Infinity, max: -Infinity };
      cur.min = Math.min(cur.min, y[i]);
      cur.max = Math.max(cur.max, y[i]);
      buckets.set(b, cur);
    }
    const kept = new Map<number, number[]>();
    out.x.forEach((x, k) => {
      const b = Math.floor(x);
      kept.set(b, [...(kept.get(b) ?? []), out.y[k]]);
    });
    for (const [b, { min, max }] of buckets) {
      expect(kept.get(b)).toContain(min);
      expect(kept.get(b)).toContain(max);
    }
  });

  it('emits points in x order and keeps the first and last sample', () => {
    for (let k = 1; k < out.x.length; k++) expect(out.x[k]).toBeGreaterThanOrEqual(out.x[k - 1]);
    expect(out.x[0]).toBe(px[0]);
    expect(out.y[0]).toBe(y[0]);
    expect(out.x[out.x.length - 1]).toBe(px[n - 1]);
    expect(out.y[out.y.length - 1]).toBe(y[n - 1]);
  });

  it('breaks the line at non-finite values without leading or trailing breaks', () => {
    const ys = [Number.NaN, 1, 2, 3, Number.NaN, Number.NaN, 7, 8, Number.NaN];
    const xs = [0, 10, 20, 30, 40, 50, 60, 70, 80];
    const d = decimateMinMax(xs, ys);
    expect(d.x).toEqual([10, 20, 30, Number.NaN, 60, 70]);
    expect(d.y).toEqual([1, 2, 3, Number.NaN, 7, 8]);
  });

  it('returns every sample when there are fewer samples than pixels', () => {
    const d = decimateMinMax([0, 5, 10, 15], [3, 1, 4, 1]);
    expect(d.y).toEqual([3, 1, 4, 1]);
  });

  it('respects the [from, to) range', () => {
    const d = decimateMinMax([0, 1, 2, 3, 4, 5], [9, 8, 7, 6, 5, 4], 2, 4);
    expect(d.x).toEqual([2, 3]);
    expect(d.y).toEqual([7, 6]);
  });

  it('handles empty input', () => {
    expect(decimateMinMax([], [])).toEqual({ x: [], y: [] });
  });
});
