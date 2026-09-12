// Props contract between the app shell (owner of state) and the traces strip.
import type { HrZone } from '../../lib/sim';
import type { SimulationResult, Units, ActivityType } from '../../lib/types';

export type Lang = 'en' | 'ru';

export interface TracesProps {
  /** null while there is no route or the simulation is pending. */
  result: SimulationResult | null;
  activity: ActivityType;
  units: Units;
  lang: Lang;
  zones: HrZone[];
  /** Index into result.streams (seconds from start), or null when not scrubbing. */
  playhead: number | null;
  onPlayhead: (index: number | null) => void;
  /** True while terrain/simulation is recomputing; traces show a quiet pending state. */
  busy: boolean;
}
