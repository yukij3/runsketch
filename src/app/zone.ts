// The start time in the route's time zone. A start the user typed (or an example or link set) means a wall-clock time
// at the route, so a newly learned zone keeps that wall clock and moves the instant; a start that follows "now" keeps
// the instant and only takes the zone's offset on that date.
import type { SessionSettings } from '../lib/types';
import { isTimeZone, wallClock, wallToEpoch, zoneOffsetMin } from '../lib/weather/time';

export function rezoneStart<T extends Pick<SessionSettings, 'startTime' | 'utcOffsetMin'>>(session: T, zone: string, startAuto: boolean): T {
  if (!isTimeZone(zone) || !Number.isFinite(session.startTime)) return session;
  const offset = zoneOffsetMin(zone, session.startTime);
  if (offset === session.utcOffsetMin) return session;
  if (startAuto) return { ...session, utcOffsetMin: offset };
  const w = wallClock(session.startTime, session.utcOffsetMin);
  const subMinute = ((session.startTime % 60_000) + 60_000) % 60_000;
  const startTime = wallToEpoch(zone, w.year, w.month, w.day, w.hour, w.minute) + subMinute;
  return { ...session, startTime, utcOffsetMin: zoneOffsetMin(zone, startTime) };
}

/** Epoch ms and offset for a wall-clock time typed at the route: in `zone` when known, else at the fixed `fallbackOffsetMin`. */
export function startFromWallClock(
  zone: string,
  wall: { year: number; month: number; day: number; hour: number; minute: number },
  fallbackOffsetMin: number,
): Pick<SessionSettings, 'startTime' | 'utcOffsetMin'> {
  if (isTimeZone(zone)) {
    const startTime = wallToEpoch(zone, wall.year, wall.month, wall.day, wall.hour, wall.minute);
    return { startTime, utcOffsetMin: zoneOffsetMin(zone, startTime) };
  }
  const startTime = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute) - fallbackOffsetMin * 60_000;
  return { startTime, utcOffsetMin: fallbackOffsetMin };
}
