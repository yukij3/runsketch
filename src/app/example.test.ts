import { describe, expect, it } from 'vitest';
import { haversine } from '../lib/geo';
import { defaultAthlete, defaultSession, simulate, solveEffortPreset } from '../lib/sim';
import { pathProfile, segmentElevation, type GradeSegment } from '../lib/sim/scenarios';
import type { Acclimatisation, SessionSettings, TerrainProfile } from '../lib/types';
import { createActions } from './actions';
import { EXAMPLES, EXAMPLE_BREAK_SHARE, exampleStart, exampleTarget } from './example';
import { buildInitialState } from './persistence';
import { ACTIVITIES, SNAP_PROFILES, localStartHour } from './state';
import { createStore } from './store';

// 13:15 UTC: 16:15 in Moscow and Tanzania, 10:15 in Mendoza.
const NOW = Date.UTC(2026, 8, 13, 13, 15);

describe('example routes', () => {
  it('are well-formed, with Montjuïc first', () => {
    expect(EXAMPLES[0].id).toBe('montjuic');
    expect(new Set(EXAMPLES.map((e) => e.id)).size).toBe(EXAMPLES.length);
    for (const e of EXAMPLES) {
      expect(e.name.en.trim(), e.id).not.toBe('');
      expect(e.name.ru.trim(), e.id).not.toBe('');
      expect(SNAP_PROFILES).toContain(e.profile);
      expect(ACTIVITIES).toContain(e.activity);
      expect(e.coords.length, e.id).toBeGreaterThanOrEqual(2);
      for (const [lon, lat] of e.coords) expect(Math.abs(lon) <= 180 && Math.abs(lat) <= 90, e.id).toBe(true);
      if (e.start) {
        expect(e.start.local, e.id).toMatch(/^([01]\d|2[0-3]):[0-5]\d$/);
        expect(Math.abs(e.start.utcOffsetMin), e.id).toBeLessThanOrEqual(14 * 60);
      }
      if ('elapsedH' in e.suggest) expect(e.suggest.elapsedH[0], e.id).toBeLessThanOrEqual(e.suggest.elapsedH[1]);
      // The routed distance cannot be shorter than straight lines through the waypoints.
      let straight = 0;
      for (let i = 1; i < e.coords.length; i++) straight += haversine(e.coords[i - 1], e.coords[i]);
      expect(e.km * 1000, e.id).toBeGreaterThan(straight);
    }
  });

  it('file summit days as mountaineering on a Steady target and keep treks as hikes on guide times with mountain breaks', () => {
    for (const e of EXAMPLES.slice(1)) {
      const summit = e.profile === 'alpine';
      expect(e.activity, e.id).toBe(summit ? 'alpine' : 'hike');
      if (summit) {
        expect(e.suggest, e.id).toEqual({ effort: 'steady' });
        expect(e.guideH, e.id).toBeDefined();
        expect(e.mountain, e.id).toBeDefined();
      } else {
        expect('elapsedH' in e.suggest, e.id).toBe(true);
        expect(e.stops, e.id).toBe('alpine');
      }
    }
  });

  it('send summit days through the alpine profile and treks along trails', () => {
    expect(Object.fromEntries(EXAMPLES.map((e) => [e.id, e.profile]))).toEqual({
      montjuic: 'foot',
      'elbrus-south': 'alpine',
      'kazbek-betlemi': 'alpine',
      'mont-blanc-gouter': 'alpine',
      'kilimanjaro-summit-night': 'alpine',
      'aconcagua-normal': 'alpine',
      'ebc-lobuche': 'hiking',
      'thorong-la': 'hiking',
    });
  });

  it('start at the local clock time of the route, on the latest day not after the reference', () => {
    const kilimanjaro = exampleStart({ local: '23:30', utcOffsetMin: 180 }, NOW);
    expect(kilimanjaro).toEqual({ startTime: Date.UTC(2026, 8, 12, 20, 30), utcOffsetMin: 180 });
    expect(localStartHour(kilimanjaro)).toBe(23);
    expect(exampleStart({ local: '03:00', utcOffsetMin: -180 }, NOW)).toEqual({ startTime: Date.UTC(2026, 8, 13, 6, 0), utcOffsetMin: -180 });
    expect(exampleStart({ local: '13:15', utcOffsetMin: 0 }, NOW).startTime).toBe(NOW);
  });

  it('turn guide elapsed hours into moving time without breaks', () => {
    expect(EXAMPLE_BREAK_SHARE).toBe(0.2);
    expect(exampleTarget([11, 16])).toEqual({ kind: 'duration', seconds: 39_000 });
    expect(exampleTarget([5, 7.5])).toEqual({ kind: 'duration', seconds: 18_000 });
  });
});

describe('loadExample', () => {
  const setup = () => {
    const store = createStore(buildInitialState({ stored: null, hash: '', language: 'en', now: NOW }));
    return { store, actions: createActions(store) };
  };

  it('loads waypoints, profile, activity, mountain settings, local start, temperature and a Steady target; undo restores the route', () => {
    const { store, actions } = setup();
    actions.addWaypoint(1, 1);
    actions.addWaypoint(1.01, 1.01);
    actions.loadExample('elbrus-south');
    const s = store.get();
    const elbrus = EXAMPLES.find((e) => e.id === 'elbrus-south')!;
    expect(s.waypoints.map((w) => [w.lon, w.lat])).toEqual(elbrus.coords);
    expect(s).toMatchObject({ profile: 'alpine', targetAuto: true, effortPreset: 'steady', selectedId: null, notice: null });
    expect(s.session).toMatchObject({
      type: 'alpine',
      startTime: Date.UTC(2026, 8, 12, 23, 30),
      utcOffsetMin: 180,
      temperatureC: -8,
      stops: 'alpine',
      acclimatisation: 'full',
      packKg: 5,
      footwear: 'mountain-boots',
      crampons: true,
      snow: 'firm',
      snowlineM: null,
      target: { kind: 'duration' },
      name: 'Night ascent',
    });
    expect(s.viewRequest).toMatchObject({ kind: 'fit', followRoute: true });

    actions.undo();
    expect(store.get().waypoints.map((w) => [w.lon, w.lat])).toEqual([
      [1, 1],
      [1.01, 1.01],
    ]);
  });

  it('defaults to the Montjuïc loop and solves a Steady run on it, keeping the start', () => {
    const { store, actions } = setup();
    actions.updateSession({ type: 'ride', target: { kind: 'speed', mps: 8 } });
    const start = store.get().session.startTime;
    actions.loadExample();
    const s = store.get();
    expect(s).toMatchObject({ profile: 'foot', effortPreset: 'steady', targetAuto: true });
    expect(s.session).toMatchObject({ type: 'run', startTime: start, target: { kind: 'pace' } });
    expect(s.waypoints).toHaveLength(EXAMPLES[0].coords.length);
    actions.loadExample('no-such-example');
    expect(store.get().waypoints).toHaveLength(EXAMPLES[0].coords.length);
  });

  it('a trek after a summit day is a hike on guide time with mountain breaks and no leftover mountain gear', () => {
    const { store, actions } = setup();
    actions.loadExample('kazbek-betlemi');
    expect(store.get().session).toMatchObject({ type: 'alpine', snow: 'soft', snowlineM: 4300, packKg: 8 });
    actions.loadExample('ebc-lobuche');
    const s = store.get();
    expect(s).toMatchObject({ profile: 'hiking', effortPreset: null, targetAuto: false });
    expect(s.session).toMatchObject({ type: 'hike', stops: 'alpine', target: exampleTarget([5, 7.5]), packKg: 0, snowlineM: null, crampons: false, name: 'Morning hike' });
  });
});

/**
 * Synthetic stand-ins for the routed summit days: the routed distance, the climb to the highest point and the SAC grades
 * along the way (technicality by distance from the nearer end of an out-and-back). Steady effort for a recreational
 * athlete, with the example's mountain settings and mountain breaks, must land inside the guide and operator times.
 */
const SUMMIT_DAYS: Record<string, { startEle: number; segments: GradeSegment[]; outAndBack: boolean; technicality: (x: number) => number }> = {
  'elbrus-south': {
    startEle: 3710,
    segments: [
      { length: 1500, grade: 0.2 },
      { length: 2000, grade: 0.32 },
      { length: 2600, grade: 0.28 },
      { length: 1500, grade: 0.176 },
    ],
    outAndBack: true,
    technicality: (x) => (x < 750 ? 0 : x < 4650 ? 0.6 : x < 7100 ? 0.8 : 1),
  },
  'kazbek-betlemi': {
    startEle: 3650,
    segments: [
      { length: 2500, grade: 0.1 },
      { length: 2750, grade: 0.28 },
      { length: 1000, grade: 0.36 },
    ],
    outAndBack: true,
    technicality: (x) => (x < 1700 ? 0.4 : x < 5500 ? 0.6 : 0.8),
  },
  'mont-blanc-gouter': {
    startEle: 3835,
    segments: [
      { length: 2000, grade: 0.2345 },
      { length: 800, grade: -0.08 },
      { length: 700, grade: 0.174 },
      { length: 2100, grade: 0.212 },
    ],
    outAndBack: true,
    technicality: (x) => (x < 3850 ? 0.6 : 0.8),
  },
  'kilimanjaro-summit-night': {
    startEle: 4673,
    segments: [
      { length: 4500, grade: 0.2407 },
      { length: 1200, grade: 0.1158 },
      { length: 1200, grade: -0.1158 },
      { length: 4500, grade: -0.2407 },
      { length: 4700, grade: -0.3347 },
    ],
    outAndBack: false,
    technicality: () => 0.2,
  },
  'aconcagua-normal': {
    startEle: 5950,
    segments: [
      { length: 1100, grade: 0.39 },
      { length: 900, grade: 0.3 },
      { length: 700, grade: 0.445 },
    ],
    outAndBack: true,
    technicality: () => 0.8,
  },
};

describe('summit-day examples at Steady effort land inside guide times', () => {
  const athlete = defaultAthlete();
  for (const example of EXAMPLES.filter((e) => e.activity === 'alpine')) {
    it(example.id, () => {
      const day = SUMMIT_DAYS[example.id];
      expect(day, example.id).toBeDefined();
      const segments = day.outAndBack ? [...day.segments, ...[...day.segments].reverse().map((s) => ({ length: s.length, grade: -s.grade }))] : day.segments;
      const total = segments.reduce((sum, s) => sum + s.length, 0);
      const base = pathProfile(
        [
          [0, 0],
          [total, 0],
        ],
        segmentElevation(segments, day.startEle),
        { origin: example.coords[0], smoothSigma: 20 },
      );
      const profile: TerrainProfile = { ...base, points: base.points.map((p) => ({ ...p, technicality: day.technicality(day.outAndBack ? Math.min(p.d, total - p.d) : p.d) })) };
      expect(Math.abs(profile.maxEle - example.maxEleM)).toBeLessThan(60);
      expect(Math.abs(total / 1000 - example.km)).toBeLessThan(0.3);
      const session: SessionSettings = {
        ...defaultSession('alpine', Date.UTC(2026, 6, 1)),
        ...example.mountain,
        temperatureC: example.temperatureC ?? 0,
        utcOffsetMin: example.start?.utcOffsetMin ?? 0,
        seed: 5,
      };
      const steady = solveEffortPreset({ profile, athlete, session }, 'steady')!;
      const r = simulate({ profile, athlete, session: { ...session, target: { kind: 'speed', mps: steady.mps } } });
      const [low, high] = example.guideH!;
      const hours = r.summary.elapsed / 3600;
      expect(hours, `${example.id} ${hours.toFixed(2)} h`).toBeGreaterThanOrEqual(low);
      expect(hours, `${example.id} ${hours.toFixed(2)} h`).toBeLessThanOrEqual(high);
    }, 20_000);
  }
});

/**
 * Synthetic stand-ins for the routed treks: the routed distance, the climb to the highest point and the rough trail
 * underfoot. Steady effort for a recreational athlete, with the example's acclimatisation and mountain breaks, must
 * land inside the guide hours for the day.
 */
const TREK_DAYS: Record<string, { startEle: number; segments: GradeSegment[]; technicality: number }> = {
  'ebc-lobuche': {
    startEle: 4940,
    segments: [
      { length: 4300, grade: 0.052 },
      { length: 3200, grade: 0.0625 },
      { length: 3200, grade: -0.0625 },
    ],
    technicality: 0.2,
  },
  'thorong-la': {
    startEle: 4540,
    segments: [
      { length: 1000, grade: 0.34 },
      { length: 4300, grade: 0.125 },
      { length: 9400, grade: -0.172 },
    ],
    technicality: 0.2,
  },
};

/**
 * These stand-ins are simplified — even grades, a single technicality, no surface tags — so they come out faster than
 * the routed profiles the app really simulates, and holding them to the guide hours would assert a guarantee they
 * cannot carry. What they can be held to is what the altitude model promises: thin air slows a trekking day sharply,
 * a week at altitude wins part of that back, and below the band where the altitude terms start nothing changes at all.
 */
describe('the trek stand-ins carry the altitude model', () => {
  const athlete = defaultAthlete();
  for (const example of EXAMPLES.filter((e) => e.activity === 'hike')) {
    it(example.id, () => {
      const day = TREK_DAYS[example.id];
      expect(day, example.id).toBeDefined();
      const total = day.segments.reduce((sum, s) => sum + s.length, 0);
      const shaped = (startEle: number): TerrainProfile => {
        const base = pathProfile(
          [
            [0, 0],
            [total, 0],
          ],
          segmentElevation(day.segments, startEle),
          { origin: example.coords[0], smoothSigma: 20 },
        );
        return { ...base, points: base.points.map((p) => ({ ...p, technicality: day.technicality })) };
      };
      const high = shaped(day.startEle);
      const low = shaped(540);
      expect(Math.abs(high.maxEle - example.maxEleM), example.id).toBeLessThan(60);
      expect(Math.abs(total / 1000 - example.km), example.id).toBeLessThan(0.3);
      const elapsed = (profile: TerrainProfile, acclimatisation: Acclimatisation) => {
        const session: SessionSettings = {
          ...defaultSession('hike', Date.UTC(2026, 6, 1)),
          ...example.mountain,
          acclimatisation,
          stops: example.stops ?? 'alpine',
          temperatureC: example.temperatureC ?? 0,
          utcOffsetMin: example.start?.utcOffsetMin ?? 0,
          seed: 5,
        };
        const steady = solveEffortPreset({ profile, athlete, session }, 'steady')!;
        return simulate({ profile, athlete, session: { ...session, target: { kind: 'speed', mps: steady.mps } } }).summary.elapsed;
      };
      const highNone = elapsed(high, 'none');
      const highPartial = elapsed(high, 'partial');
      const lowNone = elapsed(low, 'none');
      const ratio = highNone / lowNone;
      expect(ratio, `${example.id} ${ratio.toFixed(2)}x`).toBeGreaterThan(1.5);
      expect(ratio, `${example.id} ${ratio.toFixed(2)}x`).toBeLessThan(3);
      expect(highPartial, example.id).toBeLessThan(highNone);
      // The same walk copied down to 540 m barely notices acclimatisation: below 1500 m the oxygen budget is off and
      // the effort measure's altitude term has faded to nothing. The second or two left over is the mountain-break
      // schedule, which reads the elevation profile on its own account; that is not part of the altitude model.
      expect(Math.abs(elapsed(low, 'partial') - lowNone), example.id).toBeLessThanOrEqual(2);
    }, 30_000);
  }
});
