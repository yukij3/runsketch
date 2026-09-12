// Regression tests for the physiology, signal and numerics review findings (one describe per finding group).
import { describe, expect, it } from 'vitest';
import type { ActivityType, Athlete, SessionSettings, SimulationResult, TerrainProfile } from '../types';
import { defaultAthlete, defaultSession, hrZones } from './athlete';
import { hrKinetics } from './hr';
import { powerHikeSpeed, runGradeMultiplier, toblerShape, vo2NetRide, vo2NetRun, walkGradeMultiplier } from './models';
import { climbProfile, descentProfile, flatProfile, rollingProfile, segmentProfile, twoPointProfile } from './scenarios';
import { simulate } from './simulate';
import { ensembleAround, indexAtDistance, meanRange, nonFiniteStreams, positionJumps } from './testing';
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
const firstStopped = (r: SimulationResult) => {
  for (let i = 1; i < r.streams.t.length; i++) if (!r.streams.moving[i]) return i;
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

  it('net VO2 at the planned downhill speed never exceeds flat VO2 and keeps a floor', () => {
    for (let g = -0.45; g <= -0.1; g += 0.05) {
      const v = 3 * runGradeMultiplier(g);
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
    for (let i = 1; i < s.t.length; i++) if (s.cadence[i] > 0) expect(s.cadence[i]).toBeLessThanOrEqual((s.speed[i] * 60) / 1.4 + 1);
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
  it('a hotter long run never ends with a lower HR, and heat does not add speed fade', () => {
    const at = (temperatureC: number) => run(flatProfile(27273), 'run', { variability: 0, hrSensor: 'strap', temperatureC, target: { kind: 'pace', secPerKm: 330 } });
    const warm = at(25);
    const hot = at(35);
    const n = (r: SimulationResult) => r.streams.t.length;
    expect(meanRange(hot.streams.hr, n(hot) - 1200, n(hot))).toBeGreaterThanOrEqual(meanRange(warm.streams.hr, n(warm) - 1200, n(warm)) - 1);
    const fade = (r: SimulationResult) => meanRange(r.streams.speed, n(r) - 1200, n(r)) / meanRange(r.streams.speed, 900, 1500);
    expect(Math.abs(fade(hot) - fade(warm))).toBeLessThan(0.005);
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
    let same = 0;
    let longest = 0;
    for (let i = indexAtDistance(s, 700); i < indexAtDistance(s, 3300); i++) {
      same = Math.abs(s.speed[i] - s.speed[i - 1]) < 0.001 ? same + 1 : 0;
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

  it('spike guard: each 1 s displacement is within max(1.25·step, step + 0.5 m); position holds while stopped', () => {
    const r = run(flatProfile(4000), 'walk', { gpsNoise: 'high', stops: 'urban' });
    const s = r.streams;
    const j = positionJumps(s);
    for (let i = 1; i < j.length; i++) {
      const step = s.dist[i] - s.dist[i - 1];
      if (step <= 0) expect(j[i]).toBe(0);
      else expect(j[i], `t${i}`).toBeLessThanOrEqual(Math.max(1.25 * step, step + 0.5) + 0.02);
    }
  });

  it('positions do not trail the distance stream', () => {
    const on = run(flatProfile(20000), 'ride', { gpsNoise: 'normal', target: { kind: 'speed', mps: 11 } });
    const off = run(flatProfile(20000), 'ride', { gpsNoise: 'off', target: { kind: 'speed', mps: 11 } });
    let along = 0;
    const n = on.streams.t.length;
    for (let i = 0; i < n; i++) along += (on.streams.lon[i] - off.streams.lon[i]) * M_PER_DEG * Math.cos(on.streams.lat[i] * DEG);
    expect(Math.abs(along / n)).toBeLessThan(1.5);
  });

  it('altimeter has no constant offset and ascent does not grow with its wander', () => {
    const profile = rollingProfile(20000, 8, 1500, { smoothSigma: 10 });
    for (const seed of [1, 2, 3]) {
      const noisy = run(profile, 'run', { seed, gpsNoise: 'normal' });
      const exact = run(profile, 'run', { seed, gpsNoise: 'off' });
      expect(noisy.summary.ascent).toBeCloseTo(exact.summary.ascent, 6);
      let offset = 0;
      for (let i = 0; i < noisy.streams.t.length; i++) offset += noisy.streams.ele[i] - exact.streams.ele[i];
      expect(Math.abs(offset / noisy.streams.t.length)).toBeLessThan(1.5);
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
    const r = run(climbProfile({ before: 1000, climb: 1200, grade: 0.18, after: 1000 }, { smoothSigma: 20 }), 'run', { target: { kind: 'pace', secPerKm: 420 } }, runner);
    const s = r.streams;
    expect(meanRange(s.cadence, indexAtDistance(s, 1300), indexAtDistance(s, 2000))).toBeLessThan(135);
    expect(meanRange(s.hrDemand, indexAtDistance(s, 1500), indexAtDistance(s, 2100))).toBeGreaterThan(meanRange(s.hrDemand, indexAtDistance(s, 300), indexAtDistance(s, 900)));
  });
});
