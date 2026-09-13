// Mountaineering: altitude physiology to 8849 m, loaded walking, mountain ground, the oxygen-capped climbs, breaks,
// warnings, and the walking and gait fixes that share the foot integrator.
import { describe, expect, it } from 'vitest';
import { recordPlan } from '../export/recording';
import type { Athlete, LngLat, ProfilePoint, SessionSettings, SimulationResult, TerrainProfile } from '../types';
import { defaultAthlete, defaultSession } from './athlete';
import { GROUND, SNOW_DEPTH_CM, defaultSnowline, groundTrack, snowFactors } from './ground';
import {
  footwearFactor,
  hrMaxAltitudeFactor,
  inspiredO2,
  loadedClimbSpeed,
  packLoadFactor,
  restHrAltitudeFactor,
  slowWalkFactor,
  swissGradeMultiplier,
  vo2NetLoaded,
  altitudeFactor,
} from './models';
import { solveEffortPreset } from './presets';
import { climbProfile, descentProfile, flatProfile, pathProfile, segmentElevation, segmentProfile, type GradeSegment } from './scenarios';
import { simulate } from './simulate';
import { firstMovingIndex, indexAtDistance, meanRange, nonFiniteStreams } from './testing';
import { buildTrack } from './track';

const athlete = defaultAthlete();
/** 02:30 local at UTC+2. */
const START = Date.UTC(2026, 6, 1, 0, 30);
const session = (over: Partial<SessionSettings> = {}): SessionSettings => ({ ...defaultSession('alpine', START), utcOffsetMin: 120, seed: 21, ...over });

/** An out-and-back mountain day starting at `startEle` on `segments` (reversed for the way down), at `origin`. */
function mountainDay(startEle: number, segments: GradeSegment[], origin: LngLat, technicality?: number): TerrainProfile {
  const all = [...segments, ...[...segments].reverse().map((s) => ({ length: s.length, grade: -s.grade }))];
  const total = all.reduce((sum, s) => sum + s.length, 0);
  const base = pathProfile(
    [
      [0, 0],
      [total, 0],
    ],
    segmentElevation(all, startEle),
    { origin, smoothSigma: 20 },
  );
  return technicality === undefined ? base : { ...base, points: base.points.map((p) => ({ ...p, technicality })) };
}

/** Mont Blanc-like: 3835 m hut, 5.6 km up to 4808 m at 45.8° N (snow from 3000 m). */
const summitDay = mountainDay(3835, [{ length: 2800, grade: 0.18 }, { length: 2800, grade: 0.17 }], [6.83, 45.85], 0.6);

describe('altitude physiology, 0–8849 m', () => {
  it('drives everything from inspired O2 (West 1996): 149 Torr at sea level, 43 Torr on Everest', () => {
    expect(inspiredO2(0)).toBeCloseTo(149.2, 0);
    expect(inspiredO2(8848)).toBeGreaterThan(42.5);
    expect(inspiredO2(8848)).toBeLessThan(43.5);
  });

  it('lowers HRmax with the VO2max loss, more after acclimatisation, and raises resting HR above 1500 m', () => {
    const acute = hrMaxAltitudeFactor(altitudeFactor(5400, 0), 0);
    const acclimatised = hrMaxAltitudeFactor(altitudeFactor(5400, 1), 1);
    // 170/186 bpm in acute hypoxia; 155/186 after weeks at 5400 m (Lundby & van Hall 2001).
    expect(acute).toBeGreaterThan(0.9);
    expect(acute).toBeLessThan(0.92);
    expect(acclimatised).toBeGreaterThan(0.83);
    expect(acclimatised).toBeLessThan(0.87);
    expect(hrMaxAltitudeFactor(1, 1)).toBe(1);
    // 57 → 70 bpm at 5400 m and 80 at 6300 m, acclimatised (Karliner 1985).
    expect(restHrAltitudeFactor(1500, 0)).toBe(1);
    expect(restHrAltitudeFactor(5400, 1)).toBeGreaterThan(1.2);
    expect(restHrAltitudeFactor(5400, 1)).toBeLessThan(1.3);
    expect(restHrAltitudeFactor(6300, 1)).toBeGreaterThan(1.3);
    expect(restHrAltitudeFactor(6300, 0)).toBeGreaterThan(restHrAltitudeFactor(6300, 1));
    expect(restHrAltitudeFactor(8849, 0)).toBeLessThanOrEqual(1.5);
  });

  it('a run at 4000 m records a lower maximum heart rate and a higher floor than the same run at sea level', () => {
    const low = segmentProfile([{ length: 2000, grade: 0 }, { length: 1500, grade: 0.1 }, { length: 2000, grade: 0 }]);
    const high: TerrainProfile = { ...low, points: low.points.map((p) => ({ ...p, ele: p.ele + 3900 })) };
    const over = { hrSensor: 'strap' as const, target: { kind: 'pace' as const, secPerKm: 300 } };
    const sea = simulate({ profile: low, athlete, session: { ...defaultSession('run', START), seed: 3, ...over } });
    const alt = simulate({ profile: high, athlete, session: { ...defaultSession('run', START), seed: 3, ...over } });
    expect(Math.max(...alt.streams.hr)).toBeLessThan(athlete.maxHr * hrMaxAltitudeFactor(altitudeFactor(4000)) + 2.5);
    expect(Math.max(...sea.streams.hr)).toBeGreaterThan(Math.max(...alt.streams.hr));
    expect(meanRange(alt.streams.hrDemand, 0, 3)).toBeGreaterThan(meanRange(sea.streams.hrDemand, 0, 3));
  });
});

describe('mountain walking: grade, load, footwear, slow walking and snow', () => {
  it('follows the Swiss hiking-time curve, whose vertical rate levels off near 370 m/h', () => {
    const table: Array<[number, number]> = [
      [-0.4, 0.39],
      [-0.1, 1.0],
      [-0.05, 1.08],
      [0, 1],
      [0.1, 0.71],
      [0.2, 0.44],
      [0.3, 0.29],
      [0.4, 0.21],
    ];
    for (const [g, rel] of table) expect(swissGradeMultiplier(g), `${g}`).toBeCloseTo(rel, 1);
    // Route distance is horizontal, so the vertical rate is speed × grade.
    for (const g of [0.15, 0.2, 0.3, 0.4]) {
      const vertical = 4.2 * swissGradeMultiplier(g) * 1000 * g;
      expect(vertical, `${g}`).toBeGreaterThan(350);
      expect(vertical, `${g}`).toBeLessThan(380);
    }
  });

  it('prices pack, footwear and slow walking as the load-carriage equations do, and inverts exactly', () => {
    expect(packLoadFactor(15, 75)).toBeCloseTo(1.22, 2);
    expect(packLoadFactor(25, 75)).toBeCloseTo(1.44, 2);
    expect(packLoadFactor(0, 75)).toBe(1);
    // Mountain boots and crampons at 0.5 m/s: about +9 %.
    expect(footwearFactor(0.5, 2.1 + 0.87)).toBeCloseTo(1.095, 2);
    expect(footwearFactor(1.4, 0.6)).toBe(1);
    expect(slowWalkFactor(0.5)).toBeCloseTo(1.25, 1);
    expect(slowWalkFactor(0.3)).toBeCloseTo(1.6, 1);
    expect(slowWalkFactor(1.2)).toBe(1);
    for (const [v, g, cost, load, pair] of [
      [0.12, 0.35, 1.3, 1.1, 2.97],
      [0.4, 0.2, 1, 1.05, 2.1],
      [1.1, 0.05, 1.08, 1, 0.6],
      [1.6, 0, 1, 1.2, 2.7],
    ]) {
      const vo2 = vo2NetLoaded(v, g, cost, load, pair);
      expect(loadedClimbSpeed(vo2, g, cost, load, pair, 0.9)).toBeCloseTo(v, 6);
    }
  });

  it('softer snow is slower and dearer; scree is easier down than up; the snowline follows latitude', () => {
    const firm = snowFactors(SNOW_DEPTH_CM.firm);
    const soft = snowFactors(SNOW_DEPTH_CM.soft);
    const deep = snowFactors(SNOW_DEPTH_CM.deep);
    expect(firm.cost).toBeLessThan(soft.cost);
    expect(soft.cost).toBeLessThan(deep.cost);
    expect(deep.speed).toBeLessThan(firm.speed);
    expect(GROUND.scree.walkDown!.speed).toBeGreaterThan(GROUND.scree.walkSpeed);
    expect(GROUND.scree.walkDown!.cost).toBeLessThan(GROUND.scree.walkCost);
    expect(defaultSnowline(45.8)).toBe(3000);
    expect(defaultSnowline(-3)).toBe(5000);
    expect(defaultSnowline(-32.6)).toBeGreaterThan(4000);
    expect(defaultSnowline(-32.6)).toBeLessThan(4500);
  });

  it('infers snow above the snowline on unknown or T4+ path ground on a mountain day only, and slows bare ice without crampons', () => {
    const base = climbProfile({ before: 500, climb: 3000, grade: 0.2, after: 500 });
    const points: ProfilePoint[] = base.points.map((p, k) => ({
      ...p,
      ele: p.ele + 2800,
      ...(k % 4 === 1 ? { surface: 'ground' as const, technicality: 0.6 } : k % 4 === 2 ? { surface: 'rock' as const, technicality: 0.6 } : k % 4 === 3 ? { surface: 'ice' as const } : {}),
    }));
    const profile: TerrainProfile = { ...base, points };
    const track = buildTrack(profile, 0.45);
    const alpine = groundTrack(profile, track, { alpine: { snowlineM: 3000, crampons: true } })!;
    const bare = groundTrack(profile, track, { alpine: { snowlineM: 3000, crampons: false } })!;
    const hike = groundTrack(profile, track);
    const high = track.n - 20 - ((track.n - 20) % 4);
    expect(track.ele[high]).toBeGreaterThan(3000);
    expect(alpine.snow[high]).toBe(1);
    expect(alpine.snow[high + 1]).toBe(1);
    expect(alpine.snow[high + 2]).toBe(0);
    expect(alpine.snow[high + 3]).toBe(1);
    expect(alpine.snow[2]).toBe(0);
    expect(bare.walkSpeed[high + 3]).toBeCloseTo(0.7 * alpine.walkSpeed[high + 3], 9);
    expect(hike!.snow[high]).toBe(0);
  });
});

describe('a mountaineering day', () => {
  const run = (over: Partial<SessionSettings> = {}, who: Athlete = athlete, profile = summitDay) => simulate({ profile, athlete: who, session: session(over) });

  it('meets a moving-time target within ±0.5 %, deterministically, without NaN, in well under a second', () => {
    run({ target: { kind: 'duration', seconds: 6 * 3600 } });
    const t0 = performance.now();
    const a = run({ target: { kind: 'duration', seconds: 7 * 3600 } });
    const ms = performance.now() - t0;
    const b = run({ target: { kind: 'duration', seconds: 7 * 3600 } });
    expect(Math.abs(a.summary.moving / (7 * 3600) - 1)).toBeLessThan(0.005);
    expect(Array.from(b.streams.hr)).toEqual(Array.from(a.streams.hr));
    expect(Array.from(b.streams.dist)).toEqual(Array.from(a.streams.dist));
    expect(nonFiniteStreams(a)).toEqual([]);
    // A guard against a pathological slowdown, not a benchmark: a shared CI runner is several times slower than a laptop.
    expect(ms).toBeLessThan(3000);
    expect(a.summary.avgPower).toBe(0);
  });

  it('slows to a rest step on the slowest ground instead of shuffling at the walking floor', () => {
    const deep = run({ snow: 'deep', footwear: 'double-boots', crampons: true, packKg: 12, target: { kind: 'duration', seconds: 9 * 3600 } });
    const s = deep.streams;
    const i = firstMovingIndex(s);
    const top = indexAtDistance(s, 5600);
    const steps: number[] = [];
    let slow = 0;
    for (let k = i; k < top; k++) {
      if (!(s.cadence[k] > 0) || !s.moving[k]) continue;
      if (s.cadence[k] < 80) {
        slow++;
        steps.push((60 * (s.dist[k] - s.dist[k - 1])) / s.cadence[k]);
      }
    }
    expect(slow).toBeGreaterThan(60);
    expect(Math.min(...Array.from(s.cadence).filter((c) => c > 0))).toBeGreaterThanOrEqual(25);
    const step = steps.reduce((a, b) => a + b, 0) / steps.length;
    expect(step).toBeGreaterThan(0.4);
    expect(step).toBeLessThan(0.6);
    // A hike on the same ground keeps a walker's cadence.
    const hike = simulate({ profile: summitDay, athlete, session: { ...session(), type: 'hike' } });
    expect(Math.min(...Array.from(hike.streams.cadence).filter((c) => c > 0))).toBeGreaterThanOrEqual(80);
  });

  it('at the same effort climbs slower high up than low down, and a faster target climbs harder', () => {
    const vertical = (r: SimulationResult, a: number, b: number) => {
      const s = r.streams;
      const i = indexAtDistance(s, a);
      const j = indexAtDistance(s, b);
      let moving = 0;
      for (let k = i + 1; k <= j; k++) moving += s.moving[k];
      return (((s.dist[j] - s.dist[i]) * 0.2) / moving) * 3600;
    };
    const climb = segmentProfile([{ length: 500, grade: 0 }, { length: 4000, grade: 0.2 }, { length: 500, grade: 0 }], { smoothSigma: 20 });
    const lifted = (ele: number): TerrainProfile => ({ ...climb, points: climb.points.map((p) => ({ ...p, ele: p.ele + ele })) });
    const over = { stops: 'none' as const, snowlineM: 9000 };
    const steady = (profile: TerrainProfile) => {
      const mps = solveEffortPreset({ profile, athlete, session: session(over) }, 'steady')!.mps;
      return run({ ...over, target: { kind: 'speed', mps } }, athlete, profile);
    };
    const low = steady(lifted(900));
    const high = steady(lifted(4900));
    expect(vertical(high, 1500, 4000)).toBeLessThan(0.8 * vertical(low, 1500, 4000));
    expect(high.summary.moving).toBeGreaterThan(low.summary.moving);
    const fast = run({ ...over, target: { kind: 'duration', seconds: Math.round(0.8 * high.summary.moving) } }, athlete, lifted(4900));
    expect(vertical(fast, 1500, 4000)).toBeGreaterThan(vertical(high, 1500, 4000));
    expect(meanRange(fast.streams.hrDemand, 2000, 5000)).toBeGreaterThan(meanRange(high.streams.hrDemand, 2000, 5000));
  });

  it('takes regular breaks, a longer one at the summit and a gear stop where snow starts, all exported as pauses', () => {
    // Starts below the 3000 m snowline, so crampons go on on the way up.
    const profile = mountainDay(2600, [{ length: 3000, grade: 0.2 }, { length: 3000, grade: 0.2 }], [6.83, 45.85], 0.6);
    const r = run({ target: { kind: 'duration', seconds: 8 * 3600 } }, athlete, profile);
    const s = r.streams;
    const stops: Array<{ at: number; seconds: number; ele: number; from: number; to: number }> = [];
    for (let i = firstMovingIndex(s); i < s.t.length; i++) {
      if (s.moving[i] || !s.moving[i - 1]) continue;
      let j = i;
      while (j < s.t.length && !s.moving[j]) j++;
      if (j < s.t.length) stops.push({ at: s.dist[i], seconds: j - i, ele: s.ele[i], from: i, to: j });
    }
    const share = 1 - r.summary.moving / r.summary.elapsed;
    expect(share).toBeGreaterThan(0.1);
    expect(share).toBeLessThan(0.25);
    expect(stops.length).toBeGreaterThanOrEqual(5);
    const summit = stops.reduce((a, b) => (b.ele > a.ele ? b : a));
    expect(Math.abs(summit.at - 6000)).toBeLessThan(60);
    expect(summit.seconds).toBeGreaterThan(8 * 60);
    const gear = stops.find((stop) => Math.abs(stop.ele - 3000) < 40);
    expect(gear).toBeDefined();
    expect(gear!.seconds).toBeGreaterThan(5 * 60);
    // No regular break just before the summit stop (planned 20 min of expected moving time ahead of it).
    const beforeSummit = stops.filter((stop) => stop.at < summit.at).at(-1)!;
    expect(summit.from - beforeSummit.to).toBeGreaterThan(15 * 60);
    const plan = recordPlan({ result: r, session: session() });
    expect(plan.pauses.length).toBe(stops.length);
    // Same seed, same schedule.
    expect(run({ target: { kind: 'duration', seconds: 8 * 3600 } }, athlete, profile).summary.elapsed).toBe(r.summary.elapsed);
  });

  it('warns about a late summit, an unacclimatised ascent above 5500 m and heights where bottled oxygen is the norm', () => {
    const late = run({ startTime: Date.UTC(2026, 6, 1, 8, 0), target: { kind: 'duration', seconds: 6 * 3600 } });
    expect(late.warnings.some((w) => /^The highest point \(\d+ m\) is reached at 1[3-9]:\d\d local time, after 13:00/.test(w))).toBe(true);
    expect(run({ target: { kind: 'duration', seconds: 6 * 3600 } }).warnings.some((w) => w.startsWith('The highest point'))).toBe(false);
    const high = mountainDay(5000, [{ length: 3000, grade: 0.2 }, { length: 2000, grade: 0.25 }], [86.9, 27.9]);
    const none = run({ acclimatisation: 'none', target: { kind: 'duration', seconds: 12 * 3600 } }, athlete, high);
    expect(none.warnings.some((w) => /^The route climbs to 60\d\d m; above 5500 m that is not realistic without acclimatisation\.$/.test(w))).toBe(true);
    const full = run({ acclimatisation: 'full', target: { kind: 'duration', seconds: 12 * 3600 } }, athlete, high);
    expect(full.warnings.some((w) => w.includes('without acclimatisation'))).toBe(false);
    const everest = mountainDay(7900, [{ length: 3000, grade: 0.32 }], [86.93, 27.98]);
    const top = run({ acclimatisation: 'full', target: { kind: 'duration', seconds: 16 * 3600 } }, athlete, everest);
    expect(top.warnings.some((w) => /above 7500 m most ascents use bottled oxygen/.test(w))).toBe(true);
    expect(nonFiniteStreams(top)).toEqual([]);
  });

  it('summarises the highest point and the climb rate', () => {
    const r = run({ target: { kind: 'duration', seconds: 7 * 3600 } });
    expect(r.summary.maxEle).toBeGreaterThan(4780);
    expect(r.summary.climbRate).toBeGreaterThan(100);
    expect(r.summary.climbRate).toBeLessThan(600);
  });
});

describe('walking ceilings, gait bouts and descent skill', () => {
  it('a hike target too fast for its climbs caps walking speed and names the binding limit', () => {
    const profile = climbProfile({ before: 1000, climb: 3000, grade: 0.2, after: 1000 }, { smoothSigma: 20 });
    const r = simulate({ profile, athlete, session: { ...defaultSession('hike', START), seed: 4, target: { kind: 'duration', seconds: 45 * 60 } } });
    const s = r.streams;
    let fastest = 0;
    for (let i = 1; i < s.t.length; i++) fastest = Math.max(fastest, s.dist[i] - s.dist[i - 1]);
    expect(fastest).toBeLessThanOrEqual(2.35);
    const missed = r.warnings.find((w) => w.startsWith('The target moving time'));
    expect(missed).toBeDefined();
    expect(missed).not.toMatch(/corner/);
    expect(r.warnings.some((w) => /\d{4} % of/.test(w))).toBe(false);
  });

  it('run/walk bouts on a steady climb vary in length instead of repeating on a fixed period', () => {
    const runner: Athlete = { ...athlete, age: 25, restHr: 50, maxHr: 191 };
    const r = simulate({
      profile: climbProfile({ before: 500, climb: 4000, grade: 0.2, after: 300 }, { smoothSigma: 20 }),
      athlete: runner,
      session: { ...defaultSession('run', START), seed: 9, target: { kind: 'pace', secPerKm: 600 } },
    });
    const s = r.streams;
    const walks: number[] = [];
    let length = 0;
    for (let i = indexAtDistance(s, 700); i < indexAtDistance(s, 4300); i++) {
      const walking = s.cadence[i] > 0 && s.cadence[i] < 140;
      if (walking) length++;
      else if (length > 0) {
        walks.push(length);
        length = 0;
      }
    }
    expect(walks.length).toBeGreaterThanOrEqual(4);
    const mean = walks.reduce((a, b) => a + b, 0) / walks.length;
    const sd = Math.sqrt(walks.reduce((a, b) => a + (b - mean) ** 2, 0) / walks.length);
    expect(sd / mean).toBeGreaterThan(0.15);
  });

  it('trained runners keep running a −35 % descent that recreational runners walk, and walk it faster when they do', () => {
    const descent = descentProfile({ before: 1500, descent: 1000, grade: -0.35, after: 1500 }, { smoothSigma: 20 });
    const on = (fitness: Athlete['fitness']) =>
      simulate({ profile: descent, athlete: { ...athlete, fitness }, session: { ...defaultSession('run', START), seed: 2, target: { kind: 'pace', secPerKm: 360 } } });
    const share = (r: SimulationResult) => {
      const s = r.streams;
      const i = indexAtDistance(s, 1700);
      const j = indexAtDistance(s, 2300);
      let walk = 0;
      for (let k = i; k < j; k++) if (s.cadence[k] > 0 && s.cadence[k] < 140) walk++;
      return { walk: walk / (j - i), speed: (s.dist[j] - s.dist[i]) / (j - i) };
    };
    const recreational = share(on('recreational'));
    const trained = share(on('trained'));
    expect(recreational.walk).toBeGreaterThan(0.9);
    expect(trained.walk).toBeLessThan(0.5);
    expect(trained.speed).toBeGreaterThan(recreational.speed * 1.3);
    expect(share(on('beginner')).speed).toBeLessThan(recreational.speed);
  });
});

describe('flat walking', () => {
  it('an ordinary walk is unchanged by the walking ceilings', () => {
    const r = simulate({ profile: flatProfile(4000), athlete, session: { ...defaultSession('walk', START), seed: 1 } });
    expect(r.warnings).toEqual([]);
    expect(Math.abs(r.summary.moving / 2880 - 1)).toBeLessThan(0.005);
  });
});
