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
  xmlEscape,
} from './common';
import { exportLaps, type ExportLap } from './laps';

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
};

const u16 = (v: number) => clamp(Math.round(v), 0, 65535);
const tag = (name: string, value: string | number) => `<${name}>${value}</${name}>`;
const hrTag = (name: string, bpm: number) => {
  const v = fileHeartRate(bpm);
  return v === undefined ? '' : `<${name}><Value>${v}</Value></${name}>`;
};

function trackpoint(input: ExportInput, i: number): string {
  const { result, session } = input;
  const s = result.streams;
  const type = session.type;
  const ride = type === 'ride';
  const position = hasPosition(s, i)
    ? `<Position>${tag('LatitudeDegrees', fixed(s.lat[i], 7))}${tag('LongitudeDegrees', fixed(normalizeLon(s.lon[i]), 7))}</Position>`
    : '';
  const tpx =
    (Number.isFinite(s.speed[i]) ? tag('ns3:Speed', fixed(Math.max(0, s.speed[i]), 3)) : '') +
    (ride ? '' : tag('ns3:RunCadence', wholeCadence(s.cadence[i], type))) +
    (ride && Number.isFinite(s.power[i]) ? tag('ns3:Watts', u16(s.power[i])) : '');
  return (
    '     <Trackpoint>' +
    tag('Time', isoUtc(sampleEpochSeconds(session.startTime, s.t[i]))) +
    position +
    (Number.isFinite(s.ele[i]) ? tag('AltitudeMeters', fixed(s.ele[i], 1)) : '') +
    (Number.isFinite(s.dist[i]) ? tag('DistanceMeters', fixed(Math.max(0, s.dist[i]), 2)) : '') +
    hrTag('HeartRateBpm', s.hr[i]) +
    // Trackpoint Cadence is bike cadence per the AX2 XSD; foot cadence goes in TPX RunCadence.
    (ride ? tag('Cadence', wholeCadence(s.cadence[i], type)) : '') +
    (tpx ? `<Extensions><ns3:TPX>${tpx}</ns3:TPX></Extensions>` : '') +
    '</Trackpoint>'
  );
}

function lapLines(input: ExportInput, lap: ExportLap): string[] {
  const { result, session } = input;
  const type = session.type;
  const ride = type === 'ride';
  const startSec = sampleEpochSeconds(session.startTime, result.streams.t[lap.start]);

  // LX sequence: AvgSpeed, MaxBikeCadence, AvgRunCadence, MaxRunCadence, Steps, AvgWatts, MaxWatts.
  const lx =
    tag('ns3:AvgSpeed', fixed(Math.max(0, lap.avgSpeed), 3)) +
    (ride
      ? tag('ns3:MaxBikeCadence', wholeCadence(lap.maxCadence, type))
      : tag('ns3:AvgRunCadence', wholeCadence(lap.avgCadence, type)) +
        tag('ns3:MaxRunCadence', wholeCadence(lap.maxCadence, type)) +
        tag('ns3:Steps', u16(lap.cycles))) +
    (ride ? tag('ns3:AvgWatts', u16(lap.avgPower)) + tag('ns3:MaxWatts', u16(lap.maxPower)) : '');

  const lines = [
    `   <Lap StartTime="${isoUtc(startSec)}">`,
    // No timer pauses are modelled, so timer time equals elapsed time.
    `    ${tag('TotalTimeSeconds', fixed(Math.max(0, lap.elapsed), 1))}`,
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
  lines.push(`    ${tag('TriggerMethod', 'Distance')}`, '    <Track>');
  for (let i = lap.start; i < lap.end; i++) lines.push(trackpoint(input, i));
  lines.push('    </Track>', `    <Extensions><ns3:LX>${lx}</ns3:LX></Extensions>`, '   </Lap>');
  return lines;
}

export function buildTcx(input: ExportInput): string {
  const { result, session, appName, appVersion } = input;
  const s = result.streams;
  assertSamples(s);
  const version = parseVersion(appVersion);
  const notes = session.description.trim();

  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<TrainingCenterDatabase xmlns="${TCD_NS}" xmlns:ns3="${AX2_NS}" xmlns:xsi="${XSI_NS}" xsi:schemaLocation="${SCHEMA_LOCATION}">`,
    ' <Activities>',
    `  <Activity Sport="${TCX_SPORT[session.type]}">`,
    `   ${tag('Id', isoUtc(sampleEpochSeconds(session.startTime, s.t[0])))}`,
  ];
  for (const lap of exportLaps(result)) lines.push(...lapLines(input, lap));
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
