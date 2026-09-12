import { describe, expect, it } from 'vitest';
import { BIG_STEP_S, playheadForKey, STEP_S } from './keyboard';
import { indexAtPx, makeXScale, nearestIndex } from './scale';
import { clockTicks, decimalsFor, linearTicks, niceStep } from './ticks';

describe('nearestIndex', () => {
  it('finds the closest sample and prefers the earlier one on ties', () => {
    const v = [0, 10, 20, 30];
    expect(nearestIndex(v, 14)).toBe(1);
    expect(nearestIndex(v, 16)).toBe(2);
    expect(nearestIndex(v, 15)).toBe(1);
  });

  it('lands on the first second of a plateau (a stop on the distance axis)', () => {
    expect(nearestIndex([0, 3, 6, 6, 6, 6, 9], 6)).toBe(2);
  });

  it('clamps outside the domain and returns -1 when empty', () => {
    expect(nearestIndex([0, 1, 2], -5)).toBe(0);
    expect(nearestIndex([0, 1, 2], 50)).toBe(2);
    expect(nearestIndex([], 1)).toBe(-1);
  });
});

describe('x scale', () => {
  const t = Float64Array.from({ length: 601 }, (_, i) => i);

  it('maps samples to pixels over the domain', () => {
    const s = makeXScale(t, 'time', 300);
    expect(s.max).toBe(600);
    expect(s.px[0]).toBe(0);
    expect(s.px[300]).toBe(150);
    expect(s.px[600]).toBe(300);
  });

  it('maps pixel x back to the nearest sample index', () => {
    const s = makeXScale(t, 'time', 300);
    expect(indexAtPx(s, 0)).toBe(0);
    expect(indexAtPx(s, 150)).toBe(300);
    expect(indexAtPx(s, 75.4)).toBe(151);
    expect(indexAtPx(s, 300)).toBe(600);
    expect(indexAtPx(s, -20)).toBe(0);
    expect(indexAtPx(s, 9999)).toBe(600);
  });

  it('maps by distance with uneven spacing', () => {
    const dist = [0, 2, 5, 5, 5, 12, 20];
    const s = makeXScale(dist, 'distance', 200);
    expect(indexAtPx(s, (5 / 20) * 200)).toBe(2);
    expect(indexAtPx(s, (11 / 20) * 200)).toBe(5);
  });

  it('keeps a minimum span so a very short result does not stretch', () => {
    const s = makeXScale([0, 1, 2, 3, 4], 'time', 400, 10);
    expect(s.max).toBe(10);
    expect(s.px[4]).toBe(160);
    expect(indexAtPx(s, 400)).toBe(4);
  });

  it('survives a single-sample series', () => {
    const s = makeXScale([0], 'time', 400, 10);
    expect(indexAtPx(s, 200)).toBe(0);
  });
});

describe('ticks', () => {
  it('picks 1-2-5 steps', () => {
    expect(niceStep(10, 5)).toBe(2);
    expect(niceStep(7.3, 4)).toBe(2);
    expect(niceStep(0.9, 3)).toBeCloseTo(0.5);
  });

  it('lists multiples inside the range', () => {
    expect(linearTicks(132, 188, 3)).toEqual([140, 160, 180]);
  });

  it('uses clock steps for time and pace', () => {
    expect(clockTicks(0, 600, 6)).toEqual([0, 120, 240, 360, 480, 600]);
    expect(clockTicks(270, 420, 3)).toEqual([300, 360, 420]);
  });

  it('prints enough decimals for the step', () => {
    expect(decimalsFor(1)).toBe(0);
    expect(decimalsFor(0.5)).toBe(1);
    expect(decimalsFor(0.25)).toBe(2);
  });
});

describe('playheadForKey', () => {
  const n = 600;
  it('steps 10 s, or 60 s with Shift, clamped to the result', () => {
    expect(playheadForKey('ArrowRight', false, 100, n)).toBe(100 + STEP_S);
    expect(playheadForKey('ArrowLeft', false, 100, n)).toBe(100 - STEP_S);
    expect(playheadForKey('ArrowRight', true, 100, n)).toBe(100 + BIG_STEP_S);
    expect(playheadForKey('ArrowLeft', true, 30, n)).toBe(0);
    expect(playheadForKey('ArrowRight', true, 580, n)).toBe(599);
  });

  it('enters from the start or the finish when there is no playhead', () => {
    expect(playheadForKey('ArrowRight', false, null, n)).toBe(0);
    expect(playheadForKey('ArrowLeft', false, null, n)).toBe(599);
  });

  it('jumps with Home and End, clears with Escape, ignores other keys', () => {
    expect(playheadForKey('Home', false, 300, n)).toBe(0);
    expect(playheadForKey('End', false, 300, n)).toBe(599);
    expect(playheadForKey('Escape', false, 300, n)).toBeNull();
    expect(playheadForKey('a', false, 300, n)).toBeUndefined();
    expect(playheadForKey('ArrowRight', false, null, 0)).toBeUndefined();
  });
});
