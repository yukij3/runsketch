import { describe, expect, it } from 'vitest';
import type { ActivityType, SessionSettings, SimulationResult, TerrainProfile } from '../types';
import { defaultAthlete, defaultSession } from './athlete';
import { EFFORT_PRESETS, PRESET_GOALS, presetGoal, solveEffortPreset } from './presets';
import { climbProfile, rollingProfile, twoPointProfile } from './scenarios';
import { WALK_RUNNING_SPEED, measureEffort, simulate } from './simulate';

const START = Date.UTC(2026, 5, 1, 6, 30);
const athlete = defaultAthlete();
const session = (type: ActivityType, over: Partial<SessionSettings> = {}): SessionSettings => ({ ...defaultSession(type, START), seed: 3, ...over });
const input = (profile: TerrainProfile, type: ActivityType, over: Partial<SessionSettings> = {}) => ({ profile, athlete, session: session(type, over) });
const hilly = climbProfile({ before: 2000, climb: 2500, grade: 0.06, after: 1500 });

function run(profile: TerrainProfile, type: ActivityType, mps: number): SimulationResult {
  return simulate(input(profile, type, { target: { kind: 'speed', mps } }));
}

describe('effort presets', () => {
  it('orders speeds and heart rate Easy < Steady < Tempo < Race and lands each effort on its goal', () => {
    const solutions = EFFORT_PRESETS.map((preset) => solveEffortPreset(input(hilly, 'run'), preset)!);
    for (let i = 1; i < solutions.length; i++) expect(solutions[i].mps).toBeGreaterThan(solutions[i - 1].mps);
    for (const s of solutions) {
      expect(Math.abs(s.effort - s.goal), s.preset).toBeLessThan(0.01);
      const measured = measureEffort(input(hilly, 'run'), s.mps)!;
      expect(Math.abs(measured.effort - s.effort)).toBeLessThan(1e-9);
    }
    const easy = run(hilly, 'run', solutions[0].mps);
    const race = run(hilly, 'run', solutions[3].mps);
    expect(race.summary.avgHr).toBeGreaterThan(easy.summary.avgHr + 10);
    // Steady is 70 % of VO2 reserve in any weather: weather changes how long that effort takes, not the effort itself.
    expect(Math.abs(solutions[1].goal - presetGoal('run', 'steady', solutions[1].movingTime, { fitness: 'recreational' }))).toBeLessThan(1e-9);
    expect(solutions[1].goal).toBe(0.7);
  });

  it('solves a sustainable Steady ride on a hilly route (no 150 % VO2 reserve default)', () => {
    const s = solveEffortPreset(input(hilly, 'ride'), 'steady')!;
    expect(Math.abs(s.effort - s.goal)).toBeLessThan(0.01);
    expect(s.goal).toBeGreaterThan(0.68);
    const r = run(hilly, 'ride', s.mps);
    expect(r.warnings.filter((w) => /VO2 reserve|could not be matched/.test(w))).toEqual([]);
    expect(s.mps * 3.6).toBeGreaterThan(15);
    expect(s.mps * 3.6).toBeLessThan(35);
  });

  it('keeps walks at walking speed and decays Race with duration', () => {
    const flat = rollingProfile(6000, 5, 2000);
    for (const preset of EFFORT_PRESETS) {
      const s = solveEffortPreset(input(flat, 'walk'), preset)!;
      const r = run(flat, 'walk', s.mps);
      expect(r.warnings.some((w) => /is running speed/.test(w)), preset).toBe(false);
      expect(s.mps).toBeLessThan(WALK_RUNNING_SPEED);
    }
    expect(presetGoal('run', 'race', 1200)).toBe(PRESET_GOALS.run.race);
    expect(presetGoal('run', 'race', 7200)).toBeLessThan(0.82);
    expect(presetGoal('run', 'race', 7200)).toBeGreaterThan(0.78);
    expect(presetGoal('run', 'steady', 7200)).toBe(0.7);
  });

  it('returns null on routes too short to judge effort', () => {
    expect(solveEffortPreset(input(twoPointProfile(60), 'run'), 'steady')).toBeNull();
  });

  it('solves a 2 h run in under 500 ms', () => {
    const long = rollingProfile(21000, 30, 3000);
    solveEffortPreset(input(long, 'run'), 'easy');
    const t0 = performance.now();
    const s = solveEffortPreset(input(long, 'run'), 'easy')!;
    const elapsed = performance.now() - t0;
    expect(s.movingTime).toBeGreaterThan(5400);
    expect(elapsed).toBeLessThan(500);
  });
});
