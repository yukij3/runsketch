import type { Athlete, ActivityType, SessionSettings, SimulationInput, SimulationResult } from '../types';

const NI = (): never => { throw new Error('not implemented'); };

export interface HrZone { id: 1 | 2 | 3 | 4 | 5; name: string; min: number; max: number }

/** Deterministic 1 Hz simulation: same input → identical output. */
export function simulate(_input: SimulationInput): SimulationResult { return NI(); }
export function defaultAthlete(): Athlete { return NI(); }
export function defaultSession(_type: ActivityType, _now: number): SessionSettings { return NI(); }
/** Tanaka 208 − 0.7·age. */
export function estimateMaxHr(_age: number): number { return NI(); }
export function hrZones(_athlete: Athlete): HrZone[] { return NI(); }
