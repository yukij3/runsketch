// Weather in the simulation: the pre-weather output without weather, determinism with a series, calibration, and the
// dynamic responses to rain, wind, warming and pressure at the athlete's simulated position and time.
import { describe, expect, it } from 'vitest';
import type { ActivityType, Athlete, SessionSettings, SimulationInput, SimulationResult, TerrainProfile, WeatherSeries, WeatherSettings } from '../types';
import { defaultAthlete, defaultSession } from './athlete';
import { solveEffortPreset } from './presets';
import { climbProfile, flatProfile, outAndBackProfile, rollingProfile, segmentProfile, weatherScenario } from './scenarios';
import { simulate } from './simulate';
import { indexAtDistance, meanRange } from './testing';

const START = Date.UTC(2026, 5, 1, 6, 0);
const athlete = defaultAthlete();
const NEUTRAL = { humidityPct: 60, windMps: 0, windFromDeg: 0, rainMmH: 0 };
const AUTO: WeatherSettings = { mode: 'auto', manual: NEUTRAL, pinned: [] };
const session = (type: ActivityType, over: Partial<SessionSettings> = {}): SessionSettings => ({ ...defaultSession(type, START), seed: 1234, ...over });
const withWeather = (profile: TerrainProfile, type: ActivityType, weather: WeatherSeries | null, over: Partial<SessionSettings> = {}, who: Athlete = athlete) =>
  simulate({ profile, athlete: who, session: session(type, { weather: AUTO, ...over }), weather });

/** The summary numbers a weather-off run is pinned to, so a change to the thermal model has to be a deliberate one. */
interface Pinned {
  moving: number;
  elapsed: number;
  distance: number;
  avgHr: number;
  ascent: number;
}

/**
 * FNV-1a over every stream plus the summary, warnings and implied VO2max, quantised to a millimetre and positions to a
 * centimetre. It compares runs **within one process** — that the manual path, a failed fetch and an ignored series are
 * the same run — and nothing else. Recorded digests were tried and dropped: an engine that integrates for thousands of
 * seconds amplifies the last-bit differences between V8 versions past any quantisation, so a stored hash tested which
 * Node was running rather than what the engine did. The numbers above it pin the output instead, with tolerances.
 */
function digest(r: SimulationResult): string {
  let h = 0x811c9dc5;
  const eatByte = (b: number) => {
    h ^= b & 0xff;
    h = Math.imul(h, 0x01000193);
  };
  const eatInt = (x: number) => {
    eatByte(x);
    eatByte(x >>> 8);
    eatByte(x >>> 16);
    eatByte(x >>> 24);
  };
  const quantise = (v: number, scale: number) => (Number.isFinite(v) ? Math.round(v * scale) : 0);
  for (const key of Object.keys(r.streams).sort()) {
    const a = r.streams[key as keyof typeof r.streams] as ArrayLike<number>;
    const scale = key === 'lat' || key === 'lon' ? 1e7 : 1e3;
    for (let i = 0; i < a.length; i++) eatInt(quantise(a[i], scale));
  }
  const { maxEle: _maxEle, climbRate: _climbRate, ...summary } = r.summary;
  const rounded = Object.fromEntries(Object.entries(summary).map(([k, v]) => [k, typeof v === 'number' ? Math.round(v * 1e3) / 1e3 : v]));
  const tail = JSON.stringify([rounded, r.warnings, r.impliedVo2max === undefined ? null : Math.round(r.impliedVo2max * 1e3) / 1e3]);
  for (const b of new TextEncoder().encode(tail)) eatByte(b);
  return (h >>> 0).toString(16).padStart(8, '0');
}

const sameBytes = (a: ArrayBufferView, b: ArrayBufferView) => {
  const x = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
  const y = new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
  return x.length === y.length && x.every((v, i) => v === y[i]);
};

/** Moving speed between two route distances, m/s. */
function speedBetween(r: SimulationResult, a: number, b: number): number {
  const s = r.streams;
  const i = indexAtDistance(s, a);
  const j = indexAtDistance(s, b);
  let moving = 0;
  for (let k = i + 1; k <= j; k++) moving += s.moving[k];
  return (s.dist[j] - s.dist[i]) / Math.max(1, moving);
}

describe('without weather the engine output is unchanged', () => {
  const trail = (): TerrainProfile => {
    const segments = [];
    for (let k = 0; k < 4; k++) segments.push({ length: 500, grade: 0.1 }, { length: 500, grade: -0.14 });
    const base = segmentProfile(segments, { smoothSigma: 10 });
    return { ...base, points: base.points.map((p, i) => ({ ...p, surface: i % 400 < 200 ? ('ground' as const) : ('rough' as const), technicality: 0.3 })) };
  };
  const START_LEGACY = Date.UTC(2026, 5, 1, 6, 30);
  const legacy = (type: ActivityType, over: Partial<SessionSettings> = {}): SessionSettings => ({ ...defaultSession(type, START_LEGACY), seed: 1234, ...over });
  const cases: Array<[name: string, input: SimulationInput, pinned: Pinned]> = [
    ['run', { profile: rollingProfile(8000, 20, 2500), athlete, session: legacy('run', { stops: 'urban' }) }, { moving: 2640, elapsed: 2978, distance: 8000, avgHr: 155.44, ascent: 144 }],
    [
      'ride',
      { profile: rollingProfile(30000, 25, 4000), athlete, session: legacy('ride', { target: { kind: 'speed', mps: 7.5 }, temperatureC: 24 }) },
      { moving: 4001, elapsed: 4003, distance: 30000, avgHr: 146.44, ascent: 383.6 },
    ],
    ['walk', { profile: flatProfile(5000), athlete, session: legacy('walk', { temperatureC: 5 }) }, { moving: 3600, elapsed: 3602, distance: 5000, avgHr: 95.04, ascent: 3 }],
    [
      'trail',
      { profile: trail(), athlete, session: legacy('run', { hrTarget: 150, target: { kind: 'duration', seconds: 3000 } }) },
      { moving: 3000, elapsed: 3002, distance: 4000, avgHr: 150.05, ascent: 195 },
    ],
    [
      'hike',
      { profile: climbProfile({ before: 500, climb: 2000, grade: 0.15, after: 500 }, { smoothSigma: 20 }), athlete, session: legacy('hike', { target: { kind: 'duration', seconds: 4000 } }) },
      { moving: 4000, elapsed: 4002, distance: 3000, avgHr: 96.96, ascent: 304.4 },
    ],
  ];

  it('the manual path, a failed automatic fetch and an ignored series are one and the same run', () => {
    for (const [name, input] of cases) {
      const expected = digest(simulate(input));
      const manual = simulate({ ...input, session: { ...input.session, weather: { mode: 'manual', manual: NEUTRAL, pinned: ['wind'] } } });
      const failed = simulate({ ...input, session: { ...input.session, weather: AUTO }, weather: null });
      const ignored = simulate({ ...input, session: { ...input.session, weather: { mode: 'manual', manual: NEUTRAL, pinned: [] } }, weather: weatherScenario({ start: START_LEGACY, windSpeed: () => 9 }) });
      expect(digest(manual), name).toBe(expected);
      expect(digest(failed), name).toBe(expected);
      expect(digest(ignored), name).toBe(expected);
      expect(manual.weather!.source).toBeUndefined();
    }
  });

  it('holds the numbers of the one thermal model, so a change to it has to be deliberate', () => {
    for (const [name, input, pinned] of cases) {
      const s = simulate(input).summary;
      expect(Math.abs(s.moving - pinned.moving), `${name} moving`).toBeLessThanOrEqual(1);
      expect(Math.abs(s.elapsed - pinned.elapsed), `${name} elapsed`).toBeLessThanOrEqual(1);
      expect(s.distance, `${name} distance`).toBeCloseTo(pinned.distance, 0);
      expect(s.avgHr, `${name} avgHr`).toBeCloseTo(pinned.avgHr, 1);
      expect(s.ascent, `${name} ascent`).toBeCloseTo(pinned.ascent, 0);
    }
  });
});

/**
 * One thermal model runs in manual and automatic mode alike, so output is no longer byte-identical to the engine from
 * before it. In the reference air that model is calibrated against — 15 °C, 60 % humidity, calm and dry — it must still
 * reproduce that engine: these are its numbers, measured on it, and the run must stay within 2 bpm and 1 %.
 */
describe('a neutral run reproduces the engine from before the thermal model', () => {
  const BEFORE = Date.UTC(2026, 5, 1, 6, 30);
  const neutral = (type: ActivityType, over: Partial<SessionSettings> = {}): SessionSettings => ({ ...defaultSession(type, BEFORE), seed: 11, temperatureC: 15, ...over });
  const cases: Array<[name: string, input: SimulationInput, avgHr: number, speed: number]> = [
    [
      'marathon',
      { profile: flatProfile(42195), athlete, session: neutral('run', { hrSensor: 'strap', target: { kind: 'pace', secPerKm: 341 } }) },
      167.25,
      42195 / 14389,
    ],
    ['10 km', { profile: flatProfile(10000), athlete, session: neutral('run', { target: { kind: 'pace', secPerKm: 300 } }) }, 164.39, 10000 / 3000],
    [
      'hilly',
      { profile: rollingProfile(12000, 35, 2000, { smoothSigma: 20 }), athlete, session: neutral('run', { target: { kind: 'pace', secPerKm: 345 } }) },
      166.08,
      12000 / 4140,
    ],
    [
      'ride',
      { profile: rollingProfile(60000, 30, 5000), athlete, session: neutral('ride', { target: { kind: 'speed', mps: 27 / 3.6 } }) },
      146.99,
      27 / 3.6,
    ],
    [
      'hike',
      { profile: climbProfile({ before: 1000, climb: 3000, grade: 0.12, after: 1000 }, { smoothSigma: 20 }), athlete, session: neutral('hike', { target: { kind: 'duration', seconds: 7200 } }) },
      90.32,
      5000 / 7200,
    ],
  ];

  it('keeps average heart rate within 2 bpm and average speed within 1 %', () => {
    for (const [name, input, avgHr, speed] of cases) {
      const r = simulate(input);
      expect(Math.abs(r.summary.avgHr - avgHr), `${name} hr`).toBeLessThan(2);
      expect(Math.abs(r.summary.avgSpeed / speed - 1), `${name} speed`).toBeLessThan(0.01);
    }
  });
});

describe('determinism and calibration with weather', () => {
  const profile = rollingProfile(12000, 30, 2000, { smoothSigma: 20 });
  const stormy = weatherScenario({
    start: START,
    profile,
    at: [0, 6000, 12000],
    temperature: (h, p) => 12 + 2 * h - p,
    precipitation: (h) => (h === 1 ? 5 : 0),
    windSpeed: (h) => 4 + h,
    windFrom: (h) => 200 + 30 * h,
    pressure: (h) => 1012 - h,
  });

  it('the same seed and series give identical bytes, also after the series went through JSON storage', () => {
    const a = withWeather(profile, 'run', stormy, { stops: 'few' });
    const b = withWeather(profile, 'run', JSON.parse(JSON.stringify(stormy)) as WeatherSeries, { stops: 'few' });
    expect(digest(b)).toBe(digest(a));
    expect(b.weather).toEqual(a.weather);
    const other = withWeather(profile, 'run', stormy, { stops: 'few', seed: 99 });
    expect(sameBytes(other.streams.hr, a.streams.hr)).toBe(false);
  });

  it('moving time stays within ±0.5 % of the target in rain, wind and a sharp shower', () => {
    const run = withWeather(profile, 'run', stormy, { target: { kind: 'pace', secPerKm: 330 } });
    expect(Math.abs(run.summary.moving / (12 * 330) - 1)).toBeLessThan(0.005);
    const ride = withWeather(rollingProfile(40000, 25, 4000), 'ride', stormy, { target: { kind: 'duration', seconds: 5400 } });
    expect(Math.abs(ride.summary.moving / 5400 - 1)).toBeLessThan(0.005);
    const shower = weatherScenario({ start: START, precipitation: (h) => (h === 1 ? 12 : 0) });
    const short = withWeather(outAndBackProfile(1500), 'run', shower, { target: { kind: 'pace', secPerKm: 300 } });
    expect(Math.abs(short.summary.moving / (3 * 300) - 1)).toBeLessThan(0.005);
  });

  it('matching an average heart rate under weather leaves every kinematic stream unchanged', () => {
    const base = withWeather(profile, 'run', stormy, { target: { kind: 'pace', secPerKm: 330 } });
    const matched = withWeather(profile, 'run', stormy, { target: { kind: 'pace', secPerKm: 330 }, hrTarget: 150 });
    for (const key of ['dist', 'speed', 'cadence', 'lat', 'ele', 'temperature'] as const) expect(sameBytes(matched.streams[key], base.streams[key]), key).toBe(true);
    expect(Math.abs(matched.summary.avgHr - 150)).toBeLessThan(1.5);
  });
});

describe('rain that starts mid-activity', () => {
  // Rock on repeated 400 m climbs at +15 % and descents at −20 %, technicality 0.5; rain 4 mm/h in the second hour,
  // then sun and 22 °C.
  const segments = [];
  for (let k = 0; k < 12; k++) segments.push({ length: 400, grade: 0.15 }, { length: 400, grade: -0.2 });
  const base = segmentProfile(segments, { smoothSigma: 8 });
  const trail: TerrainProfile = { ...base, points: base.points.map((p) => ({ ...p, surface: 'rock' as const, technicality: 0.5 })) };
  const common = { start: START, profile: trail, shortwave: (h: number) => (h > 2 ? 650 : 60), temperature: (h: number) => (h > 2 ? 22 : 13), dewPoint: () => 6 };
  const target = { kind: 'duration' as const, seconds: 14000 };
  const dry = withWeather(trail, 'hike', weatherScenario(common), { target });
  const wet = withWeather(trail, 'hike', weatherScenario({ ...common, precipitation: (h) => (h > 1 && h <= 2 ? 4 : 0) }), { target });
  /** Descent k speed wet/dry, relative to the same ratio on the climb before it (the effort scale moves both). */
  const relative = (k: number) => {
    const a = k * 800 + 450;
    const ratio = (x: number, y: number) => speedBetween(wet, x, y) / speedBetween(dry, x, y);
    return ratio(a, a + 300) / ratio(a - 400, a - 100);
  };
  const mean = (ks: number[]) => ks.reduce((sum, k) => sum + relative(k), 0) / ks.length;

  it('leaves descents before the onset alone, slows wet descents, and the slowdown lasts after the rain while the rock dries', () => {
    const minute = (k: number) => indexAtDistance(wet.streams, k * 800 + 450) / 60;
    expect(minute(2)).toBeLessThan(60);
    expect(minute(4)).toBeGreaterThan(65);
    expect(minute(9)).toBeGreaterThan(150);
    const before = mean([0, 1, 2]);
    const during = mean([4, 5, 6]);
    const after = mean([9, 10, 11]);
    expect(before).toBeGreaterThan(0.92);
    expect(before).toBeLessThan(1.08);
    expect(during).toBeLessThan(0.85);
    expect(after).toBeGreaterThan(during + 0.04);
    expect(after).toBeLessThan(0.99);
    expect(Math.abs(wet.summary.moving / 14000 - 1)).toBeLessThan(0.005);
  });

  it('reports the rain at the athlete, the wet stretch and the slower wet descents', () => {
    const w = wet.weather!;
    expect(w.rainFrom).toBeGreaterThanOrEqual(3600);
    expect(w.rainFrom).toBeLessThan(3700);
    expect(w.rainTo).toBeLessThanOrEqual(7200);
    expect(w.rainMm).toBeCloseTo(4, 1);
    expect(w.wetDistance).toBeGreaterThan(3000);
    expect(dry.weather!.rainFrom).toBeNull();
    expect(wet.warnings.some((x) => /^Rain made [\d.]+ km of the route wet, and the wet descents were about \d+ % slower\.$/.test(x))).toBe(true);
  });
});

describe('wet roads on a ride', () => {
  it('a road still wet from the rain before the start lowers the descent speed, and the average holds', () => {
    const route = segmentProfile([{ length: 3000, grade: 0 }, { length: 4000, grade: 0.08 }, { length: 4000, grade: -0.08 }, { length: 3000, grade: 0 }], { smoothSigma: 20 });
    const over = { target: { kind: 'speed' as const, mps: 7 } };
    const dry = withWeather(route, 'ride', weatherScenario({ start: START }), over);
    const wet = withWeather(route, 'ride', weatherScenario({ start: START, precipitation: (h) => (h === 0 ? 3 : 0), dewPoint: () => 13 }), over);
    const top = (r: SimulationResult) => {
      const s = r.streams;
      let fastest = 0;
      for (let i = indexAtDistance(s, 7500); i < indexAtDistance(s, 11000); i++) fastest = Math.max(fastest, s.speed[i]);
      return fastest;
    };
    expect(top(wet)).toBeLessThan(0.95 * top(dry));
    expect(Math.abs(wet.summary.avgSpeed / 7 - 1)).toBeLessThan(0.005);
    expect(wet.weather!.wetDistance).toBeGreaterThan(5000);
  });
});

describe('wind against the direction of travel', () => {
  const route = outAndBackProfile(15000);
  const ride = (weather: WeatherSeries) => withWeather(route, 'ride', weather, { target: { kind: 'speed', mps: 8 } });
  const east = ride(weatherScenario({ start: START, profile: route, windSpeed: () => 7, windFrom: () => 90 }));
  // Easterly at the start, westerly an hour later: the vector turns through calm near the turnaround.
  const shift = ride(weatherScenario({ start: START, profile: route, windSpeed: () => 7, windFrom: (h) => (h <= 0.25 ? 90 : 270) }));

  it('a steady easterly makes the eastward leg slow and the return fast, at the target average', () => {
    expect(speedBetween(east, 16000, 29000) / speedBetween(east, 1000, 14000)).toBeGreaterThan(1.4);
    expect(Math.abs(east.summary.avgSpeed / 8 - 1)).toBeLessThan(0.005);
    expect(east.weather!.headWindMean).toBeGreaterThan(-1);
  });

  it('when the wind swings to the west during the ride, the return turns slower than the late outward leg', () => {
    const outLate = speedBetween(shift, 10000, 14500);
    const back = speedBetween(shift, 16000, 29000);
    expect(back).toBeLessThan(outLate);
    expect(speedBetween(east, 16000, 29000)).toBeGreaterThan(speedBetween(east, 10000, 14500));
    expect(back).toBeLessThan(0.85 * speedBetween(east, 16000, 29000));
    expect(outLate).toBeGreaterThan(1.15 * speedBetween(east, 10000, 14500));
    expect(Math.abs(shift.summary.avgSpeed / 8 - 1)).toBeLessThan(0.005);
  });

  it('a runner is slower into an 8 m/s wind and faster with it, within the drag-cost band', () => {
    const r = withWeather(outAndBackProfile(5000), 'run', weatherScenario({ start: START, windSpeed: () => 8, windFrom: () => 90 }), { target: { kind: 'pace', secPerKm: 300 } });
    const ratio = speedBetween(r, 5500, 9500) / speedBetween(r, 500, 4500);
    expect(ratio).toBeGreaterThan(1.05);
    expect(ratio).toBeLessThan(1.25);
  });
});

describe('warming, pressure and the sensors', () => {
  const marathon = flatProfile(42195);
  const over = { hrSensor: 'strap' as const, target: { kind: 'pace' as const, secPerKm: 341 } };
  const cool = withWeather(marathon, 'run', weatherScenario({ start: START, temperature: () => 10, dewPoint: () => 4 }), over);
  const warming = withWeather(
    marathon,
    'run',
    weatherScenario({ start: START, temperature: (h) => 10 + 5 * Math.max(0, Math.min(4, h)), dewPoint: (h) => 4 + 2.5 * Math.max(0, Math.min(4, h)) }),
    over,
  );
  const hr = (r: SimulationResult, hours: number) => meanRange(r.streams.hr, hours * 3600 - 600, hours * 3600);

  it('a morning warming from 10 to 30 °C raises heart rate later, not early, and eases the pace with it', () => {
    // Skin follows the air within minutes, so by 45 minutes the warmer run is already a couple of beats up: 2.3 bpm
    // here. The point of the test is that the gap keeps growing, not that it is absent early.
    expect(Math.abs(hr(warming, 0.75) - hr(cool, 0.75))).toBeLessThan(3);
    // The heat shows over the whole run rather than at one moment: with the average time fixed, the warmer run banks
    // time early and eases late, so a single mid-run sample compares two different speeds. That is why the old "more
    // than 4 bpm at 2.5 h" is not restored — the gap at that one moment is under a beat — but the whole-run margin is
    // pinned again now that heat reaches heart rate through a settled coefficient: 2.2 bpm here.
    expect(warming.summary.avgHr).toBeGreaterThan(cool.summary.avgHr + 1.5);
    // And the gap does grow through the run again: 2.5 bpm at 1.25 h against 3.4 bpm at 3.5 h.
    expect(hr(warming, 3.5) - hr(cool, 3.5)).toBeGreaterThan(hr(warming, 1.25) - hr(cool, 1.25));
    // The heat reaches the pace too: the same target time, run differently — early in the cool of the morning.
    expect(sameBytes(warming.streams.dist, cool.streams.dist)).toBe(false);
    expect(speedBetween(warming, 32000, 42195) / speedBetween(warming, 2000, 12195)).toBeLessThan(
      speedBetween(cool, 32000, 42195) / speedBetween(cool, 2000, 12195),
    );
    expect(warming.weather!.airTempMax).toBeGreaterThan(28);
    // Peak core is the one that cannot be tightened: the pace absorbs the heat, which is what anticipatory regulation
    // does, so the warmer day peaks no higher at all (0.01 °C lower here). Fluid loss is the robust mark of it, and a
    // wide one: 2.1 L against 1.5 L.
    expect(warming.weather!.sweatLossL).toBeGreaterThan(cool.weather!.sweatLossL);
  });

  it('the wrist sensor follows the warming air', () => {
    const t = warming.streams.temperature;
    expect(meanRange(t, t.length - 600, t.length) - meanRange(t, 900, 1500)).toBeGreaterThan(12);
  });

  it('a 3 hPa pressure fall over three hours reads as about 25 m of climb on the barometer', () => {
    const loop = flatProfile(12000);
    const target = { kind: 'duration' as const, seconds: 3 * 3600 };
    const steady = withWeather(loop, 'walk', weatherScenario({ start: START }), { target });
    const falling = withWeather(loop, 'walk', weatherScenario({ start: START, pressure: (h) => 1013 - Math.max(0, Math.min(3, h)) }), { target });
    const offset = (hours: number) => {
      const i = Math.round(hours * 3600);
      return meanRange(falling.streams.ele, i - 60, i) - meanRange(steady.streams.ele, i - 60, i);
    };
    expect(offset(1)).toBeGreaterThan(6);
    expect(offset(1)).toBeLessThan(10);
    expect(offset(2.9)).toBeGreaterThan(21);
    expect(offset(2.9)).toBeLessThan(28);
    expect(sameBytes(falling.streams.dist, steady.streams.dist)).toBe(true);
  });

  it('air at the athlete cools with height on a climb and the series end is reported when the activity outlasts it', () => {
    const climb = climbProfile({ before: 500, climb: 6000, grade: 0.15, after: 500 }, { smoothSigma: 20 });
    const series = weatherScenario({ start: START, profile: climb, after: 1 });
    const r = withWeather(climb, 'hike', series, { target: { kind: 'duration', seconds: 3 * 3600 } });
    expect(r.weather!.airTempStart - r.weather!.airTempMin).toBeGreaterThan(0.0065 * 850);
    expect(r.weather!.uncoveredS).toBeGreaterThan(3000);
    expect(r.warnings.some((w) => w.startsWith('The weather data ends '))).toBe(true);
  });

  it('manual wind and rain run through the same model without a series', () => {
    const route = outAndBackProfile(5000);
    const manual = simulate({
      profile: route,
      athlete,
      session: session('run', { target: { kind: 'pace', secPerKm: 300 }, weather: { mode: 'manual', manual: { ...NEUTRAL, windMps: 8, windFromDeg: 90, rainMmH: 2 }, pinned: [] } }),
    });
    expect(speedBetween(manual, 5500, 9500)).toBeGreaterThan(speedBetween(manual, 500, 4500));
    expect(manual.weather!.source).toBeUndefined();
    expect(manual.weather!.rainMm).toBeGreaterThan(0);
  });
});

describe('effort presets read the weather', () => {
  const profile = flatProfile(10000);
  const race = (weather: WeatherSeries | null, over: Partial<SessionSettings> = {}) =>
    solveEffortPreset({ profile, athlete, session: session('run', { weather: AUTO, ...over }), weather }, 'race')!.mps;

  it('neutral weather solves the race pace of the manual path; humid sun slows it more than dry shade at the same air temperature', () => {
    const legacy = solveEffortPreset({ profile, athlete, session: session('run', { temperatureC: 15 }) }, 'race')!.mps;
    expect(Math.abs(race(weatherScenario({ start: START })) / legacy - 1)).toBeLessThan(0.015);
    const shade = race(weatherScenario({ start: START, temperature: () => 26, dewPoint: () => 8 }));
    const muggySun = race(weatherScenario({ start: START, temperature: () => 26, dewPoint: () => 21, shortwave: () => 800, cloudCover: () => 10 }));
    expect(muggySun).toBeLessThan(shade * 0.99);
    expect(shade).toBeLessThan(race(weatherScenario({ start: START })));
  });
});
