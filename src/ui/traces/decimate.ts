// Min/max bucket decimation: at most two vertices per pixel column, so a six-hour 1 Hz trace
// (21 600 samples) draws as ~2·width vertices without losing a single peak or trough.

export interface Decimated {
  /** Pixel x. NaN in both arrays marks a gap (pen up). */
  x: number[];
  y: number[];
}

/**
 * `xPx` must be non-decreasing over [from, to). Non-finite y values break the line.
 * Per bucket of `bucketPx` pixels the minimum and maximum are emitted in sample order; the first
 * and last finite sample of every contiguous run are kept so line ends sit exactly on the data.
 */
export function decimateMinMax(
  xPx: ArrayLike<number>,
  y: ArrayLike<number>,
  from = 0,
  to = Math.min(xPx.length, y.length),
  bucketPx = 1,
): Decimated {
  const out: Decimated = { x: [], y: [] };
  const lo = Math.max(0, from);
  const hi = Math.min(to, xPx.length, y.length);
  const width = bucketPx > 0 ? bucketPx : 1;

  let bucket = Number.NaN;
  let minI = -1;
  let maxI = -1;
  let lastI = -1;
  let lastEmitted = -1;
  let runOpen = false;

  const push = (i: number) => {
    if (i <= lastEmitted) return;
    out.x.push(xPx[i]);
    out.y.push(y[i]);
    lastEmitted = i;
  };
  const flush = () => {
    if (minI >= 0) {
      push(Math.min(minI, maxI));
      push(Math.max(minI, maxI));
    }
    minI = -1;
    maxI = -1;
  };
  const endRun = () => {
    flush();
    if (!runOpen) return;
    push(lastI);
    out.x.push(Number.NaN);
    out.y.push(Number.NaN);
    runOpen = false;
  };

  for (let i = lo; i < hi; i++) {
    const v = y[i];
    const px = xPx[i];
    if (!Number.isFinite(v) || !Number.isFinite(px)) {
      endRun();
      continue;
    }
    const b = Math.floor(px / width);
    if (b !== bucket) {
      flush();
      bucket = b;
    }
    if (!runOpen) {
      runOpen = true;
      push(i);
    }
    if (minI < 0 || v < y[minI]) minI = i;
    if (maxI < 0 || v > y[maxI]) maxI = i;
    lastI = i;
  }
  endRun();

  const last = out.x.length - 1;
  if (last >= 0 && Number.isNaN(out.x[last])) {
    out.x.pop();
    out.y.pop();
  }
  return out;
}
