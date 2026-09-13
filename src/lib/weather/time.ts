// Route-local time and the sun. Wall clock ↔ epoch goes through Intl with the route's IANA zone, so the offset on the
// requested date (daylight saving included) is used, never a provider's single current offset. Sun elevation follows
// the NOAA solar position equations (Meeus 1991), computed locally so no service is needed for daylight.

const formatters = new Map<string, Intl.DateTimeFormat | null>();

function formatter(zone: string): Intl.DateTimeFormat | null {
  if (formatters.has(zone)) return formatters.get(zone) ?? null;
  let f: Intl.DateTimeFormat | null = null;
  try {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    f = null;
  }
  formatters.set(zone, f);
  return f;
}

/** True for an IANA zone name this runtime knows (e.g. "Europe/Zurich"). */
export function isTimeZone(zone: unknown): zone is string {
  return typeof zone === 'string' && zone.length > 0 && zone.length < 64 && formatter(zone) !== null;
}

/** Minutes east of UTC in `zone` at the instant `epochMs`, daylight saving included; 0 for an unknown zone. */
export function zoneOffsetMin(zone: string, epochMs: number): number {
  const f = isTimeZone(zone) ? formatter(zone) : null;
  if (!f || !Number.isFinite(epochMs)) return 0;
  const p: Record<string, number> = {};
  for (const part of f.formatToParts(new Date(epochMs))) if (part.type !== 'literal') p[part.type] = Number(part.value);
  const wall = Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute, p.second);
  return Math.round((wall - Math.floor(epochMs / 1000) * 1000) / 60000);
}

/**
 * Epoch ms of a wall-clock time in `zone` (month 1–12). Two passes settle daylight saving: a time inside the spring gap
 * moves forward by the gap, and an ambiguous autumn time takes the later occurrence.
 */
export function wallToEpoch(zone: string, year: number, month: number, day: number, hour: number, minute: number): number {
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  const first = wall - zoneOffsetMin(zone, wall) * 60_000;
  return wall - zoneOffsetMin(zone, first) * 60_000;
}

export interface WallClock {
  year: number;
  /** 1–12. */
  month: number;
  day: number;
  hour: number;
  minute: number;
}

/** Wall-clock parts of `epochMs` at a fixed offset (minutes east of UTC). */
export function wallClock(epochMs: number, offsetMin: number): WallClock {
  const d = new Date(epochMs + (Number.isFinite(offsetMin) ? offsetMin : 0) * 60_000);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(), hour: d.getUTCHours(), minute: d.getUTCMinutes() };
}

const RAD = Math.PI / 180;

/**
 * Geometric sun elevation above the horizon, degrees (no refraction), at `lat`/`lon` and `epochS` (UTC seconds). NOAA
 * solar calculator equations; within about 0.1° of the published tables for 1900–2100.
 */
export function sunElevationDeg(lat: number, lon: number, epochS: number): number {
  const jc = (epochS / 86400 + 2440587.5 - 2451545) / 36525;
  const meanLong = (280.46646 + jc * (36000.76983 + jc * 0.0003032)) % 360;
  const meanAnom = 357.52911 + jc * (35999.05029 - 0.0001537 * jc);
  const ecc = 0.016708634 - jc * (0.000042037 + 0.0000001267 * jc);
  const m = meanAnom * RAD;
  const centre = Math.sin(m) * (1.914602 - jc * (0.004817 + 0.000014 * jc)) + Math.sin(2 * m) * (0.019993 - 0.000101 * jc) + Math.sin(3 * m) * 0.000289;
  const omega = (125.04 - 1934.136 * jc) * RAD;
  const apparentLong = (meanLong + centre - 0.00569 - 0.00478 * Math.sin(omega)) * RAD;
  const meanObliquity = 23 + (26 + (21.448 - jc * (46.815 + jc * (0.00059 - jc * 0.001813))) / 60) / 60;
  const obliquity = (meanObliquity + 0.00256 * Math.cos(omega)) * RAD;
  const declination = Math.asin(Math.sin(obliquity) * Math.sin(apparentLong));
  const y = Math.tan(obliquity / 2) ** 2;
  const l0 = meanLong * RAD;
  const eqTimeMin =
    (4 / RAD) *
    (y * Math.sin(2 * l0) - 2 * ecc * Math.sin(m) + 4 * ecc * y * Math.sin(m) * Math.cos(2 * l0) - 0.5 * y * y * Math.sin(4 * l0) - 1.25 * ecc * ecc * Math.sin(2 * m));
  const minutesUtc = ((((epochS % 86400) + 86400) % 86400) / 60);
  const solarMin = (((minutesUtc + eqTimeMin + 4 * lon) % 1440) + 1440) % 1440;
  const hourAngle = (solarMin / 4 - 180) * RAD;
  const cosZenith = Math.sin(lat * RAD) * Math.sin(declination) + Math.cos(lat * RAD) * Math.cos(declination) * Math.cos(hourAngle);
  return 90 - Math.acos(Math.max(-1, Math.min(1, cosZenith))) / RAD;
}
