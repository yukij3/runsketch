import { describe, expect, it } from 'vitest';
import {
  BODY_WIND_FACTOR,
  WIND_2M_FACTOR,
  airDensityMoist,
  dewPointFromHumidity,
  freshSnowDensity,
  globeTemperature,
  pressureAtHeight,
  relativeHumidity,
  scaleHeight,
  snowShare,
  standardPressure,
  vapourPressureHpa,
  wbgt,
  wetBulb,
  wetSurfaceEvaporation,
  windChill,
  windHeightFactor,
} from './physics';

describe('humidity and density', () => {
  it('Magnus vapour pressure, humidity and dew point round-trip', () => {
    expect(vapourPressureHpa(0)).toBeCloseTo(6.112, 3);
    expect(vapourPressureHpa(20)).toBeCloseTo(23.37, 1);
    for (const [t, rh] of [
      [20, 50],
      [-5, 80],
      [30, 25],
    ]) {
      expect(relativeHumidity(t, dewPointFromHumidity(t, rh))).toBeCloseTo(rh, 6);
    }
    expect(relativeHumidity(10, 12)).toBe(100);
  });

  it('dry air at 1013.25 hPa and 15 °C is 1.225 kg/m³; humid air is lighter', () => {
    expect(airDensityMoist(1013.25, 15, -80)).toBeCloseTo(1.225, 3);
    expect(airDensityMoist(1013.25, 30, 25)).toBeLessThan(airDensityMoist(1013.25, 30, -40));
  });

  it('pressure falls 1.2 % over 100 m at 10 °C and follows the standard atmosphere at 5500 m', () => {
    expect(pressureAtHeight(1000, 100, 10) / 1000).toBeCloseTo(0.988, 3);
    expect(scaleHeight(0)).toBeCloseTo(7994, -1);
    expect(standardPressure(0)).toBeCloseTo(1013.25, 2);
    expect(standardPressure(5500)).toBeCloseTo(505, 0);
  });
});

describe('wind, wet bulb, WBGT and wind chill', () => {
  it('log profile: 1.5 m over z0 = 0.03 m is 0.67 of the 10 m wind; FAO-56 gives 0.748 at 2 m', () => {
    expect(windHeightFactor(1.5, 0.03)).toBeCloseTo(0.67, 2);
    expect(BODY_WIND_FACTOR).toBeCloseTo(0.59, 2);
    expect(WIND_2M_FACTOR).toBeCloseTo(0.748, 3);
  });

  it('Stull wet bulb at 20 °C and 50 % is 13.7 °C', () => {
    expect(wetBulb(20, 50)).toBeCloseTo(13.7, 1);
  });

  it('globe temperature equals air without radiation and rises in sun, less in wind', () => {
    expect(globeTemperature(20, 20, 2)).toBeCloseTo(20, 3);
    const calm = globeTemperature(20, 50, 0.5);
    const windy = globeTemperature(20, 50, 6);
    expect(calm).toBeGreaterThan(windy);
    expect(windy).toBeGreaterThan(20);
  });

  it('WBGT in shade at 60 % tracks air about 0.9 °C per °C; humidity and sun raise it', () => {
    const at12 = wbgt(12, 60, 1, 12);
    const at25 = wbgt(25, 60, 1, 25);
    expect((at25 - at12) / 13).toBeGreaterThan(0.85);
    expect((at25 - at12) / 13).toBeLessThan(0.95);
    expect(wbgt(25, 90, 1, 25)).toBeGreaterThan(at25 + 2);
    expect(wbgt(25, 60, 1, 65)).toBeGreaterThan(at25 + 3);
  });

  it('wind chill at −10 °C and 20 km/h is −17.9 °C, and not defined above 10 °C', () => {
    expect(windChill(-10, 20)).toBeCloseTo(-17.9, 1);
    expect(windChill(15, 30)).toBe(15);
  });
});

describe('precipitation phase, snow and drying', () => {
  it('snow share is one half at a 0.5 °C wet bulb, nearly all snow at −2 °C and rain at 3 °C', () => {
    expect(snowShare(0.5)).toBeCloseTo(0.5, 6);
    expect(snowShare(-2)).toBeGreaterThan(0.98);
    expect(snowShare(3)).toBeLessThan(0.02);
  });

  it('Hedstrom–Pomeroy fresh snow density: 68 at −15 °C, 92 at −2 °C, 119 at 0 °C', () => {
    expect(freshSnowDensity(-15)).toBeCloseTo(68, 0);
    expect(freshSnowDensity(-2)).toBeCloseTo(92, 0);
    expect(freshSnowDensity(0)).toBeCloseTo(119, 0);
    expect(freshSnowDensity(5)).toBeCloseTo(119, 0);
  });

  it('a 0.5 mm film dries in about 4 h overcast, under an hour in sun, and stays wet on a humid night (±30 %)', () => {
    const hours = (t: number, rh: number, u2: number, sw: number) => 0.5 / wetSurfaceEvaporation(t, rh, u2 / WIND_2M_FACTOR, sw, 1013);
    expect(hours(15, 60, 3, 100)).toBeGreaterThan(4 * 0.7);
    expect(hours(15, 60, 3, 100)).toBeLessThan(4 * 1.3);
    expect(hours(25, 40, 2, 700)).toBeGreaterThan(0.7 * 0.7);
    expect(hours(25, 40, 2, 700)).toBeLessThan(0.7 * 1.3);
    expect(hours(10, 90, 1, 0)).toBeGreaterThan(24);
  });
});
