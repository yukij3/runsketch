// Helpers shared by the GPX, TCX and FIT writers.
import type { ActivityStreams, ActivityType, SessionSettings } from '../types';

export const XSI_NS = 'http://www.w3.org/2001/XMLSchema-instance';

// XML 1.0 forbids these code points even when escaped; pasted user text can carry them.
const XML_FORBIDDEN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g;
const XML_ENTITIES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&apos;',
};

export function xmlEscape(text: string): string {
  return text.replace(XML_FORBIDDEN, '').replace(/[&<>"']/g, (c) => XML_ENTITIES[c]);
}

/** toFixed without "-0.0". */
export function fixed(value: number, digits: number): string {
  const s = value.toFixed(digits);
  return Number(s) === 0 ? (0).toFixed(digits) : s;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Whole-second UTC epoch of the sample at elapsed second `t`. */
export function sampleEpochSeconds(startTime: number, t: number): number {
  return Math.round(startTime / 1000) + Math.round(t);
}

/** ISO-8601 UTC without milliseconds, e.g. 2026-09-12T07:00:00Z. */
export function isoUtc(epochSeconds: number): string {
  return new Date(epochSeconds * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** GPX and TCX longitude types are [-180, 180). */
export function normalizeLon(lon: number): number {
  return lon >= -180 && lon < 180 ? lon : ((((lon + 180) % 360) + 360) % 360) - 180;
}

export function hasPosition(streams: ActivityStreams, i: number): boolean {
  const lat = streams.lat[i];
  const lon = streams.lon[i];
  return Number.isFinite(lat) && Number.isFinite(lon) && lat >= -90 && lat <= 90;
}

export function isFoot(type: ActivityType): boolean {
  return type !== 'ride';
}

/**
 * Cadence in file units. Foot-sport streams are steps/min, but FIT (avg_running_cadence is
 * "strides/min" in the FIT profile), TCX RunCadence and Garmin GPX cad all store strides/min,
 * so round to whole steps and halve (x.0 or x.5). Rides stay rpm. 254 is the ceiling of the
 * XSD CadenceValue_t and of FIT uint8 (255 = invalid).
 */
export function fileCadence(value: number, type: ActivityType): number {
  if (!(value > 0)) return 0;
  const v = isFoot(type) ? Math.round(value) / 2 : Math.round(value);
  return Math.min(v, 254);
}

/** Integer cadence for XML formats and the FIT `cadence` byte. */
export function wholeCadence(value: number, type: ActivityType): number {
  return Math.floor(fileCadence(value, type));
}

/** Heart rate as files store it (XSD positiveByte, FIT uint8 with 255 invalid), or undefined when absent. */
export function fileHeartRate(value: number): number | undefined {
  if (!(value >= 0.5)) return undefined;
  return Math.min(Math.round(value), 254);
}

export function assertSamples(streams: ActivityStreams): number {
  const n = streams.t.length;
  if (n === 0) throw new Error('Nothing to export: the activity has no samples');
  return n;
}

export interface AppVersion {
  major: number;
  minor: number;
  patch: number;
}

export function parseVersion(version: string): AppVersion {
  const m = /^\s*v?(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(version);
  const part = (s: string | undefined) => Math.min(Number(s ?? 0), 65535);
  return { major: part(m?.[1]), minor: part(m?.[2]), patch: part(m?.[3]) };
}

/** "Name version", or "" when no app name is given (the GPX creator attribute is required but may be empty). */
export function creatorName(appName: string, appVersion: string): string {
  return appName.trim() ? `${appName.trim()} ${appVersion}`.trim() : '';
}

export interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

/** Wall-clock parts at the start location (session.utcOffsetMin), independent of the browser's zone. */
export function localParts(startTime: number, utcOffsetMin: number): LocalParts {
  const offset = Number.isFinite(utcOffsetMin) ? utcOffsetMin : 0;
  const d = new Date(startTime + offset * 60_000);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
  };
}

const SPORT_LABEL: Record<ActivityType, string> = { run: 'Run', ride: 'Ride', walk: 'Walk', hike: 'Hike' };

function partOfDay(hour: number): string {
  if (hour >= 5 && hour < 12) return 'Morning';
  if (hour >= 12 && hour < 17) return 'Afternoon';
  if (hour >= 17 && hour < 21) return 'Evening';
  return 'Night';
}

/** The session name, or "Morning Run"-style from the local start hour when left blank. */
export function activityTitle(session: SessionSettings): string {
  const name = session.name.trim();
  if (name) return name;
  const { hour } = localParts(session.startTime, session.utcOffsetMin);
  return `${partOfDay(hour)} ${SPORT_LABEL[session.type]}`;
}
