import { describe, expect, it } from 'vitest';
import type { WeatherSummary } from '../lib/types';
import { compassDegrees, compassPoint, routeClock, weatherSourceText, weatherSummaryText } from './weatherText';

const START = Date.UTC(2026, 7, 15, 4, 0);
const summary: WeatherSummary = {
  source: 'forecast',
  airTempMin: 2.6,
  airTempMax: 11.4,
  airTempStart: 6.8,
  airTempEnd: 2.7,
  windMin: 2,
  windMax: 7,
  windFromStart: 230,
  windFromEnd: 310,
  headWindMean: 1.2,
  rainFrom: 7200,
  rainTo: 11700,
  rainMm: 4.6,
  snowShare: 0.1,
  snowDepthMaxCm: 0,
  wetDistance: 3000,
  coreTempMax: 37.4,
  sweatLossL: 0.4,
  wbgtMax: 9,
  uncoveredS: 0,
};

describe('weather texts', () => {
  it('summarise temperature, the rain window at the route clock and the wind', () => {
    expect(weatherSummaryText('en', 'metric', summary, START, 120)).toBe('3…11 °C · rain 08:00–09:15 · wind SW → NW 7–25 km/h');
    expect(weatherSummaryText('ru', 'metric', summary, START, 120)).toBe('3…11 °C · дождь 08:00–09:15 · ветер ЮЗ → СЗ 7–25 км/ч');
    expect(weatherSummaryText('en', 'imperial', { ...summary, windFromEnd: 225 }, START, 120)).toBe('37…53 °F · rain 08:00–09:15 · wind SW 4–16 mph');
  });

  it('say dry, calm and snow, and write a true minus', () => {
    const cold = { ...summary, airTempMin: -4.2, airTempMax: -4.4, rainFrom: null, rainTo: null, windMin: 0, windMax: 0.1 };
    expect(weatherSummaryText('en', 'metric', cold, START, 0)).toBe('−4 °C · dry · calm');
    expect(weatherSummaryText('en', 'metric', { ...summary, snowShare: 0.8 }, START, 0)).toMatch(/· snow 06:00–07:15 ·/);
  });

  it('name sources, compass points and clock times', () => {
    expect(weatherSourceText('en', 'climatology', 2019)).toBe('Typical for this date (weather of 2019)');
    expect(weatherSourceText('ru', 'historical-forecast')).toBe('Архив прогнозов');
    expect([0, 22, 23, 180, 337, 338, -45].map(compassPoint)).toEqual(['N', 'N', 'NE', 'S', 'NW', 'N', 'NW']);
    expect(compassDegrees('SW')).toBe(225);
    expect(routeClock(START, 345, 90)).toBe('09:46');
  });
});
