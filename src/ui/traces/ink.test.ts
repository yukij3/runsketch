import { describe, expect, it } from 'vitest';
import { CLIMB_START, syntheticResult, TEST_ZONES } from './__fixtures__/synthetic';
import { buildAxes } from './axes';
import { buildInk, panelYMaps } from './ink';
import { layoutStrip, panelBox } from './layout';
import { makeXScale } from './scale';
import { buildTraceModel } from './series';

/** [x, y] pairs from an M/L path string. */
function coords(d: string): Array<[number, number]> {
  return [...d.matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
}

describe('layoutStrip', () => {
  it('stacks four panels top to bottom with heart rate tallest and cadence compact', () => {
    const l = layoutStrip(900, 280);
    expect(l.panels.map((p) => p.id)).toEqual(['elevation', 'pace', 'hr', 'cadence']);
    for (let k = 1; k < l.panels.length; k++) {
      expect(l.panels[k].top).toBeGreaterThanOrEqual(l.panels[k - 1].top + l.panels[k - 1].height);
    }
    const h = Object.fromEntries(l.panels.map((p) => [p.id, p.height]));
    expect(h.hr).toBeGreaterThan(h.pace);
    expect(h.cadence).toBeLessThan(h.elevation);
    expect(l.axisTop + l.axisH).toBeLessThanOrEqual(l.height);
    expect(l.plotX + l.plotW + l.zoneW + l.readoutW).toBe(900);
  });

  it('drops the name and readout columns on narrow strips', () => {
    const l = layoutStrip(380, 230);
    expect(l.compact).toBe(true);
    expect(l.nameW).toBe(0);
    expect(l.readoutW).toBe(0);
    expect(l.padR).toBe(l.padL);
    expect(l.plotW).toBe(380 - l.plotX - l.zoneW - l.padR);
  });
});

describe('buildInk', () => {
  const result = syntheticResult();
  const model = buildTraceModel(result, 'run', 'metric');
  const layout = layoutStrip(760, 250);
  const scale = makeXScale(result.streams.dist, 'distance', layout.plotW);
  const ink = buildInk(model, scale, layout);

  it('produces every series path without NaN, inside the plot, mostly inside its panel', () => {
    const series = { elevation: ink.eleLine, pace: ink.speedSmooth, hr: ink.hr, cadence: ink.cadence } as const;
    for (const [id, d] of Object.entries(series)) {
      expect(d.length).toBeGreaterThan(0);
      expect(d).not.toContain('NaN');
      const box = panelBox(layout, id as keyof typeof series);
      const pts = coords(d);
      const inside = pts.filter(([, y]) => y >= box.top && y <= box.top + box.height).length;
      for (const [x] of pts) {
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThanOrEqual(layout.plotW + 0.1);
      }
      // Robust domains let outliers (the start-up from resting HR) run off the panel, clipped.
      expect(inside / pts.length, id).toBeGreaterThanOrEqual(id === 'elevation' ? 1 : 0.9);
    }
    for (const d of [ink.eleArea, ink.speedRaw, ink.hrDemand, ink.hrLag]) {
      expect(d.length).toBeGreaterThan(0);
      expect(d).not.toContain('NaN');
    }
  });

  it('decimates to about two vertices per pixel', () => {
    expect(coords(ink.hr).length).toBeLessThanOrEqual(2 * layout.plotW + 4);
  });

  it('breaks the pace line at the stop and marks the stop on the axis', () => {
    expect((ink.speedSmooth.match(/M/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(ink.stops).toHaveLength(1);
    expect(ink.stops[0].seconds).toBe(20);
  });

  it('places the climb band where the climb starts', () => {
    const up = ink.gradeBands.find((b) => b.kind === 'up');
    expect(up).toBeDefined();
    expect(up!.x).toBeCloseTo(scale.px[CLIMB_START], 0);
  });
});

describe('buildAxes', () => {
  const result = syntheticResult();
  const model = buildTraceModel(result, 'run', 'metric');
  const layout = layoutStrip(760, 250);

  it('labels elevation min and max, and bands zones inside the heart-rate panel', () => {
    const scale = makeXScale(result.streams.dist, 'distance', layout.plotW);
    const axes = buildAxes(model, scale, layout, panelYMaps(model, layout), TEST_ZONES);
    expect(axes.y.elevation.map((t) => t.label)).toEqual([
      String(Math.round(model.averages.eleMax)),
      String(Math.round(model.averages.eleMin)),
    ]);
    const hr = panelBox(layout, 'hr');
    expect(axes.zones.length).toBeGreaterThanOrEqual(3);
    for (const z of axes.zones) {
      expect(z.top).toBeGreaterThanOrEqual(hr.top);
      expect(z.top + z.height).toBeLessThanOrEqual(hr.top + hr.height + 0.01);
    }
    expect(axes.x[0].label).toBe('0 km');
    expect(axes.y.pace.every((t) => /^\d+:\d\d$/.test(t.label))).toBe(true);
  });

  it('writes distance ticks with a decimal comma in Russian', () => {
    const scale = makeXScale(result.streams.dist, 'distance', layout.plotW);
    const ru = buildAxes(model, scale, layout, panelYMaps(model, layout), TEST_ZONES, 'ru');
    const en = buildAxes(model, scale, layout, panelYMaps(model, layout), TEST_ZONES);
    expect(ru.x.map((t) => t.label)).toEqual(en.x.map((t) => t.label.replace('.', ',').replace('0 km', '0 км')));
    expect(ru.x[0].label).toBe('0 км');
    expect(ru.x.some((t) => t.label.includes(','))).toBe(true);
  });

  it('formats the time axis as a clock', () => {
    const scale = makeXScale(result.streams.t, 'time', layout.plotW, 10);
    const axes = buildAxes(model, scale, layout, panelYMaps(model, layout), TEST_ZONES);
    expect(axes.x.map((t) => t.label)).toContain('2:00');
  });
});
