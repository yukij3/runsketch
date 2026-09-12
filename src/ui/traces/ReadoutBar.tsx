// Readout row above the panels and the legend below them.
import type { ReadoutCell } from './readout';
import type { TraceStrings } from './strings';

export function ReadoutRow({ cells }: { cells: readonly ReadoutCell[] }) {
  return (
    <dl className="traces__readouts">
      {cells.map((c) => (
        <div key={c.key} className="traces__cell">
          <dt>{c.label}</dt>
          <dd>
            <span className="traces__value" data-key={c.key}>
              {c.value}
            </span>
            {c.unit && <span className="traces__unit">{c.unit}</span>}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function Legend({ s, showStops }: { s: TraceStrings; showStops: boolean }) {
  return (
    <ul className="traces__legend">
      <li>
        <svg className="traces__key" width={20} height={8} aria-hidden="true" focusable="false">
          <line className="traces__swatch traces__swatch--dashed" x1={0} x2={20} y1={4} y2={4} />
        </svg>
        {s.legendDemand}
      </li>
      <li>
        <svg className="traces__key" width={20} height={8} aria-hidden="true" focusable="false">
          <line className="traces__swatch traces__swatch--solid" x1={0} x2={20} y1={4} y2={4} />
        </svg>
        {s.legendResponse}
      </li>
      <li>
        <svg className="traces__key" width={10} height={10} aria-hidden="true" focusable="false">
          <path className="traces__key-lag" d="M0 4.5L4.5 0M0 9.5L9.5 0M4.5 10L10 4.5" />
        </svg>
        {s.legendLag}
      </li>
      <li>
        <svg className="traces__key" width={22} height={10} aria-hidden="true" focusable="false">
          <rect className="traces__key-climb" x={0} y={0} width={10} height={10} />
          <circle className="traces__stipple" cx={13.5} cy={1.5} r={0.85} />
          <circle className="traces__stipple" cx={19.5} cy={1.5} r={0.85} />
          <circle className="traces__stipple" cx={16.5} cy={4.5} r={0.85} />
          <circle className="traces__stipple" cx={13.5} cy={7.5} r={0.85} />
          <circle className="traces__stipple" cx={19.5} cy={7.5} r={0.85} />
        </svg>
        {s.legendTerrain}
      </li>
      {showStops && (
        <li className="traces__legend-stops">
          <svg className="traces__key" width={8} height={8} aria-hidden="true" focusable="false">
            <rect className="traces__stop" x={3} y={2} width={2} height={4} />
          </svg>
          {s.legendStops}
        </li>
      )}
    </ul>
  );
}
