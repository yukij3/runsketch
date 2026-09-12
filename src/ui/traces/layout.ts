// Geometry of the strip body: gutters, stacked panels sharing one plot column, and the x axis row.

export type PanelId = 'elevation' | 'pace' | 'hr' | 'cadence';

export const PANEL_ORDER: readonly PanelId[] = ['elevation', 'pace', 'hr', 'cadence'];

/** Heart rate gets the most height: it carries the demand/response story. Cadence is compact. */
const WEIGHTS: Record<PanelId, number> = { elevation: 1, pace: 1.15, hr: 1.6, cadence: 0.62 };

export interface PanelBox {
  id: PanelId;
  top: number;
  height: number;
}

export interface StripLayout {
  width: number;
  height: number;
  /** Narrow strip: panel names get a label band above each plot and the right readout column is dropped. */
  compact: boolean;
  /** Left margin before the tick gutter (compact strips only, so tick labels clear the screen edge). */
  padL: number;
  /** Right margin after the zone column (compact strips only), mirroring padL. */
  padR: number;
  /** Height of the band above each panel that carries its name (compact strips only). */
  labelH: number;
  nameW: number;
  tickW: number;
  plotX: number;
  plotW: number;
  /** Column right of the plot holding HR zone labels (number, plus the zone's function when wide). */
  zoneX: number;
  zoneW: number;
  readoutX: number;
  readoutW: number;
  panels: PanelBox[];
  axisTop: number;
  axisH: number;
}

export const COMPACT_BELOW = 640;
const PANEL_GAP = 6;
const TOP_PAD = 6;
const COMPACT_PAD_L = 12;
const COMPACT_LABEL_H = 15;
const AXIS_H = 18;
const MIN_PANEL_H = 18;

export function layoutStrip(width: number, height: number): StripLayout {
  const w = Math.max(160, Math.floor(width));
  const h = Math.max(120, Math.floor(height));
  const compact = w < COMPACT_BELOW;
  const padL = compact ? COMPACT_PAD_L : 0;
  const padR = compact ? COMPACT_PAD_L : 0;
  const labelH = compact ? COMPACT_LABEL_H : 0;
  const nameW = compact ? 0 : 78;
  const tickW = 40;
  const zoneW = compact ? 22 : 84;
  const readoutW = compact ? 0 : 92;
  const plotX = padL + nameW + tickW;
  const plotW = Math.max(40, w - plotX - zoneW - readoutW - padR);

  const gap = PANEL_GAP + labelH;
  const topPad = TOP_PAD + labelH;
  const gaps = gap * (PANEL_ORDER.length - 1);
  const avail = Math.max(PANEL_ORDER.length * MIN_PANEL_H, h - topPad - AXIS_H - gaps);
  const totalWeight = PANEL_ORDER.reduce((sum, id) => sum + WEIGHTS[id], 0);
  const heights = PANEL_ORDER.map((id) => Math.max(MIN_PANEL_H, Math.floor((avail * WEIGHTS[id]) / totalWeight)));
  const leftover = avail - heights.reduce((a, b) => a + b, 0);
  heights[PANEL_ORDER.indexOf('hr')] += Math.max(0, leftover);

  let top = topPad;
  const panels = PANEL_ORDER.map((id, k) => {
    const box = { id, top, height: heights[k] };
    top += heights[k] + gap;
    return box;
  });
  const last = panels[panels.length - 1];

  return {
    width: w,
    height: h,
    compact,
    padL,
    padR,
    labelH,
    nameW,
    tickW,
    plotX,
    plotW,
    zoneX: plotX + plotW,
    zoneW,
    readoutX: plotX + plotW + zoneW,
    readoutW,
    panels,
    axisTop: last.top + last.height,
    axisH: AXIS_H,
  };
}

export function panelBox(layout: StripLayout, id: PanelId): PanelBox {
  return layout.panels.find((p) => p.id === id) ?? layout.panels[0];
}
