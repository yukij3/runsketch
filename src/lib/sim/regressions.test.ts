// Regression tests for the physiology, signal and numerics review findings (one describe per finding group).
import { describe, expect, it } from 'vitest';
import type { ActivityType, Athlete, ProfilePoint, SessionSettings, SimulationResult, TerrainProfile } from '../types';
import { defaultAthlete, defaultSession, hrZones } from './athlete';
import { SLOW_COMPONENT, hrDemand, hrKinetics } from './hr';
import { DESCENT_SKILL, altitudeFactor, powerHikeSpeed, runCadence, runGradeMultiplier, toblerShape, vo2NetRide, vo2NetRun, walkGradeMultiplier } from './models';
import { solveEffortPreset } from './presets';
import { climbProfile, descentProfile, flatProfile, rollingProfile, segmentProfile, twoPointProfile } from './scenarios';
import { simulate } from './simulate';
import { ensembleAround, firstMovingIndex, indexAtDistance, meanRange, nonFiniteStreams, positionJumps } from './testing';
import { DEG, M_PER_DEG } from './track';

const START = Date.UTC(2026, 5, 1, 6, 30);
const session = (type: ActivityType, over: Partial<SessionSettings> = {}): SessionSettings => ({
  ...defaultSession(type, START),
  seed: 11,
  ...over,
});
const athlete = defaultAthlete();
const runner: Athlete = { ...defaultAthlete(), age: 25, restHr: 50, maxHr: 191 };
const run = (profile: TerrainProfile, type: ActivityType, over: Partial<SessionSettings> = {}, who: Athlete = athlete) =>
  simulate({ profile, athlete: who, session: session(type, over) });
const movingError = (r: SimulationResult, seconds: number) => Math.abs(r.summary.moving / seconds - 1);
/** First stopped sample after moving off (the standing start is not a stop). */
const firstStopped = (r: SimulationResult) => {
  for (let i = firstMovingIndex(r.streams); i < r.streams.t.length; i++) if (!r.streams.moving[i]) return i;
  return -1;
};

describe('HR kinetics: vagal/sympathetic split instead of a zero-slope series cascade', () => {
  it('HR dips during a short stop and turns upward within 10 s of resuming', () => {
    const runs = [1, 2, 3, 4, 5, 6].map((seed) =>
      simulate(
        { profile: flatProfile(5000), athlete: runner, session: session('run', { seed, hrSensor: 'strap', gpsNoise: 'off', target: { kind: 'pace', secPerKm: 330 } }) },
        { stops: [{ s: 3000, duration: 15 }] },
      ),
    );
    const B = 30;
    const hr = ensembleAround(runs, 'hr', firstStopped, B, 120);
    const pre = meanRange(hr, 0, B);
    const stopEnd = B + 14;
    expect(pre - meanRange(hr, stopEnd - 1, stopEnd + 2)).toBeGreaterThan(6);
    let trough = B;
    for (let k = B; k < B + 100; k++) if (hr[k] < hr[trough]) trough = k;
    expect(trough - stopEnd).toBeLessThanOrEqual(10);
  });

  it('large transitions start moving immediately; recovery is fastest early', () => {
    const levels = { rest: 55, max: 184 };
    const up = hrKinetics(new Float64Array(200).fill(160), 200, 1, 70, levels);
    expect(up[5] - 70).toBeGreaterThan(8);
    expect(up[10] - 70).toBeGreaterThan(15);
    const down = hrKinetics(new Float64Array(200).fill(70), 200, 1, 160, levels);
    expect(160 - down[10]).toBeGreaterThan(6);
    expect(down[0] - down[10]).toBeGreaterThan(down[60] - down[70]);
  });

  it('changes high in the HR range stay slow (a crest is not a stop)', () => {
    const levels = { rest: 55, max: 184 };
    const crest = hrKinetics(new Float64Array(200).fill(150), 200, 1, 165, levels);
    expect(165 - crest[20]).toBeLessThan(4);
  });

  it('falls at most twice as slowly as it rises, and faster after a short surge than after a held effort', () => {
    const levels = { rest: 55, max: 184 };
    const t63 = (h: Float64Array, from: number, to: number, start = 0) =>
      h.findIndex((x, k) => k >= start && (to > from ? x >= from + 0.63 * (to - from) : x <= from - 0.63 * (from - to))) - start;
    const up = t63(hrKinetics(new Float64Array(600).fill(150), 600, 1, 120, levels), 120, 150);
    const down = t63(hrKinetics(new Float64Array(600).fill(120), 600, 1, 150, levels), 150, 120);
    expect(down / up).toBeLessThanOrEqual(2.1);
    const afterSurge = (seconds: number) => {
      const demand = new Float64Array(1800).fill(150);
      for (let i = 600; i < 600 + seconds; i++) demand[i] = 170;
      const h = hrKinetics(demand, 1800, 1, 150, levels);
      return t63(h, h[599 + seconds], 150, 600 + seconds);
    };
    expect(afterSurge(30)).toBeLessThan(0.85 * afterSurge(600));
  });

  it('mean HR stays close to mean demand on a 60 s on/off pattern', () => {
    const n = 4800;
    const demand = new Float64Array(n);
    for (let i = 0; i < n; i++) demand[i] = Math.floor(i / 30) % 2 === 0 ? 140 : 170;
    const h = hrKinetics(demand, n, 1, 150, { rest: 55, max: 184 });
    expect(meanRange(h, 1200, n) - meanRange(demand, 1200, n)).toBeLessThan(5);
  });

  it('HR stops falling when running resumes after a short stop', () => {
    // Kinetics only: variability 0 keeps the physiological HR wander from deciding a 1 bpm comparison.
    const runs = [1, 2, 3, 4].map((seed) =>
      simulate(
        { profile: flatProfile(6000), athlete, session: session('run', { seed, variability: 0, hrSensor: 'strap', gpsNoise: 'off', target: { kind: 'pace', secPerKm: 330 } }) },
        { stops: [{ s: 3000, duration: 6 }] },
      ),
    );
    let end = 0;
    let later = 0;
    let lowest = 0;
    for (const r of runs) {
      const s = r.streams;
      let k = indexAtDistance(s, 3000);
      while (s.moving[k + 1]) k++;
      const last = k + 6;
      end += meanRange(s.hr, last - 1, last + 2) / runs.length;
      later += meanRange(s.hr, last + 19, last + 22) / runs.length;
      lowest += Math.min(...Array.from(s.hr.slice(last, last + 40))) / runs.length;
    }
    expect(later).toBeGreaterThanOrEqual(end - 1);
    expect(lowest).toBeGreaterThan(end - 3);
  });

  it('the running slow component is two thirds of the cycling one', () => {
    const n = 2400;
    const vo2 = new Float64Array(n).fill(0.85 * 41.5);
    const params = { rest: 50, max: 200, vo2max: 45, tauScale: 1, fracLT: 0.75, temperatureC: 15 };
    const foot = hrDemand(vo2, n, { ...params, slowComponent: SLOW_COMPONENT.run }).demand;
    const ride = hrDemand(vo2, n, { ...params, slowComponent: SLOW_COMPONENT.ride }).demand;
    // (15 − 10) bpm × 0.4 of the way from threshold to max × (1 − e^(−2400/420)).
    expect(ride[n - 1] - foot[n - 1]).toBeCloseTo(2, 0);
  });

  it('a heart rate pinned at the maximum is not a flat shelf', () => {
    // A beginner marathon far beyond a sustainable pace: demand sits at the ceiling for hours, and a clipped trace
    // would read exactly HRmax for minutes at a time.
    const beginner: Athlete = { ...athlete, fitness: 'beginner' };
    for (const hrSensor of ['strap', 'optical'] as const) {
      const r = run(flatProfile(42195), 'run', { hrSensor, target: { kind: 'pace', secPerKm: 390 } }, beginner);
      const s = r.streams;
      let atMax = 0;
      let moving = 0;
      let run_ = 0;
      let longest = 0;
      for (let i = 0; i < s.t.length; i++) {
        if (!s.moving[i]) continue;
        moving++;
        expect(s.hr[i], hrSensor).toBeLessThanOrEqual(beginner.maxHr);
        if (s.hr[i] === beginner.maxHr) {
          atMax++;
          longest = Math.max(longest, ++run_);
        } else run_ = 0;
      }
      expect(atMax / moving, hrSensor).toBeLessThan(0.12);
      expect(longest, hrSensor).toBeLessThan(45);
      // The trace still reaches the maximum now and then.
      expect(atMax, hrSensor).toBeGreaterThan(0);
    }
  });

  it('heart rate wanders a couple of bpm around its 1-minute mean while most seconds repeat', () => {
    const measure = (hrSensor: SessionSettings['hrSensor']) => {
      const s = run(flatProfile(10000), 'run', { hrSensor, target: { kind: 'pace', secPerKm: 330 } }).streams;
      let sq = 0;
      let same = 0;
      let count = 0;
      for (let i = 600; i < s.t.length - 600; i++) {
        if (!s.moving[i]) continue;
        sq += (s.hr[i] - meanRange(s.hr, i - 30, i + 31)) ** 2;
        if (s.hr[i] === s.hr[i - 1]) same++;
        count++;
      }
      return { detrended: Math.sqrt(sq / count), unchanged: same / count };
    };
    // Decoded 1 Hz files: strap detrended SD ≈ 2.35 bpm with ≈ 64 % unchanged seconds.
    const strap = measure('strap');
    expect(strap.detrended).toBeGreaterThan(1.6);
    expect(strap.detrended).toBeLessThan(3);
    expect(strap.unchanged).toBeGreaterThan(0.56);
    expect(strap.unchanged).toBeLessThan(0.72);
    // The optical sensor averages over about 5 s, so it repeats more often and wanders no more.
    const optical = measure('optical');
    expect(optical.unchanged).toBeGreaterThan(strap.unchanged);
    expect(optical.detrended).toBeLessThan(strap.detrended + 0.5);
  });

  it('recorded HR never exceeds the athlete maximum, even on an impossible target', () => {
    const hard = run(flatProfile(5000), 'run', { hrSensor: 'strap', target: { kind: 'pace', secPerKm: 200 } });
    expect(hard.summary.maxHr).toBeLessThanOrEqual(athlete.maxHr);
    const vk = run(climbProfile({ before: 500, climb: 2900, grade: 0.35, after: 200 }), 'run', { target: { kind: 'pace', secPerKm: 600 } });
    expect(Math.max(...vk.streams.hr)).toBeLessThanOrEqual(athlete.maxHr);
  });
});

describe('steep descents: HR demand follows effort, not the braking pace factor', () => {
  const sections = (grade: number) => {
    const r = run(descentProfile({ before: 2000, descent: 1500, grade, after: 1000 }, { smoothSigma: 20 }), 'run', { variability: 0, target: { kind: 'pace', secPerKm: 330 } }, runner);
    const s = r.streams;
    const flat = meanRange(s.hrDemand, indexAtDistance(s, 1300), indexAtDistance(s, 2000));
    const down = meanRange(s.hrDemand, indexAtDistance(s, 2800), indexAtDistance(s, 3500));
    return { flat, down };
  };

  it('−20 %, −25 % and −30 % demand is below flat running demand', () => {
    for (const g of [-0.2, -0.25, -0.3]) {
      const { flat, down } = sections(g);
      expect(down, `${g}`).toBeLessThan(flat - 5);
    }
  });

  it('recorded HR on a steep running descent is only 10–25 bpm under the surrounding flats', () => {
    for (const grade of [-0.2, -0.25]) {
      const r = run(descentProfile({ before: 2000, descent: 1500, grade, after: 1500 }, { smoothSigma: 20 }), 'run', { hrSensor: 'strap', variability: 0.1, target: { kind: 'pace', secPerKm: 330 } }, runner);
      const s = r.streams;
      const hr = (a: number, b: number) => meanRange(s.hr, indexAtDistance(s, a), indexAtDistance(s, b));
      const delta = hr(2300, 3300) - (hr(1200, 1900) + hr(3700, 4800)) / 2;
      expect(delta, `${grade}`).toBeLessThan(-10);
      expect(delta, `${grade}`).toBeGreaterThan(-25);
    }
  });

  it('net VO2 at the planned downhill speed never exceeds flat VO2 and keeps a floor', () => {
    for (let g = -0.45; g <= -0.1; g += 0.05) {
      const v = 3 * runGradeMultiplier(g, 0.35);
      expect(vo2NetRun(v, g)).toBeLessThanOrEqual(vo2NetRun(3, 0) + 1e-9);
      expect(vo2NetRun(v, g)).toBeGreaterThanOrEqual(0.6 * vo2NetRun(3, 0) - 1e-9);
    }
  });
});

describe('rides: coasting demand, net VO2, descent-dominated routes, stalls and power ceiling', () => {
  it('HR on a 12-minute coasting descent stays above rest + 25 % of HR reserve', () => {
    const profile = segmentProfile([{ length: 20000, grade: 0 }, { length: 12000, grade: -0.06 }, { length: 10000, grade: 0 }], { smoothSigma: 20 });
    const r = run(profile, 'ride', { target: { kind: 'speed', mps: 8.5 } });
    const s = r.streams;
    const end = indexAtDistance(s, 32000);
    expect(meanRange(s.hr, end - 300, end)).toBeGreaterThanOrEqual(athlete.restHr + 0.25 * (athlete.maxHr - athlete.restHr));
  });

  it('ride VO2 is net of resting metabolism', () => {
    expect(vo2NetRide(0, 70)).toBe(0);
    expect(vo2NetRide(93, 70)).toBeCloseTo((93 * 60) / (0.21 * 20.9 * 70) - 3.5, 9);
  });

  it('a slow target on a descent-dominated route brakes on descents instead of crawling the flats', () => {
    const profile = segmentProfile([{ length: 2000, grade: 0 }, { length: 15000, grade: -0.05 }, { length: 2000, grade: 0 }], { smoothSigma: 20 });
    const r = run(profile, 'ride', { target: { kind: 'speed', mps: 22 / 3.6 } });
    const s = r.streams;
    expect(movingError(r, profile.totalDistance / (22 / 3.6))).toBeLessThan(0.005);
    const leadIn = indexAtDistance(s, 2000);
    expect(meanRange(s.speed, 5, leadIn) * 3.6).toBeGreaterThan(14);
    expect(meanRange(s.power, 5, leadIn)).toBeGreaterThan(25);
    expect(r.warnings.some((w) => w.includes('brakes'))).toBe(true);
    expect(r.warnings.some((w) => w.includes('crawls'))).toBe(false);

    const steep = segmentProfile([{ length: 200, grade: 0 }, { length: 10000, grade: -0.08 }, { length: 200, grade: 0 }]);
    const r2 = run(steep, 'ride', { target: { kind: 'speed', mps: 20 / 3.6 } });
    expect(movingError(r2, steep.totalDistance / (20 / 3.6))).toBeLessThan(0.005);
    expect(r2.warnings.some((w) => w.includes('crawls'))).toBe(false);
  });

  it('never pedals while stationary before a stop on a steep ramp, and stays calibrated', () => {
    const ramp = segmentProfile([{ length: 8000, grade: 0 }, { length: 200, grade: 0.16 }, { length: 2000, grade: 0 }], { smoothSigma: 5 });
    const r = simulate({ profile: ramp, athlete, session: session('ride', { target: { kind: 'speed', mps: 14 / 3.6 } }) }, { stops: [{ s: 8150, duration: 15 }] });
    const s = r.streams;
    for (let i = 1; i < s.t.length; i++) if (s.dist[i] === s.dist[i - 1]) expect(s.power[i], `t${i}`).toBe(0);
    expect(movingError(r, ramp.totalDistance / (14 / 3.6))).toBeLessThan(0.005);

    const segs = [];
    for (let k = 0; k < 12; k++) segs.push({ length: 1500, grade: 0 }, { length: 150, grade: 0.14 }, { length: 150, grade: -0.14 });
    const city = segmentProfile(segs, { smoothSigma: 10 });
    for (const seed of [1, 2, 3]) {
      const u = run(city, 'ride', { seed, stops: 'urban', target: { kind: 'speed', mps: 15 / 3.6 } });
      const us = u.streams;
      for (let i = 1; i < us.t.length; i++) if (us.dist[i] === us.dist[i - 1]) expect(us.power[i]).toBe(0);
      expect(movingError(u, city.totalDistance / (15 / 3.6))).toBeLessThan(0.005);
    }
  });

  it('standing starts on a flat urban ride do not count as crawling', () => {
    const r = run(flatProfile(10000), 'ride', { stops: 'urban', target: { kind: 'speed', mps: 25 / 3.6 } });
    expect(r.warnings.some((w) => w.includes('crawls'))).toBe(false);
  });

  it('absurd ride targets stay under a human power ceiling and name it', () => {
    const fast = run(flatProfile(20000), 'ride', { target: { kind: 'speed', mps: 70 / 3.6 } }, { ...athlete, fitness: 'elite' });
    expect(Math.max(...fast.streams.power)).toBeLessThanOrEqual(2000);
    expect(fast.summary.calories).toBeLessThan(3000);
    expect(fast.warnings.some((w) => w.includes('2000 W'))).toBe(true);
    const oneSecond = run(flatProfile(5000), 'ride', { target: { kind: 'duration', seconds: 1 } });
    expect(Math.max(...oneSecond.streams.power)).toBeLessThanOrEqual(2000);
  });

  it('coasting and braked descents are not a ruler-straight speed line', () => {
    const cases = [
      // Coasting at terminal speed on −6 %.
      [segmentProfile([{ length: 3000, grade: 0 }, { length: 4000, grade: 0.06 }, { length: 4000, grade: -0.06 }, { length: 2000, grade: 0 }]), 7, 7500, 10800],
      // Braking at the ≈65 km/h set point on −12 %.
      [segmentProfile([{ length: 1000, grade: 0 }, { length: 4500, grade: 0.08 }, { length: 3000, grade: -0.12 }, { length: 1000, grade: 0 }]), 8.3, 6000, 8400],
    ] as const;
    for (const [profile, mps, from, to] of cases) {
      const s = run(profile, 'ride', { target: { kind: 'speed', mps } }).streams;
      const a = indexAtDistance(s, from);
      const b = indexAtDistance(s, to);
      const mean = meanRange(s.speed, a, b);
      let sq = 0;
      let same = 0;
      let longest = 0;
      for (let i = a; i < b; i++) {
        sq += (s.speed[i] - mean) ** 2;
        same = Math.abs(s.speed[i] - s.speed[i - 1]) < 0.001 ? same + 1 : 0;
        longest = Math.max(longest, same);
      }
      expect(Math.sqrt(sq / (b - a)), `${mps}`).toBeGreaterThan(0.1);
      expect(longest, `${mps}`).toBeLessThan(8);
    }
  });

  it('pedalling cadence respects the lowest gear at crawling speed', () => {
    const ramp = segmentProfile([{ length: 1000, grade: 0 }, { length: 300, grade: 0.2 }, { length: 500, grade: 0 }], { smoothSigma: 5 });
    const r = run(ramp, 'ride', { target: { kind: 'speed', mps: 14 / 3.6 } });
    const s = r.streams;
    // Recorded speed is smoothed, so compare with the motion itself: the distance covered in the seconds either side
    // (10 % allows a one-second crawl surge that the per-second average hides).
    const moved = (i: number) => Math.max(s.dist[i] - s.dist[i - 1], s.dist[Math.min(s.t.length - 1, i + 1)] - s.dist[i]);
    for (let i = 1; i < s.t.length; i++) if (s.cadence[i] > 0) expect(s.cadence[i]).toBeLessThanOrEqual((1.1 * moved(i) * 60) / 1.4 + 1);
  });
});

describe('sustainability warnings come from the simulated effort, not only flat ground', () => {
  it('a recreational runner at 4:30/km for 40 min is flagged; 5:00/km for 10 km is not', () => {
    const hard = run(flatProfile((40 * 60 * 1000) / 270), 'run', { temperatureC: 10, target: { kind: 'pace', secPerKm: 270 } });
    expect(hard.warnings.some((w) => w.startsWith('Effort averages'))).toBe(true);
    const easy = run(flatProfile(10000), 'run', { target: { kind: 'pace', secPerKm: 300 } });
    expect(easy.warnings).toEqual([]);
  });

  it('a ride that holds a climb near VO2max for half an hour is flagged', () => {
    const profile = segmentProfile([{ length: 5000, grade: 0 }, { length: 8000, grade: 0.07 }, { length: 8000, grade: -0.07 }, { length: 5000, grade: 0 }], { smoothSigma: 20 });
    const r = run(profile, 'ride', { target: { kind: 'speed', mps: 25 / 3.6 } });
    expect(r.warnings.some((w) => w.startsWith('Effort averages') || w.includes('on flat road'))).toBe(true);
  });

  it('above threshold HR keeps rising after minute 5 (slow component not hidden by the soft cap)', () => {
    const r = run(flatProfile((40 * 60 * 1000) / 270), 'run', { variability: 0, temperatureC: 10, target: { kind: 'pace', secPerKm: 270 } });
    expect(meanRange(r.streams.hrDemand, 2040, 2100) - meanRange(r.streams.hrDemand, 270, 330)).toBeGreaterThan(4);
  });

  it('very short routes do not produce effort warnings from the standing start', () => {
    const texts = [
      run(twoPointProfile(20), 'run').warnings,
      run(twoPointProfile(49), 'ride').warnings,
      run(twoPointProfile(5), 'walk').warnings,
    ].flat();
    expect(texts.some((w) => /not sustainable|on flat road|running speed|Effort averages/.test(w))).toBe(false);
  });
});

describe('heat, drift and altitude', () => {
  it('a hotter long run never ends with a lower HR, and fades more', () => {
    const at = (temperatureC: number) => run(flatProfile(27273), 'run', { variability: 0, hrSensor: 'strap', temperatureC, target: { kind: 'pace', secPerKm: 330 } });
    const warm = at(25);
    const hot = at(35);
    const n = (r: SimulationResult) => r.streams.t.length;
    expect(meanRange(hot.streams.hr, n(hot) - 1200, n(hot))).toBeGreaterThanOrEqual(meanRange(warm.streams.hr, n(warm) - 1200, n(warm)) - 1);
    // The target time is still met, so the heat shows as a faster start and a slower finish.
    const fade = (r: SimulationResult) => meanRange(r.streams.speed, n(r) - 1200, n(r)) / meanRange(r.streams.speed, 900, 1500);
    expect(fade(hot)).toBeLessThan(fade(warm));
    expect(fade(hot)).toBeGreaterThan(0.5);
  });

  it('cardiac drift partly recovers during a 20-minute stop', () => {
    const r = simulate(
      { profile: flatProfile(70000), athlete, session: session('ride', { variability: 0.2, hrSensor: 'strap', temperatureC: 28, target: { kind: 'speed', mps: 7 } }) },
      { stops: [{ s: 35000, duration: 1200 }] },
    );
    const first = firstStopped(r);
    const before = meanRange(r.streams.hr, first - 600, first);
    const after = meanRange(r.streams.hr, first + 1800, first + 2400);
    expect(after).toBeLessThan(before);
  });

  it('the same pace at 3000 m costs more heart rate than at sea level', () => {
    const low = flatProfile(8000);
    const high: TerrainProfile = { ...low, points: low.points.map((p) => ({ ...p, ele: p.ele + 2900 })) };
    const over = { variability: 0, target: { kind: 'pace' as const, secPerKm: 360 } };
    const sea = run(low, 'run', over);
    const alt = run(high, 'run', over);
    expect(meanRange(alt.streams.hrDemand, 600, 1800)).toBeGreaterThan(meanRange(sea.streams.hrDemand, 600, 1800) + 5);
  });
});

describe('walking, hiking and power-hiking', () => {
  it('walk and hike follow plain Tobler; power-hiking is capped by sustainable VO2', () => {
    for (const g of [0.1, 0.2, 0.3, -0.2]) expect(walkGradeMultiplier(g)).toBeCloseTo(Math.min(1.2, toblerShape(g)), 12);
    expect(powerHikeSpeed(1.85, 0.18, 30)).toBeLessThan(powerHikeSpeed(1.85, 0.18));
  });

  it('run calibration is continuous across the power-hike threshold on long climbs', () => {
    const profile = segmentProfile([{ length: 300, grade: 0 }, { length: 6000, grade: 0.12 }, { length: 300, grade: 0 }], { smoothSigma: 20 });
    for (const secPerKm of [500, 510, 520, 530, 540]) {
      const r = run(profile, 'run', { target: { kind: 'pace', secPerKm } });
      expect(movingError(r, (profile.totalDistance * secPerKm) / 1000), `${secPerKm}`).toBeLessThan(0.005);
    }
  });

  it('downhill cap is applied before the noise, so walking speed does not plateau', () => {
    const r = run(descentProfile({ before: 500, descent: 3000, grade: -0.05, after: 500 }), 'walk', { seed: 2 });
    const s = r.streams;
    // Distance increments carry the exact motion (the recorded speed has 0.01 m/s resolution and may repeat).
    let same = 0;
    let longest = 0;
    for (let i = indexAtDistance(s, 700); i < indexAtDistance(s, 3300); i++) {
      same = Math.abs(s.dist[i] - s.dist[i - 1] - (s.dist[i - 1] - s.dist[i - 2])) < 0.001 ? same + 1 : 0;
      longest = Math.max(longest, same);
    }
    expect(longest).toBeLessThan(6);
  });

  it('running cadence on steep descents stays at or above the flat cadence', () => {
    const r = run(descentProfile({ before: 2000, descent: 1000, grade: -0.25, after: 2000 }, { smoothSigma: 20 }), 'run', { variability: 0, target: { kind: 'pace', secPerKm: 330 } }, runner);
    const s = r.streams;
    const flat = meanRange(s.cadence, indexAtDistance(s, 1200), indexAtDistance(s, 1850));
    expect(meanRange(s.cadence, indexAtDistance(s, 2150), indexAtDistance(s, 2850))).toBeGreaterThanOrEqual(flat);
  });
});

describe('stops: braking, arrival samples and restarts', () => {
  it('foot and bike brake over several seconds, and a sample never moves with zero speed', () => {
    for (const [type, decel, target] of [
      ['run', 1.25, { kind: 'pace', secPerKm: 300 }],
      ['ride', 2.2, { kind: 'speed', mps: 8 }],
    ] as const) {
      const r = simulate({ profile: flatProfile(3000), athlete, session: session(type, { variability: 0, target }) }, { stops: [{ s: 1500, duration: 20 }] });
      const s = r.streams;
      const first = firstStopped(r);
      for (let i = first - 8; i <= first; i++) expect(s.speed[i - 1] - s.speed[i], `${type} t${i}`).toBeLessThanOrEqual(decel);
    }
    for (const type of ['run', 'walk', 'ride'] as const) {
      const r = run(rollingProfile(10500, 30, 2000), type, { stops: 'urban' });
      const s = r.streams;
      for (let i = 1; i < s.t.length; i++) if (s.dist[i] > s.dist[i - 1]) expect(s.speed[i], `${type} t${i}`).toBeGreaterThan(0);
    }
  });

  it('restarts after stops do not all use the same acceleration', () => {
    const r = run(flatProfile(8000), 'run', { variability: 0, stops: 'urban' });
    const s = r.streams;
    const firstSteps = new Set<number>();
    for (let i = 2; i < s.t.length; i++) if (!s.moving[i - 1] && s.moving[i]) firstSteps.add(Math.round(s.speed[i] * 100));
    expect(firstSteps.size).toBeGreaterThan(3);
  });
});

describe('GPS and altitude realism', () => {
  const pathInflation = (r: SimulationResult) => {
    const j = positionJumps(r.streams);
    let path = 0;
    for (let i = 1; i < j.length; i++) path += j[i];
    return path / r.summary.distance - 1;
  };

  it('recorded track length stays within ~1 % for every sport at normal and high noise', () => {
    for (const type of ['run', 'walk', 'hike'] as const) {
      for (const gpsNoise of ['normal', 'high'] as const) {
        const r = run(flatProfile(type === 'run' ? 8000 : 4000), type, { gpsNoise });
        expect(Math.abs(pathInflation(r)), `${type} ${gpsNoise}`).toBeLessThan(0.012);
      }
    }
  });

  it('spike guard: a 1 s displacement exceeds the true step by at most 2.5·σ (never 1.5·step + 3 m); stopped positions drift slowly', () => {
    const r = run(flatProfile(4000), 'walk', { gpsNoise: 'high', stops: 'urban' });
    const s = r.streams;
    const j = positionJumps(s);
    const margin = 2.5 * 0.9 * 1.6;
    let stoppedSeconds = 0;
    let stoppedMoves = 0;
    for (let i = 31; i < j.length; i++) {
      const step = Math.max(0, s.dist[i] - s.dist[i - 1]);
      expect(j[i], `t${i}`).toBeLessThanOrEqual(Math.min(step + margin, 1.5 * step + 3) + 0.02);
      if (!s.moving[i] && !s.moving[i - 1]) {
        stoppedSeconds++;
        if (j[i] > 0) stoppedMoves++;
        expect(j[i], `stopped t${i}`).toBeLessThan(0.6);
      }
    }
    expect(stoppedSeconds).toBeGreaterThan(30);
    expect(stoppedMoves / stoppedSeconds).toBeGreaterThan(0.5);
  });

  it('positions do not trail the distance stream', () => {
    const on = run(flatProfile(20000), 'ride', { gpsNoise: 'normal', target: { kind: 'speed', mps: 11 } });
    const off = run(flatProfile(20000), 'ride', { gpsNoise: 'off', target: { kind: 'speed', mps: 11 } });
    let along = 0;
    const n = on.streams.t.length;
    for (let i = 0; i < n; i++) along += (on.streams.lon[i] - off.streams.lon[i]) * M_PER_DEG * Math.cos(on.streams.lat[i] * DEG);
    expect(Math.abs(along / n)).toBeLessThan(1.5);
  });

  it('altimeter starts on the terrain, drifts no faster than weather, and summary ascent counts its recorded climb', () => {
    const profile = rollingProfile(20000, 8, 1500, { smoothSigma: 10 });
    for (const seed of [1, 2, 3]) {
      const noisy = run(profile, 'run', { seed, gpsNoise: 'normal' });
      const exact = run(profile, 'run', { seed, gpsNoise: 'off' });
      // A watch totals its own barometric climb: close to the terrain, a little more rather than less.
      expect(noisy.summary.ascent / exact.summary.ascent).toBeGreaterThan(0.95);
      expect(noisy.summary.ascent / exact.summary.ascent).toBeLessThan(1.2);
      const n = noisy.streams.t.length;
      const offset = (from: number, to: number) => {
        let sum = 0;
        for (let i = from; i < to; i++) sum += noisy.streams.ele[i] - exact.streams.ele[i];
        return sum / (to - from);
      };
      expect(Math.abs(offset(0, 300))).toBeLessThan(1.5);
      // Weather drift stays in the "slowly" pressure-tendency band (≤ 4 m/h) on top of the ±0.8 m wander.
      expect(Math.abs(offset(0, n))).toBeLessThan(1.5 + (4 * n) / 3600);
    }
  });

  it('optical HR is not jumpier second to second than a chest strap', () => {
    const diffSd = (hrSensor: SessionSettings['hrSensor']) => {
      const h = run(flatProfile(10000), 'run', { seed: 1, hrSensor }).streams.hr;
      let sq = 0;
      for (let i = 2; i < h.length; i++) sq += (h[i] - h[i - 1]) ** 2;
      return Math.sqrt(sq / (h.length - 2));
    };
    expect(diffSd('optical')).toBeLessThan(diffSd('strap'));
  });
});

describe('fatigue follows effort-weighted load, descents and glycogen, not the clock', () => {
  const MARATHON = 42195;
  /** Moving speed between two distances. */
  const speedBetween = (r: SimulationResult, a: number, b: number) => {
    const s = r.streams;
    const i = indexAtDistance(s, a);
    const j = indexAtDistance(s, b);
    let moving = 0;
    for (let k = i + 1; k <= j; k++) moving += s.moving[k];
    return (s.dist[j] - s.dist[i]) / Math.max(1, moving);
  };
  const hrBetween = (r: SimulationResult, a: number, b: number) => meanRange(r.streams.hr, indexAtDistance(r.streams, a), indexAtDistance(r.streams, b) + 1);
  const secondHalfSlower = (r: SimulationResult, D: number) => speedBetween(r, 0, D / 2) / speedBetween(r, D / 2, D) - 1;

  it('a recreational flat marathon: second half 4–9 % slower, HR:pace ratio 1.12–1.18 at the finish', () => {
    // Three seeds: heart rate wanders by a bpm or two over the 2 km finish window.
    const ratios = [11, 12, 13].map((seed) => {
      const r = run(flatProfile(MARATHON), 'run', { seed, hrSensor: 'strap', target: { kind: 'pace', secPerKm: 341 } });
      const slower = secondHalfSlower(r, MARATHON);
      expect(slower).toBeGreaterThan(0.04);
      expect(slower).toBeLessThan(0.09);
      expect(movingError(r, (MARATHON * 341) / 1000)).toBeLessThan(0.005);
      // Smyth et al. 2022: %HRmax over speed at the finish, indexed to the 5–10 km segment.
      return (hrBetween(r, MARATHON - 2200, MARATHON) / speedBetween(r, MARATHON - 2200, MARATHON)) / (hrBetween(r, 5000, 10000) / speedBetween(r, 5000, 10000));
    });
    const ratio = ratios.reduce((a, b) => a + b, 0) / ratios.length;
    expect(ratio).toBeGreaterThan(1.12);
    expect(ratio).toBeLessThan(1.18);
  });

  it('an easy marathon fades less than a race-effort one', () => {
    const input = { profile: flatProfile(MARATHON), athlete, session: session('run') };
    const fade = (preset: 'easy' | 'race') => {
      const mps = solveEffortPreset(input, preset)!.mps;
      return secondHalfSlower(run(flatProfile(MARATHON), 'run', { target: { kind: 'speed', mps } }), MARATHON);
    };
    expect(fade('race')).toBeGreaterThan(fade('easy') + 0.015);
  });

  it('90 min steady: aerobic decoupling grows from elite (1–3 %) to beginner (≥ 5 %)', () => {
    // Variability 0 and three seeds: pace noise and the physiological HR wander would otherwise move a single run's
    // decoupling by a percentage point either way.
    const decoupling = (fitness: Athlete['fitness'], vo2max: number) => {
      const v = (0.7 * (vo2max - 3.5)) / vo2NetRun(1, 0);
      const values = [11, 12, 13].map((seed) => {
        const r = run(flatProfile(v * 5400), 'run', { seed, variability: 0, hrSensor: 'strap', target: { kind: 'duration', seconds: 5400 } }, { ...athlete, fitness });
        const s = r.streams;
        const mid = Math.floor((600 + s.t.length) / 2);
        // Mean speed from distance: the recorded speed carries a wandering sensor error that is not physiology.
        const ef = (a: number, b: number) => (s.dist[b - 1] - s.dist[a - 1]) / (b - a) / meanRange(s.hr, a, b);
        return 1 - ef(mid, s.t.length) / ef(600, mid);
      });
      return values.reduce((a, b) => a + b, 0) / values.length;
    };
    const elite = decoupling('elite', 66);
    const recreational = decoupling('recreational', 45);
    const beginner = decoupling('beginner', 35);
    expect(elite).toBeGreaterThan(0.01);
    expect(elite).toBeLessThan(0.03);
    expect(recreational).toBeGreaterThan(elite);
    expect(beginner).toBeGreaterThan(Math.max(0.05, recreational));
  });

  it('a hilly or descending first half leaves later flats slower than after a flat start', () => {
    const lateOverEarly = (profile: TerrainProfile) => {
      const r = run(profile, 'run', { variability: 0.1, target: { kind: 'pace', secPerKm: 345 } });
      return speedBetween(r, 15000, 26000) / speedBetween(r, 700, 2000);
    };
    const hills: Array<{ length: number; grade: number }> = [{ length: 2000, grade: 0 }];
    for (let k = 0; k < 12; k++) hills.push({ length: 500, grade: 0.08 }, { length: 500, grade: -0.08 });
    hills.push({ length: 12000, grade: 0 });
    const flat = lateOverEarly(flatProfile(26000));
    expect(lateOverEarly(segmentProfile(hills, { smoothSigma: 15 }))).toBeLessThan(flat - 0.015);
    const descent = segmentProfile([{ length: 2000, grade: 0 }, { length: 12000, grade: -0.06 }, { length: 12000, grade: 0 }], { smoothSigma: 15 });
    expect(lateOverEarly(descent)).toBeLessThan(flat - 0.007);
  });

  it('a marathon at 25 °C: heart rate does not trend down late on a flat, even effort', () => {
    const r = run(flatProfile(MARATHON), 'run', { hrSensor: 'strap', temperatureC: 25, target: { kind: 'pace', secPerKm: 341 } });
    expect(hrBetween(r, 37000, 42000)).toBeGreaterThanOrEqual(hrBetween(r, 30000, 35000) - 1);
  });

  it('a beginner 100 km keeps slowing without a plateau, and the first hour is not far ahead of the average', () => {
    const r = run(flatProfile(100000), 'run', { target: { kind: 'pace', secPerKm: 540 } }, { ...athlete, fitness: 'beginner' });
    const s = r.streams;
    const hourSpeed = (h: number) => (s.dist[(h + 1) * 3600] - s.dist[h * 3600]) / 3600;
    expect(hourSpeed(0) / r.summary.avgSpeed).toBeLessThan(1.08);
    // Hour-to-hour pace wanders by a few seconds, so compare four-hour blocks: the fade keeps going to the end.
    const block = (from: number) => (hourSpeed(from) + hourSpeed(from + 1) + hourSpeed(from + 2) + hourSpeed(from + 3)) / 4;
    expect(block(10)).toBeLessThan(block(5) * 0.985);
    expect(block(10)).toBeLessThan(block(0) * 0.92);
    expect(movingError(r, 54000)).toBeLessThan(0.005);
  });

  it('a hard marathon can hit the wall: a warning, a sharp late slowdown and calibration still holds', () => {
    const r = run(flatProfile(MARATHON), 'run', { seed: 2, target: { kind: 'pace', secPerKm: 300 } });
    const wall = r.warnings.find((w) => w.startsWith('Glycogen ran low'));
    expect(wall).toBeDefined();
    const km = Number(/around (\d+) km/.exec(wall!)![1]);
    expect(km).toBeGreaterThanOrEqual(25);
    expect(km).toBeLessThanOrEqual(40);
    const base = speedBetween(r, 5000, 20000);
    let worst = 1;
    for (let d = 25000; d + 5000 <= MARATHON; d += 1000) worst = Math.min(worst, speedBetween(r, d, d + 5000) / base);
    expect(worst).toBeLessThan(0.75);
    expect(worst).toBeGreaterThan(0.5);
    expect(movingError(r, (MARATHON * 300) / 1000)).toBeLessThan(0.005);
    const easy = run(flatProfile(MARATHON), 'run', { seed: 2, target: { kind: 'pace', secPerKm: 400 } });
    expect(easy.warnings.some((w) => w.startsWith('Glycogen'))).toBe(false);
  });

  it('a long ride fades with load too, gently', () => {
    const r = run(flatProfile(180000), 'ride', { target: { kind: 'duration', seconds: 6 * 3600 } });
    const hour = (h: number) => meanRange(r.streams.power, h * 3600 + 300, (h + 1) * 3600);
    expect(hour(5) / hour(0)).toBeLessThan(0.98);
    expect(hour(5) / hour(0)).toBeGreaterThan(0.85);
  });
});

describe('gait: walk/run from the planned speed on a long grade, alternation, descents and vertical speed', () => {
  /** Seconds in a walking gait (walking cadence) and switches between gaits over [a, b) metres. */
  const gaitStats = (r: SimulationResult, a: number, b: number) => {
    const s = r.streams;
    const i = indexAtDistance(s, a);
    const j = indexAtDistance(s, b);
    const isWalk = (k: number) => s.cadence[k] > 0 && s.cadence[k] < 140;
    let walk = 0;
    let switches = 0;
    let walkSpeed = 0;
    let runSpeed = 0;
    for (let k = i + 1; k < j; k++) {
      const step = s.dist[k] - s.dist[k - 1];
      if (isWalk(k)) {
        walk++;
        walkSpeed += step;
      } else runSpeed += step;
      if (s.cadence[k] > 0 && s.cadence[k - 1] > 0 && isWalk(k) !== isWalk(k - 1)) switches++;
    }
    const n = Math.max(1, j - i - 1);
    return { share: walk / n, switches, walkSpeed: walkSpeed / Math.max(1, walk), runSpeed: runSpeed / Math.max(1, n - walk) };
  };

  it('alternating 100 m at 3 % and 9 % gives at most 2 walk/run switches per km', () => {
    const segs: Array<{ length: number; grade: number }> = [{ length: 1000, grade: 0 }];
    for (let k = 0; k < 10; k++) segs.push({ length: 100, grade: 0.03 }, { length: 100, grade: 0.09 });
    segs.push({ length: 1000, grade: 0 });
    for (const secPerKm of [420, 480, 540, 600]) {
      const r = run(segmentProfile(segs), 'run', { target: { kind: 'pace', secPerKm } });
      expect(gaitStats(r, 1000, 3000).switches, `${secPerKm}`).toBeLessThanOrEqual(4);
    }
  });

  it('a steep climb alternates run and walk bouts, walking visibly slower than running', () => {
    const r = run(climbProfile({ before: 1000, climb: 1000, grade: 0.25, after: 1000 }, { smoothSigma: 20 }), 'run', { target: { kind: 'pace', secPerKm: 540 } }, runner);
    const g = gaitStats(r, 1100, 1950);
    expect(g.share).toBeGreaterThan(0.3);
    expect(g.share).toBeLessThan(0.7);
    expect(g.switches).toBeGreaterThanOrEqual(6);
    expect(g.walkSpeed).toBeLessThan(0.92 * g.runSpeed);
    expect(r.warnings.some((w) => w.includes('power-hiked'))).toBe(true);
  });

  it('a 30 m ramp on a flat road never makes a runner walk', () => {
    const r = run(segmentProfile([{ length: 2500, grade: 0 }, { length: 30, grade: 0.2 }, { length: 2500, grade: 0 }]), 'run', { target: { kind: 'pace', secPerKm: 480 } });
    expect(gaitStats(r, 100, 5000).share).toBe(0);
  });

  it('descents steeper than about 30 % are walked; −20 % is still run', () => {
    const descent = (grade: number) => run(descentProfile({ before: 1500, descent: 1200, grade, after: 1500 }, { smoothSigma: 20 }), 'run', { target: { kind: 'pace', secPerKm: 360 } });
    const steep = descent(-0.35);
    const g = gaitStats(steep, 1700, 2600);
    expect(g.share).toBeGreaterThan(0.9);
    expect(g.walkSpeed).toBeLessThan(1.5);
    expect(steep.warnings.some((w) => w.includes('walked down'))).toBe(true);
    expect(gaitStats(descent(-0.2), 1700, 2600).share).toBe(0);
  });

  it('vertical speed stays under the ceiling by fitness, and an unreachable VK target is reported, not drawn', () => {
    const vk = (fitness: Athlete['fitness'], secPerKm: number) => {
      const r = run(climbProfile({ before: 800, climb: 2857, grade: 0.35, after: 300 }, { smoothSigma: 10 }), 'run', { target: { kind: 'pace', secPerKm } }, { ...athlete, fitness });
      const s = r.streams;
      const i = indexAtDistance(s, 900);
      const j = indexAtDistance(s, 3600);
      return { r, vam: (((s.dist[j] - s.dist[i]) * 0.35) / Math.sqrt(1 + 0.35 * 0.35) / (j - i)) * 3600 };
    };
    // Pace texture never carries the average past the ceiling (it used to run about 6 % over it).
    const rec = vk('recreational', 330);
    expect(rec.vam).toBeLessThanOrEqual(1100);
    expect(rec.vam).toBeGreaterThan(900);
    expect(rec.r.warnings.some((w) => w.includes('could not be matched'))).toBe(true);
    // The flats do not absorb the missing time at an absurd speed.
    const flat = indexAtDistance(rec.r.streams, 700);
    expect(rec.r.streams.dist[flat] / flat).toBeLessThan(5.5);
    const elite = vk('elite', 420);
    expect(elite.vam).toBeLessThanOrEqual(1950);
    expect(elite.vam).toBeGreaterThan(1500);
  });

  it('the grade limit comes from the terrain step and the warning names the limited distance', () => {
    const limited = /^The elevation data was steeper than this route plausibly is, so grades were limited on about \d+ m\.$/;
    const profile = segmentProfile([{ length: 500, grade: 0 }, { length: 200, grade: 0.4 }, { length: 500, grade: 0 }]);
    expect(run(profile, 'ride', { target: { kind: 'speed', mps: 5 } }).warnings.some((w) => limited.test(w))).toBe(true);
    expect(run(profile, 'run').warnings.some((w) => limited.test(w))).toBe(false);
    const counted = run({ ...flatProfile(3000), gradeClampedM: 120 }, 'run');
    expect(counted.warnings).toContain('The elevation data was steeper than this route plausibly is, so grades were limited on about 120 m.');
  });
});

describe('grade response: skill-blended descents, crest carry-over and uphill demand', () => {
  it('skilled runners descend fastest near −10 % and hold speed deeper; beginners hold back; technical ground caps it', () => {
    const grades = [-0.15, -0.14, -0.13, -0.12, -0.11, -0.1, -0.09, -0.08, -0.07, -0.06, -0.05];
    const elite = grades.map((g) => runGradeMultiplier(g, DESCENT_SKILL.elite));
    const fastest = grades[elite.indexOf(Math.max(...elite))];
    expect(fastest).toBeGreaterThanOrEqual(-0.12);
    expect(fastest).toBeLessThanOrEqual(-0.08);
    expect(Math.max(...elite)).toBeGreaterThan(1.18);
    expect(Math.max(...elite)).toBeLessThanOrEqual(1.25);
    expect(runGradeMultiplier(-0.2, DESCENT_SKILL.elite)).toBeGreaterThan(1.2 * runGradeMultiplier(-0.2, DESCENT_SKILL.beginner));
    expect(runGradeMultiplier(-0.1, DESCENT_SKILL.elite, 0.8)).toBeLessThan(runGradeMultiplier(-0.1, DESCENT_SKILL.elite) - 0.08);
    for (const g of [0.05, 0.1]) expect(runGradeMultiplier(g, DESCENT_SKILL.elite)).toBe(runGradeMultiplier(g, 0));
  });

  it('level speed after a crest comes back over about a minute, not at once', () => {
    const segs: Array<{ length: number; grade: number }> = [{ length: 1500, grade: 0 }];
    for (let k = 0; k < 6; k++) segs.push({ length: 400, grade: 0.06 }, { length: 800, grade: 0 });
    const runs = [1, 2, 3].map((seed) => run(segmentProfile(segs, { smoothSigma: 10 }), 'run', { seed, variability: 0, target: { kind: 'pace', secPerKm: 330 } }));
    const after = new Float64Array(150);
    let settled = 0;
    for (const r of runs) {
      const s = r.streams;
      for (let k = 0; k < 6; k++) {
        const crest = indexAtDistance(s, 1500 + k * 1200 + 400);
        for (let t = 0; t < 150; t++) after[t] += (s.dist[crest + t + 1] - s.dist[crest + t]) / 18;
        const a = indexAtDistance(s, 1500 + k * 1200 + 1000);
        const b = indexAtDistance(s, 1500 + k * 1200 + 1180);
        settled += (s.dist[b] - s.dist[a]) / (b - a) / 18;
      }
    }
    expect(meanRange(after, 8, 13) / settled).toBeLessThan(0.93);
    expect(meanRange(after, 85, 95) / settled).toBeGreaterThan(0.97);
  });

  it('self-paced climbs raise HR demand clearly above the level (β 0.7)', () => {
    const segs: Array<{ length: number; grade: number }> = [{ length: 1500, grade: 0 }];
    for (let k = 0; k < 6; k++) segs.push({ length: 600, grade: 0.06 }, { length: 600, grade: 0 }, { length: 600, grade: -0.06 }, { length: 600, grade: 0 });
    const r = run(segmentProfile(segs, { smoothSigma: 10 }), 'run', { variability: 0, target: { kind: 'pace', secPerKm: 360 } });
    const s = r.streams;
    let up = 0;
    let level = 0;
    for (let k = 1; k < 6; k++) {
      const base = 1500 + k * 2400;
      up += meanRange(s.hrDemand, indexAtDistance(s, base + 300), indexAtDistance(s, base + 580)) / 5;
      level += meanRange(s.hrDemand, indexAtDistance(s, base + 2100), indexAtDistance(s, base + 2380)) / 5;
    }
    expect(up - level).toBeGreaterThan(4);
    expect(up - level).toBeLessThan(15);
  });
});

describe('ground, altitude, heat and age', () => {
  const tagged = (profile: TerrainProfile, from: number, to: number, surface: ProfilePoint['surface'], technicality?: number): TerrainProfile => ({
    ...profile,
    points: profile.points.map((p) => (p.d > from && p.d <= to ? { ...p, surface, ...(technicality === undefined ? {} : { technicality }) } : p)),
  });
  const motionSpeed = (r: SimulationResult, a: number, b: number) => {
    const s = r.streams;
    const i = indexAtDistance(s, a);
    const j = indexAtDistance(s, b);
    return (s.dist[j] - s.dist[i]) / (j - i);
  };
  const demand = (r: SimulationResult, a: number, b: number) => meanRange(r.streams.hrDemand, indexAtDistance(r.streams, a), indexAtDistance(r.streams, b));

  it('pavement tags change nothing; untagged points stay neutral', () => {
    const base = flatProfile(4000);
    const plain = run(base, 'run');
    const paved = run(tagged(base, -1, 5000, 'paved', 0), 'run');
    expect(Array.from(paved.streams.dist)).toEqual(Array.from(plain.streams.dist));
    expect(Array.from(paved.streams.hr)).toEqual(Array.from(plain.streams.hr));
  });

  it('sand is slower and harder, technical ground slower with HR held up, alpine ground and steps are walked', () => {
    const base = flatProfile(8000);
    const over = { variability: 0, target: { kind: 'pace' as const, secPerKm: 330 } };
    const plain = run(base, 'run', over);
    const flatV = motionSpeed(plain, 1000, 2700);
    const sand = run(tagged(base, 3000, 5000, 'sand'), 'run', over);
    expect(motionSpeed(sand, 3300, 4700) / motionSpeed(sand, 1000, 2700)).toBeLessThan(0.8);
    expect(demand(sand, 3400, 4700)).toBeGreaterThan(demand(sand, 1000, 2700) + 3);
    const technical = run(tagged(base, 3000, 5000, 'rough', 0.4), 'run', over);
    expect(motionSpeed(technical, 3300, 4700) / motionSpeed(technical, 1000, 2700)).toBeLessThan(0.75);
    expect(demand(technical, 3400, 4700)).toBeGreaterThan(demand(technical, 1000, 2700) - 15);
    const alpine = run(tagged(base, 3000, 5000, undefined, 0.8), 'run', over);
    const i = indexAtDistance(alpine.streams, 3400);
    const j = indexAtDistance(alpine.streams, 4700);
    let walking = 0;
    for (let k = i; k < j; k++) if (alpine.streams.cadence[k] > 0 && alpine.streams.cadence[k] < 140) walking++;
    expect(walking / (j - i)).toBeGreaterThan(0.9);
    expect(flatV).toBeGreaterThan(2.5);
    const stairs = tagged(segmentProfile([{ length: 1500, grade: 0 }, { length: 200, grade: 0.2 }, { length: 1500, grade: 0 }]), 1500, 1700, 'steps');
    expect(motionSpeed(run(stairs, 'run', over), 1530, 1680)).toBeLessThanOrEqual(1.0 * 1.06);
  });

  it('a ride on sand or rough ground needs more power for the same speed', () => {
    const base = flatProfile(12000);
    const over = { variability: 0.1, target: { kind: 'speed' as const, mps: 7 } };
    const road = run(base, 'ride', over);
    const gravel = run(tagged(base, -1, 13000, 'gravel'), 'ride', over);
    expect(gravel.summary.avgPower).toBeGreaterThan(road.summary.avgPower + 15);
    expect(movingError(gravel, 12000 / 7)).toBeLessThan(0.005);
  });

  it('altitude: −6.3 % per 1000 m from 300 m to 2800 m, then the hypoxia curve, continuous and monotone to 8849 m', () => {
    expect(altitudeFactor(0)).toBeCloseTo(1, 3);
    expect(altitudeFactor(1300)).toBeCloseTo(0.937, 3);
    expect(altitudeFactor(2800)).toBeCloseTo(1 - 0.063 * 2.5, 3);
    for (const a of [0, 0.5, 1]) {
      let previous = altitudeFactor(-100, a);
      for (let h = 0; h <= 8849; h += 50) {
        const f = altitudeFactor(h, a);
        expect(f).toBeLessThanOrEqual(previous + 1e-12);
        expect(f).toBeGreaterThanOrEqual(0.15);
        // Above 2800 m the loss steepens to about 1 % per 100 m near the Everest summit, never a jump.
        expect(previous - f).toBeLessThan(0.007);
        previous = f;
      }
    }
    // Operation Everest II after 40 days: 0.283 of sea-level VO2max at the summit's inspired O2.
    expect(altitudeFactor(8848, 1)).toBeGreaterThan(0.25);
    expect(altitudeFactor(8848, 1)).toBeLessThan(0.31);
    // Calbet 2003 at 5260 m: 0.54 acute, 0.585 after 9–10 weeks.
    expect(altitudeFactor(5260, 0)).toBeCloseTo(0.567, 1);
    expect(altitudeFactor(5260, 1) - altitudeFactor(5260, 0)).toBeGreaterThan(0.03);
    // Below 2800 m acclimatisation changes nothing: Wehrlin's acute data already describe it.
    for (const h of [500, 1500, 2500, 2800]) expect(altitudeFactor(h, 1)).toBe(altitudeFactor(h, 0));
  });

  it('heat slows the Race preset but never a pace the user set; so does age', () => {
    const profile = flatProfile(10000);
    const race = (over: Partial<SessionSettings>, who: Athlete = athlete) => solveEffortPreset({ profile, athlete: who, session: session('run', over) }, 'race')!.mps;
    // A short race in warm air loses little: over 29 minutes the fluid deficit and the heat store barely differ.
    expect(race({ temperatureC: 25 })).toBeLessThan(0.998 * race({ temperatureC: 10 }));
    const older = { ...athlete, age: 65, maxHr: 162 };
    expect(race({}, older)).toBeLessThan(0.85 * race({}));
    const cool = run(profile, 'run', { temperatureC: 5, target: { kind: 'pace', secPerKm: 330 } });
    const hot = run(profile, 'run', { temperatureC: 32, target: { kind: 'pace', secPerKm: 330 } });
    // The target time is still met; the heat redistributes the pace inside it rather than making the run longer.
    expect(Math.abs(hot.summary.moving / cool.summary.moving - 1)).toBeLessThan(0.005);
    expect(Math.abs(hot.summary.distance / cool.summary.distance - 1)).toBeLessThan(0.001);
    expect(hot.summary.avgHr).toBeGreaterThan(cool.summary.avgHr);
  });

  it('the Race preset slows more with distance for beginners than for elites (Riegel exponent by level)', () => {
    const ratio = (fitness: Athlete['fitness']) => {
      const who = { ...athlete, fitness };
      const time = (distance: number) => solveEffortPreset({ profile: flatProfile(distance), athlete: who, session: session('run') }, 'race')!.movingTime;
      return time(21097) / time(5000);
    };
    expect(ratio('beginner')).toBeGreaterThan(ratio('elite') + 0.1);
  });
});

describe('cadence on grades, pace texture and the standing start', () => {
  it('cadence at a fixed speed rises a little uphill and dips slightly downhill; self-paced climbs lower it', () => {
    const flat = runCadence(3, 0, 1.75);
    expect(runCadence(3, 8, 1.75) / flat).toBeGreaterThan(1.015);
    expect(runCadence(3, 8, 1.75) / flat).toBeLessThan(1.03);
    expect(runCadence(3, -8, 1.75) / flat).toBeGreaterThan(0.985);
    expect(runCadence(3, -8, 1.75) / flat).toBeLessThan(1);
    const r = run(climbProfile({ before: 2000, climb: 1000, grade: 0.08, after: 2000 }, { smoothSigma: 20 }), 'run', { target: { kind: 'pace', secPerKm: 330 } });
    const s = r.streams;
    const cadence = (a: number, b: number) => meanRange(s.cadence, indexAtDistance(s, a), indexAtDistance(s, b));
    expect(cadence(2200, 2950)).toBeLessThan(cadence(1000, 1900));
  });

  it('speed is smooth second to second yet wanders a few per cent around its 1-minute mean', () => {
    const r = run(flatProfile(10000), 'run', { target: { kind: 'pace', secPerKm: 300 } });
    const s = r.streams;
    const n = s.t.length;
    // Motion speed from the trapezoidal 1 s distances (the recorded speed is additionally smoothed by the sensor).
    const motion = new Float64Array(n);
    for (let i = 1; i < n; i++) motion[i] = 2 * (s.dist[i] - s.dist[i - 1]) - motion[i - 1];
    let lag0 = 0;
    let lag1 = 0;
    let mean = 0;
    let count = 0;
    for (let i = 400; i < n - 400; i++) {
      const x = motion[i] - meanRange(motion, i - 30, i + 31);
      const y = motion[i - 1] - meanRange(motion, i - 31, i + 30);
      lag0 += x * x;
      lag1 += x * y;
      mean += motion[i];
      count++;
    }
    expect(lag1 / lag0).toBeGreaterThan(0.85);
    const detrended = Math.sqrt(lag0 / count) / (mean / count);
    expect(detrended).toBeGreaterThan(0.02);
    expect(detrended).toBeLessThan(0.05);
  });

  it('the activity starts with 2–5 s standing still, outside moving time, fixed by the seed', () => {
    for (const type of ['run', 'walk', 'ride'] as const) {
      const r = run(flatProfile(3000), type);
      const s = r.streams;
      const start = firstMovingIndex(s);
      expect(start - 1, type).toBeGreaterThanOrEqual(2);
      expect(start - 1, type).toBeLessThanOrEqual(5);
      for (let i = 0; i < start; i++) {
        expect(s.speed[i]).toBe(0);
        expect(s.moving[i]).toBe(0);
        expect(s.cadence[i]).toBe(0);
        expect(s.dist[i]).toBe(0);
      }
      expect(r.summary.elapsed - r.summary.moving, type).toBe(start - 1);
    }
    expect(firstMovingIndex(run(flatProfile(3000), 'run').streams)).toBe(firstMovingIndex(run(flatProfile(3000), 'run').streams));
  });
});

describe('input robustness', () => {
  it('absurd duration targets are clamped before any buffer is sized', () => {
    const r = run(flatProfile(10000), 'run', { target: { kind: 'duration', seconds: 1e9 } });
    expect(r.streams.t.length).toBeLessThan(100000);
    expect(r.warnings.some((w) => w.includes('longer than'))).toBe(true);
    expect(nonFiniteStreams(r)).toEqual([]);
  });

  it('prototype keys in enum fields fall back to defaults instead of NaN', () => {
    const bogus = { pacing: 'constructor', gpsNoise: 'constructor', stops: '__proto__', hrSensor: 'toString' } as unknown as Partial<SessionSettings>;
    for (const type of ['run', 'ride'] as const) {
      const r = run(flatProfile(3000), type, bogus);
      expect(nonFiniteStreams(r)).toEqual([]);
      expect(r.summary.distance).toBeCloseTo(3000, 6);
      expect(Number.isFinite(r.summary.calories)).toBe(true);
    }
  });

  it('hrZones sanitises resting HR at or above max HR', () => {
    const zones = hrZones({ ...athlete, restHr: 190, maxHr: 150 });
    expect(zones[4].max).toBe(150);
    expect(zones[0].min).toBeLessThan(zones[4].max);
    for (const z of zones) expect(z.max).toBeLessThanOrEqual(150);
  });

  it('a steep power-hike climb still shows walking cadence and higher demand than the flats', () => {
    const r = run(climbProfile({ before: 1000, climb: 1200, grade: 0.18, after: 1000 }, { smoothSigma: 20 }), 'run', { target: { kind: 'pace', secPerKm: 540 } }, runner);
    const s = r.streams;
    expect(meanRange(s.cadence, indexAtDistance(s, 1300), indexAtDistance(s, 2000))).toBeLessThan(135);
    // Power-hiking is deliberately slower than running the climb, so demand stays near the flats.
    expect(meanRange(s.hrDemand, indexAtDistance(s, 1500), indexAtDistance(s, 2100))).toBeGreaterThan(meanRange(s.hrDemand, indexAtDistance(s, 300), indexAtDistance(s, 900)) - 5);
  });
});
