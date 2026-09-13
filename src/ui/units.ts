import type { Translate } from '../app/i18n';
import type { Units } from '../lib/types';

export const KG_PER_LB = 0.45359237;
export const CM_PER_IN = 2.54;
export const KM_PER_MI = 1.609344;

export function unitLabels(units: Units, t: Translate) {
  const metric = units === 'metric';
  return {
    distance: t(metric ? 'unit_km' : 'unit_mi'),
    elevation: t(metric ? 'unit_m' : 'unit_ft'),
    pace: t(metric ? 'unit_perKm' : 'unit_perMi'),
    speed: t(metric ? 'unit_kmh' : 'unit_mph'),
    weight: t(metric ? 'unit_kg' : 'unit_lb'),
    height: t(metric ? 'unit_cm' : 'unit_in'),
    temperature: t(metric ? 'unit_c' : 'unit_f'),
  };
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/** Always h:mm:ss, e.g. 0:45:00. */
export function formatHms(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '';
  const s = Math.round(seconds);
  return `${Math.floor(s / 3600)}:${pad2(Math.floor((s % 3600) / 60))}:${pad2(s % 60)}`;
}

/** m:ss, e.g. 5:30. */
export function formatMss(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '';
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}:${pad2(s % 60)}`;
}

export const cToF = (c: number) => (c * 9) / 5 + 32;
export const fToC = (f: number) => ((f - 32) * 5) / 9;

/** Wall-clock value for <input type="datetime-local">: at a fixed offset (minutes east of UTC) when given, else in the browser's zone. */
export function toDateTimeLocal(epochMs: number, offsetMin?: number): string {
  if (offsetMin !== undefined && Number.isFinite(offsetMin)) {
    const d = new Date(epochMs + offsetMin * 60_000);
    return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}T${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
  }
  const d = new Date(epochMs);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** Wall-clock parts of a datetime-local value ("2026-09-13T06:30"), or null. */
export function parseDateTimeLocal(text: string): { year: number; month: number; day: number; hour: number; minute: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(text);
  if (!m) return null;
  const [year, month, day, hour, minute] = m.slice(1).map(Number);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return null;
  return { year, month, day, hour, minute };
}

/** Wind speed in the display unit: km/h (metric) or mph. */
export const windToDisplay = (mps: number, units: Units): number => (units === 'metric' ? mps * 3.6 : (mps * 3600) / 1609.344);
export const windFromDisplay = (value: number, units: Units): number => (units === 'metric' ? value / 3.6 : (value * 1609.344) / 3600);
