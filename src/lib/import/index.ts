// GPX / TCX route import through the browser's DOMParser. Elements are matched by local name
// with any namespace, so gpxtpx:/ns3:/unprefixed/foreign-prefixed files all parse the same way.
import type { LngLat } from '../types';

export interface ImportedRoute {
  coords: LngLat[];
  name?: string;
}

function elements(root: Document | Element, localName: string): Element[] {
  return Array.from(root.getElementsByTagNameNS('*', localName));
}

function child(el: Element, localName: string): Element | undefined {
  return Array.from(el.children).find((c) => c.localName === localName);
}

function childText(el: Element | undefined, localName: string): string | undefined {
  const text = el && child(el, localName)?.textContent?.trim();
  return text || undefined;
}

function toCoord(latText: string | null | undefined, lonText: string | null | undefined): LngLat | undefined {
  const lat = Number.parseFloat(latText ?? '');
  const lon = Number.parseFloat(lonText ?? '');
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return undefined;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return undefined;
  return [lon, lat];
}

function parseXml(text: string): Document {
  if (typeof DOMParser === 'undefined') throw new Error('Route import needs a browser: DOMParser is unavailable');
  // A BOM or whitespace before <?xml … ?> is a fatal XML error, but common in hand-edited files.
  const source = text.replace(/^﻿/, '').trimStart();
  if (!source) throw new Error('The file is empty');
  const doc = new DOMParser().parseFromString(source, 'application/xml');
  const error = elements(doc, 'parsererror')[0];
  if (error) {
    // Chrome nests the message in a <div>; Firefox and jsdom put it in the element text.
    const raw = (elements(error, 'div')[0] ?? error).textContent ?? '';
    const detail = raw.split('\n').map((l) => l.trim()).find(Boolean)?.slice(0, 160);
    throw new Error(`This file is not valid XML${detail ? ` (${detail})` : ''}`);
  }
  return doc;
}

function parseGpx(doc: Document): ImportedRoute {
  const root = doc.documentElement;
  const metadataName = childText(elements(doc, 'metadata')[0], 'name') ?? childText(root, 'name');
  // Prefer the recorded track, then a planned route, then loose waypoints.
  const sources: Array<[point: string, container: string]> = [
    ['trkpt', 'trk'],
    ['rtept', 'rte'],
    ['wpt', ''],
  ];
  for (const [point, container] of sources) {
    const coords = elements(doc, point)
      .map((el) => toCoord(el.getAttribute('lat'), el.getAttribute('lon')))
      .filter((c): c is LngLat => c !== undefined);
    if (coords.length > 0) {
      const containerName = container ? childText(elements(doc, container)[0], 'name') : undefined;
      return { coords, name: containerName ?? metadataName };
    }
  }
  return { coords: [], name: metadataName };
}

function parseTcx(doc: Document): ImportedRoute {
  const coords = elements(doc, 'Trackpoint')
    .map((tp) => {
      const position = child(tp, 'Position');
      return position && toCoord(childText(position, 'LatitudeDegrees'), childText(position, 'LongitudeDegrees'));
    })
    .filter((c): c is LngLat => c !== undefined);
  // Courses carry a name; activities only have an Id timestamp.
  return { coords, name: childText(elements(doc, 'Course')[0], 'Name') };
}

/** Consecutive identical points (a recorded stop) add nothing to a route. */
function dropRepeats(coords: LngLat[]): LngLat[] {
  return coords.filter((c, i) => i === 0 || c[0] !== coords[i - 1][0] || c[1] !== coords[i - 1][1]);
}

/** GPX (trk/rte/wpt) or TCX track → coordinates. Throws a readable Error on invalid input. */
export function parseRouteFile(text: string, filename: string): ImportedRoute {
  if (/\.fit$/i.test(filename)) {
    throw new Error('FIT files cannot be imported as a route. Export the activity as GPX or TCX and import that file.');
  }
  const doc = parseXml(text);
  const rootName = doc.documentElement.localName;
  let route: ImportedRoute;
  if (rootName === 'gpx') route = parseGpx(doc);
  else if (rootName === 'TrainingCenterDatabase') route = parseTcx(doc);
  else throw new Error(`Unsupported file: expected GPX or TCX, but the document root is <${rootName}>`);

  const coords = dropRepeats(route.coords);
  if (coords.length === 0) throw new Error('No track points found in this file');
  if (coords.length === 1) throw new Error('This file has only one point; a route needs at least two');
  return route.name ? { coords, name: route.name } : { coords };
}
