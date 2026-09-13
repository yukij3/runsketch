// FIT activity file via @markw65/fit-file-writer (MIT).
// Message order follows Garmin's Encode Activity Recipe ("summary last"):
// file_id → device_info → event(timer start) → record… (with timer stop_all/start pairs around auto-pauses)
// → event(timer stop_all) → lap… → session → activity.
//
// Writer quirks, found by reading its source:
// - device_info.device_index is typed as a number (creator = 0), not the string "creator".
// - timer_trigger is a subfield of event.data, so it is passed as `data: 'manual'` or `data: 'auto'`.
// - The writer truncates (value + offset) · scale toward zero instead of rounding, so scaled
//   values are nudged to the centre of the target integer (see `scaled`).
import { FitWriter } from '@markw65/fit-file-writer';
import type { ExportInput } from '../types';
import {
  assertSamples,
  clamp,
  fileCadence,
  fileHeartRate,
  fileTemperature,
  hasPosition,
  isFoot,
  parseVersion,
  sampleEpochSeconds,
} from './common';
import { runningDynamics, type DynamicsStreams } from './dynamics';
import { exportLaps, streamCycles, streamMax } from './laps';
import { pausedSeconds, recordPlan, timerStats, type RecordPlan } from './recording';

const FIT_SPORT = {
  run: { sport: 'running', sub_sport: 'generic' },
  ride: { sport: 'cycling', sub_sport: 'road' },
  walk: { sport: 'walking', sub_sport: 'generic' },
  hike: { sport: 'hiking', sub_sport: 'generic' },
  // FIT profile sport 16; there is no mountaineering sub_sport (expedition, 66, is Garmin's low-rate recording mode).
  alpine: { sport: 'mountaineering', sub_sport: 'generic' },
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
/** uint16 field with a scale, or undefined for a missing value. */
const scaled16 = (v: number | undefined, scale: number) =>
  v !== undefined && Number.isFinite(v) ? scaled(Math.max(0, v), scale, 0, 65534) : undefined;

/** uint32z serial number: 0 is the invalid value, so map the seed into 1…2³²−1. */
export function fitSerial(seed: number): number {
  const n = Number.isFinite(seed) ? Math.abs(Math.trunc(seed)) : 0;
  return (n % 0xfffffffe) + 1;
}

/** Running dynamics record fields (FIT profile units: ms, %, mm) at sample i. */
function dynamicsRecord(d: DynamicsStreams | null, i: number) {
  if (!d || !Number.isFinite(d.stanceTime[i])) return {};
  return {
    stance_time: scaled16(d.stanceTime[i], 10),
    stance_time_percent: scaled16(d.stanceTimePercent[i], 100),
    vertical_oscillation: scaled16(d.verticalOscillation[i], 10),
    vertical_ratio: scaled16(d.verticalRatio[i], 100),
    step_length: scaled16(d.stepLength[i], 10),
    stance_time_balance: scaled16(d.stanceTimeBalance[i], 100),
  };
}

/** Lap/session averages of the running dynamics over the written records of [start, end). */
function dynamicsSummary(d: DynamicsStreams | null, plan: RecordPlan, start: number, end: number) {
  if (!d) return {};
  const avg = (values: Float64Array) => timerStats(values, plan, start, end)?.mean;
  return {
    avg_stance_time: scaled16(avg(d.stanceTime), 10),
    avg_stance_time_percent: scaled16(avg(d.stanceTimePercent), 100),
    avg_vertical_oscillation: scaled16(avg(d.verticalOscillation), 10),
    avg_vertical_ratio: scaled16(avg(d.verticalRatio), 100),
    avg_step_length: scaled16(avg(d.stepLength), 10),
    avg_stance_time_balance: scaled16(avg(d.stanceTimeBalance), 100),
  };
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
  const plan = recordPlan(input);
  const dynamics = runningDynamics(s, session);
  const temperature = Float64Array.from({ length: n }, (_, i) => fileTemperature(s, session, i) ?? Number.NaN);

  const w = new FitWriter({ noCompressedTimestamps: true });
  const time = (i: number) => w.time(sampleEpochSeconds(session.startTime, s.t[i]) * 1000);
  const lat = (i: number) => (hasPosition(s, i) ? w.latlng(toRad(s.lat[i])) : undefined);
  const lon = (i: number) => (hasPosition(s, i) ? w.latlng(toRad(s.lon[i])) : undefined);
  const start = time(0);
  const end = time(n - 1);
  const cadenceFields = (value: number) => {
    const c = fileCadence(value, type);
    return { whole: Math.floor(c), fraction: c - Math.floor(c) };
  };
  const temperatureSummary = (first: number, endIndex: number) => {
    const t = timerStats(temperature, plan, first, endIndex);
    return t ? { avg_temperature: Math.round(t.mean), max_temperature: t.max, min_temperature: t.min } : {};
  };
  // Timer time excludes auto-pauses; average speed is distance over timer time, as the FIT profile defines it.
  const timerOver = (elapsed: number, first: number, last: number) =>
    Math.max(0, elapsed - pausedSeconds(plan, s.t, Math.max(0, first - 1), last));

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

  // Auto-pause as a Garmin Edge writes it: a zero-speed record at the pause, timer stop_all (auto), no records while
  // paused, then timer start (auto) with the first record after the stop.
  const pauseAt = new Set(plan.pauses.map((p) => p.from));
  const resumeAt = new Set(plan.pauses.map((p) => p.to));
  for (let i = 0; i < n; i++) {
    if (!plan.written[i]) continue;
    if (resumeAt.has(i)) w.writeMessage('event', { timestamp: time(i), event: 'timer', event_type: 'start', data: 'auto' }, null, true);
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
        temperature: Number.isFinite(temperature[i]) ? temperature[i] : undefined,
        ...dynamicsRecord(dynamics, i),
      },
      null,
      i === n - 1,
    );
    if (pauseAt.has(i)) w.writeMessage('event', { timestamp: time(i), event: 'timer', event_type: 'stop_all', data: 'auto' }, null, true);
  }

  w.writeMessage('event', { timestamp: end, event: 'timer', event_type: 'stop_all', data: 'manual' }, null, true);

  // FIT total_cycles means strides for foot sports (total_strides subfield).
  const cyclesOut = (steps: number) => Math.round(foot ? steps / 2 : steps);

  laps.forEach((lap, k) => {
    const first = lap.start;
    const last = lap.end - 1;
    const avgCad = cadenceFields(lap.avgCadence);
    const maxCad = cadenceFields(lap.maxCadence);
    const hrAvg = fileHeartRate(lap.avgHr);
    const hrMax = fileHeartRate(lap.maxHr);
    const timer = timerOver(lap.elapsed, first, last);
    const avgSpeed = timer > 0 ? Math.max(0, lap.distance) / timer : 0;
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
        total_timer_time: seconds32(timer),
        total_moving_time: seconds32(lap.moving),
        total_distance: scaled(Math.max(0, lap.distance), 100),
        total_cycles: cyclesOut(lap.cycles),
        total_calories: u16(lap.calories),
        avg_speed: speed16(avgSpeed),
        enhanced_avg_speed: scaled(avgSpeed, 1000),
        max_speed: speed16(lap.maxSpeed),
        enhanced_max_speed: scaled(lap.maxSpeed, 1000),
        avg_heart_rate: hrAvg,
        max_heart_rate: hrMax,
        avg_cadence: avgCad.whole,
        avg_fractional_cadence: foot ? avgCad.fraction : undefined,
        max_cadence: maxCad.whole,
        max_fractional_cadence: foot ? maxCad.fraction : undefined,
        avg_power: ride ? u16(lap.avgPower) : undefined,
        max_power: ride ? u16(lap.maxPower) : undefined,
        total_ascent: u16(lap.ascent),
        total_descent: u16(lap.descent),
        ...temperatureSummary(first, lap.end),
        ...dynamicsSummary(dynamics, plan, first, lap.end),
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
  const maxCad = cadenceFields(streamMax(s.cadence));
  const timer = timerOver(summary.elapsed, 0, n - 1);
  const avgSpeed = timer > 0 ? Math.max(0, summary.distance) / timer : 0;
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
      total_timer_time: seconds32(timer),
      total_moving_time: seconds32(summary.moving),
      total_distance: scaled(Math.max(0, summary.distance), 100),
      total_cycles: cyclesOut(streamCycles(s.cadence)),
      total_calories: u16(summary.calories),
      avg_speed: speed16(avgSpeed),
      enhanced_avg_speed: scaled(avgSpeed, 1000),
      max_speed: speed16(summary.maxSpeed),
      enhanced_max_speed: scaled(Math.max(0, summary.maxSpeed), 1000),
      avg_heart_rate: fileHeartRate(summary.avgHr),
      max_heart_rate: fileHeartRate(summary.maxHr),
      avg_cadence: avgCad.whole,
      avg_fractional_cadence: foot ? avgCad.fraction : undefined,
      max_cadence: maxCad.whole,
      max_fractional_cadence: foot ? maxCad.fraction : undefined,
      avg_power: ride ? u16(summary.avgPower) : undefined,
      max_power: ride ? u16(streamMax(s.power)) : undefined,
      total_ascent: u16(summary.ascent),
      total_descent: u16(summary.descent),
      ...temperatureSummary(0, n),
      ...dynamicsSummary(dynamics, plan, 0, n),
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
      total_timer_time: seconds32(timer),
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
