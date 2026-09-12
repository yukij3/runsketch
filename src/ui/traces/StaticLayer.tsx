// Under the ink: ruled panels, gridlines, zone bands, gutter names and tick labels.
// Over the ink (compact strips only): panel names inset in the plot.
import { memo } from 'react';
import type { Axes } from './axes';
import type { PanelId, StripLayout } from './layout';

export type PanelNames = Record<PanelId, { name: string; unit: string }>;

/** Centre a 1px stroke on a pixel row/column. */
export const crisp = (v: number) => Math.round(v) + 0.5;

const NAME_X = 12;

interface StaticLayerProps {
  layout: StripLayout;
  axes: Axes | null;
  names: PanelNames;
}

export const StaticLayer = memo(function StaticLayer({ layout, axes, names }: StaticLayerProps) {
  const { plotX, plotW, panels, axisTop, width, height, compact } = layout;
  const plotRight = plotX + plotW;
  const firstTop = panels[0].top;

  return (
    <svg className="traces__layer traces__static" width={width} height={height} aria-hidden="true" focusable="false">
      {axes?.zones.map((z) => (
        <rect key={z.id} className={`traces__zone traces__zone--${z.id}`} x={plotX} y={z.top} width={plotW} height={z.height} />
      ))}
      {axes?.x.map((t) => (
        <line key={`gx${t.pos}`} className="traces__grid" x1={crisp(plotX + t.pos)} x2={crisp(plotX + t.pos)} y1={firstTop} y2={axisTop} />
      ))}

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

      <line className="traces__rule" x1={crisp(plotX)} x2={crisp(plotX)} y1={0} y2={axisTop} />
      <line className="traces__rule traces__rule--strong" x1={plotX} x2={plotRight} y1={crisp(axisTop)} y2={crisp(axisTop)} />
      {layout.readoutW > 0 && (
        <line className="traces__rule" x1={crisp(layout.readoutX)} x2={crisp(layout.readoutX)} y1={0} y2={height} />
      )}

      {axes?.zones
        .filter((z) => z.height >= 9)
        .map((z) => (
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
        ))}

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
}

export const LabelLayer = memo(function LabelLayer({ layout, names }: LabelLayerProps) {
  if (!layout.compact) return null;
  return (
    <svg className="traces__layer traces__labels" width={layout.width} height={layout.height} aria-hidden="true" focusable="false">
      {layout.panels.map((p) => (
        <text key={p.id} className="traces__name traces__name--inset" x={layout.plotX + 4} y={p.top + 10}>
          {names[p.id].name}
          <tspan className="traces__name-unit" dx={4}>
            {names[p.id].unit}
          </tspan>
        </text>
      ))}
    </svg>
  );
});
