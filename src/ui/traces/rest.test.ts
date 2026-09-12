import { describe, expect, it } from 'vitest';
import { CLIMB_END, CLIMB_START, syntheticResult } from './__fixtures__/synthetic';
import { findRestPoint, restPoint } from './rest';

describe('restPoint', () => {
  it('rests at the crest of the largest climb', () => {
    const rest = findRestPoint(syntheticResult())!;
    expect(rest.kind).toBe('crest');
    expect(rest.index).toBeGreaterThan(CLIMB_START);
    expect(Math.abs(rest.index - CLIMB_END)).toBeLessThanOrEqual(2);
  });

  it('rests at peak heart rate on a flat route and caches per result', () => {
    const flat = syntheticResult({ flat: true, stop: null });
    const rest = restPoint(flat)!;
    expect(rest.kind).toBe('peak');
    expect(flat.streams.hr[rest.index]).toBe(Math.max(...flat.streams.hr));
    expect(restPoint(flat)).toBe(rest);
    expect(restPoint(null)).toBeNull();
  });
});
