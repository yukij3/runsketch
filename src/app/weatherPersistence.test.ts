// Weather settings, the set start time and the route zone across reloads and share links.
import { describe, expect, it } from 'vitest';
import { createActions } from './actions';
import { buildInitialState, decodeShare, encodeShare, toPersisted } from './persistence';
import { createStore } from './store';

const NOW = Date.UTC(2026, 8, 12, 7, 0);
const defaultManual = { humidityPct: 60, windMps: 0, windFromDeg: 0, rainMmH: 0 };
const reload = (stored: unknown, now = NOW + 86_400_000, hash = '') => buildInitialState({ stored: JSON.parse(JSON.stringify(stored)), hash, now });

describe('weather settings', () => {
  it('new sessions and stored sessions without them are automatic with neutral manual values', () => {
    const fresh = buildInitialState({ stored: null, hash: '', now: NOW });
    expect(fresh.session.weather).toEqual({ mode: 'auto', manual: { humidityPct: 60, windMps: 0, windFromDeg: 0, rainMmH: 0 }, pinned: [] });
    expect(fresh.weather).toEqual({ state: 'idle', key: '', series: null });
    expect(reload({ v: 1, session: { type: 'walk', temperatureC: 22 } }).session).toMatchObject({ temperatureC: 22, weather: { mode: 'auto' } });
  });

  it('stored settings are kept and sanitised', () => {
    const store = createStore(buildInitialState({ stored: null, hash: '', now: NOW }));
    const actions = createActions(store);
    actions.setWeatherMode('manual');
    actions.updateManualWeather({ humidityPct: 85, windMps: 6, windFromDeg: 270, rainMmH: 4 });
    actions.toggleWeatherPin('wind');
    actions.toggleWeatherPin('temperature');
    const restored = reload(toPersisted(store.get()));
    expect(restored.session.weather).toEqual({ mode: 'manual', manual: { humidityPct: 85, windMps: 6, windFromDeg: 270, rainMmH: 4 }, pinned: ['temperature', 'wind'] });
    actions.toggleWeatherPin('wind');
    expect(store.get().session.weather?.pinned).toEqual(['temperature']);
    const junk = reload({ v: 1, session: { weather: { mode: 'auto', manual: { humidityPct: 900, windMps: -3 }, pinned: ['wind', 'hail'] } } });
    expect(junk.session.weather).toEqual({ mode: 'auto', manual: { humidityPct: 100, windMps: 0, windFromDeg: 0, rainMmH: 0 }, pinned: ['wind'] });
    expect(reload({ v: 1, session: { weather: { mode: 'sometimes' } } }).session.weather?.mode).toBe('auto');
  });

  it('a share link carries the mode, the manual values and the pins, and stays short without them', () => {
    const store = createStore(buildInitialState({ stored: null, hash: '', now: NOW }));
    const actions = createActions(store);
    // An ordinary automatic session with neutral values adds nothing to the link.
    const plain = encodeShare(store.get());
    expect(plain).not.toContain('wm=');
    expect(plain).not.toContain('wc=');
    expect(plain).not.toContain('wp=');

    actions.setWeatherMode('manual');
    actions.updateManualWeather({ humidityPct: 85, windMps: 6, windFromDeg: 270, rainMmH: 4 });
    actions.toggleWeatherPin('wind');
    const settings = { mode: 'manual', manual: { humidityPct: 85, windMps: 6, windFromDeg: 270, rainMmH: 4 }, pinned: ['wind'] };
    const hash = `#${encodeShare(store.get())}`;
    expect(decodeShare(hash)?.weather).toEqual(settings);
    expect(buildInitialState({ stored: null, hash, now: NOW }).session.weather).toEqual(settings);
    // Junk in the link falls back to the neutral default rather than being trusted.
    expect(decodeShare('#v=1&r=&t=x&s=1&wm=sometimes')?.weather).toBeUndefined();
    expect(decodeShare('#v=1&r=&t=x&s=1&wp=wind.hail')?.weather).toEqual({ mode: 'auto', manual: defaultManual, pinned: ['wind'] });
  });
});

describe('start time and route zone', () => {
  it('a set start survives a reload; a start that follows now does not', () => {
    const store = createStore(buildInitialState({ stored: null, hash: '', now: NOW }));
    const actions = createActions(store);
    expect(store.get().startAuto).toBe(true);
    expect(toPersisted(store.get()).startTime).toBeUndefined();
    expect(reload(toPersisted(store.get())).session.startTime).toBe(NOW + 86_400_000);

    const set = Date.UTC(2026, 9, 3, 4, 30);
    actions.setStart(set, 345);
    const restored = reload(toPersisted(store.get()));
    expect(restored).toMatchObject({ startAuto: false, session: { startTime: set, utcOffsetMin: 345 } });
    actions.updateSession({ startTime: set + 60_000 });
    expect(store.get().startAuto).toBe(false);
  });

  it('keeps a known route zone and drops an unknown one', () => {
    expect(reload({ v: 1, routeZone: 'Asia/Kathmandu' }).routeZone).toBe('Asia/Kathmandu');
    expect(reload({ v: 1, routeZone: 'Mars/Olympus_Mons' }).routeZone).toBe('');
    expect(reload({ v: 1, routeZone: 42 }).routeZone).toBe('');
    expect(reload({ v: 1, startAuto: false, startTime: 'yesterday' }).startAuto).toBe(true);
  });

  it('a share link carries a set start and its offset, and nothing when the start follows now', () => {
    const store = createStore(buildInitialState({ stored: null, hash: '', now: NOW }));
    const actions = createActions(store);
    actions.addWaypoint(7.75, 45.98);
    actions.addWaypoint(7.66, 45.98);
    expect(encodeShare(store.get())).not.toMatch(/st=/);
    const set = Date.UTC(2026, 7, 15, 4, 0);
    actions.setStart(set, 120);
    const hash = `#${encodeShare(store.get())}`;
    expect(hash).toMatch(/&st=\d+&so=120$/);
    expect(decodeShare(hash)).toMatchObject({ startTime: set, utcOffsetMin: 120 });
    expect(reload({ v: 1 }, NOW, hash)).toMatchObject({ startAuto: false, session: { startTime: set, utcOffsetMin: 120 } });
    expect(decodeShare(hash.replace(/st=\d+/, 'st=-5'))?.startTime).toBeUndefined();
    expect(decodeShare(hash.replace('so=120', 'so=9999'))).toMatchObject({ startTime: set });
    expect(decodeShare(hash.replace('so=120', 'so=9999'))?.utcOffsetMin).toBeUndefined();
  });
});
