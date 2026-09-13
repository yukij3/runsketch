// Running dynamics for FIT records, derived from the recorded speed and cadence the way a chest strap reports them.
import { createRandom, ouStepper } from '../sim/rng';
import type { ActivityStreams, SessionSettings } from '../types';
import { clamp, isFoot } from './common';

/**
 * Ground contact time falls about 30 ms per m/s from 250 ms at 3 m/s, and vertical oscillation sits at a personal
 * 7–11 cm (Garmin Forerunner 965 manual gauge bands; 1 s recordings with an HRM-Run and a fenix 5: 240–258 ms at
 * 3.0–3.1 m/s, 212–228 ms at 4.0 m/s, 7.3–11.5 cm). Walking steps (cadence under `walkBelowSpm`) have 420–560 ms
 * contact and 4–6 cm oscillation. Step length is speed·60/cadence, so it always agrees with the speed and cadence
 * fields; stance time percent is contact over the stride (two steps), vertical ratio is oscillation over step length.
 * Personal offsets and wander sizes are HEURISTIC.
 */
export const RUNNING_DYNAMICS = {
  gctAt3: 250,
  gctPerMps: -30,
  gctRange: [180, 330],
  walkGct: { at0: 620, perMps: -110, range: [420, 560] },
  gctPersonSd: 15,
  gctWander: { tau: 10, sigma: 3 },
  voMm: [70, 110],
  voWander: { tau: 20, sigma: 3 },
  walkVoMm: 50,
  balanceSd: 0.8,
  balanceWander: { tau: 10, sigma: 0.3 },
  walkBelowSpm: 140,
  minSpeed: 0.3,
} as const;

export interface DynamicsStreams {
  /** Ground contact time, ms (NaN where no step is recorded). */
  stanceTime: Float64Array;
  /** Contact time as a share of the stride, %. */
  stanceTimePercent: Float64Array;
  /** mm. */
  verticalOscillation: Float64Array;
  /** Oscillation over step length, %. */
  verticalRatio: Float64Array;
  /** mm. */
  stepLength: Float64Array;
  /** Left foot's share of contact time, %. */
  stanceTimeBalance: Float64Array;
}

/**
 * Per-sample running dynamics for foot sports recorded with a chest strap (optical-only recordings have none, as
 * with real wrist units without a strap or pod); null otherwise.
 */
export function runningDynamics(streams: ActivityStreams, session: SessionSettings): DynamicsStreams | null {
  if (!isFoot(session.type) || session.hrSensor !== 'strap') return null;
  const D = RUNNING_DYNAMICS;
  const n = streams.t.length;
  const out: DynamicsStreams = {
    stanceTime: new Float64Array(n).fill(NaN),
    stanceTimePercent: new Float64Array(n).fill(NaN),
    verticalOscillation: new Float64Array(n).fill(NaN),
    verticalRatio: new Float64Array(n).fill(NaN),
    stepLength: new Float64Array(n).fill(NaN),
    stanceTimeBalance: new Float64Array(n).fill(NaN),
  };
  const random = createRandom(session.seed, 'running-dynamics');
  const gctPerson = clamp(D.gctPersonSd * random.normal(), -2 * D.gctPersonSd, 2 * D.gctPersonSd);
  const voPerson = D.voMm[0] + (D.voMm[1] - D.voMm[0]) * random.uniform();
  const balancePerson = 50 + clamp(D.balanceSd * random.normal(), -2.5, 2.5);
  const gctWander = ouStepper(random, D.gctWander.tau, D.gctWander.sigma);
  const voWander = ouStepper(random, D.voWander.tau, D.voWander.sigma);
  const balanceWander = ouStepper(random, D.balanceWander.tau, D.balanceWander.sigma);
  for (let i = 0; i < n; i++) {
    const gctNoise = gctWander();
    const voNoise = voWander();
    const balanceNoise = balanceWander();
    const v = streams.speed[i];
    const spm = streams.cadence[i];
    if (!streams.moving[i] || !(v >= D.minSpeed) || !(spm > 0)) continue;
    const walking = spm < D.walkBelowSpm;
    const gct = walking
      ? clamp(D.walkGct.at0 + D.walkGct.perMps * v, D.walkGct.range[0], D.walkGct.range[1])
      : clamp(D.gctAt3 + D.gctPerMps * (v - 3), D.gctRange[0], D.gctRange[1]);
    const stanceTime = gct + gctPerson + gctNoise;
    const vo = walking ? D.walkVoMm + (voPerson - 90) / 4 + voNoise / 2 : voPerson + voNoise;
    const stepMm = (v * 60 * 1000) / spm;
    out.stanceTime[i] = stanceTime;
    out.stanceTimePercent[i] = (stanceTime * spm) / 1200;
    out.verticalOscillation[i] = vo;
    out.verticalRatio[i] = (100 * vo) / stepMm;
    out.stepLength[i] = stepMm;
    out.stanceTimeBalance[i] = balancePerson + balanceNoise;
  }
  return out;
}
