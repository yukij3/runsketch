import { describe, expect, it } from 'vitest';
import type { ActivityType, Athlete, SessionSettings, SimulationResult } from '../types';
import { defaultAthlete, defaultSession, estimateMaxHr, hrZones, resolveVo2max } from './athlete';
import { hrKinetics } from './hr';
import { paceFactor, runGradeMultiplier } from './models';
import { climbProfile, descentProfile, flatProfile, rollingProfile, segmentProfile } from './scenarios';
import { simulate } from './simulate';
import { ensembleAround, firstIndex, indexAtDistance, meanRange, movingAverage } from './testing';

const START = Date.UTC(2026, 5, 1, 6, 30);
const session = (type: ActivityType, over: Partial<SessionSettings> = {}): SessionSettings => ({
  ...defaultSession(type, START),
  seed: 7,
  ...over,
});
/** Young recreational runner with HR headroom, so a climb is not squashed by the HRmax soft cap. */
const runner: Athlete = { ...defaultAthlete(), age: 25, restHr: 50, maxHr: 191 };

describe('heart rate lags a climb (c)', () => {
  // 2 km flat, 1 km at +8 %, 2 km flat, one target pace. Eight seeds are event-averaged (start- and
  // crest-aligned) so the strap's ±1–2 bpm sensor wander does not decide the timing measurements.
  const runs = [1, 2, 3, 4, 5, 6, 7, 8].map((seed) =>
    simulate({
      profile: climbProfile({ before: 2000, climb: 1000, grade: 0.08, after: 2000 }, { smoothSigma: 20 }),
      athlete: runner,
      session: session('run', { seed, variability: 0, hrSensor: 'strap', target: { kind: 'pace', secPerKm: 330 } }),
    }),
  );
  const B = 240;
  const atStart = (r: SimulationResult) => indexAtDistance(r.streams, 2000);
  const atCrest = (r: SimulationResult) => indexAtDistance(r.streams, 3000);
  const hrFromStart = ensembleAround(runs, 'hr', atStart, B, 360);
  const hrFromCrest = ensembleAround(runs, 'hr', atCrest, B, 480);
  const demandFromCrest = ensembleAround(runs, 'hrDemand', atCrest, B, 480);
  const pre = meanRange(hrFromStart, B - 60, B);
  const plateau = meanRange(hrFromCrest, B - 60, B);
  const post = meanRange(hrFromCrest, B + 360, B + 480);
  const rise = plateau - pre;

  it('rises 6–25 bpm above the pre-climb plateau', () => {
    expect(rise).toBeGreaterThanOrEqual(6);
    expect(rise).toBeLessThanOrEqual(25);
  });

  it('has closed less than 60 % of the gap 30 s into the climb, and 63 % only after 30–150 s', () => {
    const closed30 = (meanRange(hrFromStart, B + 28, B + 33) - pre) / rise;
    expect(closed30).toBeLessThan(0.6);
    const t63 = firstIndex(hrFromStart, B, (x) => x >= pre + 0.63 * rise) - B;
    expect(t63).toBeGreaterThanOrEqual(30);
    expect(t63).toBeLessThanOrEqual(150);
  });

  it('is still rising at the top, peaks around the crest and holds there while demand already fell', () => {
    // With τ_up 18 + 38 s a 6-minute climb is ~99 % converged at the top, so the climb maximum is a
    // plateau that keeps creeping up (slow component + drift) until the crest rather than a peak minutes
    // later. The inertia shows as a shoulder: demand drops at the crest, HR does not for ~20 s.
    const smooth = movingAverage(hrFromCrest, 31);
    let peak = 16;
    for (let k = 16; k < B + 300; k++) if (smooth[k] > smooth[peak]) peak = k;
    const atCrest = meanRange(hrFromCrest, B - 15, B + 15);
    const midClimb = meanRange(hrFromStart, B + 170, B + 190);
    // Creep over the last three minutes is small (≈1 bpm) but always positive across seeds.
    expect(atCrest).toBeGreaterThan(midClimb + 0.5);
    expect(atCrest).toBeGreaterThan(smooth[peak] - 1);
    expect(peak - B).toBeGreaterThanOrEqual(-120);
    expect(peak - B).toBeLessThanOrEqual(150);
    expect(demandFromCrest[B + 20]).toBeLessThan(meanRange(demandFromCrest, B - 30, B - 5) - 3);
    expect(meanRange(hrFromCrest, B + 15, B + 25)).toBeGreaterThan(meanRange(hrFromCrest, B - 5, B + 5) - 1.5);
  });

  it('recovers after the crest more slowly than it rose (d, route level)', () => {
    const drop = plateau - post;
    expect(drop).toBeGreaterThan(3);
    const t63Up = firstIndex(hrFromStart, B, (x) => x >= pre + 0.63 * rise) - B;
    const t63Down = firstIndex(hrFromCrest, B, (x) => x <= plateau - 0.63 * drop) - B;
    expect(t63Down).toBeGreaterThan(t63Up);
  });
});

describe('asymmetric kinetics (d)', () => {
  const t63 = (series: Float64Array, from: number, to: number) =>
    firstIndex(series, 0, (x) => (to > from ? x >= from + 0.63 * (to - from) : x <= from - 0.63 * (from - to)));

  it('a 30 bpm step down takes longer to close 63 % than the same step up', () => {
    const n = 1200;
    const up = hrKinetics(new Float64Array(n).fill(150), n, 1, 120);
    const down = hrKinetics(new Float64Array(n).fill(120), n, 1, 150);
    const tUp = t63(up, 120, 150);
    const tDown = t63(down, 150, 120);
    expect(tUp).toBeGreaterThan(40);
    expect(tUp).toBeLessThan(90);
    expect(tDown).toBeGreaterThan(1.5 * tUp);
  });

  it('fitter athletes respond faster (fitness-scaled time constants)', () => {
    const n = 600;
    const demand = new Float64Array(n).fill(160);
    const elite = t63(hrKinetics(demand, n, 0.6, 100), 100, 160);
    const beginner = t63(hrKinetics(demand, n, 1.4, 100), 100, 160);
    expect(beginner).toBeGreaterThan(2 * elite);
  });
});

describe('cardiac drift (e)', () => {
  const steady = (temperatureC: number) =>
    simulate({
      profile: flatProfile(90 * 60 * 3.0),
      athlete: defaultAthlete(),
      session: session('run', { temperatureC, hrSensor: 'strap', target: { kind: 'pace', secPerKm: 1000 / 3.0 } }),
    });
  const driftOf = (r: SimulationResult) => {
    const hr = r.streams.hr;
    return meanRange(hr, hr.length - 600, hr.length) - meanRange(hr, 15 * 60, 25 * 60);
  };

  it('90 min steady at 25 °C: last 10 min are 4–20 bpm above minutes 15–25; at 10 °C drift is smaller', () => {
    const warm = driftOf(steady(25));
    const cool = driftOf(steady(10));
    expect(warm).toBeGreaterThanOrEqual(4);
    expect(warm).toBeLessThanOrEqual(20);
    expect(cool).toBeLessThan(warm - 3);
  });
});

describe('downhill (f)', () => {
  const descent = (grade: number) =>
    simulate({
      profile: descentProfile({ before: 2000, descent: 1000, grade, after: 2000 }, { smoothSigma: 20 }),
      athlete: runner,
      session: session('run', { variability: 0.1, target: { kind: 'pace', secPerKm: 330 } }),
    });
  const sections = (r: SimulationResult) => {
    const s = r.streams;
    const range = (a: number, b: number) => [indexAtDistance(s, a), indexAtDistance(s, b)] as const;
    const [f1, f2] = range(1200, 1850);
    const [d1, d2] = range(2150, 2850);
    const [a1, a2] = range(3150, 3800);
    const flatSpeed = (meanRange(s.speed, f1, f2) + meanRange(s.speed, a1, a2)) / 2;
    const flatDemand = (meanRange(s.hrDemand, f1, f2) + meanRange(s.hrDemand, a1, a2)) / 2;
    return { speedRatio: meanRange(s.speed, d1, d2) / flatSpeed, demandDelta: meanRange(s.hrDemand, d1, d2) - flatDemand };
  };

  it('−8 %: faster than flat but at most 1.2×, and HR demand below flat', () => {
    const { speedRatio, demandDelta } = sections(descent(-0.08));
    expect(speedRatio).toBeGreaterThan(1.03);
    expect(speedRatio).toBeLessThanOrEqual(1.2);
    expect(demandDelta).toBeLessThan(-1);
  });

  it('−25 %: braking makes it no faster than flat', () => {
    expect(sections(descent(-0.25)).speedRatio).toBeLessThanOrEqual(1);
  });

  it('the grade→speed curve peaks near −8…−10 % and never exceeds the 1.2× cap', () => {
    expect(paceFactor(-8)).toBeLessThan(paceFactor(-2));
    expect(paceFactor(-16.2)).toBeCloseTo(1, 1);
    for (let g = -0.45; g <= 0.45; g += 0.01) expect(runGradeMultiplier(g)).toBeLessThanOrEqual(1.2);
    expect(runGradeMultiplier(0.08)).toBeCloseTo(Math.pow(1.4064, -0.8), 3);
  });
});

describe('stops (g)', () => {
  it('during a 30 s stop: speed 0, moving 0, cadence 0, elapsed advances and HR falls 5–25 bpm', () => {
    const r = simulate(
      { profile: flatProfile(5000), athlete: runner, session: session('run', { gpsNoise: 'off', hrSensor: 'strap', target: { kind: 'pace', secPerKm: 330 } }) },
      { stops: [{ s: 3000, duration: 30 }] },
    );
    const s = r.streams;
    const stopped: number[] = [];
    for (let i = 1; i < s.t.length; i++) if (!s.moving[i]) stopped.push(i);
    expect(stopped.length).toBe(30);
    expect(stopped[29] - stopped[0]).toBe(29);
    const first = stopped[0];
    const last = stopped[29];
    for (const i of stopped) {
      expect(s.speed[i]).toBe(0);
      expect(s.cadence[i]).toBe(0);
      expect(s.dist[i]).toBeCloseTo(3000, 6);
      expect(s.lat[i]).toBe(s.lat[first]);
      expect(s.t[i]).toBe(i);
    }
    // 3-sample means so a single bpm of sensor wander does not decide the result.
    const drop = meanRange(s.hr, first - 3, first) - meanRange(s.hr, last - 2, last + 1);
    expect(drop).toBeGreaterThanOrEqual(5);
    expect(drop).toBeLessThanOrEqual(25);
    expect(s.hrDemand[last]).toBeLessThan(s.hrDemand[first - 5] - 40);
    expect(r.summary.elapsed - r.summary.moving).toBe(30);
    // Running resumes with acceleration, not a jump back to pace.
    expect(s.speed[last + 1]).toBeLessThanOrEqual(0.61);
  });

  it("'few' and 'urban' produce plausible stop patterns", () => {
    const stoppedSeconds = (stops: SessionSettings['stops']) => {
      const r = simulate({ profile: flatProfile(15000), athlete: runner, session: session('run', { stops, target: { kind: 'pace', secPerKm: 330 } }) });
      let n = 0;
      let events = 0;
      for (let i = 1; i < r.streams.t.length; i++) {
        if (!r.streams.moving[i]) {
          n++;
          if (r.streams.moving[i - 1]) events++;
        }
      }
      return { n, events };
    };
    const urban = stoppedSeconds('urban');
    expect(urban.events).toBeGreaterThanOrEqual(15);
    expect(urban.n / urban.events).toBeGreaterThan(5);
    expect(urban.n / urban.events).toBeLessThan(45);
    const few = stoppedSeconds('few');
    expect(few.events).toBeLessThanOrEqual(3);
    expect(stoppedSeconds('none').n).toBe(0);
  });
});

describe('effort model coherence', () => {
  it('warm-up: the first minutes run slower than the settled pace', () => {
    const r = simulate({ profile: flatProfile(8000), athlete: runner, session: session('run', { variability: 0, target: { kind: 'pace', secPerKm: 330 } }) });
    const early = meanRange(r.streams.speed, 30, 120);
    const settled = meanRange(r.streams.speed, 600, 1200);
    expect(early / settled).toBeLessThan(0.98);
    expect(early / settled).toBeGreaterThan(0.93);
  });

  it('fatigue: a 2 h 30 min run fades after 45 minutes at constant effort', () => {
    const r = simulate({ profile: flatProfile(27000), athlete: runner, session: session('run', { variability: 0, target: { kind: 'duration', seconds: 9000 } }) });
    expect(meanRange(r.streams.speed, 8400, 9000) / meanRange(r.streams.speed, 1200, 2400)).toBeLessThan(0.97);
  });

  it('HR is integer bpm inside [rest − 5, max + 2] and a trained athlete runs the same pace at lower HR', () => {
    const input = { profile: rollingProfile(8000, 20, 2000), session: session('run', { target: { kind: 'pace' as const, secPerKm: 300 } }) };
    const rec = simulate({ ...input, athlete: runner });
    const fit = simulate({ ...input, athlete: { ...runner, fitness: 'trained' } });
    for (const x of rec.streams.hr) {
      expect(Number.isInteger(x)).toBe(true);
      expect(x).toBeGreaterThanOrEqual(runner.restHr - 5);
      expect(x).toBeLessThanOrEqual(runner.maxHr + 2);
    }
    expect(fit.summary.avgHr).toBeLessThan(rec.summary.avgHr - 8);
  });

  it('an unsustainable target is flagged and HR saturates below max', () => {
    const r = simulate({ profile: flatProfile(5000), athlete: runner, session: session('run', { target: { kind: 'pace', secPerKm: 200 } }) });
    expect(r.warnings.some((w) => w.includes('not sustainable'))).toBe(true);
    expect(r.summary.maxHr).toBeLessThanOrEqual(runner.maxHr + 2);
    expect(meanRange(r.streams.hr, r.streams.t.length - 120, r.streams.t.length)).toBeGreaterThan(runner.maxHr - 10);
  });

  it('steep climbs force a power-hike: walking cadence on the climb and a warning', () => {
    const r = simulate({
      profile: climbProfile({ before: 1000, climb: 1200, grade: 0.18, after: 1000 }, { smoothSigma: 20 }),
      athlete: runner,
      session: session('run', { target: { kind: 'pace', secPerKm: 420 } }),
    });
    expect(r.warnings.some((w) => w.includes('power-hiked'))).toBe(true);
    const s = r.streams;
    const climbCad = meanRange(s.cadence, indexAtDistance(s, 1300), indexAtDistance(s, 2000));
    expect(climbCad).toBeGreaterThan(90);
    expect(climbCad).toBeLessThan(135);
    expect(meanRange(s.hrDemand, indexAtDistance(s, 1500), indexAtDistance(s, 2100))).toBeGreaterThan(
      meanRange(s.hrDemand, indexAtDistance(s, 300), indexAtDistance(s, 900)),
    );
  });

  it('rides: climbs cost more power and HR at lower cadence; fast descents coast with zero power and cadence', () => {
    const r = simulate({
      profile: segmentProfile([
        { length: 3000, grade: 0 },
        { length: 4000, grade: 0.06 },
        { length: 4000, grade: -0.06 },
        { length: 2000, grade: 0 },
      ]),
      athlete: runner,
      session: session('ride', { variability: 0.2, target: { kind: 'speed', mps: 7 } }),
    });
    const s = r.streams;
    const seg = (a: number, b: number) => [indexAtDistance(s, a), indexAtDistance(s, b)] as const;
    const [f1, f2] = seg(1000, 2900);
    const [c1, c2] = seg(4500, 7000);
    const [d1, d2] = seg(7500, 10800);
    expect(meanRange(s.power, c1, c2)).toBeGreaterThan(1.1 * meanRange(s.power, f1, f2));
    expect(meanRange(s.cadence, c1, c2)).toBeLessThan(meanRange(s.cadence, f1, f2) - 5);
    expect(meanRange(s.hr, c1 + 120, c2)).toBeGreaterThan(meanRange(s.hr, f1, f2) + 5);
    let coasting = 0;
    for (let i = d1; i < d2; i++) {
      if (s.cadence[i] === 0) {
        coasting++;
        expect(s.power[i]).toBe(0);
      }
    }
    expect(coasting / (d2 - d1)).toBeGreaterThan(0.5);
    expect(meanRange(s.hr, d2 - 60, d2)).toBeLessThan(meanRange(s.hr, c2 - 60, c2) - 10);
  });

  it('zones, HRmax estimate and VO2max defaults follow the documented formulas', () => {
    expect(estimateMaxHr(35)).toBe(184);
    expect(estimateMaxHr(60)).toBe(166);
    const zones = hrZones({ ...runner, restHr: 50, maxHr: 190 });
    expect(zones.map((z) => z.name)).toEqual(['Recovery', 'Endurance', 'Tempo', 'Threshold', 'VO2max']);
    expect(zones[0].min).toBe(120);
    expect(zones[4].max).toBe(190);
    expect(zones[2].min).toBe(zones[1].max);
    expect(resolveVo2max({ ...runner, fitness: 'trained', sex: 'female' })).toBe(49);
    expect(resolveVo2max({ ...runner, vo2max: 61 })).toBe(61);
  });
});
