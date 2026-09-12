// The data ink. Memoised: scrubbing never re-renders these paths. Remounted (new key) per result,
// which restarts the plotter-pen wipe defined in traces.css.
import { memo, useId } from 'react';
import { formatDuration } from '../../lib/format';
import type { InkGeometry } from './ink';
import { panelBox, type PanelId, type StripLayout } from './layout';
import { crisp } from './StaticLayer';

interface InkLayerProps {
  layout: StripLayout;
  ink: InkGeometry;
  stoppedLabel: string;
}

/** Panels below elevation that carry each climb forward, so the heart-rate lag after it can be read. */
const CARRIED: readonly PanelId[] = ['pace', 'hr', 'cadence'];

/** useId output is not guaranteed to be a valid url(#…) fragment. */
function useSvgId(): string {
  return `traces${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
}

export const InkLayer = memo(function InkLayer({ layout, ink, stoppedLabel }: InkLayerProps) {
  const uid = useSvgId();
  const clipId = (id: PanelId) => `${uid}-clip-${id}`;
  const clip = (id: PanelId) => `url(#${clipId(id)})`;
  const ele = panelBox(layout, 'elevation');
  const climbs = ink.gradeBands.filter((b) => b.kind === 'up');
  const carried = CARRIED.map((id) => panelBox(layout, id));
  const onsets = climbs
    .map((b) => {
      const x = crisp(b.x);
      return [ele, ...carried].map((p) => `M${x} ${p.top}V${p.top + p.height}`).join('');
    })
    .join('');

  return (
    <svg
      className="traces__layer traces__ink"
      width={layout.plotW}
      height={layout.height}
      style={{ left: layout.plotX }}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        {layout.panels.map((p) => (
          <clipPath key={p.id} id={clipId(p.id)}>
            <rect x={-1} y={p.top} width={layout.plotW + 2} height={p.height} />
          </clipPath>
        ))}
        <pattern id={`${uid}-hatch`} patternUnits="userSpaceOnUse" width={4} height={4} patternTransform="rotate(45)">
          <line className="traces__hatch-line" x1={0.5} y1={0} x2={0.5} y2={4} />
        </pattern>
        {/* Descents are stippled, not hatched: the hatch belongs to the heart-rate lag alone. */}
        <pattern id={`${uid}-descent`} patternUnits="userSpaceOnUse" width={6} height={6}>
          <circle className="traces__stipple" cx={1.5} cy={1.5} r={0.85} />
          <circle className="traces__stipple" cx={4.5} cy={4.5} r={0.85} />
        </pattern>
      </defs>

      <g data-layer="climbs">
        {climbs.flatMap((b) =>
          carried.map((p) => (
            <rect
              key={`c${b.x}${p.id}`}
              className="traces__climb-column"
              x={b.x}
              y={p.top}
              width={Math.max(1, b.w)}
              height={p.height}
            />
          )),
        )}
        {onsets && <path className="traces__onset" d={onsets} />}
      </g>

      <g data-panel="elevation" clipPath={clip('elevation')}>
        {ink.gradeBands.map((b) => (
          <rect
            key={`${b.kind}${b.x}`}
            className={`traces__grade traces__grade--${b.kind}`}
            x={b.x}
            y={ele.top}
            width={Math.max(1, b.w)}
            height={ele.height}
            fill={b.kind === 'down' ? `url(#${uid}-descent)` : undefined}
          />
        ))}
        {ink.eleArea && <path className="traces__ele-area" d={ink.eleArea} />}
        {ink.eleLine && <path className="traces__line traces__ele-line" d={ink.eleLine} data-series="elevation" />}
      </g>

      <g data-panel="pace" clipPath={clip('pace')}>
        {ink.speedRaw && <path className="traces__line traces__speed-raw" d={ink.speedRaw} data-series="speed-raw" />}
        {ink.speedSmooth && <path className="traces__line traces__speed" d={ink.speedSmooth} data-series="speed" />}
      </g>

      <g data-panel="hr" clipPath={clip('hr')}>
        {ink.hrLag && <path className="traces__lag" d={ink.hrLag} fill={`url(#${uid}-hatch)`} data-series="hr-lag" />}
        {ink.hrDemand && <path className="traces__line traces__hr-demand" d={ink.hrDemand} data-series="hr-demand" />}
        {ink.hr && <path className="traces__line traces__hr" d={ink.hr} data-series="hr" />}
      </g>

      <g data-panel="cadence" clipPath={clip('cadence')}>
        {ink.cadence && <path className="traces__line traces__cadence" d={ink.cadence} data-series="cadence" />}
      </g>

      <g className="traces__stops">
        {ink.stops.map((st) => (
          <rect
            key={`s${st.x}`}
            className="traces__stop"
            x={st.w < 2 ? st.x - 1 : st.x}
            y={layout.axisTop + 1}
            width={Math.max(2, st.w)}
            height={4}
          >
            <title>{`${stoppedLabel} ${formatDuration(st.seconds)}`}</title>
          </rect>
        ))}
      </g>
    </svg>
  );
});
