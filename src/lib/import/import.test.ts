// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type { LngLat } from '../types';
import { FIXTURE_NAME, makeExportInput } from '../export/__fixtures__/activity';
import { buildGpx, buildTcx } from '../export';
import { recordPlan } from '../export/recording';
import { RouteImportError, parseRouteFile } from './index';

function expectedCoords(): LngLat[] {
  const input = makeExportInput('run');
  const s = input.result.streams;
  const { written } = recordPlan(input);
  const coords = Array.from(s.lat, (lat, i): LngLat => [Number(s.lon[i].toFixed(7)), Number(lat.toFixed(7))]).filter(
    (_, i) => written[i] === 1,
  );
  return coords.filter((c, i) => i === 0 || c[0] !== coords[i - 1][0] || c[1] !== coords[i - 1][1]);
}

describe('parseRouteFile', () => {
  it('round-trips a generated GPX into coordinates and the track name', () => {
    const route = parseRouteFile(buildGpx(makeExportInput('run')), 'run.gpx');
    expect(route.name).toBe(FIXTURE_NAME);
    expect(route.coords).toEqual(expectedCoords());
    expect(route.coords.length).toBeLessThan(120); // the stop's repeated points are dropped
  });

  it('round-trips a generated TCX into coordinates', () => {
    const route = parseRouteFile(buildTcx(makeExportInput('run')), 'run.tcx');
    expect(route.coords).toEqual(expectedCoords());
    expect(route.name).toBeUndefined();
  });

  it('falls back from tracks to routes to waypoints, ignoring namespace prefixes', () => {
    const rte = `<?xml version="1.0"?>
      <g:gpx xmlns:g="http://www.topografix.com/GPX/1/1" version="1.1" creator="x">
        <g:metadata><g:name>Meta</g:name></g:metadata>
        <g:rte><g:name>Planned loop</g:name>
          <g:rtept lat="45.1" lon="7.1"><g:name>A</g:name></g:rtept>
          <g:rtept lat="45.2" lon="7.2"/>
        </g:rte>
      </g:gpx>`;
    expect(parseRouteFile(rte, 'loop.gpx')).toEqual({ name: 'Planned loop', coords: [[7.1, 45.1], [7.2, 45.2]] });

    const wpt = `﻿  <?xml version="1.0"?><gpx version="1.0"><name>Old style</name>
      <wpt lat="-33.9" lon="151.2"/><wpt lat="bad" lon="1"/><wpt lat="-33.8" lon="151.3"/></gpx>`;
    expect(parseRouteFile(wpt, 'pts.gpx')).toEqual({ name: 'Old style', coords: [[151.2, -33.9], [151.3, -33.8]] });
  });

  it('reads TCX courses and skips trackpoints without a position', () => {
    const tcx = `<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2">
      <Courses><Course><Name>Hill reps</Name><Track>
        <Trackpoint><Time>2026-01-01T00:00:00Z</Time></Trackpoint>
        <Trackpoint><Position><LatitudeDegrees>1.5</LatitudeDegrees><LongitudeDegrees>2.5</LongitudeDegrees></Position></Trackpoint>
        <Trackpoint><Position><LatitudeDegrees>1.6</LatitudeDegrees><LongitudeDegrees>2.6</LongitudeDegrees></Position></Trackpoint>
      </Track></Course></Courses></TrainingCenterDatabase>`;
    expect(parseRouteFile(tcx, 'course.tcx')).toEqual({ name: 'Hill reps', coords: [[2.5, 1.5], [2.6, 1.6]] });
  });

  it('throws readable errors for malformed, empty, unsupported and point-less files', () => {
    expect(() => parseRouteFile('<gpx><trk><trkpt lat="1" lon="2"></trk></gpx>', 'bad.gpx')).toThrow(
      /^This file is not valid XML/,
    );
    expect(() => parseRouteFile('   ', 'empty.gpx')).toThrow('The file is empty');
    expect(() => parseRouteFile('<kml><Document/></kml>', 'x.kml')).toThrow(/expected GPX or TCX.*<kml>/);
    expect(() => parseRouteFile('<gpx version="1.1"><trk><trkseg/></trk></gpx>', 'x.gpx')).toThrow(
      'No track points found in this file',
    );
    expect(() => parseRouteFile('<gpx><wpt lat="1" lon="2"/></gpx>', 'x.gpx')).toThrow(/only one point/);
    expect(() => parseRouteFile('', 'activity.FIT')).toThrow(/FIT files cannot be imported/);
  });

  it('tags every failure with a code for localized messages', () => {
    const codeOf = (text: string, name: string) => {
      try {
        parseRouteFile(text, name);
      } catch (err) {
        expect(err).toBeInstanceOf(RouteImportError);
        return [(err as RouteImportError).code, (err as RouteImportError).detail];
      }
      return null;
    };
    expect(codeOf('<gpx><trk>', 'bad.gpx')?.[0]).toBe('invalidXml');
    expect(codeOf(' ', 'e.gpx')).toEqual(['empty', undefined]);
    expect(codeOf('<kml/>', 'x.kml')).toEqual(['unsupported', 'kml']);
    expect(codeOf('<gpx/>', 'x.gpx')).toEqual(['noPoints', undefined]);
    expect(codeOf('<gpx><wpt lat="1" lon="2"/></gpx>', 'x.gpx')).toEqual(['onePoint', undefined]);
    expect(codeOf('', 'a.fit')).toEqual(['fit', undefined]);
  });
});
