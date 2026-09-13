import { describe, expect, it } from 'vitest';
import { isTimeZone, sunElevationDeg, wallClock, wallToEpoch, zoneOffsetMin } from './time';

describe('route time zone', () => {
  it('offsets follow daylight saving on the date asked, not today', () => {
    expect(zoneOffsetMin('Europe/Zurich', Date.UTC(2026, 0, 10, 12))).toBe(60);
    expect(zoneOffsetMin('Europe/Zurich', Date.UTC(2026, 6, 10, 12))).toBe(120);
    expect(zoneOffsetMin('Asia/Kathmandu', Date.UTC(2026, 0, 10, 12))).toBe(345);
    expect(zoneOffsetMin('America/New_York', Date.UTC(2026, 0, 10, 12))).toBe(-300);
    expect(zoneOffsetMin('Not/AZone', Date.UTC(2026, 0, 10, 12))).toBe(0);
    expect(isTimeZone('Europe/Moscow')).toBe(true);
    expect(isTimeZone('Mars/Olympus')).toBe(false);
    expect(isTimeZone('')).toBe(false);
  });

  it('wall clock at the route converts to epoch, moving through the spring gap and taking the later autumn hour', () => {
    expect(wallToEpoch('Europe/Zurich', 2026, 8, 15, 6, 0)).toBe(Date.UTC(2026, 7, 15, 4, 0));
    expect(wallToEpoch('Europe/Zurich', 2026, 3, 29, 2, 30)).toBe(Date.UTC(2026, 2, 29, 1, 30));
    expect(wallToEpoch('Europe/Zurich', 2026, 10, 25, 2, 30)).toBe(Date.UTC(2026, 9, 25, 1, 30));
    const start = wallToEpoch('Asia/Kathmandu', 2026, 11, 3, 4, 30);
    expect(wallClock(start, zoneOffsetMin('Asia/Kathmandu', start))).toEqual({ year: 2026, month: 11, day: 3, hour: 4, minute: 30 });
  });
});

describe('sun elevation', () => {
  it('Lausanne sunrise on 2026-09-14 at 07:09+02:00 (refraction and disc put the centre 0.83° below the horizon)', () => {
    const sunrise = Date.UTC(2026, 8, 14, 5, 9) / 1000;
    expect(sunElevationDeg(46.52, 6.63, sunrise)).toBeCloseTo(-0.83, 0);
    expect(sunElevationDeg(46.52, 6.63, sunrise - 180)).toBeLessThan(sunElevationDeg(46.52, 6.63, sunrise + 180));
  });

  it('Zermatt on 2026-08-15: below the horizon at 06:00 CEST, near 35° at 10:00, and highest near solar noon', () => {
    const at = (h: number, m = 0) => sunElevationDeg(45.98, 7.7, Date.UTC(2026, 7, 15, h - 2, m) / 1000);
    expect(at(6)).toBeLessThan(-3);
    expect(at(10)).toBeGreaterThan(32);
    expect(at(10)).toBeLessThan(38);
    expect(at(13, 25)).toBeGreaterThan(at(11));
    expect(at(13, 25)).toBeGreaterThan(at(16));
  });
});
