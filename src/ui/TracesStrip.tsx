import { useMemo } from 'react';
import { useActions, useApp } from '../app/runtime';
import { hrZones } from '../lib/sim';
import { Traces } from './traces/Traces';

export function TracesStrip() {
  const actions = useActions();
  const result = useApp((s) => s.sim.result);
  const activity = useApp((s) => s.sim.activity);
  const units = useApp((s) => s.units);
  const lang = useApp((s) => s.lang);
  const playhead = useApp((s) => s.playhead);
  const athlete = useApp((s) => s.athlete);
  const busy = useApp((s) => s.routing.state === 'busy' || s.terrain.state === 'busy' || s.sim.state === 'busy');
  const zones = useMemo(() => hrZones(athlete), [athlete]);
  return (
    <div className="traces-slot">
      <Traces result={result} activity={activity} units={units} lang={lang} zones={zones} playhead={playhead} onPlayhead={actions.setPlayhead} busy={busy} />
    </div>
  );
}
