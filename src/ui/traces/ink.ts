// Width-dependent geometry of the data ink: decimated paths, grade bands and stop marks, in
// plot-local x (0 = left edge of the plot) and body y. Rebuilt on new result or resize, never on scrub.
import { decimateMinMax } from './decimate';
import { panelBox, type PanelId, type StripLayout } from './layout';
import { areaPath, bandPath, linearY, linePath, type YMap } from './paths';
import type { XScale } from './scale';
import type { TraceModel } from './series';

export interface XSpan {
  x: number;
  w: number;
}

export interface InkGeometry {
  gradeBands: Array<XSpan & { kind: 'up' | 'down' }>;
  eleArea: string;
  eleLine: string;
  speedRaw: string;
  speedSmooth: string;
  hrLag: string;
  hrDemand: string;
  hr: string;
  cadence: string;
  stops: Array<XSpan & { seconds: number }>;
}

export type PanelYMaps = Record<PanelId, YMap>;

export function panelYMaps(model: TraceModel, layout: StripLayout): PanelYMaps {
  const box = (id: PanelId) => panelBox(layout, id);
  const ele = box('elevation');
  const spd = box('pace');
  const hr = box('hr');
  const cad = box('cadence');
  return {
    elevation: linearY(model.eleDomain, ele.top, ele.height),
    pace: linearY(model.speedDomain, spd.top, spd.height, model.kind === 'pace'),
    hr: linearY(model.hrDomain, hr.top, hr.height),
    cadence: linearY(model.cadenceDomain, cad.top, cad.height),
  };
}

function span(scale: XScale, i0: number, i1: number): XSpan {
  const x0 = scale.px[i0];
  const x1 = scale.px[i1];
  return { x: x0, w: Math.max(0, x1 - x0) };
}

export function buildInk(model: TraceModel, scale: XScale, layout: StripLayout): InkGeometry {
  const s = model.streams;
  const px = scale.px;
  const y = panelYMaps(model, layout);
  const eleBox = panelBox(layout, 'elevation');

  const ele = decimateMinMax(px, model.ele);
  const demand = decimateMinMax(px, s.hrDemand);

  const lagParts: string[] = [];
  for (const run of model.lagRuns) {
    const a = decimateMinMax(px, s.hr, run.i0, run.i1 + 1);
    const b = decimateMinMax(px, s.hrDemand, run.i0, run.i1 + 1);
    lagParts.push(bandPath(a, b, y.hr));
  }

  return {
    gradeBands: model.gradeBands.map((band) => ({ kind: band.kind, ...span(scale, band.i0, band.i1) })),
    eleArea: areaPath(ele, y.elevation, eleBox.top + eleBox.height),
    eleLine: linePath(ele, y.elevation),
    speedRaw: linePath(decimateMinMax(px, model.speedRaw), y.pace),
    speedSmooth: linePath(decimateMinMax(px, model.speedSmooth), y.pace),
    hrLag: lagParts.join(''),
    hrDemand: linePath(demand, y.hr),
    hr: linePath(decimateMinMax(px, s.hr), y.hr),
    cadence: linePath(decimateMinMax(px, model.cadence), y.cadence),
    stops: model.stops.map((run) => ({
      ...span(scale, run.i0, run.i1),
      seconds: Math.max(1, s.t[run.i1] - s.t[run.i0] + 1),
    })),
  };
}
