import { describe, expect, it } from 'vitest';
import type { StyleSpecification } from 'maplibre-gl';
import { legKey } from '../../lib/route';
import type { RouteLeg, Waypoint } from '../../lib/types';
import { TICK_TEXT_PX, distanceTicks, nearestSample, placeTickLabels, routeFeatures, segmentBoxDist, type ScreenPoint } from './geometry';
import { DEM_SOURCE_ID, HILLSHADE_LAYER_ID, transformPositron } from './mapStyle';

const wps: Waypoint[] = [
  { id: 'a', lon: 0, lat: 0 },
  { id: 'b', lon: 0.01, lat: 0 },
  { id: 'c', lon: 0.02, lat: 0 },
];

describe('routeFeatures', () => {
  it('labels legs routed, fallback or pending and honours a drag override', () => {
    const k1 = legKey([0, 0], [0.01, 0], 'foot');
    const k2 = legKey([0.01, 0], [0.02, 0], 'foot');
    const routed: RouteLeg = { fromId: 'a', toId: 'b', coords: [[0, 0], [0.005, 0.001], [0.01, 0]], distance: 1100, provider: 'osrm', fallback: false };
    const legs = new Map([[k1, routed]]);
    const fc = routeFeatures(wps, 'foot', legs);
    expect(fc.features.map((f) => f.properties.kind)).toEqual(['routed', 'pending']);
    expect(fc.features[0].geometry.coordinates).toHaveLength(3);

    legs.set(k2, { ...routed, fromId: 'b', toId: 'c', provider: 'straight', fallback: true });
    expect(routeFeatures(wps, 'foot', legs).features.map((f) => f.properties.kind)).toEqual(['routed', 'fallback']);

    const dragged = routeFeatures(wps, 'foot', legs, { id: 'c', lon: 0.02, lat: 0.01 });
    expect(dragged.features.map((f) => f.properties.kind)).toEqual(['routed', 'pending']);
    expect(dragged.features[1].geometry.coordinates[1]).toEqual([0.02, 0.01]);
  });
});

describe('distanceTicks', () => {
  it('places one tick per whole unit, none at the finish, and thins long routes', () => {
    const line: Array<[number, number]> = [
      [0, 0],
      [0.04, 0],
    ];
    const ticks = distanceTicks(line, 1000);
    expect(ticks.features.map((f) => f.properties.label)).toEqual(['1', '2', '3', '4']);
    expect(ticks.features[0].geometry.coordinates[0]).toBeCloseTo(0.00898, 4);
    const labelled = distanceTicks(line, 1000, 'km').features[0].properties;
    expect(labelled.text).toBe('1 km');
    // Eastbound: the hairline turns a quarter across the route and the label sits below it, clear of the line.
    expect(labelled.rotate).toBe(90);
    expect(labelled.offset[0]).toBeCloseTo(0, 5);
    expect(labelled.offset[1]).toBeGreaterThan(1);

    const long = distanceTicks(
      [
        [0, 0],
        [1, 0],
      ],
      1000,
    );
    expect(long.features[0].properties.label).toBe('10');
    expect(distanceTicks(null, 1000).features).toEqual([]);
  });
});

describe('nearestSample', () => {
  it('finds the closest recorded sample', () => {
    const n = 20_000;
    const lat = new Float64Array(n);
    const lon = new Float64Array(n);
    for (let i = 0; i < n; i++) lon[i] = i * 1e-5;
    expect(nearestSample({ lat, lon }, 0.123456, 0.0001)).toBe(12346);
    expect(nearestSample({ lat: new Float64Array(0), lon: new Float64Array(0) }, 0, 0)).toBe(-1);
  });
});

describe('transformPositron', () => {
  it('hides POI-like layers, mutes labels and puts hillshade under roads', () => {
    const style = {
      version: 8,
      sources: { openmaptiles: { type: 'vector', url: 'https://tiles.openfreemap.org/planet' } },
      layers: [
        { id: 'background', type: 'background' },
        { id: 'park', type: 'fill', source: 'openmaptiles', 'source-layer': 'park' },
        { id: 'highway_path', type: 'line', source: 'openmaptiles', 'source-layer': 'transportation', paint: { 'line-color': '#eee' } },
        { id: 'poi_z16', type: 'symbol', source: 'openmaptiles', 'source-layer': 'poi' },
        { id: 'highway-shield-non-us', type: 'symbol', source: 'openmaptiles', 'source-layer': 'transportation_name' },
        { id: 'label_city', type: 'symbol', source: 'openmaptiles', 'source-layer': 'place', paint: { 'text-color': '#000' } },
      ],
    } as unknown as StyleSpecification;
    const out = transformPositron(style, 'https://tiles.mapterhorn.com/tilejson.json');
    expect(out.layers.map((l) => l.id)).toEqual(['background', 'park', HILLSHADE_LAYER_ID, 'highway_path', 'label_city']);
    expect(out.sources[DEM_SOURCE_ID]).toMatchObject({ type: 'raster-dem', encoding: 'terrarium' });
    const city = out.layers.find((l) => l.id === 'label_city') as { paint: Record<string, unknown> };
    expect(city.paint['text-color']).not.toBe('#000');
    expect(style.layers).toHaveLength(6);
  });
});

describe('placeTickLabels', () => {
  const box = (at: ScreenPoint, offset: [number, number], text: string) => {
    const cx = at[0] + offset[0] * TICK_TEXT_PX;
    const cy = at[1] + offset[1] * TICK_TEXT_PX;
    const w = text.length * 6;
    return { x0: cx - w / 2, y0: cy - 8, x1: cx + w / 2, y1: cy + 8 };
  };

  it('keeps labels off the route line, the markers and each other', () => {
    const ticks = distanceTicks(
      [
        [0, 0],
        [0.04, 0],
      ],
      1000,
      'km',
    );
    // Eastbound on screen along y = 100; a hairpin comes back just below the route, and a waypoint sits right of 2 km.
    const anchors: ScreenPoint[] = ticks.features.map((_, k) => [100 + k * 40, 100]);
    const lines: ScreenPoint[][] = [
      [
        [0, 100],
        [400, 100],
        [400, 122],
        [0, 122],
      ],
    ];
    const discs = [{ at: [140, 80] as ScreenPoint, r: 8 }];
    const placed = placeTickLabels(ticks, anchors, { lines, discs });
    const boxes = placed.features.map((f, k) => box(anchors[k], f.properties.offset, f.properties.text));
    boxes.forEach((b, k) => {
      for (const line of lines) for (let i = 1; i < line.length; i++) expect(segmentBoxDist(line[i - 1], line[i], b)).toBeGreaterThan(4);
      const [dx, dy] = [Math.max(b.x0 - 140, 0, 140 - b.x1), Math.max(b.y0 - 80, 0, 80 - b.y1)];
      expect(Math.hypot(dx, dy)).toBeGreaterThan(8);
      for (let j = 0; j < k; j++) {
        const o = boxes[j];
        expect(o.x1 < b.x0 || b.x1 < o.x0 || o.y1 < b.y0 || b.y1 < o.y0).toBe(true);
      }
    });
  });
});
