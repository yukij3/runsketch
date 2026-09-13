// Public API of the simulation engine.
export { HR_MATCH_TOLERANCE, HR_MATCH_VO2MAX, measureEffort, simulate, type EffortMeasure, type SimulationOverrides } from './simulate';
export {
  EFFORT_PRESETS,
  PRESET_GOALS,
  presetGoal,
  solveEffortPreset,
  type EffortPreset,
  type PresetSolution,
} from './presets';
export { defaultAthlete, defaultSession, estimateMaxHr, hrZones, mountainDefaults, resolveVo2max, type HrZone, type MountainSettings } from './athlete';
export { sanitiseWeatherSettings } from './environment';
export { defaultSnowline } from './ground';
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
  weatherScenario,
  type GradeSegment,
  type ScenarioOptions,
  type WeatherScenarioOptions,
} from './scenarios';
