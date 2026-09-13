import { describe, expect, it } from 'vitest';
import { ascentDescent, ascentIncrements } from './ascent';

const sum = (a: Float64Array) => a.reduce((s, v) => s + v, 0);

/** Deterministic noise in [-1, 1]. */
function lcg(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return (s / 2 ** 32) * 2 - 1;
  };
}

describe('ascentDescent', () => {
  it('counts swings between turning points once they reach the threshold', () => {
    expect(ascentDescent([0, 2, 0, 2, 0, 2], 3)).toEqual({ ascent: 0, descent: 0 });
    expect(ascentDescent([0, 10, 5, 20, 0], 3)).toEqual({ ascent: 25, descent: 25 });
    expect(ascentDescent([100, 98, 110, 105, 107, 90, 91, 95], 3)).toEqual({ ascent: 17, descent: 20 });
    expect(ascentDescent([5], 3)).toEqual({ ascent: 0, descent: 0 });
  });

  it('honours a sample count shorter than the array', () => {
    expect(ascentDescent([0, 10, 0, 50], 3, 3)).toEqual({ ascent: 10, descent: 10 });
  });
});

describe('ascentIncrements', () => {
  it('places each increment where the elevation reaches a new high or low within its leg', () => {
    const ele = Float64Array.from([100, 98, 110, 105, 107, 90, 91, 95]);
    const { up, down } = ascentIncrements(ele, ele.length, 3);
    expect(Array.from(up)).toEqual([0, 0, 12, 0, 0, 0, 1, 4]);
    expect(Array.from(down)).toEqual([0, 0, 0, 5, 0, 15, 0, 0]);
  });

  it('adds up to the totals on a noisy climb, and agrees across sampling rates', () => {
    const rnd = lcg(3);
    // 3 km at 3 %, then 1 km down at 4 %, with ±1.5 m of wander.
    const truth = (d: number) => (d < 3000 ? 0.03 * d : 90 - 0.04 * (d - 3000));
    const at5m = Float64Array.from({ length: 801 }, (_, i) => truth(i * 5) + 1.5 * rnd());
    const at1Hz = Float64Array.from({ length: 1334 }, (_, i) => truth(i * 3) + 1.5 * rnd());
    const coarse = ascentDescent(at5m);
    const { up, down } = ascentIncrements(at1Hz);
    const fine = ascentDescent(at1Hz);
    expect(sum(up)).toBeCloseTo(fine.ascent, 9);
    expect(sum(down)).toBeCloseTo(fine.descent, 9);
    expect(Math.abs(coarse.ascent - fine.ascent)).toBeLessThan(3);
    expect(Math.abs(fine.ascent - 90)).toBeLessThan(6);
    expect(Math.abs(fine.descent - 40)).toBeLessThan(6);
  });
});
