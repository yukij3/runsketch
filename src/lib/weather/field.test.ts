import { describe, expect, it } from 'vitest';
import { weatherScenario } from '../sim/scenarios';
import type { WeatherSeries } from '../types';
import { NEUTRAL_MANUAL, constantField, createAmbient, createWeatherField, isNeutralManual, isUsableSeries, type Conditions } from './field';
import { dewPointFromHumidity, relativeHumidity } from './physics';

const START = Date.UTC(2026, 7, 15, 4, 0);
const T0 = START / 1000;
const manual: Conditions = { temperatureC: 12, ...NEUTRAL_MANUAL };

function twoPoints(over: Partial<Parameters<typeof weatherScenario>[0]> = {}): WeatherSeries {
  const s = weatherScenario({ start: START, before: 2, after: 4, at: [0, 10000], ...over });
  s.points = [
    { d: 0, lon: 7.75, lat: 45.98, ele: 1600 },
    { d: 10000, lon: 7.66, lat: 45.976, ele: 3200 },
  ];
  const rows = (f: (h: number, p: number) => number) => [0, 1].map((p) => Array.from({ length: s.temperature[0].length }, (_, k) => f(k - 2, p)));
  s.temperature = rows((h, p) => (p === 0 ? 10 + h : 0 + h));
  s.dewPoint = rows((_, p) => (p === 0 ? 4 : -6));
  s.surfacePressure = rows((h, p) => (p === 0 ? 840 - h : 690 - h));
  s.windSpeed = rows(() => 10);
  s.windFrom = rows((h) => (h <= 0 ? 350 : 10));
  s.precipitation = rows((h) => (h === 1 ? 3 : 0));
  return s;
}

describe('series field', () => {
  it('instant variables interpolate linearly in time and space; sums hold over the hour they cover', () => {
    const field = createWeatherField(twoPoints(), manual);
    const a = createAmbient();
    field.at(0, T0 + 1800, 1600, a);
    expect(a.temp).toBeCloseTo(10.5, 9);
    field.at(5000, T0 + 1800, 2400, a);
    expect(a.temp).toBeCloseTo(5.5, 9);
    // Precipitation summed at +1 h falls at a constant rate from the start to +1 h, and not after.
    field.at(0, T0 + 60, 1600, a);
    expect(a.precip).toBeCloseTo(3, 9);
    field.at(0, T0 + 3599, 1600, a);
    expect(a.precip).toBeCloseTo(3, 9);
    field.at(0, T0 + 3601, 1600, a);
    expect(a.precip).toBe(0);
  });

  it('wind turning from 350° to 10° passes through north, not south, at full speed', () => {
    const field = createWeatherField(twoPoints(), manual);
    const a = createAmbient();
    field.at(0, T0 + 1800, 1600, a);
    expect(a.windSpeed).toBeGreaterThan(9.8);
    expect(a.windV).toBeLessThan(-9.8);
    expect(Math.abs(a.windU)).toBeLessThan(0.1);
  });

  it('a route 100 m above the sampled point is 0.65 K cooler with humidity recomputed and dew point ≤ air', () => {
    const field = createWeatherField(twoPoints(), manual);
    const a = createAmbient();
    const b = createAmbient();
    field.at(0, T0, 1600, a);
    field.at(0, T0, 1700, b);
    expect(a.temp - b.temp).toBeCloseTo(0.65, 9);
    expect(b.dew).toBeLessThanOrEqual(b.temp);
    expect(b.rh).toBeCloseTo(relativeHumidity(b.temp, b.dew), 9);
    expect(b.pressure).toBeLessThan(a.pressure);
    expect(a.pressure / b.pressure).toBeCloseTo(Math.exp(100 / 7900), 2);
  });

  it('irradiance is zero before sunrise and continuous across an hour boundary by day', () => {
    const s = twoPoints({ before: 6, after: 12, shortwave: () => 500 });
    const field = createWeatherField(s, manual);
    const a = createAmbient();
    field.sun(0, T0 - 3 * 3600, a);
    expect(a.shortwave).toBe(0);
    const at = (t: number) => {
      field.sun(0, t, a);
      return a.shortwave;
    };
    const boundary = T0 + 5 * 3600;
    expect(at(boundary + 1) - at(boundary - 1)).toBeLessThan(5);
    expect(at(boundary)).toBeGreaterThan(300);
  });

  it('pressure tendencies are smooth: no kink at the hour, monotone between falling hours', () => {
    const field = createWeatherField(twoPoints(), manual);
    const p = (t: number) => field.pressureTrend(0, t);
    const slopeBefore = p(T0 + 3600) - p(T0 + 3599);
    const slopeAfter = p(T0 + 3601) - p(T0 + 3600);
    expect(Math.abs(slopeAfter - slopeBefore)).toBeLessThan(1e-4);
    for (let t = T0; t < T0 + 3 * 3600; t += 300) expect(p(t + 300)).toBeLessThanOrEqual(p(t) + 1e-9);
  });

  it('pins hold the manual values; gaps take the nearest hour or the manual value', () => {
    const s = twoPoints();
    s.temperature[0] = s.temperature[0].map((v, k) => (k === 3 ? null : v));
    s.dewPoint[1] = s.dewPoint[1].map(() => null);
    const field = createWeatherField(s, { ...manual, windMps: 4, windFromDeg: 270, rainMmH: 2 }, ['wind', 'precipitation', 'temperature']);
    const a = createAmbient();
    field.at(0, T0 + 3600, 2000, a);
    expect(a.temp).toBe(12);
    expect(a.dew).toBeCloseTo(dewPointFromHumidity(12, 60), 9);
    expect(a.windU).toBeCloseTo(4, 9);
    expect(a.precip).toBe(2);
    const unpinned = createWeatherField(s, manual);
    unpinned.at(0, T0 + 3600, 1600, a);
    expect(Number.isFinite(a.temp)).toBe(true);
    unpinned.at(10000, T0, 3200, a);
    expect(a.dew).toBeCloseTo(Math.min(a.temp, dewPointFromHumidity(12, 60) - 0), 0);
  });

  it('usable series need matching point and slot counts', () => {
    const s = twoPoints();
    expect(isUsableSeries(s)).toBe(true);
    expect(isUsableSeries({ ...s, windFrom: [s.windFrom[0]] })).toBe(false);
    expect(isUsableSeries({ ...s, stepS: 0 })).toBe(false);
    expect(isUsableSeries(null)).toBe(false);
  });
});

describe('constant conditions', () => {
  it('manual conditions are the same everywhere and at any time; neutral ones keep the pre-weather path', () => {
    const field = constantField({ temperatureC: 20, humidityPct: 40, windMps: 5, windFromDeg: 90, rainMmH: 1 });
    const a = createAmbient();
    field.at(123, 1e9, 500, a);
    expect(a.temp).toBe(20);
    expect(a.rh).toBeCloseTo(40, 6);
    expect(a.windU).toBeCloseTo(-5, 9);
    expect(a.precip).toBe(1);
    expect(field.varies).toBe(false);
    expect(isNeutralManual(NEUTRAL_MANUAL)).toBe(true);
    expect(isNeutralManual({ ...NEUTRAL_MANUAL, windMps: 1 })).toBe(false);
  });
});
