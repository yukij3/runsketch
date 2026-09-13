import { describe, expect, it } from 'vitest';
import type { LngLat } from '../lib/types';
import { createActions } from './actions';
import { buildInitialState, decodeShare, encodeShare, sameRoute, toPersisted } from './persistence';
import { createStore } from './store';

const NOW = Date.UTC(2026, 8, 12, 7, 0);
const precise: LngLat[] = [
  [2.1496812345, 41.3751023456],
  [2.1532198765, 41.3688054321],
  [2.1649876543, 41.3632512345],
];

describe('share link vs stored route', () => {
  const stored = { v: 1, waypoints: precise };
  const base = buildInitialState({ stored, hash: '', now: NOW });
  const hash = `#${encodeShare(base)}`;

  it('keeps the stored full-precision waypoints when the link names the same route', () => {
    const state = buildInitialState({ stored, hash, now: NOW });
    expect(state.waypoints.map((w) => [w.lon, w.lat])).toEqual(precise);
  });

  it('takes the link route when it differs', () => {
    const other = buildInitialState({ stored: { v: 1, waypoints: [[10, 50], [10.01, 50.01]] }, hash: '', now: NOW });
    const state = buildInitialState({ stored, hash: `#${encodeShare(other)}`, now: NOW });
    expect(state.waypoints.map((w) => [w.lon, w.lat])).toEqual([
      [10, 50],
      [10.01, 50.01],
    ]);
  });

  it('compares within the polyline rounding only (share link)', () => {
    expect(sameRoute([[1.00001, 2]], [[1.000014, 2]])).toBe(true);
    expect(sameRoute([[1.00001, 2]], [[1.00003, 2]])).toBe(false);
    expect(sameRoute([[1, 2]], [])).toBe(false);
  });
});

describe('mountaineering sessions', () => {
  it('loads states saved before the mountain fields existed with the activity defaults, and cleans stored values', () => {
    const hike = buildInitialState({ stored: { v: 1, session: { type: 'hike', stops: 'few' } }, hash: '', now: NOW });
    expect(hike.session).toMatchObject({ type: 'hike', stops: 'few', acclimatisation: 'none', packKg: 0, footwear: 'trail-shoes', crampons: false, snow: 'firm', snowlineM: null });
    const alpine = buildInitialState({
      stored: { v: 1, session: { type: 'alpine', packKg: 12, snow: 'deep', snowlineM: 4200.4, acclimatisation: 'bogus', footwear: 'flip-flops' } },
      hash: '',
      now: NOW,
    });
    expect(alpine.session).toMatchObject({
      type: 'alpine',
      stops: 'alpine',
      packKg: 12,
      snow: 'deep',
      snowlineM: 4200,
      acclimatisation: 'partial',
      footwear: 'mountain-boots',
      crampons: true,
      target: { kind: 'duration' },
    });
  });

  it('round-trips mountain settings through storage and opens mountaineering share links', () => {
    const store = createStore(buildInitialState({ stored: null, hash: '', language: 'ru', now: NOW }));
    const actions = createActions(store);
    actions.addWaypoint(42.46406, 43.29894);
    actions.addWaypoint(42.43784, 43.35241);
    actions.updateSession({ type: 'alpine' });
    actions.updateSession({ acclimatisation: 'full', packKg: 6, snow: 'soft', snowlineM: 3900, crampons: false, footwear: 'double-boots' });
    const s = store.get();
    expect(s.session.name).toMatch(/восхождение$/);
    const restored = buildInitialState({ stored: JSON.parse(JSON.stringify(toPersisted(s))), hash: `#${encodeShare(s)}`, now: NOW + 60_000 });
    expect(restored.session).toMatchObject({ type: 'alpine', acclimatisation: 'full', packKg: 6, snow: 'soft', snowlineM: 3900, crampons: false, footwear: 'double-boots' });
    expect(decodeShare(`#${encodeShare(s)}`)?.activity).toBe('alpine');
  });

  it('switching to mountaineering brings a finish-time target, mountain breaks and gear; switching away drops them', () => {
    const store = createStore(buildInitialState({ stored: null, hash: '', language: 'en', now: NOW }));
    const actions = createActions(store);
    actions.updateSession({ type: 'alpine' });
    expect(store.get()).toMatchObject({ effortPreset: 'steady', session: { type: 'alpine', stops: 'alpine', packKg: 8, crampons: true, target: { kind: 'duration' } } });
    actions.updateSession({ type: 'hike' });
    expect(store.get().session).toMatchObject({ type: 'hike', stops: 'alpine', packKg: 0, crampons: false, acclimatisation: 'none' });
    actions.updateSession({ type: 'run' });
    expect(store.get().session).toMatchObject({ type: 'run', stops: 'none', target: { kind: 'duration' } });
  });
});
