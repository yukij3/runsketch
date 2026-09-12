import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import FitParser from 'fit-file-parser';
import { afterAll, describe, expect, it } from 'vitest';
import type { ActivityType, ExportInput } from '../types';
import {
  FIXTURE_CALORIES,
  FIXTURE_DESCRIPTION,
  FIXTURE_SAMPLES,
  FIXTURE_START,
  FIXTURE_STOP,
  FIXTURE_UTC_OFFSET_MIN,
  fixtureLapBoundary,
  makeExportInput,
} from './__fixtures__/activity';
import { buildFit, buildGpx, buildTcx, exportActivity, exportFilename, slugify } from './index';
import { apportion } from './laps';

const XSD_DIR = fileURLToPath(new URL('./__fixtures__/xsd/', import.meta.url));
const hasXmllint = !spawnSync('xmllint', ['--version']).error;
const tmp = mkdtempSync(join(tmpdir(), 'runsketch-export-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

function validate(xml: string, wrapper: 'gpx-tpx1.xsd' | 'tcx-ax2.xsd', label: string) {
  const file = join(tmp, `${label}.xml`);
  writeFileSync(file, xml, 'utf8');
  const run = spawnSync('xmllint', ['--noout', '--nonet', '--schema', join(XSD_DIR, wrapper), file], {
    encoding: 'utf8',
  });
  return { status: run.status, stderr: run.stderr.trim() };
}

const TYPES: ActivityType[] = ['run', 'ride', 'walk', 'hike'];
const count = (text: string, needle: string) => text.split(needle).length - 1;
const iso = (ms: number) => new Date(ms).toISOString().replace('.000Z', 'Z');

/** An input whose streams hold out-of-range values that must be clamped to stay schema-valid. */
function extremeInput(type: ActivityType): ExportInput {
  const input = makeExportInput(type, { name: 'Ctlchars <&>', description: ']]> "q" \'a\'' });
  const s = input.result.streams;
  s.cadence.fill(999);
  s.hr.fill(300);
  s.hr[3] = 0;
  s.hr[4] = Number.NaN;
  s.power.fill(1e6);
  s.lon[5] = 180;
  s.ele[6] = Number.NaN;
  return input;
}

describe('GPX', () => {
  it('writes metadata, escaped text, sport type and one trkpt per second', () => {
    const gpx = buildGpx(makeExportInput('run'));
    expect(gpx).toContain('creator="Runsketch 0.1.0"');
    expect(gpx).toContain('<name>Tempo &lt;Run&gt; &amp; &quot;Hills&quot;</name>');
    expect(gpx).toContain('<desc>Easy &apos;shakeout&apos; &amp; strides — утро</desc>');
    expect(gpx).toContain(`<time>${iso(FIXTURE_START)}</time>`);
    expect(gpx).toContain('<type>running</type>');
    expect(count(gpx, '<trkpt ')).toBe(FIXTURE_SAMPLES);
    expect(gpx).toMatch(/<trkpt lat="52\.5200000" lon="13\.4050000"><ele>34\.0<\/ele><time>2026-09-12T07:00:00Z<\/time>/);
    expect(gpx).toContain(`<time>${iso(FIXTURE_START + 119_000)}</time>`);
  });

  it('halves foot cadence to strides/min and keeps TPX order atemp, hr, cad', () => {
    const input = makeExportInput('run');
    const gpx = buildGpx(input);
    const first = gpx.split('<trkpt ')[1];
    const hr = Math.round(input.result.streams.hr[0]);
    expect(first).toContain(
      `<gpxtpx:TrackPointExtension><gpxtpx:atemp>18.0</gpxtpx:atemp><gpxtpx:hr>${hr}</gpxtpx:hr><gpxtpx:cad>85</gpxtpx:cad></gpxtpx:TrackPointExtension>`,
    );
    const stopped = gpx.split('<trkpt ')[FIXTURE_STOP.from + 1];
    expect(stopped).toContain('<gpxtpx:cad>0</gpxtpx:cad>');
  });

  it('writes ride cadence as rpm and the cycling type', () => {
    const gpx = buildGpx(makeExportInput('ride'));
    expect(gpx).toContain('<type>cycling</type>');
    expect(gpx.split('<trkpt ')[1]).toContain('<gpxtpx:cad>88</gpxtpx:cad>');
  });

  it('throws a readable error for an empty activity', () => {
    const input = makeExportInput('run');
    input.result.streams.t = new Float64Array(0);
    expect(() => buildGpx(input)).toThrow('Nothing to export');
  });

  describe.skipIf(!hasXmllint)('validates against gpx.xsd + TrackPointExtensionv1.xsd', () => {
    it('rejects a document that breaks the TPX sequence (validator sanity check)', () => {
      const broken = buildGpx(makeExportInput('run')).replace(
        /(<gpxtpx:hr>\d+<\/gpxtpx:hr>)(<gpxtpx:cad>\d+<\/gpxtpx:cad>)/,
        '$2$1',
      );
      const result = validate(broken, 'gpx-tpx1.xsd', 'gpx-broken');
      expect(result.status).not.toBe(0);
      expect(result.stderr).toMatch(/not expected/);
    });
    for (const type of TYPES) {
      it(type, () => {
        expect(validate(buildGpx(makeExportInput(type)), 'gpx-tpx1.xsd', `gpx-${type}`)).toMatchObject({ status: 0 });
      });
    }
    it('with blank text fields and clamped extreme values', () => {
      expect(validate(buildGpx(extremeInput('run')), 'gpx-tpx1.xsd', 'gpx-extreme')).toMatchObject({ status: 0 });
      const blank = makeExportInput('hike', { name: '  ', description: '' });
      expect(validate(buildGpx(blank), 'gpx-tpx1.xsd', 'gpx-blank')).toMatchObject({ status: 0 });
    });
  });
});

describe('TCX', () => {
  it('writes one Lap per summary lap covering every trackpoint once', () => {
    const input = makeExportInput('run');
    const tcx = buildTcx(input);
    const boundary = fixtureLapBoundary(input);
    expect(tcx).toContain('<Activity Sport="Running">');
    expect(tcx).toContain(`<Id>${iso(FIXTURE_START)}</Id>`);
    expect(count(tcx, '<Lap StartTime=')).toBe(2);
    expect(tcx).toContain(`<Lap StartTime="${iso(FIXTURE_START + boundary * 1000)}">`);
    expect(count(tcx, '<Trackpoint>')).toBe(FIXTURE_SAMPLES);
    const laps = tcx.split('<Lap StartTime=').slice(1);
    expect(count(laps[0], '<Trackpoint>')).toBe(boundary);
    expect(tcx).toContain('<TriggerMethod>Distance</TriggerMethod>');
    expect(tcx).toContain('<Notes>Easy &apos;shakeout&apos; &amp; strides — утро</Notes>');
    expect(tcx).toMatch(/<Creator xsi:type="Device_t">\s*<Name>Runsketch<\/Name>/);
  });

  it('puts foot cadence in RunCadence as strides/min and never in Trackpoint Cadence', () => {
    const tcx = buildTcx(makeExportInput('run'));
    expect(tcx).toContain('<ns3:RunCadence>85</ns3:RunCadence>');
    expect(tcx).not.toMatch(/<Cadence>/);
    expect(tcx).not.toContain('<ns3:Watts>');
    const calories = [...tcx.matchAll(/<Calories>(\d+)<\/Calories>/g)].map((m) => Number(m[1]));
    expect(calories.reduce((a, b) => a + b, 0)).toBe(FIXTURE_CALORIES);
  });

  it('writes bike cadence and watts for rides', () => {
    const tcx = buildTcx(makeExportInput('ride'));
    expect(tcx).toContain('<Activity Sport="Biking">');
    expect(tcx).toMatch(/<Cadence>8[78]<\/Cadence>/);
    expect(tcx).toContain('<ns3:Watts>');
    expect(tcx).toContain('<ns3:AvgWatts>');
    expect(tcx).not.toContain('RunCadence');
  });

  it('maps walks and hikes to Other (the XSD enum has no walking/hiking)', () => {
    expect(buildTcx(makeExportInput('walk'))).toContain('<Activity Sport="Other">');
    expect(buildTcx(makeExportInput('hike'))).toContain('<Activity Sport="Other">');
  });

  describe.skipIf(!hasXmllint)('validates against TrainingCenterDatabasev2.xsd + ActivityExtensionv2.xsd', () => {
    for (const type of TYPES) {
      it(type, () => {
        expect(validate(buildTcx(makeExportInput(type)), 'tcx-ax2.xsd', `tcx-${type}`)).toMatchObject({ status: 0 });
      });
    }
    it('with clamped extreme values and a summary without laps', () => {
      for (const type of ['run', 'ride'] as const) {
        expect(validate(buildTcx(extremeInput(type)), 'tcx-ax2.xsd', `tcx-extreme-${type}`)).toMatchObject({
          status: 0,
        });
      }
      const noLaps = makeExportInput('run', { description: '' });
      noLaps.result.summary.laps = [];
      const tcx = buildTcx(noLaps);
      expect(count(tcx, '<Lap StartTime=')).toBe(1);
      expect(validate(tcx, 'tcx-ax2.xsd', 'tcx-nolaps')).toMatchObject({ status: 0 });
    });
  });
});

type ParsedFit = Awaited<ReturnType<FitParser['parseAsync']>>;

async function decodeFit(input: ExportInput): Promise<ParsedFit> {
  const bytes = buildFit(input);
  const parser = new FitParser({ mode: 'list', speedUnit: 'm/s', lengthUnit: 'm', force: false });
  return parser.parseAsync(bytes.slice().buffer);
}

const ms = (v: unknown) => new Date(v as string).getTime();

// FIT SDK CRC-16 (nibble table). A block followed by its own CRC checks to 0.
const CRC_TABLE = [
  0x0000, 0xcc01, 0xd801, 0x1400, 0xf001, 0x3c00, 0x2800, 0xe401, 0xa001, 0x6c00, 0x7800, 0xb401, 0x5000, 0x9c01,
  0x8801, 0x4400,
];
function fitCrc(bytes: Uint8Array): number {
  let crc = 0;
  for (const byte of bytes) {
    let tmp = CRC_TABLE[crc & 0xf];
    crc = ((crc >> 4) & 0x0fff) ^ tmp ^ CRC_TABLE[byte & 0xf];
    tmp = CRC_TABLE[crc & 0xf];
    crc = ((crc >> 4) & 0x0fff) ^ tmp ^ CRC_TABLE[(byte >> 4) & 0xf];
  }
  return crc;
}

describe('FIT', () => {
  it('has a 14-byte header with the right data size and valid header and file CRCs', () => {
    const bytes = buildFit(makeExportInput('run'));
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    expect(bytes[0]).toBe(14);
    expect(new TextDecoder().decode(bytes.subarray(8, 12))).toBe('.FIT');
    expect(view.getUint32(4, true)).toBe(bytes.length - 16);
    expect(fitCrc(bytes.subarray(0, 14))).toBe(0);
    expect(fitCrc(bytes)).toBe(0);
    // Same seed and inputs → identical bytes.
    expect(buildFit(makeExportInput('run'))).toEqual(bytes);
  });

  it('decodes a running activity with records, laps, session and activity', async () => {
    const input = makeExportInput('run');
    const { streams: s, summary } = input.result;
    const fit = await decodeFit(input);

    expect(fit.file_ids?.[0]).toMatchObject({ type: 'activity', manufacturer: 'development', product: 0 });
    expect(fit.device_infos?.[0]).toMatchObject({ product_name: 'Runsketch', software_version: 0.01 });

    const records = fit.records ?? [];
    expect(records).toHaveLength(FIXTURE_SAMPLES);
    expect(ms(records[0].timestamp)).toBe(FIXTURE_START);
    expect(ms(records[FIXTURE_SAMPLES - 1].timestamp)).toBe(FIXTURE_START + 119_000);
    expect(records[0].position_lat).toBeCloseTo(52.52, 6);
    expect(records[0].position_long).toBeCloseTo(13.405, 6);
    expect(records.map((r) => r.heart_rate)).toEqual(Array.from(s.hr, (v) => Math.round(v)));
    // 171 spm → 85 strides + 0.5; 170 spm → 85 + 0.
    expect(records[0]).toMatchObject({ cadence: 85, fractional_cadence: 0.5 });
    expect(records[1]).toMatchObject({ cadence: 85, fractional_cadence: 0 });
    expect(records[FIXTURE_STOP.from]).toMatchObject({ cadence: 0, enhanced_speed: 0 });
    expect(records[10].enhanced_speed).toBeCloseTo(s.speed[10], 3);
    expect(records[10].distance).toBeCloseTo(s.dist[10], 2);
    // enhanced_altitude has 0.2 m resolution (scale 5).
    expect(Math.abs((records[10].enhanced_altitude ?? Number.NaN) - s.ele[10])).toBeLessThanOrEqual(0.1);
    expect(records[10].temperature).toBe(18);
    expect(records[10].power).toBeUndefined();

    const events = fit.events ?? [];
    expect(events.map((e) => [e.event, e.event_type])).toEqual([
      ['timer', 'start'],
      ['timer', 'stop_all'],
    ]);

    const laps = fit.laps ?? [];
    expect(laps).toHaveLength(2);
    expect(ms(laps[1].start_time)).toBe(FIXTURE_START + fixtureLapBoundary(input) * 1000);
    expect(laps.reduce((a, l) => a + (l.total_calories as number), 0)).toBe(FIXTURE_CALORIES);
    expect(laps[0].lap_trigger).toBe('distance');
    expect(laps[1].lap_trigger).toBe('session_end');

    const session = fit.sessions?.[0];
    expect(session).toMatchObject({
      sport: 'running',
      sub_sport: 'generic',
      num_laps: 2,
      total_elapsed_time: summary.elapsed,
      total_timer_time: summary.elapsed,
      total_calories: FIXTURE_CALORIES,
      total_ascent: Math.round(summary.ascent),
      total_descent: Math.round(summary.descent),
      avg_heart_rate: Math.round(summary.avgHr),
      max_heart_rate: Math.round(summary.maxHr),
      avg_cadence: Math.floor(Math.round(summary.avgCadence) / 2),
      max_cadence: 85,
    });
    expect(session?.total_distance).toBeCloseTo(summary.distance, 2);
    expect(session?.avg_speed).toBeCloseTo(summary.avgSpeed, 3);
    expect(ms(session?.start_time)).toBe(FIXTURE_START);

    expect(fit.activity).toMatchObject({ num_sessions: 1, type: 'manual' });
    expect(ms(fit.activity.local_timestamp) - ms(fit.activity.timestamp)).toBe(FIXTURE_UTC_OFFSET_MIN * 60_000);
  });

  it('writes rides as cycling/road with rpm cadence and power', async () => {
    const input = makeExportInput('ride');
    const fit = await decodeFit(input);
    const records = fit.records ?? [];
    expect(fit.sessions?.[0]).toMatchObject({ sport: 'cycling', sub_sport: 'road' });
    expect(records[0].cadence).toBe(88);
    expect(records[0].fractional_cadence).toBeUndefined();
    expect(records[3].power).toBe(Math.round(input.result.streams.power[3]));
    expect(fit.sessions?.[0].avg_power).toBe(Math.round(input.result.summary.avgPower));
  });

  it.each([
    ['walk', 'walking'],
    ['hike', 'hiking'],
  ] as const)('maps %s to sport %s', async (type, sport) => {
    const fit = await decodeFit(makeExportInput(type));
    expect(fit.sessions?.[0]).toMatchObject({ sport, sub_sport: 'generic' });
    expect(fit.laps).toHaveLength(2);
  });

  it('survives out-of-range and missing samples', async () => {
    const fit = await decodeFit(extremeInput('run'));
    const records = fit.records ?? [];
    expect(records).toHaveLength(FIXTURE_SAMPLES);
    expect(records[0]).toMatchObject({ heart_rate: 254, cadence: 254 });
    expect(records[4].heart_rate).toBeUndefined();
    expect(records[6].enhanced_altitude).toBeUndefined();
  });
});

describe('exportActivity', () => {
  it.each([
    ['gpx', 'application/gpx+xml'],
    ['tcx', 'application/vnd.garmin.tcx+xml'],
    ['fit', 'application/vnd.ant.fit'],
  ] as const)('%s → filename, mime and blob', async (format, mime) => {
    const out = exportActivity(format, makeExportInput('run'));
    expect(out.filename).toBe(`2026-09-12_0900_run_tempo-run-hills.${format}`);
    expect(out.mime).toBe(mime);
    expect(out.blob.type).toBe(mime);
    const bytes = new Uint8Array(await out.blob.arrayBuffer());
    expect(bytes.length).toBeGreaterThan(1000);
    if (format === 'fit') expect(new TextDecoder().decode(bytes.subarray(8, 12))).toBe('.FIT');
    else expect(new TextDecoder().decode(bytes.subarray(0, 5))).toBe('<?xml');
  });

  it('names blank sessions after the local part of day and keeps non-Latin letters', () => {
    const base = makeExportInput('ride').session;
    expect(exportFilename('fit', { ...base, name: '' })).toBe('2026-09-12_0900_ride_morning-ride.fit');
    expect(exportFilename('gpx', { ...base, name: 'Утренний бег, Crème brûlée!' })).toBe(
      '2026-09-12_0900_ride_утренний-бег-creme-brulee.gpx',
    );
    expect(exportFilename('gpx', { ...base, name: '***', utcOffsetMin: -300 })).toBe('2026-09-12_0200_ride_ride.gpx');
    expect(slugify('Й ё')).toBe('й-ё');
  });

  it('reads the description into GPX and TCX identically', () => {
    const input = makeExportInput('walk');
    expect(buildGpx(input)).toContain('strides — утро');
    expect(buildTcx(input)).toContain('strides — утро');
    expect(FIXTURE_DESCRIPTION).toContain('утро');
  });
});

describe('apportion', () => {
  it('splits an integer total by weight with no rounding loss', () => {
    expect(apportion(27, [1, 1, 1])).toEqual([9, 9, 9]);
    expect(apportion(10, [1, 1, 1])).toEqual([4, 3, 3]);
    expect(apportion(5, [0, 0])).toEqual([5, 0]);
  });
});

describe('files without an app name', () => {
  const anonymous = (type: ActivityType) => ({ ...makeExportInput(type), appName: '' });

  it('writes an empty GPX creator, no TCX Creator and no FIT product name or version', async () => {
    const gpx = buildGpx(anonymous('run'));
    const tcx = buildTcx(anonymous('ride'));
    expect(gpx).toContain('creator=""');
    expect(gpx).not.toContain('Runsketch');
    expect(tcx).not.toContain('<Creator');
    expect(tcx).not.toContain('Runsketch');
    const fit = await decodeFit(anonymous('run'));
    expect(fit.device_infos?.[0]).toMatchObject({ manufacturer: 'development', product: 0 });
    expect(fit.device_infos?.[0]?.product_name).toBeUndefined();
    expect(fit.device_infos?.[0]?.software_version).toBeUndefined();
  });

  it.skipIf(!hasXmllint)('stays schema-valid', () => {
    expect(validate(buildGpx(anonymous('run')), 'gpx-tpx1.xsd', 'anon-gpx')).toMatchObject({ status: 0 });
    expect(validate(buildTcx(anonymous('ride')), 'tcx-ax2.xsd', 'anon-tcx')).toMatchObject({ status: 0 });
  });
});
