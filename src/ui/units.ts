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

/** Local wall-clock value for <input type="datetime-local">. */
export function toDateTimeLocal(epochMs: number): string {
  const d = new Date(epochMs);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
