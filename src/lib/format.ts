// Display formatting shared by the sheet, traces and map readouts.
import type { Units } from './types';

export const METERS_PER_MILE = 1609.344;
export const FEET_PER_METER = 3.280839895;

const pad2 = (n: number) => String(n).padStart(2, '0');

/** 3725 → "1:02:05"; 125 → "2:05". */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '–';
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0 ? `${h}:${pad2(m)}:${pad2(sec)}` : `${m}:${pad2(sec)}`;
}

/** Pace from speed (m/s) → "5:12" per km or per mile. */
export function formatPace(mps: number, units: Units): string {
  if (!Number.isFinite(mps) || mps < 0.3) return '–';
  const perUnit = units === 'metric' ? 1000 : METERS_PER_MILE;
  const secs = perUnit / mps;
  if (secs >= 3600) return '–';
  const m = Math.floor(secs / 60);
  const s = Math.round(secs - m * 60);
  return s === 60 ? `${m + 1}:00` : `${m}:${pad2(s)}`;
}

export function paceUnit(units: Units): string {
  return units === 'metric' ? '/km' : '/mi';
}

export function formatSpeed(mps: number, units: Units, digits = 1): string {
  if (!Number.isFinite(mps)) return '–';
  const v = units === 'metric' ? mps * 3.6 : (mps * 3600) / METERS_PER_MILE;
  return v.toFixed(digits);
}

export function speedUnit(units: Units): string {
  return units === 'metric' ? 'km/h' : 'mph';
}

/** Distance in metres → value string in km or mi. */
export function formatDistance(m: number, units: Units, digits = 2): string {
  if (!Number.isFinite(m)) return '–';
  const v = units === 'metric' ? m / 1000 : m / METERS_PER_MILE;
  return v.toFixed(digits);
}

export function distanceUnit(units: Units): string {
  return units === 'metric' ? 'km' : 'mi';
}

export function formatElevation(m: number, units: Units): string {
  if (!Number.isFinite(m)) return '–';
  return String(Math.round(units === 'metric' ? m : m * FEET_PER_METER));
}

export function elevationUnit(units: Units): string {
  return units === 'metric' ? 'm' : 'ft';
}

/** Grade 0.052 → "5.2". */
export function formatGrade(grade: number): string {
  if (!Number.isFinite(grade)) return '–';
  return (grade * 100).toFixed(1);
}

/** Parse "m:ss" or "h:mm:ss" into seconds; null when invalid. */
export function parseClock(text: string): number | null {
  const parts = text.trim().split(':');
  if (parts.length < 2 || parts.length > 3 || parts.some((p) => !/^\d+$/.test(p))) return null;
  const nums = parts.map(Number);
  const [a, b, c] = nums;
  if (nums.length === 2) return b! < 60 ? a! * 60 + b! : null;
  return b! < 60 && c! < 60 ? a! * 3600 + b! * 60 + c! : null;
}
