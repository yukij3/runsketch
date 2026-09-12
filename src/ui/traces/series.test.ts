import { describe, expect, it } from 'vitest';
import { CLIMB_END, CLIMB_START, syntheticResult } from './__fixtures__/synthetic';
import { panelYMaps } from './ink';
import { layoutStrip } from './layout';
import { clampIndex, emptyCells, liveText, panelReadouts, readoutCells } from './readout';
import { buildTraceModel, gradeBands, lagRuns, maskedMean, quantile, runsWhere, startTransientEnd } from './series';
import { stringsFor } from './strings';

const fill = (count: number, v: number) => Array.from({ length: count }, () => v);

describe('maskedMean', () => {
  it('averages only unmasked, finite samples in a centred window', () => {
    const out = maskedMean([1, 2, 3, 100, 5], [1, 1, 1, 0, 1], 3);
    expect(out[0]).toBeCloseTo(1.5);
    expect(out[3]).toBeCloseTo(4);
    expect(out[4]).toBeCloseTo(5);
  });

  it('is NaN where no sample qualifies', () => {
    expect(Number.isNaN(maskedMean([1, 2, 3], [0, 0, 0], 3)[1])).toBe(true);
  });
});

describe('runs', () => {
  it('merges short gaps and drops short runs', () => {
    const on = [0, 1, 1, 0, 1, 1, 1, 0, 0, 0, 1];
    expect(runsWhere(on.length, (i) => on[i] === 1, 1, 1)).toEqual([
      { i0: 1, i1: 6 },
      { i0: 10, i1: 10 },
    ]);
    expect(runsWhere(on.length, (i) => on[i] === 1, 2, 1)).toEqual([{ i0: 1, i1: 6 }]);
  });

  it('bands climbs and descents with hysteresis and a minimum length', () => {
    const g = [...fill(10, 0), ...fill(30, 0.05), ...fill(5, 0.02), ...fill(10, 0), ...fill(25, -0.04), ...fill(10, 0.04)];
    expect(gradeBands(g)).toEqual([
      { kind: 'up', i0: 10, i1: 44 },
      { kind: 'down', i0: 55, i1: 79 },
    ]);
  });

  it('finds the heart-rate lag after the climb starts and after the crest', () => {
    const r = syntheticResult();
    const runs = lagRuns(r.streams.hr, r.streams.hrDemand);
    const afterClimb = runs.find((run) => run.i0 >= CLIMB_START - 10 && run.i0 <= CLIMB_START + 15);
    const afterCrest = runs.find((run) => run.i0 >= CLIMB_END - 10 && run.i0 <= CLIMB_END + 15);
    expect(afterClimb).toBeDefined();
    expect(afterClimb!.i1).toBeGreaterThan(CLIMB_START + 45);
    expect(afterCrest).toBeDefined();
  });

  it('leaves the start-up from resting HR out of the heart-rate domain', () => {
    const r = syntheticResult();
    const model = buildTraceModel(r, 'run', 'metric');
    expect(startTransientEnd(model.lagRuns, model.n)).toBeGreaterThan(30);
    expect(model.hrDomain.lo).toBeGreaterThan(r.streams.hr[0]);
    expect(startTransientEnd([{ i0: 50, i1: 90 }], 600)).toBe(0);
  });

  it('interpolates quantiles', () => {
    expect(quantile([0, 10, 20, 30], 0.5)).toBeCloseTo(15);
    expect(Number.isNaN(quantile([], 0.5))).toBe(true);
  });
});

describe('buildTraceModel', () => {
  const result = syntheticResult();
  const run = buildTraceModel(result, 'run', 'metric');

  it('plots pace for foot sports with gaps while stopped', () => {
    expect(run.kind).toBe('pace');
    expect(run.cadenceUnit).toBe('spm');
    expect(run.stops).toEqual([{ i0: 520, i1: 539 }]);
    expect(Number.isNaN(run.speedRaw[530])).toBe(true);
    expect(Number.isNaN(run.speedSmooth[530])).toBe(true);
    expect(Number.isNaN(run.cadence[530])).toBe(true);
    expect(run.speedSmooth[100]).toBeCloseTo(1000 / 3.2, -1);
  });

  it('covers the climb and descent paces and draws faster pace higher', () => {
    expect(run.speedDomain.lo).toBeLessThan(1000 / 3.6);
    expect(run.speedDomain.hi).toBeGreaterThan(1000 / 2.4);
    const y = panelYMaps(run, layoutStrip(760, 250));
    expect(y.pace(250)).toBeLessThan(y.pace(400));
  });

  it('plots speed for rides, upright, zero while stopped', () => {
    const ride = buildTraceModel(result, 'ride', 'metric');
    expect(ride.kind).toBe('speed');
    expect(ride.cadenceUnit).toBe('rpm');
    expect(ride.smoothSpeed[530]).toBe(0);
    expect(ride.speedDomain.lo).toBe(0);
    const y = panelYMaps(ride, layoutStrip(760, 250));
    expect(y.pace(30)).toBeLessThan(y.pace(10));
  });

  it('bands the climb and keeps a flat route visually flat', () => {
    expect(run.gradeBands.some((b) => b.kind === 'up' && Math.abs(b.i0 - CLIMB_START) <= 1)).toBe(true);
    const flat = buildTraceModel(syntheticResult({ flat: true }), 'run', 'metric');
    expect(flat.eleDomain.hi - flat.eleDomain.lo).toBeGreaterThanOrEqual(20);
  });

  it('converts to imperial display units', () => {
    const imp = buildTraceModel(result, 'run', 'imperial');
    expect(imp.ele[0]).toBeCloseTo(100 * 3.280839895, 3);
    expect(imp.speedSmooth[100]).toBeCloseTo(1609.344 / 3.2, -1);
  });

  it('computes whole-activity figures', () => {
    const n = result.streams.t.length;
    expect(run.averages.distance).toBe(result.streams.dist[n - 1]);
    expect(run.averages.elapsed).toBe(599);
    expect(run.averages.ascent).toBeGreaterThan(30);
    expect(run.averages.eleMax).toBeGreaterThan(run.averages.eleMin);
  });
});

describe('readouts', () => {
  const result = syntheticResult();
  const model = buildTraceModel(result, 'run', 'metric');
  const en = stringsFor('en');

  it('reads values at the playhead', () => {
    const cells = readoutCells(model, 100, en);
    const byKey = Object.fromEntries(cells.map((c) => [c.key, c]));
    expect(byKey.elapsed.value).toBe('1:40');
    expect(byKey.hr.value).toBe(`${Math.round(result.streams.hr[100])}/146`);
    expect(byKey.grade.value).toBe('0.0');
    expect(byKey.speed.unit).toBe('/km');
    expect(byKey.cadence.value).toBe('172');
    expect(readoutCells(model, 300, en).find((c) => c.key === 'grade')!.value).toBe('8.0');
  });

  it('shows whole-activity figures without a playhead', () => {
    const cells = readoutCells(model, null, en);
    expect(cells.map((c) => c.label)).toEqual(['Elapsed', 'Distance', 'Avg pace', 'Avg HR / demand', 'Recorded ascent', 'Avg cadence', 'Recorded elevation']);
    expect(cells[0].value).toBe('9:59');
    expect(panelReadouts(model, null, en).hr.caption).toBe('avg');
  });

  it('dashes cadence while stopped and clamps stale indices', () => {
    expect(readoutCells(model, 530, en).find((c) => c.key === 'cadence')!.value).toBe('–');
    expect(clampIndex(model, 10_000)).toBe(599);
    expect(clampIndex(model, null)).toBeNull();
  });

  it('translates labels and units to Russian', () => {
    const ru = stringsFor('ru');
    const cells = readoutCells(model, 100, ru);
    expect(cells.find((c) => c.key === 'distance')!.unit).toBe('км');
    expect(cells.find((c) => c.key === 'speed')!.unit).toBe('/км');
    expect(cells.find((c) => c.key === 'hr')!.label).toBe('Пульс / требуемый');
    expect(emptyCells(ru, 'ride', 'imperial').find((c) => c.key === 'speed')!.unit).toBe('миль/ч');
  });

  it('writes decimal commas in Russian readouts', () => {
    const ru = stringsFor('ru');
    expect(readoutCells(model, 100, ru).find((c) => c.key === 'distance')!.value).toMatch(/^0,\d\d$/);
    expect(readoutCells(model, 300, ru).find((c) => c.key === 'grade')!.value).toBe('8,0');
    const ride = buildTraceModel(result, 'ride', 'metric');
    expect(readoutCells(ride, null, ru).find((c) => c.key === 'speed')!.value).toMatch(/^\d+,\d$/);
    expect(readoutCells(ride, null, en).find((c) => c.key === 'speed')!.value).toMatch(/^\d+\.\d$/);
  });

  it('writes one sentence for the live region', () => {
    expect(liveText(readoutCells(model, 100, en))).toMatch(/^Elapsed 1:40, Distance 0\.\d\d km, Pace \d:\d\d \/km, HR \/ demand/);
  });
});
