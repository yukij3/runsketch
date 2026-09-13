// Short weather texts for the sheet: what the athlete met (temperature range, precipitation window in the route's clock,
// wind) and where the data came from.
import { formatDecimal } from '../lib/format';
import type { Units, WeatherSource, WeatherSummary } from '../lib/types';
import { wallClock } from '../lib/weather/time';
import { translate, type Lang, type MessageKey } from './i18n';

export const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;
export type CompassPoint = (typeof COMPASS)[number];

/** Eight-point compass direction for degrees (0 = north). */
export function compassPoint(deg: number): CompassPoint {
  const d = Number.isFinite(deg) ? ((deg % 360) + 360) % 360 : 0;
  return COMPASS[Math.round(d / 45) % 8];
}

/** Degrees of an eight-point compass direction. */
export const compassDegrees = (point: CompassPoint): number => COMPASS.indexOf(point) * 45;

const pad2 = (n: number) => String(n).padStart(2, '0');

/** "HH:MM" at the route for `elapsedS` seconds after the start. */
export function routeClock(startTime: number, utcOffsetMin: number, elapsedS: number): string {
  const w = wallClock(startTime + elapsedS * 1000, utcOffsetMin);
  return `${pad2(w.hour)}:${pad2(w.minute)}`;
}

/** Temperature in the display unit. */
export const temperatureIn = (celsius: number, units: Units): number => (units === 'metric' ? celsius : (celsius * 9) / 5 + 32);

/** Whole number with a true minus sign. */
const whole = (x: number): string => String(Math.round(x)).replace('-', '−');

/** "3…11 °C · rain 08:00–09:15 · wind SW → NW 7–25 km/h" for what the athlete met. */
export function weatherSummaryText(lang: Lang, units: Units, w: WeatherSummary, startTime: number, utcOffsetMin: number): string {
  const t = (key: MessageKey, params?: Record<string, string | number>) => translate(lang, key, params);
  const unit = t(units === 'metric' ? 'unit_c' : 'unit_f');
  const lo = whole(temperatureIn(w.airTempMin, units));
  const hi = whole(temperatureIn(w.airTempMax, units));
  const parts = [lo === hi ? `${hi} ${unit}` : `${lo}…${hi} ${unit}`];
  if (w.rainFrom !== null && w.rainTo !== null) {
    const window = { from: routeClock(startTime, utcOffsetMin, w.rainFrom), to: routeClock(startTime, utcOffsetMin, w.rainTo) };
    parts.push(t(w.snowShare >= 0.5 ? 'weatherSnow' : 'weatherRain', window));
  } else {
    parts.push(t('weatherDry'));
  }
  const speed = (mps: number) => Math.round(units === 'metric' ? mps * 3.6 : (mps * 3600) / 1609.344);
  if (speed(w.windMax) < 1) {
    parts.push(t('weatherCalm'));
  } else {
    const a = t(`dir_${compassPoint(w.windFromStart)}`);
    const b = t(`dir_${compassPoint(w.windFromEnd)}`);
    const lowSpeed = speed(w.windMin);
    const highSpeed = speed(w.windMax);
    parts.push(
      t('weatherWind', {
        dir: a === b ? a : `${a} → ${b}`,
        speed: lowSpeed === highSpeed ? String(highSpeed) : `${lowSpeed}–${highSpeed}`,
        unit: t(units === 'metric' ? 'unit_kmh' : 'unit_mph'),
      }),
    );
  }
  return parts.join(' · ');
}

/** "Archived forecast", "Typical for this date (weather of 2019)". */
export function weatherSourceText(lang: Lang, source: WeatherSource, analogYear?: number): string {
  return translate(lang, `weatherSource_${source}`, { year: analogYear ?? '–' });
}

/** Precipitation total for the result table: one decimal in mm. */
export const precipitationText = (mm: number, lang: Lang): string => formatDecimal(mm, 1, lang);
