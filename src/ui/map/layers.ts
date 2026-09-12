import type { FeatureCollection } from 'geojson';
import type { Map as MapLibreMap } from 'maplibre-gl';
import { TICK_TEXT_PX } from './geometry';

export const ROUTE_SOURCE = 'rs-route';
export const TICK_SOURCE = 'rs-ticks';
export const ROUTE_HIT_LAYER = 'rs-route-hit';

const empty = (): FeatureCollection => ({ type: 'FeatureCollection', features: [] });

export interface MapInks {
  route: string;
  casing: string;
  dash: string;
  paper: string;
  label: string;
}

export function readInks(el: Element = document.documentElement): MapInks {
  const css = getComputedStyle(el);
  const v = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  return {
    route: v('--route', '#1b1d22'),
    casing: v('--route-casing', '#ffffff'),
    dash: v('--route-dash', '#7d838b'),
    paper: v('--sheet', '#f9fafc'),
    label: v('--ink-2', '#474c55'),
  };
}

/**
 * Distance tick: a cased ink hairline drawn on a 2× canvas, rotated across the route by the layer.
 * Deliberately not a disc, so it cannot be mistaken for a waypoint handle.
 */
function tickImage(inks: MapInks): ImageData | null {
  const w = 40;
  const h = 8;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = inks.casing;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = inks.route;
  ctx.fillRect(2, 2, w - 4, h - 4);
  return ctx.getImageData(0, 0, w, h);
}

export function installRouteLayers(map: MapLibreMap, inks: MapInks): void {
  map.addSource(ROUTE_SOURCE, { type: 'geojson', data: empty() });
  map.addSource(TICK_SOURCE, { type: 'geojson', data: empty() });
  const width = (lo: number, hi: number) => ['interpolate', ['linear'], ['zoom'], 10, lo, 17, hi] as unknown as number;
  const kinds = (...k: string[]) => ['in', ['get', 'kind'], ['literal', k]] as unknown as boolean;

  map.addLayer({
    id: 'rs-route-casing',
    type: 'line',
    source: ROUTE_SOURCE,
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: { 'line-color': inks.casing, 'line-width': width(5, 10) },
  });
  map.addLayer({
    id: 'rs-route-line',
    type: 'line',
    source: ROUTE_SOURCE,
    filter: kinds('routed', 'straight'),
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: { 'line-color': inks.route, 'line-width': width(2.25, 4.5) },
  });
  map.addLayer({
    id: 'rs-route-dashed',
    type: 'line',
    source: ROUTE_SOURCE,
    filter: kinds('fallback', 'pending'),
    layout: { 'line-join': 'round' },
    paint: {
      'line-color': inks.dash,
      'line-width': width(2, 3.5),
      'line-dasharray': [2, 1.6],
      'line-opacity': ['match', ['get', 'kind'], 'pending', 0.65, 1],
    },
  });
  map.addLayer({
    id: ROUTE_HIT_LAYER,
    type: 'line',
    source: ROUTE_SOURCE,
    paint: { 'line-color': '#000000', 'line-opacity': 0, 'line-width': 18 },
  });

  const image = tickImage(inks);
  if (image) map.addImage('rs-tick', image, { pixelRatio: 2 });
  map.addLayer({
    id: 'rs-ticks',
    type: 'symbol',
    source: TICK_SOURCE,
    layout: {
      'icon-image': image ? 'rs-tick' : '',
      'icon-rotate': ['get', 'rotate'] as unknown as number,
      'icon-rotation-alignment': 'map',
      'text-field': ['get', 'text'],
      'text-font': ['Noto Sans Regular'],
      'text-size': TICK_TEXT_PX,
      'text-offset': ['get', 'offset'] as unknown as [number, number],
      'text-anchor': 'center',
      'icon-allow-overlap': false,
      'text-allow-overlap': false,
      'symbol-sort-key': ['to-number', ['get', 'label']],
    },
    paint: { 'text-color': inks.route, 'text-halo-color': inks.casing, 'text-halo-width': 1.5 },
  });
}
