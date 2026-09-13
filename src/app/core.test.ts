import { describe, expect, it } from 'vitest';
import type { LngLat, Waypoint } from '../lib/types';
import { createActions } from './actions';
import { decimateTrack } from './decimate';
import * as history from './history';
import { MESSAGES, defaultActivityName, detectLang, legsSummary, ruPlural, translate, type MessageKey } from './i18n';
import { buildInitialState, decodeShare, encodeShare, sanitizeAthlete } from './persistence';
import { createStore } from './store';
import { localizeWarning } from './warnings';

const NOW = Date.UTC(2026, 8, 12, 7, 30);
const wp = (id: string, lon = 0, lat = 0): Waypoint => ({ id, lon, lat });

function freshStore(language = 'en') {
  return createStore(buildInitialState({ stored: null, hash: '', language, now: NOW }));
}

describe('history', () => {
  it('commits, undoes and redoes waypoint lists', () => {
    let h: history.WaypointHistory = { waypoints: [], past: [], future: [] };
    h = history.commit(h, [wp('a')]);
    h = history.commit(h, [wp('a'), wp('b')]);
    expect(h.past).toHaveLength(2);
    h = history.undo(h);
    expect(h.waypoints.map((w) => w.id)).toEqual(['a']);
    expect(h.future).toHaveLength(1);
    h = history.redo(h);
    expect(h.waypoints.map((w) => w.id)).toEqual(['a', 'b']);
    expect(history.redo(h)).toBe(h);
  });

  it('drops redo on a new commit and caps the past', () => {
    let h: history.WaypointHistory = { waypoints: [], past: [], future: [] };
    for (let i = 0; i < 10; i++) h = history.commit(h, [wp(String(i))], 4);
    expect(h.past).toHaveLength(4);
    h = history.undo(h);
    h = history.commit(h, [wp('x')], 4);
    expect(h.future).toEqual([]);
  });
});

describe('decimateTrack', () => {
  it('keeps short tracks unchanged', () => {
    const coords: LngLat[] = [
      [0, 0],
      [0.001, 0],
    ];
    expect(decimateTrack(coords, 60)).toEqual(coords);
  });

  it('keeps endpoints and the most significant corners', () => {
    const coords: LngLat[] = [];
    for (let i = 0; i <= 100; i++) coords.push([i * 1e-4, 0]);
    for (let i = 1; i <= 100; i++) coords.push([0.01, i * 1e-4]);
    const out = decimateTrack(coords, 3);
    expect(out).toEqual([
      [0, 0],
      [0.01, 0],
      [0.01, 0.01],
    ]);
  });

  it('handles closed loops and never exceeds the limit', () => {
    const coords: LngLat[] = [];
    for (let i = 0; i <= 2000; i++) {
      const a = (i / 2000) * Math.PI * 2;
      coords.push([Math.cos(a) * 0.01, Math.sin(a) * 0.01]);
    }
    const out = decimateTrack(coords, 60);
    expect(out.length).toBe(60);
    expect(out[0]).toEqual(coords[0]);
    expect(out[out.length - 1]).toEqual(coords[coords.length - 1]);
  });
});

describe('i18n', () => {
  it('has the same non-empty keys and placeholders in both languages', () => {
    const keys = Object.keys(MESSAGES.en) as MessageKey[];
    expect(Object.keys(MESSAGES.ru).sort()).toEqual([...keys].sort());
    const placeholders = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();
    for (const key of keys) {
      expect(MESSAGES.en[key].trim(), key).not.toBe('');
      expect(MESSAGES.ru[key].trim(), key).not.toBe('');
      expect(placeholders(MESSAGES.ru[key]), key).toEqual(placeholders(MESSAGES.en[key]));
    }
  });

  it('interpolates parameters', () => {
    expect(translate('en', 'statusRouting', { done: 2, total: 5 })).toBe('Routing 2/5…');
    expect(translate('ru', 'statusRouting', { done: 2, total: 5 })).toBe('Прокладываю участки: 2 из 5…');
  });

  it('detects Russian from the browser language', () => {
    expect(detectLang('ru-RU')).toBe('ru');
    expect(detectLang('en-GB')).toBe('en');
    expect(detectLang(undefined)).toBe('en');
  });

  it('declines Russian plurals and summarises legs', () => {
    expect([1, 2, 5, 11, 21, 22, 25].map((n) => ruPlural(n, 'участок', 'участка', 'участков'))).toEqual([
      'участок',
      'участка',
      'участков',
      'участков',
      'участок',
      'участка',
      'участков',
    ]);
    expect(legsSummary('en', { routed: 4, straight: 0, fallback: 1, pending: 0 })).toBe('4 legs follow paths · 1 straight');
    expect(legsSummary('ru', { routed: 4, straight: 0, fallback: 1, pending: 0 })).toBe('4 участка по дорогам · 1 по прямой');
    expect(legsSummary('en', { routed: 1, straight: 0, fallback: 0, pending: 0 })).toBe('1 leg follows paths');
  });

  it('names activities by local hour with grammatical agreement', () => {
    expect(defaultActivityName('en', 'run', 7)).toBe('Morning run');
    expect(defaultActivityName('ru', 'run', 7)).toBe('Утренняя пробежка');
    expect(defaultActivityName('ru', 'ride', 19)).toBe('Вечерний заезд');
    expect(defaultActivityName('ru', 'hike', 12)).toBe('Дневной поход');
    // Восхождение is neuter.
    expect(defaultActivityName('ru', 'alpine', 2)).toBe('Ночное восхождение');
    expect(defaultActivityName('ru', 'alpine', 8)).toBe('Утреннее восхождение');
    expect(defaultActivityName('en', 'alpine', 2)).toBe('Night ascent');
  });
});

describe('warnings', () => {
  it('renders known simulator warnings in Russian and passes unknown text through', () => {
    expect(localizeWarning('ru', 'Grades steeper than 45 % were treated as 45 %.')).toBe('Уклоны круче 45 % учтены как 45 %.');
    expect(localizeWarning('ru', 'Something new.')).toBe('Something new.');
    expect(localizeWarning('en', 'Grades steeper than 45 % were treated as 45 %.')).toBe('Grades steeper than 45 % were treated as 45 %.');
  });
});

describe('persistence', () => {
  it('round-trips the share link', () => {
    const store = freshStore();
    const actions = createActions(store);
    actions.addWaypoint(2.149677, 41.375102);
    actions.addWaypoint(2.153217, 41.368806);
    actions.updateSession({ type: 'ride' });
    actions.updateSession({ seed: 424242, target: { kind: 'duration', seconds: 3725 } });
    actions.setProfile('road-bike');
    const payload = decodeShare(`#${encodeShare(store.get())}`);
    expect(payload).toEqual({
      coords: [
        [2.14968, 41.3751],
        [2.15322, 41.36881],
      ],
      profile: 'road-bike',
      activity: 'ride',
      target: { kind: 'duration', seconds: 3725 },
      seed: 424242,
    });
  });

  it('ignores malformed hashes and storage', () => {
    expect(decodeShare('')).toBeNull();
    expect(decodeShare('#v=2&r=abc')).toBeNull();
    expect(decodeShare('#v=1&r=%%%&t=x')).toBeNull();
    expect(decodeShare('#v=1&r=&t=x&s=-4')).toEqual({ coords: [] });
    const state = buildInitialState({ stored: { v: 1, athlete: { age: 'old', restHr: 500 }, units: 'parsecs', waypoints: [[999, 1], 'x'] }, hash: '#junk', language: 'ru', now: NOW });
    expect(state.lang).toBe('ru');
    expect(state.units).toBe('metric');
    expect(state.waypoints).toEqual([]);
    expect(state.athlete.age).toBe(35);
    expect(state.session.name).toMatch(/пробежка$/);
  });

  it('restores stored preferences and lets a share link override the route', () => {
    const stored = {
      v: 1,
      athlete: { age: 50, sex: 'female', weightKg: 60, heightCm: 165, restHr: 58, maxHr: 170, fitness: 'trained' },
      maxHrAuto: false,
      session: { type: 'walk', seed: 7, pacing: 'negative', name: 'Dog walk' },
      nameAuto: false,
      units: 'imperial',
      lang: 'en',
      profile: 'hiking',
      waypoints: [
        [1, 1],
        [1.01, 1.01],
      ],
    };
    const state = buildInitialState({ stored, hash: '', language: 'ru', now: NOW });
    expect(state.athlete).toMatchObject({ age: 50, sex: 'female', maxHr: 170, fitness: 'trained' });
    expect(state.session).toMatchObject({ type: 'walk', seed: 7, pacing: 'negative', name: 'Dog walk', lapDistance: 1609.344 });
    expect(state.waypoints).toHaveLength(2);
    expect(state.lang).toBe('en');

    const shared = buildInitialState({ stored, hash: '#v=1&r=_p~iF~ps|U_ulL_ulL&a=run&t=p300&s=9', language: 'en', now: NOW });
    expect(shared.session).toMatchObject({ type: 'run', seed: 9, target: { kind: 'pace', secPerKm: 300 } });
    expect(shared.waypoints.map((w) => [w.lon, w.lat])).toEqual([
      [-120.2, 38.5],
      [-118, 40.7],
    ]);
  });

  it('clamps athlete fields into physiological ranges', () => {
    expect(sanitizeAthlete({ restHr: 105, maxHr: 120 })).toMatchObject({ restHr: 80, maxHr: 120 });
  });
});

describe('actions', () => {
  it('keeps max HR on the age estimate until edited', () => {
    const store = freshStore();
    const actions = createActions(store);
    actions.updateAthlete({ age: 60 });
    expect(store.get().athlete.maxHr).toBe(166);
    actions.updateAthlete({ maxHr: 180 });
    actions.updateAthlete({ age: 20 });
    expect(store.get().athlete.maxHr).toBe(180);
    actions.useAutoMaxHr();
    expect(store.get().athlete.maxHr).toBe(194);
  });

  it('switches target defaults and auto name with the activity and language', () => {
    const store = freshStore();
    const actions = createActions(store);
    actions.updateSession({ type: 'ride' });
    expect(store.get().session.target.kind).toBe('speed');
    expect(store.get().session.name).toMatch(/ride$/);
    actions.setLang('ru');
    expect(store.get().session.name).toMatch(/заезд$/);
    actions.setName('Commute');
    actions.setLang('en');
    expect(store.get().session.name).toBe('Commute');
    actions.updateSession({ target: { kind: 'duration', seconds: 1800 } });
    actions.updateSession({ type: 'walk' });
    expect(store.get().session.target).toEqual({ kind: 'duration', seconds: 1800 });
  });

  it('edits the route with undo, loop and removal', () => {
    const store = freshStore();
    const actions = createActions(store);
    actions.addWaypoint(0, 0);
    actions.addWaypoint(0.01, 0);
    actions.addWaypoint(0.01, 0.01);
    actions.closeLoop();
    expect(store.get().waypoints).toHaveLength(4);
    actions.undo();
    expect(store.get().waypoints).toHaveLength(3);
    const middle = store.get().waypoints[1].id;
    actions.select(middle);
    actions.removeWaypoint(middle);
    expect(store.get().selectedId).toBeNull();
    expect(store.get().waypoints).toHaveLength(2);
    actions.setUnits('imperial');
    expect(store.get().session.lapDistance).toBeCloseTo(1609.344);
  });

  it('imports a track as at most 60 straight-leg waypoints', () => {
    const store = freshStore();
    const actions = createActions(store);
    const coords: LngLat[] = Array.from({ length: 500 }, (_, i) => [i * 1e-4, Math.sin(i / 20) * 1e-3]);
    const n = actions.importTrack(coords, 'Park loop');
    expect(n).toBe(60);
    expect(store.get()).toMatchObject({ profile: 'none', nameAuto: false });
    expect(store.get().session.name).toBe('Park loop');
    expect(store.get().viewRequest?.kind).toBe('fit');
  });
});
