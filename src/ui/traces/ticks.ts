// Nice tick values for linear, clock (pace, elapsed) and distance axes.

const EPS = 1e-9;

/** Smallest 1·2·5·10^k step giving at most `maxTicks` intervals over `span`. */
export function niceStep(span: number, maxTicks: number): number {
  if (!(span > 0)) return 1;
  const raw = span / Math.max(1, maxTicks);
  const mag = 10 ** Math.floor(Math.log10(raw));
  for (const m of [1, 2, 5]) if (m * mag >= raw - EPS * mag) return m * mag;
  return 10 * mag;
}

function stepFrom(steps: readonly number[], span: number, maxTicks: number): number {
  const raw = span / Math.max(1, maxTicks);
  for (const s of steps) if (s >= raw) return s;
  return niceStep(span, maxTicks);
}

/** Multiples of `step` inside [lo, hi]. */
export function ticksWithStep(lo: number, hi: number, step: number): number[] {
  if (!(hi >= lo) || !(step > 0)) return [];
  const out: number[] = [];
  const start = Math.ceil(lo / step - EPS);
  const end = Math.floor(hi / step + EPS);
  for (let k = start; k <= end && out.length < 200; k++) out.push(Number((k * step).toPrecision(12)));
  return out;
}

export function linearTicks(lo: number, hi: number, maxTicks: number): number[] {
  if (!(hi > lo)) return Number.isFinite(lo) ? [lo] : [];
  return ticksWithStep(lo, hi, niceStep(hi - lo, maxTicks));
}

const CLOCK_STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 10800, 21600, 43200];

/** Tick values in seconds for clock-formatted axes (elapsed time, pace). */
export function clockTicks(lo: number, hi: number, maxTicks: number): number[] {
  if (!(hi > lo)) return Number.isFinite(lo) ? [lo] : [];
  return ticksWithStep(lo, hi, stepFrom(CLOCK_STEPS, hi - lo, maxTicks));
}

/** Decimals needed to print multiples of `step` without losing precision (max 3). */
export function decimalsFor(step: number): number {
  if (!(step > 0)) return 0;
  for (let d = 0; d <= 3; d++) if (Math.abs(Math.round(step * 10 ** d) - step * 10 ** d) < 1e-6) return d;
  return 3;
}
