import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
// MapLibre 6 resolves its worker next to its own module URL, which a bundler moves; hand it the bundled worker.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { useEffect, useMemo, useRef, useState } from 'react';
import { FIX_THE_MAP_URL, MAPTERHORN_TILEJSON_URL, POSITRON_STYLE_URL } from '../../app/config';
import { routeCoords } from '../../app/pipeline';
import { useApp, useRuntime, useT } from '../../app/runtime';
import type { LngLat } from '../../lib/types';
import { waypointLabel, waypointRole } from '../labels';
import { distanceTicks, nearestSample, routeFeatures } from './geometry';
import { ROUTE_HIT_LAYER, ROUTE_SOURCE, TICK_SOURCE, installRouteLayers, readInks } from './layers';
import { EmptyPlate, MapFoot } from './MapOverlay';
import { transformPositron } from './mapStyle';
import { Toolbar } from './Toolbar';

maplibregl.setWorkerUrl(workerUrl);

const DEFAULT_VIEW = { center: [10.5, 48.5] as LngLat, zoom: 3.6 };
const Z_INDEX = { start: '3', mid: '2', finish: '1' } as const;

export type MapFailure = 'webgl' | 'style';

function supportsWebGL2(): boolean {
  try {
    return Boolean(document.createElement('canvas').getContext('webgl2'));
  } catch {
    return false;
  }
}

const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

async function loadStyle(signal: AbortSignal): Promise<maplibregl.StyleSpecification | string> {
  try {
    const res = await fetch(POSITRON_STYLE_URL, { signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return transformPositron((await res.json()) as maplibregl.StyleSpecification, MAPTERHORN_TILEJSON_URL);
  } catch (err) {
    if (signal.aborted) throw err;
    // Let MapLibre try the untouched style; its own error event reports a real outage.
    return POSITRON_STYLE_URL;
  }
}

const escapeHtml = (text: string) => text.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
const link = (href: string, label: string) => `<a href="${href}" target="_blank" rel="noopener">${escapeHtml(label)}</a>`;

function geojsonSource(map: maplibregl.Map, id: string): maplibregl.GeoJSONSource | undefined {
  return map.getSource(id) as maplibregl.GeoJSONSource | undefined;
}

function fitBox(map: maplibregl.Map, box: [number, number, number, number], top: number, duration: number) {
  const [west, south, east, north] = box;
  if (west === east && south === north) {
    map.flyTo({ center: [west, south], zoom: Math.max(map.getZoom(), 14), duration });
    return;
  }
  map.fitBounds(
    [
      [west, south],
      [east, north],
    ],
    { padding: { top, bottom: 56, left: 32, right: 32 }, maxZoom: 16, duration },
  );
}

export function MapPlate() {
  const t = useT();
  const { store, actions } = useRuntime();
  const containerRef = useRef<HTMLDivElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef(new Map<string, maplibregl.Marker>());
  const playheadRef = useRef<maplibregl.Marker | null>(null);
  const attributionRef = useRef<maplibregl.AttributionControl | null>(null);
  const lastDragRef = useRef(0);
  /** Set while a camera fit waits for routed legs (they can run well outside the waypoint bbox). */
  const followRouteRef = useRef(store.get().waypoints.length >= 2);
  const [ready, setReady] = useState(false);
  const [failure, setFailure] = useState<MapFailure | null>(null);

  const waypoints = useApp((s) => s.waypoints);
  const legs = useApp((s) => s.legs);
  const profile = useApp((s) => s.profile);
  const selectedId = useApp((s) => s.selectedId);
  const units = useApp((s) => s.units);
  const playhead = useApp((s) => s.playhead);
  const result = useApp((s) => s.sim.result);
  const viewRequest = useApp((s) => s.viewRequest);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    if (!supportsWebGL2()) {
      setFailure('webgl');
      return;
    }
    const controller = new AbortController();
    const markers = markersRef.current;
    let map: maplibregl.Map | null = null;

    loadStyle(controller.signal).then(
      (style) => {
        if (controller.signal.aborted) return;
        const s = store.get();
        const coords = s.waypoints.map((w): LngLat => [w.lon, w.lat]);
        const view = s.view ?? DEFAULT_VIEW;
        const camera: Partial<maplibregl.MapOptions> =
          coords.length >= 2
            ? {
                bounds: [
                  [Math.min(...coords.map((c) => c[0])), Math.min(...coords.map((c) => c[1]))],
                  [Math.max(...coords.map((c) => c[0])), Math.max(...coords.map((c) => c[1]))],
                ],
                fitBoundsOptions: { padding: 64, maxZoom: 16 },
              }
            : { center: coords[0] ?? view.center, zoom: coords.length === 1 ? 14 : view.zoom };
        try {
          map = new maplibregl.Map({
            container,
            style,
            ...camera,
            attributionControl: false,
            dragRotate: false,
            pitchWithRotate: false,
            touchPitch: false,
            maxPitch: 0,
          });
        } catch {
          setFailure('webgl');
          return;
        }
        const m = map;
        mapRef.current = m;
        m.touchZoomRotate.disableRotation();
        m.keyboard.disableRotation();

        let loaded = false;
        m.on('error', (e) => {
          if (!loaded && !('sourceId' in e)) setFailure('style');
        });
        m.getCanvas().addEventListener('webglcontextlost', () => setFailure('webgl'));
        m.on('load', () => {
          loaded = true;
          installRouteLayers(m, readInks());
          setFailure((f) => (f === 'style' ? null : f));
          setReady(true);
        });
        m.on('moveend', () => {
          const c = m.getCenter();
          actions.setView({ center: [c.lng, c.lat], zoom: m.getZoom() });
        });
        m.on('click', (e) => {
          const target = e.originalEvent.target;
          if (target instanceof Element && target.closest('.rs-wp')) return;
          if (performance.now() - lastDragRef.current < 300) return;
          actions.addWaypoint(e.lngLat.lng, e.lngLat.lat);
        });

        let frame = 0;
        m.on('mousemove', ROUTE_HIT_LAYER, (e) => {
          const { lng, lat } = e.lngLat;
          cancelAnimationFrame(frame);
          frame = requestAnimationFrame(() => {
            const r = store.get().sim.result;
            if (!r) return;
            const i = nearestSample(r.streams, lng, lat);
            if (i >= 0) actions.setPlayhead(i);
          });
        });
        m.on('mouseleave', ROUTE_HIT_LAYER, () => {
          cancelAnimationFrame(frame);
          if (store.get().playhead !== null) actions.setPlayhead(null);
        });
      },
      () => undefined,
    );

    return () => {
      controller.abort();
      for (const marker of markers.values()) marker.remove();
      markers.clear();
      playheadRef.current = null;
      attributionRef.current = null;
      map?.remove();
      mapRef.current = null;
      setReady(false);
    };
  }, [store, actions]);

  // Route legs
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    geojsonSource(map, ROUTE_SOURCE)?.setData(routeFeatures(waypoints, profile, legs));
  }, [ready, waypoints, profile, legs]);

  // Distance ticks
  const ticks = useMemo(
    () => distanceTicks(routeCoords({ waypoints, profile, legs }), units === 'metric' ? 1000 : 1609.344),
    [waypoints, profile, legs, units],
  );
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    geojsonSource(map, TICK_SOURCE)?.setData(ticks);
  }, [ready, ticks]);

  // Waypoint markers
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const markers = markersRef.current;
    const alive = new Set<string>();

    const create = (id: string, at: LngLat) => {
      const el = document.createElement('div');
      el.className = 'rs-wp';
      el.setAttribute('role', 'button');
      el.tabIndex = -1;
      const dot = document.createElement('span');
      dot.className = 'rs-wp__dot';
      el.appendChild(dot);
      const marker = new maplibregl.Marker({ element: el, draggable: true }).setLngLat(at).addTo(map);
      let frame = 0;
      el.addEventListener('click', (ev) => {
        ev.stopPropagation();
        actions.select(id);
      });
      marker.on('dragstart', () => {
        lastDragRef.current = performance.now();
        el.classList.add('is-dragging');
        actions.select(id);
      });
      marker.on('drag', () => {
        lastDragRef.current = performance.now();
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => {
          const ll = marker.getLngLat();
          const s = store.get();
          geojsonSource(map, ROUTE_SOURCE)?.setData(routeFeatures(s.waypoints, s.profile, s.legs, { id, lon: ll.lng, lat: ll.lat }));
        });
      });
      marker.on('dragend', () => {
        cancelAnimationFrame(frame);
        lastDragRef.current = performance.now();
        el.classList.remove('is-dragging');
        const ll = marker.getLngLat();
        actions.moveWaypoint(id, ll.lng, ll.lat);
      });
      return marker;
    };

    waypoints.forEach((w, i) => {
      alive.add(w.id);
      let marker = markers.get(w.id);
      if (!marker) {
        marker = create(w.id, [w.lon, w.lat]);
        markers.set(w.id, marker);
      } else {
        const ll = marker.getLngLat();
        if (ll.lng !== w.lon || ll.lat !== w.lat) marker.setLngLat([w.lon, w.lat]);
      }
      const role = waypointRole(i, waypoints.length);
      const el = marker.getElement();
      el.dataset.role = role;
      el.style.zIndex = Z_INDEX[role];
      el.classList.toggle('is-selected', w.id === selectedId);
      el.setAttribute('aria-label', waypointLabel(t, i, waypoints.length));
    });
    for (const [id, marker] of markers) {
      if (!alive.has(id)) {
        marker.remove();
        markers.delete(id);
      }
    }
  }, [ready, waypoints, selectedId, t, store, actions]);

  // Playhead
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const streams = result?.streams;
    const valid = playhead !== null && streams !== undefined && playhead < streams.lat.length && Number.isFinite(streams.lat[playhead]);
    if (!valid) {
      playheadRef.current?.remove();
      playheadRef.current = null;
      return;
    }
    const at: LngLat = [streams.lon[playhead], streams.lat[playhead]];
    if (playheadRef.current) {
      playheadRef.current.setLngLat(at);
    } else {
      const el = document.createElement('div');
      el.className = 'rs-playhead';
      el.setAttribute('aria-hidden', 'true');
      playheadRef.current = new maplibregl.Marker({ element: el }).setLngLat(at).addTo(map);
    }
  }, [ready, playhead, result]);

  // Attribution: tile sources attribute themselves; routing providers and the OSM "fix the map" link are added here.
  const providers = useMemo(() => [...new Set([...legs.values()].map((l) => l.provider))].sort().join(','), [legs]);
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const custom: string[] = [];
    if (providers.includes('brouter')) custom.push(link('https://brouter.de/', 'BRouter'));
    if (providers.includes('osrm')) custom.push(link('https://routing.openstreetmap.de/', 'FOSSGIS OSRM'));
    custom.push(link(FIX_THE_MAP_URL, t('fixMap')));
    const control = new maplibregl.AttributionControl({ compact: true, customAttribution: custom });
    if (attributionRef.current) map.removeControl(attributionRef.current);
    map.addControl(control, 'bottom-right');
    attributionRef.current = control;
    // MapLibre labels its canvas and attribution toggle in English; follow the app language.
    map.getCanvas().setAttribute('aria-label', t('mapCanvas'));
    const toggle = map.getContainer().querySelector('.maplibregl-ctrl-attrib-button');
    toggle?.setAttribute('title', t('toggleAttribution'));
    toggle?.setAttribute('aria-label', t('toggleAttribution'));
    // MapLibre opens compact attribution until the first drag; on a phone-sized plate it would cover the route.
    if (map.getContainer().clientWidth < 640) {
      const details = map.getContainer().querySelector('.maplibregl-ctrl-attrib');
      details?.classList.remove('maplibregl-compact-show');
      details?.removeAttribute('open');
    }
  }, [ready, providers, t]);

  // Camera requests from search, import and the example route
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !viewRequest) return;
    const duration = reducedMotion() ? 0 : 700;
    if (viewRequest.kind === 'fly') {
      followRouteRef.current = false;
      map.flyTo({ center: viewRequest.center, zoom: viewRequest.zoom, duration });
      return;
    }
    followRouteRef.current = viewRequest.followRoute === true;
    fitBox(map, viewRequest.bbox, (toolbarRef.current?.offsetHeight ?? 48) + 24, duration);
  }, [ready, viewRequest]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !followRouteRef.current) return;
    const coords = routeCoords({ waypoints, profile, legs });
    if (!coords) return;
    followRouteRef.current = false;
    const lons = coords.map((c) => c[0]);
    const lats = coords.map((c) => c[1]);
    const box: [number, number, number, number] = [Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)];
    fitBox(map, box, (toolbarRef.current?.offsetHeight ?? 48) + 24, reducedMotion() ? 0 : 500);
  }, [ready, waypoints, profile, legs]);

  return (
    <div className="map-plate">
      <div ref={containerRef} className="map-plate__canvas" role="region" aria-label={t('mapLabel')} />
      {failure === 'webgl' ? (
        <div className="map-plate__failure" role="alert">
          <h2>{t('webglTitle')}</h2>
          <p>{t('webglBody')}</p>
        </div>
      ) : null}
      <Toolbar ref={toolbarRef} />
      {waypoints.length === 0 && failure !== 'webgl' ? <EmptyPlate /> : null}
      <MapFoot styleFailed={failure === 'style'} />
    </div>
  );
}
