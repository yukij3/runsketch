// GPX 1.1 with Garmin TrackPointExtension v1 (the version Strava documents reading hr/cad/atemp from).
import type { ActivityType, ExportInput } from '../types';
import {
  XSI_NS,
  activityTitle,
  assertSamples,
  creatorName,
  fileHeartRate,
  fileTemperature,
  fixed,
  hasPosition,
  isoUtc,
  normalizeLon,
  sampleEpochSeconds,
  wholeCadenceSeries,
  xmlEscape,
} from './common';
import { recordPlan } from './recording';

const GPX_NS = 'http://www.topografix.com/GPX/1/1';
const TPX_NS = 'http://www.garmin.com/xmlschemas/TrackPointExtension/v1';
const SCHEMA_LOCATION = [
  GPX_NS,
  'http://www.topografix.com/GPX/1/1/gpx.xsd',
  TPX_NS,
  'http://www.garmin.com/xmlschemas/TrackPointExtensionv1.xsd',
].join(' ');

// GPX 1.1 leaves <type> free-form; these are the words Garmin Connect writes.
const GPX_TYPE: Record<ActivityType, string> = {
  run: 'running',
  ride: 'cycling',
  walk: 'walking',
  hike: 'hiking',
  alpine: 'mountaineering',
};

/**
 * GPX has no timer events, so an auto-pause is a time gap inside the one track segment, as in a device's own GPX
 * export; skipped seconds are gaps too (see recordPlan).
 */
export function buildGpx(input: ExportInput): string {
  const { result, session, appName, appVersion } = input;
  const s = result.streams;
  const n = assertSamples(s);
  const plan = recordPlan(input);
  const cadence = wholeCadenceSeries(s.cadence, session.type);
  const title = xmlEscape(activityTitle(session));
  const desc = session.description.trim();
  const descLine = (indent: string) => (desc ? [`${indent}<desc>${xmlEscape(desc)}</desc>`] : []);

  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<gpx version="1.1" creator="${xmlEscape(creatorName(appName, appVersion))}" xmlns="${GPX_NS}" xmlns:gpxtpx="${TPX_NS}" xmlns:xsi="${XSI_NS}" xsi:schemaLocation="${SCHEMA_LOCATION}">`,
    ' <metadata>',
    `  <name>${title}</name>`,
    ...descLine('  '),
    `  <time>${isoUtc(sampleEpochSeconds(session.startTime, s.t[0]))}</time>`,
    ' </metadata>',
    ' <trk>',
    `  <name>${title}</name>`,
    ...descLine('  '),
    `  <type>${GPX_TYPE[session.type]}</type>`,
    '  <trkseg>',
  ];

  for (let i = 0; i < n; i++) {
    if (!plan.written[i] || !hasPosition(s, i)) continue; // lat/lon are required attributes of wptType
    const hr = fileHeartRate(s.hr[i]);
    const temperature = fileTemperature(s, session, i);
    // TPX v1 sequence is atemp, wtemp, depth, hr, cad; atemp is the device's temperature sensor.
    const ext =
      (temperature !== undefined ? `<gpxtpx:atemp>${fixed(temperature, 1)}</gpxtpx:atemp>` : '') +
      (hr !== undefined ? `<gpxtpx:hr>${hr}</gpxtpx:hr>` : '') +
      `<gpxtpx:cad>${cadence[i]}</gpxtpx:cad>`;
    lines.push(
      `   <trkpt lat="${fixed(s.lat[i], 7)}" lon="${fixed(normalizeLon(s.lon[i]), 7)}">` +
        (Number.isFinite(s.ele[i]) ? `<ele>${fixed(s.ele[i], 1)}</ele>` : '') +
        `<time>${isoUtc(sampleEpochSeconds(session.startTime, s.t[i]))}</time>` +
        `<extensions><gpxtpx:TrackPointExtension>${ext}</gpxtpx:TrackPointExtension></extensions>` +
        '</trkpt>',
    );
  }

  lines.push('  </trkseg>', ' </trk>', '</gpx>', '');
  return lines.join('\n');
}
