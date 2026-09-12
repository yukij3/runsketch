// Tick positions and labels: shared x axis, y ticks per panel, HR zone bands.
import type { HrZone } from '../../lib/sim';
import { distanceUnit, formatDecimal, formatDuration, FEET_PER_METER, METERS_PER_MILE, type NumberLang } from '../../lib/format';
import type { Units } from '../../lib/types';
import type { PanelYMaps } from './ink';
import { panelBox, type PanelId, type StripLayout } from './layout';
import { toPx, type XScale } from './scale';
import { stringsFor, unitText } from './strings';
import type { TraceModel } from './series';
import { clockTicks, decimalsFor, linearTicks, niceStep, ticksWithStep } from './ticks';

export interface Tick {
  pos: number;
  label: string;
}

export interface ZoneBand {
  id: HrZone['id'];
  top: number;
  height: number;
}

export interface Axes {
  x: Tick[];
  y: Record<PanelId, Tick[]>;
  zones: ZoneBand[];
}

const X_TICK_PX = 80;
const Y_TICK_PX = 24;
const LABEL_HALF = 5;
const MIN_TICK_GAP_PX = 14;
/** Zone-edge labels closer than this (px) would touch; the later one is skipped. */
const ZONE_EDGE_GAP_PX = 11;

/** m:ss for pace labels (h:mm:ss beyond an hour). */
export function clockLabel(seconds: number): string {
  return formatDuration(seconds);
}

export function xTicks(scale: XScale, units: Units, lang: NumberLang = 'en'): Tick[] {
  const maxTicks = Math.max(1, Math.floor(scale.width / X_TICK_PX));
  if (scale.axis === 'time') {
    return clockTicks(0, scale.max, maxTicks).map((v) => ({ pos: toPx(scale, v), label: formatDuration(v) }));
  }
  const perUnit = units === 'metric' ? 1000 : METERS_PER_MILE;
  const maxUnits = scale.max / perUnit;
  const step = niceStep(maxUnits, maxTicks);
  const decimals = decimalsFor(step);
  const unit = unitText(stringsFor(lang), distanceUnit(units));
  return ticksWithStep(0, maxUnits, step).map((v) => ({
    pos: toPx(scale, v * perUnit),
    label: v === 0 ? `0 ${unit}` : formatDecimal(v, decimals, lang),
  }));
}

function clampLabel(pos: number, top: number, height: number): number {
  return Math.min(top + height - LABEL_HALF + 1, Math.max(top + LABEL_HALF, pos));
}

function linearYTicks(
  lo: number,
  hi: number,
  y: (v: number) => number,
  top: number,
  height: number,
  clock: boolean,
  lang: NumberLang,
): Tick[] {
  const pick = (maxTicks: number) => (clock ? clockTicks(lo, hi, maxTicks) : linearTicks(lo, hi, maxTicks));
  const base = Math.max(1, Math.floor(height / Y_TICK_PX));
  let values = pick(base);
  // One label cannot convey a scale: take a finer step when two labels still fit apart.
  for (let m = base + 1; values.length < 2 && m <= base + 6; m++) {
    const next = pick(m);
    if (next.length < 2) continue;
    if (Math.abs(y(next[1]) - y(next[0])) >= MIN_TICK_GAP_PX) values = next;
    break;
  }
  const step = values.length > 1 ? values[1] - values[0] : 1;
  const decimals = clock ? 0 : decimalsFor(step);
  return values
    .map((v) => ({ pos: y(v), label: clock ? clockLabel(v) : formatDecimal(v, decimals, lang) }))
    .filter((t) => t.pos >= top - 0.5 && t.pos <= top + height + 0.5)
    .map((t) => ({ ...t, pos: clampLabel(t.pos, top, height) }));
}

/**
 * Heart-rate ticks at the zone edges, so every band reads with its bpm limits. Falls back to plain
 * linear ticks when fewer than two edges fit the visible domain.
 */
export function zoneEdgeTicks(
  zones: readonly HrZone[],
  lo: number,
  hi: number,
  y: (v: number) => number,
  top: number,
  height: number,
  lang: NumberLang,
): Tick[] | null {
  const edges = [...new Set(zones.flatMap((z) => [z.min, z.max]))].filter((v) => v > lo && v < hi).sort((a, b) => a - b);
  const ticks: Tick[] = [];
  let lastPos = Infinity;
  for (const v of edges) {
    const pos = y(v);
    if (Math.abs(lastPos - pos) < ZONE_EDGE_GAP_PX) continue;
    ticks.push({ pos: clampLabel(pos, top, height), label: formatDecimal(v, 0, lang) });
    lastPos = pos;
  }
  return ticks.length >= 2 ? ticks : null;
}

export function buildAxes(
  model: TraceModel,
  scale: XScale,
  layout: StripLayout,
  y: PanelYMaps,
  zones: readonly HrZone[],
  lang: NumberLang = 'en',
): Axes {
  const eleBox = panelBox(layout, 'elevation');
  const eleFactor = model.units === 'metric' ? 1 : FEET_PER_METER;
  const eleTicks: Tick[] = [];
  const { eleMin, eleMax } = model.averages;
  if (Number.isFinite(eleMin) && Number.isFinite(eleMax)) {
    const yMax = y.elevation(eleMax * eleFactor);
    const yMin = y.elevation(eleMin * eleFactor);
    eleTicks.push({ pos: clampLabel(yMax, eleBox.top, eleBox.height), label: String(Math.round(eleMax * eleFactor)) });
    // Min and max labels would collide on a flat route; the max alone then says it.
    if (yMin - yMax >= 2 * LABEL_HALF + 2) {
      eleTicks.push({ pos: clampLabel(yMin, eleBox.top, eleBox.height), label: String(Math.round(eleMin * eleFactor)) });
    }
  }

  const spd = panelBox(layout, 'pace');
  const hr = panelBox(layout, 'hr');
  const cad = panelBox(layout, 'cadence');

  const zoneBands: ZoneBand[] = [];
  for (const zone of zones) {
    const lo = Math.max(zone.min, model.hrDomain.lo);
    const hi = Math.min(zone.max, model.hrDomain.hi);
    if (!(hi > lo)) continue;
    const top = Math.max(hr.top, y.hr(hi));
    const bottom = Math.min(hr.top + hr.height, y.hr(lo));
    if (bottom - top >= 1) zoneBands.push({ id: zone.id, top, height: bottom - top });
  }

  return {
    x: xTicks(scale, model.units, lang),
    y: {
      elevation: eleTicks,
      pace: linearYTicks(model.speedDomain.lo, model.speedDomain.hi, y.pace, spd.top, spd.height, model.kind === 'pace', lang),
      hr:
        zoneEdgeTicks(zones, model.hrDomain.lo, model.hrDomain.hi, y.hr, hr.top, hr.height, lang) ??
        linearYTicks(model.hrDomain.lo, model.hrDomain.hi, y.hr, hr.top, hr.height, false, lang),
      cadence: linearYTicks(model.cadenceDomain.lo, model.cadenceDomain.hi, y.cadence, cad.top, cad.height, false, lang),
    },
    zones: zoneBands,
  };
}
