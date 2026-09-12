// FIT activity file via @markw65/fit-file-writer (MIT).
// Message order follows Garmin's Encode Activity Recipe ("summary last"):
// file_id → device_info → event(timer start) → record… → event(timer stop_all) → lap… → session → activity.
//
// Writer quirks, found by reading its source:
// - device_info.device_index is typed as a number (creator = 0), not the string "creator".
// - timer_trigger is a subfield of event.data, so it is passed as `data: 'manual'`.
// - The writer truncates (value + offset) · scale toward zero instead of rounding, so scaled
//   values are nudged to the centre of the target integer (see `scaled`).
import { FitWriter } from '@markw65/fit-file-writer';
import type { ExportInput } from '../types';
import {
  assertSamples,
  clamp,
  fileCadence,
  fileHeartRate,
  hasPosition,
  isFoot,
  parseVersion,
  sampleEpochSeconds,
} from './common';
import { exportLaps, streamCycles, streamMax } from './laps';

const FIT_SPORT = {
  run: { sport: 'running', sub_sport: 'generic' },
  ride: { sport: 'cycling', sub_sport: 'road' },
  walk: { sport: 'walking', sub_sport: 'generic' },
  hike: { sport: 'hiking', sub_sport: 'generic' },
} as const;

/** Value that the writer's truncating encoder turns into round((v + offset) · scale), clamped to [0, max]. */
function scaled(value: number, scale: number, offset = 0, max = 0xfffffffe): number {
  const n = clamp(Math.round((value + offset) * scale), 0, max);
  return (n + 0.5) / scale - offset;
}

const u16 = (v: number) => clamp(Math.round(v), 0, 65534);
const toRad = (deg: number) => (deg * Math.PI) / 180;
/** m/s for uint16 speed fields (scale 1000). */
const speed16 = (v: number) => scaled(Math.max(0, v), 1000, 0, 65534);
const seconds32 = (v: number) => scaled(Math.max(0, v), 1000);

/** uint32z serial number: 0 is the invalid value, so map the seed into 1…2³²−1. */
export function fitSerial(seed: number): number {
  const n = Number.isFinite(seed) ? Math.abs(Math.trunc(seed)) : 0;
  return (n % 0xfffffffe) + 1;
}

export function buildFit(input: ExportInput): Uint8Array {
  const { result, session, appName, appVersion } = input;
  const s = result.streams;
  const summary = result.summary;
  const n = assertSamples(s);
  const type = session.type;
  const foot = isFoot(type);
  const ride = type === 'ride';
  const { sport, sub_sport } = FIT_SPORT[type];
  const laps = exportLaps(result);
  const serial = fitSerial(session.seed);
  const version = parseVersion(appVersion);

  const w = new FitWriter({ noCompressedTimestamps: true });
  const time = (i: number) => w.time(sampleEpochSeconds(session.startTime, s.t[i]) * 1000);
  const lat = (i: number) => (hasPosition(s, i) ? w.latlng(toRad(s.lat[i])) : undefined);
  const lon = (i: number) => (hasPosition(s, i) ? w.latlng(toRad(s.lon[i])) : undefined);
  const start = time(0);
  const end = time(n - 1);
  const temperature = Number.isFinite(session.temperatureC) ? clamp(Math.round(session.temperatureC), -127, 127) : undefined;
  const cadenceFields = (value: number) => {
    const c = fileCadence(value, type);
    return { whole: Math.floor(c), fraction: c - Math.floor(c) };
  };

  w.writeMessage(
    'file_id',
    { type: 'activity', manufacturer: 'development', product: 0, serial_number: serial, time_created: start },
    null,
    true,
  );
  w.writeMessage(
    'device_info',
    {
      timestamp: start,
      device_index: 0, // creator
      manufacturer: 'development',
      product: 0,
      product_name: appName.trim() || undefined,
      serial_number: serial,
      software_version: appName.trim() ? scaled(version.major + Math.min(version.minor, 99) / 100, 100, 0, 65534) : undefined,
    },
    null,
    true,
  );
  w.writeMessage('event', { timestamp: start, event: 'timer', event_type: 'start', data: 'manual' }, null, true);

  for (let i = 0; i < n; i++) {
    const cad = cadenceFields(s.cadence[i]);
    w.writeMessage(
      'record',
      {
        timestamp: time(i),
        position_lat: lat(i),
        position_long: lon(i),
        enhanced_altitude: Number.isFinite(s.ele[i]) ? scaled(s.ele[i], 5, 500) : undefined,
        distance: Number.isFinite(s.dist[i]) ? scaled(Math.max(0, s.dist[i]), 100) : undefined,
        enhanced_speed: Number.isFinite(s.speed[i]) ? scaled(Math.max(0, s.speed[i]), 1000) : undefined,
        heart_rate: fileHeartRate(s.hr[i]),
        cadence: cad.whole,
        fractional_cadence: foot ? cad.fraction : undefined,
        power: ride && Number.isFinite(s.power[i]) ? u16(s.power[i]) : undefined,
        temperature,
      },
      null,
      i === n - 1,
    );
  }

  w.writeMessage('event', { timestamp: end, event: 'timer', event_type: 'stop_all', data: 'manual' }, null, true);

  // FIT total_cycles means strides for foot sports (total_strides subfield).
  const cyclesOut = (steps: number) => Math.round(foot ? steps / 2 : steps);

  laps.forEach((lap, k) => {
    const first = lap.start;
    const last = lap.end - 1;
    const avgCad = cadenceFields(lap.avgCadence);
    const hrAvg = fileHeartRate(lap.avgHr);
    const hrMax = fileHeartRate(lap.maxHr);
    w.writeMessage(
      'lap',
      {
        message_index: { value: k },
        timestamp: time(last),
        start_time: time(first),
        start_position_lat: lat(first),
        start_position_long: lon(first),
        end_position_lat: lat(last),
        end_position_long: lon(last),
        total_elapsed_time: seconds32(lap.elapsed),
        total_timer_time: seconds32(lap.elapsed), // no timer pauses are modelled
        total_moving_time: seconds32(lap.moving),
        total_distance: scaled(Math.max(0, lap.distance), 100),
        total_cycles: cyclesOut(lap.cycles),
        total_calories: u16(lap.calories),
        avg_speed: speed16(lap.avgSpeed),
        enhanced_avg_speed: scaled(Math.max(0, lap.avgSpeed), 1000),
        max_speed: speed16(lap.maxSpeed),
        enhanced_max_speed: scaled(lap.maxSpeed, 1000),
        avg_heart_rate: hrAvg,
        max_heart_rate: hrMax,
        avg_cadence: avgCad.whole,
        avg_fractional_cadence: foot ? avgCad.fraction : undefined,
        max_cadence: cadenceFields(lap.maxCadence).whole,
        avg_power: ride ? u16(lap.avgPower) : undefined,
        max_power: ride ? u16(lap.maxPower) : undefined,
        total_ascent: u16(lap.ascent),
        total_descent: u16(lap.descent),
        event: 'lap',
        event_type: 'stop',
        lap_trigger: k === laps.length - 1 ? 'session_end' : 'distance',
        intensity: 'active',
        sport,
        sub_sport,
      },
      null,
      k === laps.length - 1,
    );
  });

  const avgCad = cadenceFields(summary.avgCadence);
  w.writeMessage(
    'session',
    {
      message_index: { value: 0 },
      timestamp: end,
      start_time: start,
      start_position_lat: lat(0),
      start_position_long: lon(0),
      sport,
      sub_sport,
      total_elapsed_time: seconds32(summary.elapsed),
      total_timer_time: seconds32(summary.elapsed),
      total_moving_time: seconds32(summary.moving),
      total_distance: scaled(Math.max(0, summary.distance), 100),
      total_cycles: cyclesOut(streamCycles(s.cadence)),
      total_calories: u16(summary.calories),
      avg_speed: speed16(summary.avgSpeed),
      enhanced_avg_speed: scaled(Math.max(0, summary.avgSpeed), 1000),
      max_speed: speed16(summary.maxSpeed),
      enhanced_max_speed: scaled(Math.max(0, summary.maxSpeed), 1000),
      avg_heart_rate: fileHeartRate(summary.avgHr),
      max_heart_rate: fileHeartRate(summary.maxHr),
      avg_cadence: avgCad.whole,
      avg_fractional_cadence: foot ? avgCad.fraction : undefined,
      max_cadence: cadenceFields(streamMax(s.cadence)).whole,
      avg_power: ride ? u16(summary.avgPower) : undefined,
      max_power: ride ? u16(streamMax(s.power)) : undefined,
      total_ascent: u16(summary.ascent),
      total_descent: u16(summary.descent),
      avg_temperature: temperature,
      first_lap_index: 0,
      num_laps: laps.length,
      event: 'session',
      event_type: 'stop',
      trigger: 'activity_end',
    },
    null,
    true,
  );

  const offsetSec = Number.isFinite(session.utcOffsetMin) ? Math.round(session.utcOffsetMin * 60) : 0;
  w.writeMessage(
    'activity',
    {
      timestamp: end,
      total_timer_time: seconds32(summary.elapsed),
      num_sessions: 1,
      type: 'manual',
      event: 'activity',
      event_type: 'stop',
      local_timestamp: end + offsetSec,
    },
    null,
    true,
  );

  const view = w.finish();
  return new Uint8Array(view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength));
}
