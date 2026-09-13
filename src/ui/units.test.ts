import { describe, expect, it } from 'vitest';
import { parseDateTimeLocal, toDateTimeLocal, windFromDisplay, windToDisplay } from './units';

describe('units', () => {
  it('shows a start at a fixed offset, independent of the browser zone', () => {
    expect(toDateTimeLocal(Date.UTC(2026, 8, 13, 4, 30), 120)).toBe('2026-09-13T06:30');
    expect(toDateTimeLocal(Date.UTC(2026, 8, 13, 23, 50), 345)).toBe('2026-09-14T05:35');
    expect(toDateTimeLocal(Date.UTC(2026, 0, 1, 2, 0), -300)).toBe('2025-12-31T21:00');
  });

  it('reads datetime-local values into wall-clock parts', () => {
    expect(parseDateTimeLocal('2026-03-29T02:30')).toEqual({ year: 2026, month: 3, day: 29, hour: 2, minute: 30 });
    expect(parseDateTimeLocal('')).toBeNull();
    expect(parseDateTimeLocal('2026-13-01T00:00')).toBeNull();
  });

  it('converts wind for display', () => {
    expect(windToDisplay(10, 'metric')).toBeCloseTo(36, 9);
    expect(windToDisplay(10, 'imperial')).toBeCloseTo(22.369, 3);
    expect(windFromDisplay(windToDisplay(4.2, 'imperial'), 'imperial')).toBeCloseTo(4.2, 9);
  });
});
