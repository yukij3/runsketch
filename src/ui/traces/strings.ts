// Copy for the traces strip. Plain, literal labels.
import type { RestKind } from './rest';

export interface TraceStrings {
  groupLabel: string;
  keyboardHint: string;
  empty: string;
  computing: string;
  recomputing: string;
  legendDemand: string;
  legendResponse: string;
  /** The hatched fill between the demand and response lines. */
  legendLag: string;
  legendStops: string;
  legendTerrain: string;
  axisLabel: string;
  axisDistance: string;
  axisTime: string;
  clearPlayhead: string;
  cleared: string;
  /** Live text when Escape returns the playhead to its rest point. */
  rested: Record<RestKind, string>;
  stopped: string;
  avg: string;
  ascent: string;
  demand: string;
  panel: { elevation: string; pace: string; speed: string; hr: string; cadence: string };
  /** Heart-rate zone functions, by zone id. */
  zone: Record<1 | 2 | 3 | 4 | 5, string>;
  cell: {
    elapsed: string;
    distance: string;
    pace: string;
    speed: string;
    hr: string;
    grade: string;
    cadence: string;
    elevation: string;
    avgPace: string;
    avgSpeed: string;
    avgHr: string;
    avgCadence: string;
    ascent: string;
    elevationRange: string;
  };
}

export const STRINGS: TraceStrings = {
  groupLabel: 'Activity traces',
  keyboardHint:
    'Arrow keys move the playhead by 10 seconds, Shift with an arrow by 60 seconds. Home and End jump to the start and finish. Escape returns it to the top of the largest climb, or to peak heart rate on a flat route.',
  empty: 'Traces appear once the route has two points',
  computing: 'Computing traces…',
  recomputing: 'Recomputing…',
  legendDemand: 'Dashed — what the effort demands.',
  legendResponse: 'Solid — how the heart responds.',
  legendLag: 'Hatched — its lag behind demand.',
  legendStops: 'Ticks under the axis — stops.',
  legendTerrain: 'Shaded — climbing; dotted — descending.',
  axisLabel: 'Horizontal axis',
  axisDistance: 'Distance',
  axisTime: 'Time',
  clearPlayhead: 'Unpin',
  cleared: 'Playhead cleared',
  rested: { crest: 'Playhead back at the top of the largest climb', peak: 'Playhead back at peak heart rate' },
  stopped: 'Stopped',
  avg: 'avg',
  ascent: 'recorded ascent',
  demand: 'demand',
  panel: { elevation: 'Elevation', pace: 'Pace', speed: 'Speed', hr: 'Heart rate', cadence: 'Cadence' },
  zone: { 1: 'Recovery', 2: 'Endurance', 3: 'Tempo', 4: 'Threshold', 5: 'VO₂max' },
  cell: {
    elapsed: 'Elapsed',
    distance: 'Distance',
    pace: 'Pace',
    speed: 'Speed',
    hr: 'HR / demand',
    grade: 'Grade',
    cadence: 'Cadence',
    elevation: 'Elevation',
    avgPace: 'Avg pace',
    avgSpeed: 'Avg speed',
    avgHr: 'Avg HR / demand',
    avgCadence: 'Avg cadence',
    ascent: 'Recorded ascent',
    elevationRange: 'Recorded elevation',
  },
};
