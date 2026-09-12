// Public API of the simulation engine.
export { simulate, type SimulationOverrides } from './simulate';
export { defaultAthlete, defaultSession, estimateMaxHr, hrZones, resolveVo2max, type HrZone } from './athlete';
export type { StopEvent } from './stops';
export {
  climbProfile,
  descentProfile,
  flatProfile,
  outAndBackProfile,
  pathProfile,
  rollingProfile,
  segmentProfile,
  squareLoopProfile,
  twoPointProfile,
  type GradeSegment,
  type ScenarioOptions,
} from './scenarios';
