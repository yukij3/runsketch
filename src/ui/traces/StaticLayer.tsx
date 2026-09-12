// Under the ink: ruled panels, gridlines, zone bands, gutter names and tick labels.
// Over the ink (compact strips only): panel names in the label band above each plot, and a key naming
// the heart-rate zones beside the heart-rate name (the narrow zone column only has room for Z3, Z4…).
import { memo } from 'react';
import type { Axes, ZoneBand } from './axes';
import type { PanelId, StripLayout } from './layout';
import type { TraceStrings } from './strings';

export type PanelNames = Record<PanelId, { name: string; unit: string }>;

/** Centre a 1px stroke on a pixel row/column. */
export const crisp = (v: number) => Math.round(v) + 0.5;

const NAME_X = 12;
/** Zone bands shorter than this carry no label; the function name needs a little more room. */
const ZONE_LABEL_MIN_H = 9;
const ZONE_NAME_MIN_H = 10;

interface StaticLayerProps {
  layout: StripLayout;
  axes: Axes | null;
  names: PanelNames;
  zoneNames: TraceStrings['zone'];
}

export const StaticLayer = memo(function StaticLayer({ layout, axes, names, zoneNames }: StaticLayerProps) {
  const { plotX, plotW, panels, axisTop, width, height, compact } = layout;
  const plotRight = plotX + plotW;

  return (
    <svg className="traces__layer traces__static" width={width} height={height} aria-hidden="true" focusable="false">
      {axes?.zones.map((z) => (
        <rect key={z.id} className={`traces__zone traces__zone--${z.id}`} x={plotX} y={z.top} width={plotW} height={z.height} />
      ))}
      {axes?.x.map((t) =>
        panels.map((p) => (
          <line
            key={`gx${t.pos}${p.id}`}
            className="traces__grid"
            x1={crisp(plotX + t.pos)}
            x2={crisp(plotX + t.pos)}
            y1={p.top}
            y2={p.top + p.height}
          />
        )),
      )}

      {panels.map((p, k) => {
        const name = names[p.id];
        return (
          <g key={p.id} data-panel-frame={p.id}>
            {k < panels.length - 1 && (
              <line className="traces__rule" x1={0} x2={width} y1={crisp(p.top + p.height + 2)} y2={crisp(p.top + p.height + 2)} />
            )}
            {axes?.y[p.id].map((t) => (
              <g key={`t${t.label}${t.pos}`}>
                <line className="traces__grid traces__grid--y" x1={plotX} x2={plotRight} y1={crisp(t.pos)} y2={crisp(t.pos)} />
                <text className="traces__tick" x={plotX - 6} y={t.pos} textAnchor="end" dominantBaseline="central">
                  {t.label}
                </text>
              </g>
            ))}
            {!compact && (
              <text className="traces__name" x={NAME_X} y={p.top + 10}>
                {name.name}
              </text>
            )}
            {!compact && p.height >= 28 && (
              <text className="traces__name-unit" x={NAME_X} y={p.top + 23}>
                {name.unit}
              </text>
            )}
          </g>
        );
      })}

      <line className="traces__rule" x1={crisp(plotX)} x2={crisp(plotX)} y1={panels[0].top - layout.labelH} y2={axisTop} />
      <line className="traces__rule traces__rule--strong" x1={plotX} x2={plotRight} y1={crisp(axisTop)} y2={crisp(axisTop)} />
      {layout.readoutW > 0 && (
        <line className="traces__rule" x1={crisp(layout.readoutX)} x2={crisp(layout.readoutX)} y1={0} y2={height} />
      )}

      {axes?.zones
        .filter((z) => z.height >= ZONE_LABEL_MIN_H)
        .map((z) =>
          compact ? (
            <text
              key={`zl${z.id}`}
              className="traces__zone-label"
              x={layout.zoneX + layout.zoneW / 2}
              y={z.top + z.height / 2}
              textAnchor="middle"
              dominantBaseline="central"
            >
              {`Z${z.id}`}
            </text>
          ) : (
            <g key={`zl${z.id}`}>
              <text className="traces__zone-label" x={layout.zoneX + 7} y={z.top + z.height / 2} dominantBaseline="central">
                {`Z${z.id}`}
              </text>
              {z.height >= ZONE_NAME_MIN_H && (
                <text className="traces__zone-name" x={layout.zoneX + 25} y={z.top + z.height / 2} dominantBaseline="central">
                  {zoneNames[z.id]}
                </text>
              )}
            </g>
          ),
        )}

      {axes?.x.map((t, k) => (
        <text
          key={`xl${t.pos}`}
          className="traces__tick"
          x={plotX + t.pos}
          y={axisTop + 12}
          textAnchor={k === 0 && t.pos < 16 ? 'start' : t.pos > plotW - 24 ? 'end' : 'middle'}
        >
          {t.label}
        </text>
      ))}
    </svg>
  );
});

interface LabelLayerProps {
  layout: StripLayout;
  names: PanelNames;
  zones: readonly ZoneBand[] | null;
  zoneNames: TraceStrings['zone'];
}

/** Rough rendered width at the 11 px label size (sans letters, mono zone numbers). */
const textW = (text: string, mono = false) => text.length * (mono ? 6.7 : 5.7);
const KEY_GAP = 8;

export const LabelLayer = memo(function LabelLayer({ layout, names, zones, zoneNames }: LabelLayerProps) {
  if (!layout.compact) return null;
  const right = layout.width - layout.padR;
  const room = right - layout.padL - textW(`${names.hr.name} ${names.hr.unit}`) - 12;
  const entryW = (z: ZoneBand) => textW(`Z${z.id}`, true) + 4 + textW(zoneNames[z.id]) + KEY_GAP;
  // Highest zones first: when five bands are on screen and the key cannot name them all, the easy end drops out.
  const labelled = (zones ?? []).filter((z) => z.height >= ZONE_LABEL_MIN_H).sort((a, b) => b.id - a.id);
  let used = -KEY_GAP;
  const keyed = labelled.filter((z) => (used += entryW(z)) <= room).sort((a, b) => a.id - b.id);
  const showKey = keyed.length > 0;
  return (
    <svg className="traces__layer traces__labels" width={layout.width} height={layout.height} aria-hidden="true" focusable="false">
      {layout.panels.map((p) => (
        <text key={p.id} className="traces__name traces__name--band" x={layout.padL} y={p.top - 5}>
          {names[p.id].name}
          <tspan className="traces__name-unit" dx={4}>
            {names[p.id].unit}
          </tspan>
        </text>
      ))}
      {showKey && (
        <text className="traces__zone-key" x={right} y={layout.panels.find((p) => p.id === 'hr')!.top - 5} textAnchor="end">
          {keyed.map((z, k) => (
            <tspan key={z.id}>
              <tspan className="traces__zone-label" dx={k === 0 ? 0 : KEY_GAP}>{`Z${z.id}`}</tspan>
              <tspan className="traces__zone-name" dx={4}>
                {zoneNames[z.id]}
              </tspan>
            </tspan>
          ))}
        </text>
      )}
    </svg>
  );
});
