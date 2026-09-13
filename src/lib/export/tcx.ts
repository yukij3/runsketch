// TCX (TrainingCenterDatabase v2) with ActivityExtension v2. Element order follows the XSD sequences.
import type { ActivityType, ExportInput } from '../types';
import {
  XSI_NS,
  assertSamples,
  clamp,
  fileHeartRate,
  fixed,
  hasPosition,
  isoUtc,
  normalizeLon,
  parseVersion,
  sampleEpochSeconds,
  wholeCadence,
  wholeCadenceSeries,
  xmlEscape,
} from './common';
import { exportLaps, type ExportLap } from './laps';
import { pausedSeconds, recordPlan, type RecordPlan } from './recording';

const TCD_NS = 'http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2';
const AX2_NS = 'http://www.garmin.com/xmlschemas/ActivityExtension/v2';
const SCHEMA_LOCATION = [
  TCD_NS,
  'http://www.garmin.com/xmlschemas/TrainingCenterDatabasev2.xsd',
  AX2_NS,
  'http://www.garmin.com/xmlschemas/ActivityExtensionv2.xsd',
].join(' ');

// Sport_t in TrainingCenterDatabasev2.xsd is the closed enum Running | Biking | Other. Strava's
// uploader also maps the strings "walking"/"hiking", but those make the file schema-invalid for
// every other importer, so walks and hikes ship as Other (Strava then applies the athlete's
// default sport). The FIT export carries the exact sport for users who need it.
const TCX_SPORT: Record<ActivityType, 'Running' | 'Biking' | 'Other'> = {
  run: 'Running',
  ride: 'Biking',
  walk: 'Other',
  hike: 'Other',
  alpine: 'Other',
};

const u16 = (v: number) => clamp(Math.round(v), 0, 65535);
const tag = (name: string, value: string | number) => `<${name}>${value}</${name}>`;
const hrTag = (name: string, bpm: number) => {
  const v = fileHeartRate(bpm);
  return v === undefined ? '' : `<${name}><Value>${v}</Value></${name}>`;
};

interface TcxContext {
  input: ExportInput;
  plan: RecordPlan;
  cadence: Int16Array;
}

function trackpoint({ input, cadence }: TcxContext, i: number): string {
  const { result, session } = input;
  const s = result.streams;
  const ride = session.type === 'ride';
  const position = hasPosition(s, i)
    ? `<Position>${tag('LatitudeDegrees', fixed(s.lat[i], 7))}${tag('LongitudeDegrees', fixed(normalizeLon(s.lon[i]), 7))}</Position>`
    : '';
  const tpx =
    (Number.isFinite(s.speed[i]) ? tag('ns3:Speed', fixed(Math.max(0, s.speed[i]), 3)) : '') +
    (ride ? '' : tag('ns3:RunCadence', cadence[i])) +
    (ride && Number.isFinite(s.power[i]) ? tag('ns3:Watts', u16(s.power[i])) : '');
  return (
    '     <Trackpoint>' +
    tag('Time', isoUtc(sampleEpochSeconds(session.startTime, s.t[i]))) +
    position +
    (Number.isFinite(s.ele[i]) ? tag('AltitudeMeters', fixed(s.ele[i], 1)) : '') +
    (Number.isFinite(s.dist[i]) ? tag('DistanceMeters', fixed(Math.max(0, s.dist[i]), 2)) : '') +
    hrTag('HeartRateBpm', s.hr[i]) +
    // Trackpoint Cadence is bike cadence per the AX2 XSD; foot cadence goes in TPX RunCadence.
    (ride ? tag('Cadence', cadence[i]) : '') +
    (tpx ? `<Extensions><ns3:TPX>${tpx}</ns3:TPX></Extensions>` : '') +
    '</Trackpoint>'
  );
}

function lapLines(ctx: TcxContext, lap: ExportLap): string[] {
  const { input, plan } = ctx;
  const { result, session } = input;
  const s = result.streams;
  const type = session.type;
  const ride = type === 'ride';
  const startSec = sampleEpochSeconds(session.startTime, s.t[lap.start]);
  // TotalTimeSeconds is timer time, so auto-paused seconds are left out and AvgSpeed is distance over timer time.
  const timer = Math.max(0, lap.elapsed - pausedSeconds(plan, s.t, Math.max(0, lap.start - 1), lap.end - 1));
  const avgSpeed = timer > 0 ? Math.max(0, lap.distance) / timer : 0;

  // LX sequence: AvgSpeed, MaxBikeCadence, AvgRunCadence, MaxRunCadence, Steps, AvgWatts, MaxWatts.
  const lx =
    tag('ns3:AvgSpeed', fixed(avgSpeed, 3)) +
    (ride
      ? tag('ns3:MaxBikeCadence', wholeCadence(lap.maxCadence, type))
      : tag('ns3:AvgRunCadence', wholeCadence(lap.avgCadence, type)) +
        tag('ns3:MaxRunCadence', wholeCadence(lap.maxCadence, type)) +
        tag('ns3:Steps', u16(lap.cycles))) +
    (ride ? tag('ns3:AvgWatts', u16(lap.avgPower)) + tag('ns3:MaxWatts', u16(lap.maxPower)) : '');

  const lines = [
    `   <Lap StartTime="${isoUtc(startSec)}">`,
    `    ${tag('TotalTimeSeconds', fixed(timer, 1))}`,
    `    ${tag('DistanceMeters', fixed(Math.max(0, lap.distance), 2))}`,
    `    ${tag('MaximumSpeed', fixed(lap.maxSpeed, 3))}`,
    `    ${tag('Calories', u16(lap.calories))}`,
  ];
  const avgHr = hrTag('AverageHeartRateBpm', lap.avgHr);
  const maxHr = hrTag('MaximumHeartRateBpm', lap.maxHr);
  if (avgHr) lines.push(`    ${avgHr}`);
  if (maxHr) lines.push(`    ${maxHr}`);
  lines.push(`    ${tag('Intensity', 'Active')}`);
  if (ride) lines.push(`    ${tag('Cadence', wholeCadence(lap.avgCadence, type))}`);
  lines.push(`    ${tag('TriggerMethod', 'Distance')}`);
  // A new Track after each auto-pause, as Garmin Connect writes paused activities.
  const resumes = new Set(plan.pauses.map((p) => p.to));
  let open = false;
  for (let i = lap.start; i < lap.end; i++) {
    if (!plan.written[i]) continue;
    if (open && resumes.has(i)) {
      lines.push('    </Track>');
      open = false;
    }
    if (!open) {
      lines.push('    <Track>');
      open = true;
    }
    lines.push(trackpoint(ctx, i));
  }
  if (open) lines.push('    </Track>');
  lines.push(`    <Extensions><ns3:LX>${lx}</ns3:LX></Extensions>`, '   </Lap>');
  return lines;
}

export function buildTcx(input: ExportInput): string {
  const { result, session, appName, appVersion } = input;
  const s = result.streams;
  assertSamples(s);
  const version = parseVersion(appVersion);
  const notes = session.description.trim();
  const ctx: TcxContext = { input, plan: recordPlan(input), cadence: wholeCadenceSeries(s.cadence, session.type) };

  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<TrainingCenterDatabase xmlns="${TCD_NS}" xmlns:ns3="${AX2_NS}" xmlns:xsi="${XSI_NS}" xsi:schemaLocation="${SCHEMA_LOCATION}">`,
    ' <Activities>',
    `  <Activity Sport="${TCX_SPORT[session.type]}">`,
    `   ${tag('Id', isoUtc(sampleEpochSeconds(session.startTime, s.t[0])))}`,
  ];
  for (const lap of exportLaps(result)) lines.push(...lapLines(ctx, lap));
  if (notes) lines.push(`   ${tag('Notes', xmlEscape(notes))}`);
  // Creator is optional in Activity_t; without an app name the block is left out entirely.
  if (appName.trim()) {
    lines.push(
      '   <Creator xsi:type="Device_t">',
      `    ${tag('Name', xmlEscape(appName.trim()))}`,
      // Honest provenance: no unit id or product id of a real device.
      `    ${tag('UnitId', 0)}`,
      `    ${tag('ProductID', 0)}`,
      `    <Version>${tag('VersionMajor', version.major)}${tag('VersionMinor', version.minor)}${tag('BuildMajor', version.patch)}${tag('BuildMinor', 0)}</Version>`,
      '   </Creator>',
    );
  }
  lines.push('  </Activity>', ' </Activities>', '</TrainingCenterDatabase>', '');
  return lines.join('\n');
}
