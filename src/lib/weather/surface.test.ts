import { describe, expect, it } from 'vitest';
import type { SurfaceClass } from '../types';
import { constantField, type Ambient, type WeatherField } from './field';
import { WET_SURFACE, createSurfaceState, precomputeSurface, type SurfaceGrid } from './surface';

const T0 = 1_800_000_000;

interface Weather {
  temperatureC: number;
  humidityPct: number;
  /** Wind at 2 m, m/s. */
  wind2: number;
  shortwave: number;
  /** Precipitation rate by seconds from T0, mm/h. */
  rain: (t: number) => number;
}

/** Constant conditions with a scripted precipitation rate and irradiance. */
function scripted(w: Weather): WeatherField {
  const base = constantField({ temperatureC: w.temperatureC, humidityPct: w.humidityPct, windMps: w.wind2 / 0.748, windFromDeg: 0, rainMmH: 0 });
  return {
    ...base,
    at(s: number, t: number, ele: number, out: Ambient) {
      base.at(s, t, ele, out);
      out.precip = w.rain(t - T0);
      out.snow = w.temperatureC <= -1 ? 1 : w.temperatureC >= 3 ? 0 : 0.5;
    },
    sun(_s: number, _t: number, out: Ambient) {
      out.sunElev = 40;
      out.shortwave = w.shortwave;
    },
  };
}

function wetAt(grid: SurfaceGrid, minutes: number) {
  const st = createSurfaceState();
  grid.at(0, T0 + minutes * 60, st);
  return st;
}

const grid = (w: Weather, surface: SurfaceClass = 'paved', hours = 10) => precomputeSurface(scripted(w), [{ d: 0, ele: 100, surface }], T0, T0 + hours * 3600);

describe('water film', () => {
  it('4 mm/h on pavement wets it fully within 10 minutes of the onset', () => {
    const g = grid({ temperatureC: 15, humidityPct: 70, wind2: 2, shortwave: 100, rain: (t) => (t >= 3600 && t < 7200 ? 4 : 0) });
    expect(wetAt(g, 55).wet).toBe(0);
    expect(wetAt(g, 70).wet).toBeGreaterThan(0.99);
    expect(g.active).toBe(true);
  });

  it('after an hour of rain the road dries in about an hour in sun, over several hours overcast, and not on a humid night', () => {
    const rain = (t: number) => (t >= 0 && t < 3600 ? 4 : 0);
    const sunny = grid({ temperatureC: 25, humidityPct: 40, wind2: 2, shortwave: 700, rain });
    const overcast = grid({ temperatureC: 15, humidityPct: 60, wind2: 3, shortwave: 100, rain });
    const night = grid({ temperatureC: 10, humidityPct: 90, wind2: 1, shortwave: 0, rain });
    expect(wetAt(sunny, 60 + 150).wet).toBeLessThan(0.1);
    expect(wetAt(sunny, 60 + 30).wet).toBeGreaterThan(0.5);
    expect(wetAt(overcast, 60 + 150).wet).toBeGreaterThan(0.9);
    expect(wetAt(overcast, 60 + 480).wet).toBeLessThan(0.6);
    expect(wetAt(night, 60 + 480).wet).toBeGreaterThan(0.99);
    // Drying is monotone once the rain has stopped.
    let previous = 1;
    for (let m = 60; m <= 600; m += 30) {
      const w = wetAt(overcast, m).wet;
      expect(w).toBeLessThanOrEqual(previous + 1e-6);
      previous = w;
    }
  });

  it('a trail keeps mud after the film has dried, fading over its soil memory time', () => {
    const rain = (t: number) => (t >= 0 && t < 3600 ? 6 : 0);
    const g = grid({ temperatureC: 25, humidityPct: 40, wind2: 2, shortwave: 700, rain }, 'ground', 30);
    const soon = wetAt(g, 60 + 240);
    const later = wetAt(g, 60 + 24 * 60);
    expect(soon.wet).toBeLessThan(0.15);
    expect(soon.wetEff).toBeGreaterThan(0.4);
    // Soil memory M shows as M/(M + 5 mm) and decays with the class's drying time.
    const memory = (5 * soon.wetEff) / (1 - soon.wetEff);
    const expected = memory * Math.exp(-20 / WET_SURFACE.ground.soilTauH);
    expect(later.wetEff).toBeCloseTo(expected / (expected + 5), 1);
    expect(later.wetEff).toBeGreaterThan(0.05);
  });

  it('stays dry and inactive without precipitation', () => {
    const g = grid({ temperatureC: 20, humidityPct: 50, wind2: 2, shortwave: 400, rain: () => 0 });
    expect(wetAt(g, 120)).toEqual({ wet: 0, wetEff: 0, snowCm: 0, ice: 0 });
    expect(g.active).toBe(false);
  });
});

describe('snow and ice', () => {
  it('snow accumulates only below the rain–snow threshold and melts by degree hours', () => {
    const snowing = grid({ temperatureC: -4, humidityPct: 90, wind2: 2, shortwave: 0, rain: (t) => (t >= 0 && t < 7200 ? 2 : 0) }, 'ground');
    const raining = grid({ temperatureC: 6, humidityPct: 90, wind2: 2, shortwave: 0, rain: (t) => (t >= 0 && t < 7200 ? 2 : 0) }, 'ground');
    const depth = wetAt(snowing, 125).snowCm;
    // 4 mm of water at the fresh density of −4 °C (≈ 75 kg/m³) is about 5 cm.
    expect(depth).toBeGreaterThan(4);
    expect(depth).toBeLessThan(6.5);
    expect(wetAt(raining, 125).snowCm).toBe(0);
    const field = scripted({ temperatureC: -4, humidityPct: 90, wind2: 2, shortwave: 0, rain: (t) => (t >= 0 && t < 7200 ? 2 : 0) });
    const thaw: WeatherField = {
      ...field,
      at(s, t, ele, out) {
        field.at(s, t, ele, out);
        if (t - T0 >= 3 * 3600) out.temp = 8;
      },
    };
    const melting = precomputeSurface(thaw, [{ d: 0, ele: 100, surface: 'ground' }], T0, T0 + 12 * 3600);
    expect(wetAt(melting, 170).snowCm).toBeGreaterThan(4);
    expect(wetAt(melting, 11 * 60).snowCm).toBeLessThan(wetAt(melting, 170).snowCm);
  });

  it('a wet film freezes gradually between +1 and −2 °C', () => {
    const film = (temperatureC: number) => grid({ temperatureC, humidityPct: 95, wind2: 1, shortwave: 0, rain: (t) => (t >= 0 && t < 1800 ? 1 : 0) });
    expect(wetAt(film(1), 60).ice).toBe(0);
    const zero = wetAt(film(0), 60).ice;
    expect(zero).toBeGreaterThan(0.1);
    expect(zero).toBeLessThan(0.5);
    // Colder still and the precipitation itself turns to snow, so the film that froze is the one already there.
    const half = wetAt(film(-0.5), 60).ice;
    expect(half).toBeGreaterThan(zero);
    expect(half).toBeLessThanOrEqual(1);
  });
});
