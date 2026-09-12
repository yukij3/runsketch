// Readout values at the playhead (or whole-activity figures when there is none).
import {
  distanceUnit,
  elevationUnit,
  formatDistance,
  formatDuration,
  formatElevation,
  formatGrade,
  formatPace,
  formatSpeed,
  paceUnit,
  speedUnit,
} from '../../lib/format';
import type { ActivityType, Units } from '../../lib/types';
import type { PanelId } from './layout';
import { isFootSport, type TraceModel } from './series';
import { unitText, type TraceStrings } from './strings';

export type ReadoutKey = 'elapsed' | 'distance' | 'speed' | 'hr' | 'grade' | 'cadence' | 'elevation';

export interface ReadoutCell {
  key: ReadoutKey;
  label: string;
  value: string;
  unit: string;
}

export interface PanelReadoutLine {
  value: string;
  unit: string;
  swatch?: 'solid' | 'dashed';
}

export interface PanelReadout {
  lines: PanelReadoutLine[];
  /** "avg" / "ascent" when showing whole-activity figures. */
  caption: string;
}

const DASH = '–';
const round = (v: number) => (Number.isFinite(v) ? String(Math.round(v)) : DASH);

function speedText(model: TraceModel, mps: number): string {
  return model.kind === 'pace' ? formatPace(mps, model.units) : formatSpeed(mps, model.units);
}

function speedUnitText(model: TraceModel, s: TraceStrings): string {
  return unitText(s, model.kind === 'pace' ? paceUnit(model.units) : speedUnit(model.units));
}

/** Clamp a possibly stale playhead to the current result. */
export function clampIndex(model: TraceModel, index: number | null): number | null {
  if (index === null || !Number.isFinite(index) || model.n === 0) return null;
  return Math.min(model.n - 1, Math.max(0, Math.round(index)));
}

export function readoutCells(model: TraceModel, index: number | null, s: TraceStrings): ReadoutCell[] {
  const st = model.streams;
  const u = model.units;
  const pace = model.kind === 'pace';
  const cad = unitText(s, model.cadenceUnit);
  const i = clampIndex(model, index);

  if (i === null) {
    const a = model.averages;
    const range =
      Number.isFinite(a.eleMin) && Number.isFinite(a.eleMax)
        ? `${formatElevation(a.eleMin, u)}–${formatElevation(a.eleMax, u)}`
        : DASH;
    return [
      { key: 'elapsed', label: s.cell.elapsed, value: formatDuration(a.elapsed), unit: '' },
      { key: 'distance', label: s.cell.distance, value: formatDistance(a.distance, u), unit: unitText(s, distanceUnit(u)) },
      { key: 'speed', label: pace ? s.cell.avgPace : s.cell.avgSpeed, value: speedText(model, a.speed), unit: speedUnitText(model, s) },
      { key: 'hr', label: s.cell.avgHr, value: `${round(a.hr)}/${round(a.demand)}`, unit: unitText(s, 'bpm') },
      { key: 'grade', label: s.cell.ascent, value: formatElevation(a.ascent, u), unit: unitText(s, elevationUnit(u)) },
      { key: 'cadence', label: s.cell.avgCadence, value: round(a.cadence), unit: cad },
      { key: 'elevation', label: s.cell.elevationRange, value: range, unit: unitText(s, elevationUnit(u)) },
    ];
  }

  const moving = st.moving[i] !== 0;
  return [
    { key: 'elapsed', label: s.cell.elapsed, value: formatDuration(st.t[i]), unit: '' },
    { key: 'distance', label: s.cell.distance, value: formatDistance(st.dist[i], u), unit: unitText(s, distanceUnit(u)) },
    { key: 'speed', label: pace ? s.cell.pace : s.cell.speed, value: speedText(model, model.smoothSpeed[i]), unit: speedUnitText(model, s) },
    { key: 'hr', label: s.cell.hr, value: `${round(st.hr[i])}/${round(st.hrDemand[i])}`, unit: unitText(s, 'bpm') },
    { key: 'grade', label: s.cell.grade, value: formatGrade(st.grade[i]), unit: '%' },
    { key: 'cadence', label: s.cell.cadence, value: moving ? round(st.cadence[i]) : DASH, unit: cad },
    { key: 'elevation', label: s.cell.elevation, value: formatElevation(st.ele[i], u), unit: unitText(s, elevationUnit(u)) },
  ];
}

export function panelReadouts(model: TraceModel, index: number | null, s: TraceStrings): Record<PanelId, PanelReadout> {
  const st = model.streams;
  const u = model.units;
  const i = clampIndex(model, index);
  const bpm = unitText(s, 'bpm');
  const cad = unitText(s, model.cadenceUnit);
  const eleUnit = unitText(s, elevationUnit(u));
  const speedUnitLabel = speedUnitText(model, s);

  if (i === null) {
    const a = model.averages;
    return {
      elevation: { lines: [{ value: formatElevation(a.ascent, u), unit: eleUnit }], caption: s.ascent },
      pace: { lines: [{ value: speedText(model, a.speed), unit: speedUnitLabel }], caption: s.avg },
      hr: {
        lines: [
          { value: round(a.hr), unit: bpm, swatch: 'solid' },
          { value: round(a.demand), unit: '', swatch: 'dashed' },
        ],
        caption: s.avg,
      },
      cadence: { lines: [{ value: round(a.cadence), unit: cad }], caption: s.avg },
    };
  }
  return {
    elevation: { lines: [{ value: formatElevation(st.ele[i], u), unit: eleUnit }], caption: '' },
    pace: { lines: [{ value: speedText(model, model.smoothSpeed[i]), unit: speedUnitLabel }], caption: '' },
    hr: {
      lines: [
        { value: round(st.hr[i]), unit: bpm, swatch: 'solid' },
        { value: round(st.hrDemand[i]), unit: '', swatch: 'dashed' },
      ],
      caption: '',
    },
    cadence: { lines: [{ value: st.moving[i] !== 0 ? round(st.cadence[i]) : DASH, unit: cad }], caption: '' },
  };
}

/** One sentence for the aria-live region. */
export function liveText(cells: readonly ReadoutCell[]): string {
  return cells.map((c) => `${c.label} ${c.value}${c.unit ? ` ${c.unit}` : ''}`).join(', ');
}

/** Readout row before any result exists: labels stay put, values are dashes. */
export function emptyCells(s: TraceStrings, activity: ActivityType, units: Units): ReadoutCell[] {
  const pace = isFootSport(activity);
  return [
    { key: 'elapsed', label: s.cell.elapsed, value: DASH, unit: '' },
    { key: 'distance', label: s.cell.distance, value: DASH, unit: unitText(s, distanceUnit(units)) },
    { key: 'speed', label: pace ? s.cell.pace : s.cell.speed, value: DASH, unit: unitText(s, pace ? paceUnit(units) : speedUnit(units)) },
    { key: 'hr', label: s.cell.hr, value: DASH, unit: unitText(s, 'bpm') },
    { key: 'grade', label: s.cell.grade, value: DASH, unit: '%' },
    { key: 'cadence', label: s.cell.cadence, value: DASH, unit: unitText(s, pace ? 'spm' : 'rpm') },
    { key: 'elevation', label: s.cell.elevation, value: DASH, unit: unitText(s, elevationUnit(units)) },
  ];
}
