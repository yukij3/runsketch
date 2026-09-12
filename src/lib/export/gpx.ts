// GPX 1.1 with Garmin TrackPointExtension v1 (the version Strava documents reading hr/cad/atemp from).
import type { ActivityType, ExportInput } from '../types';
import {
  XSI_NS,
  activityTitle,
  assertSamples,
  creatorName,
  fileHeartRate,
  fixed,
  hasPosition,
  isoUtc,
  normalizeLon,
  sampleEpochSeconds,
  wholeCadence,
  xmlEscape,
} from './common';

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
};

export function buildGpx(input: ExportInput): string {
  const { result, session, appName, appVersion } = input;
  const s = result.streams;
  const n = assertSamples(s);
  const title = xmlEscape(activityTitle(session));
  const desc = session.description.trim();
  const descLine = (indent: string) => (desc ? [`${indent}<desc>${xmlEscape(desc)}</desc>`] : []);
  // Ambient temperature is constant for the session; TPX v1 sequence is atemp, wtemp, depth, hr, cad.
  const atemp = Number.isFinite(session.temperatureC)
    ? `<gpxtpx:atemp>${fixed(session.temperatureC, 1)}</gpxtpx:atemp>`
    : '';

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
    if (!hasPosition(s, i)) continue; // lat/lon are required attributes of wptType
    const hr = fileHeartRate(s.hr[i]);
    const ext = `${atemp}${hr !== undefined ? `<gpxtpx:hr>${hr}</gpxtpx:hr>` : ''}<gpxtpx:cad>${wholeCadence(s.cadence[i], session.type)}</gpxtpx:cad>`;
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
