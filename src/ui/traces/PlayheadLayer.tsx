// The only layer that re-renders while scrubbing: the "now" hairline, its dots, and the right readouts.
import type { PanelYMaps } from './ink';
import type { PanelBox, StripLayout } from './layout';
import type { PanelReadout } from './readout';
import type { XScale } from './scale';
import type { TraceModel } from './series';
import { crisp } from './StaticLayer';

interface PlayheadLayerProps {
  layout: StripLayout;
  model: TraceModel;
  scale: XScale;
  y: PanelYMaps;
  index: number | null;
  pinned: boolean;
  readouts: Record<PanelBox['id'], PanelReadout>;
}

const LINE_H = 14;
/** Rough advance widths (px) for the 13px mono value and the 11px UI unit/caption text. */
const MONO_ADVANCE = 7.9;
const UI_ADVANCE = 6.2;

function Dot({ className, x, y, box, r = 2.5 }: { className: string; x: number; y: number; box: PanelBox; r?: number }) {
  if (!Number.isFinite(y) || y < box.top - 1 || y > box.top + box.height + 1) return null;
  return <circle className={`traces__dot ${className}`} cx={x} cy={y} r={r} />;
}

function ReadoutText({ box, x, width, readout }: { box: PanelBox; x: number; width: number; readout: PanelReadout }) {
  const maxLines = Math.max(1, Math.floor((box.height - 2) / LINE_H));
  const lines = readout.lines.slice(0, maxLines);
  const captionOwnLine = readout.caption !== '' && lines.length < maxLines;
  return (
    <g>
      {lines.map((line, k) => {
        const baseline = box.top + 11 + k * LINE_H;
        const textX = line.swatch ? x + 14 : x;
        const isLast = k === lines.length - 1;
        const inlineCaption =
          !captionOwnLine &&
          isLast &&
          readout.caption !== '' &&
          textX - x + line.value.length * MONO_ADVANCE + (line.unit.length + readout.caption.length) * UI_ADVANCE + 10 <= width;
        return (
          <g key={k}>
            {line.swatch && (
              <line className={`traces__swatch traces__swatch--${line.swatch}`} x1={x} x2={x + 10} y1={baseline - 4} y2={baseline - 4} />
            )}
            <text className="traces__read" x={textX} y={baseline}>
              {line.value}
              {line.unit && (
                <tspan className="traces__read-unit" dx={3}>
                  {line.unit}
                </tspan>
              )}
              {inlineCaption && (
                <tspan className="traces__read-caption" dx={4}>
                  {readout.caption}
                </tspan>
              )}
            </text>
          </g>
        );
      })}
      {captionOwnLine && (
        <text className="traces__read-caption" x={x} y={box.top + 11 + lines.length * LINE_H}>
          {readout.caption}
        </text>
      )}
    </g>
  );
}

export function PlayheadLayer({ layout, model, scale, y, index, pinned, readouts }: PlayheadLayerProps) {
  const [ele, pace, hr, cad] = layout.panels;
  const st = model.streams;
  const x = index !== null ? crisp(layout.plotX + scale.px[index]) : null;

  return (
    <svg className="traces__layer traces__overlay" width={layout.width} height={layout.height} aria-hidden="true" focusable="false">
      {x !== null && index !== null && (
        <g data-playhead={index}>
          <line className="traces__playhead" x1={x} x2={x} y1={ele.top - 4} y2={layout.axisTop} />
          {pinned && <rect className="traces__pin" x={x - 3.5} y={ele.top - 5} width={7} height={4} />}
          <Dot className="traces__dot--ele" x={x} y={y.elevation(model.ele[index])} box={ele} />
          <Dot className="traces__dot--speed" x={x} y={y.pace(model.speedSmooth[index])} box={pace} />
          <Dot className="traces__dot--demand" x={x} y={y.hr(st.hrDemand[index])} box={hr} />
          <Dot className="traces__dot--hr" x={x} y={y.hr(st.hr[index])} box={hr} r={3} />
          <Dot className="traces__dot--cadence" x={x} y={y.cadence(model.cadence[index])} box={cad} />
        </g>
      )}
      {layout.readoutW > 0 &&
        layout.panels.map((p) => (
          <ReadoutText key={p.id} box={p} x={layout.readoutX + 10} width={layout.readoutW - 12} readout={readouts[p.id]} />
        ))}
    </svg>
  );
}
