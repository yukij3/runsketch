// Anchors for the heat balance, the clothing choice and the thermal speed factor, against measured studies.
import { describe, expect, it } from 'vitest';
import type { ActivityType } from '../types';
import { VO2_REST } from '../sim/models';
import { dewPointFromHumidity } from './physics';
import {
  BodyHeat,
  bodyFatPct,
  chooseClothing,
  createBodyInput,
  createThermalPace,
  drinkShare,
  heatHeartRateShare,
  resultantInsulation,
  shiverCapacity,
  thermalPace,
  type Clothing,
  type ThermalBody,
} from './thermal';

const build = { weightKg: 70, heightCm: 175, age: 35, sex: 'male' as const };

const makeBody = (sport: ActivityType, clothing: Clothing, vo2max = 50): ThermalBody => ({
  ...build,
  bodyFatPct: bodyFatPct(build),
  sport,
  clothing,
  drink: drinkShare(sport),
  shiverMax: shiverCapacity(build, vo2max),
});

interface Steady {
  seconds: number;
  sport: ActivityType;
  clo: number;
  shell?: boolean;
  /** Net O2 uptake of the motion, ml/kg/min. */
  vo2Net: number;
  speed: number;
  /** Air speed past the athlete, m/s. */
  air: number;
  temp: number;
  rh: number;
  radiant?: number;
  rain?: number;
  externalW?: number;
}

/** Steady exercise in constant air, second by second. */
function steady(o: Steady) {
  const body = new BodyHeat(makeBody(o.sport, { clo: o.clo, shell: o.shell ?? false }));
  const x = createBodyInput(o.temp, dewPointFromHumidity(o.temp, o.rh));
  x.vo2Net = o.vo2Net;
  x.externalW = o.externalW ?? 0;
  x.speed = o.speed;
  x.airAlong = o.air;
  x.radiant = o.radiant ?? o.temp;
  x.rain = o.rain ?? 0;
  const core = new Float64Array(o.seconds);
  const skin = new Float64Array(o.seconds);
  const lossG = new Float64Array(o.seconds);
  const shiverVo2 = new Float64Array(o.seconds);
  for (let i = 0; i < o.seconds; i++) {
    body.step(x);
    core[i] = body.core;
    skin[i] = body.skin;
    lossG[i] = body.lossG;
    shiverVo2[i] = body.shiverVo2;
  }
  return { body, core, skin, lossG, shiverVo2 };
}

/** Running at v m/s: net O2 cost 3.6 J/kg/m at 20.9 J/ml. */
const runVo2 = (v: number) => (3.6 * v * 60) / 20.9;
/** Gross sweat and breath water, litres per hour, from the net loss over the first hour (runners replace 30 %). */
const litresPerHour = (lossG: Float64Array) => lossG[3599] / 1000 / 0.7;
/** Heat production against the same exercise without shivering. */
const heatProduction = (r: { shiverVo2: Float64Array }, vo2Net: number, s: number) => (VO2_REST + vo2Net + r.shiverVo2[s]) / (VO2_REST + vo2Net);

describe('heat balance anchors', () => {
  it('a marathon pace at 15 °C plateaus under 38.6 °C core (Noakes et al. 1991: 38.9 ± 0.6 °C at the finish)', () => {
    const r = steady({ seconds: 3 * 3600, sport: 'run', clo: 0.3, vo2Net: runVo2(3.35), speed: 3.35, air: 3.35, temp: 15, rh: 60 });
    expect(r.core[3599]).toBeGreaterThan(37.5);
    expect(r.core[3599]).toBeLessThan(38.6);
    expect(Math.abs(r.core[3 * 3600 - 1] - r.core[3599])).toBeLessThan(0.2);
    // Sweat over the first hour, gross: runners lose roughly 0.5–1.5 L/h in cool air (Sawka et al. 2007).
    expect(litresPerHour(r.lossG)).toBeGreaterThan(0.4);
    expect(litresPerHour(r.lossG)).toBeLessThan(1.2);
  });

  it('an hour at 30 °C in shade runs hotter and sweats more, and sun adds to both (Byrne et al. 2006; Barnes et al. 2019)', () => {
    const at = (temp: number, rh: number, radiant?: number) => steady({ seconds: 3600, sport: 'run', clo: 0.3, vo2Net: runVo2(3), speed: 3, air: 3, temp, rh, radiant });
    const cool = at(15, 60);
    const shade = at(30, 50);
    const sun = at(30, 50, 55);
    expect(shade.core[3599]).toBeGreaterThan(38.2);
    expect(shade.core[3599]).toBeLessThan(39.5);
    expect(shade.core[3599]).toBeGreaterThan(cool.core[3599] + 0.3);
    expect(litresPerHour(shade.lossG)).toBeGreaterThan(0.6);
    expect(litresPerHour(shade.lossG)).toBeLessThan(1.8);
    expect(litresPerHour(shade.lossG)).toBeGreaterThan(litresPerHour(cool.lossG) + 0.2);
    expect(sun.core[3599]).toBeGreaterThan(shade.core[3599]);
    expect(sun.skin[3599]).toBeGreaterThan(shade.skin[3599]);
  });

  it('cycling in 35 °C adds heart rate over 45 min against neutral air (Wingo et al. 2005: +12 % from 15 to 45 min)', () => {
    const ride = (temp: number, rh: number) => steady({ seconds: 2700, sport: 'ride', clo: 0.4, vo2Net: 23.5, speed: 0, air: 1, temp, rh, externalW: 150 });
    const hot = ride(35, 40);
    const neutral = ride(15, 60);
    const share = (s: number) => heatHeartRateShare(hot.core[s], neutral.core[s], hot.lossG[s], neutral.lossG[s], build.weightKg);
    expect(share(2699)).toBeGreaterThan(0.015);
    expect(share(2699)).toBeLessThan(0.14);
    expect(share(2699)).toBeGreaterThan(share(900));
    expect(hot.core[2699]).toBeGreaterThan(hot.core[900]);
  });

  it('the same air as the reference adds no heart rate and no slowing', () => {
    const o: Steady = { seconds: 3600, sport: 'run', clo: 0.3, vo2Net: runVo2(3), speed: 3, air: 3, temp: 15, rh: 60 };
    const a = steady(o);
    const b = steady(o);
    expect(heatHeartRateShare(a.core[3599], b.core[3599], a.lossG[3599], b.lossG[3599], build.weightKg)).toBe(0);
    const out = createThermalPace();
    expect(thermalPace(a.body, b.body, 'recreational', out)).toBe(1);
    expect(out.heat).toBe(1);
    expect(out.cold).toBe(1);
  });
});

describe('cold and wet anchors', () => {
  /** Walking in 5 °C, lightly dressed, six hours (Thompson & Hayward 1996: wind and rain, heat production up ≈ 40 %). */
  const walk = (o: { air: number; rain: number; rh: number }) =>
    steady({ seconds: 6 * 3600, sport: 'hike', clo: 0.9, vo2Net: 12, speed: 1.1, temp: 5, ...o });
  const wetWind = walk({ air: 6, rain: 8, rh: 97 });
  const dryCalm = walk({ air: 1.1, rain: 0, rh: 75 });

  it('wind and rain strip the skin of heat and drive shivering, while dry calm air does not', () => {
    const hour = 6 * 3600 - 1;
    // Mean skin falls far in soaked clothing and wind, but stays well above the air.
    expect(wetWind.skin[hour]).toBeLessThan(dryCalm.skin[hour] - 8);
    expect(wetWind.skin[hour]).toBeGreaterThan(12);
    expect(dryCalm.skin[hour]).toBeGreaterThan(29);
    // Shivering raises heat production; dry calm air needs none.
    expect(heatProduction(wetWind, 12, hour)).toBeGreaterThan(1.2);
    expect(heatProduction(dryCalm, 12, hour)).toBeLessThan(1.05);
    expect(wetWind.body.wetness).toBeGreaterThan(0.9);
    expect(dryCalm.body.wetness).toBeLessThan(1e-3);
  });

  it('core temperature holds near normal while the athlete keeps walking, and never runs away', () => {
    const hour = 6 * 3600 - 1;
    for (const r of [wetWind, dryCalm]) {
      expect(r.core[hour]).toBeGreaterThan(36);
      expect(r.core[hour]).toBeLessThan(37.8);
    }
    expect(wetWind.core[hour]).toBeLessThan(dryCalm.core[hour] + 0.1);
  });

  it('cold, wet clothing slows the pace through cold muscle, and dry calm air does not', () => {
    const neutral = steady({ seconds: 6 * 3600, sport: 'hike', clo: 0.9, vo2Net: 12, speed: 1.1, air: 1.1, temp: 15, rh: 60 });
    const out = createThermalPace();
    const wet = thermalPace(wetWind.body, neutral.body, 'recreational', out);
    expect(wet).toBeLessThan(0.95);
    expect(wet).toBeGreaterThan(0.6);
    expect(out.cold).toBeLessThan(1);
    expect(out.heat).toBe(1);
    const dry = thermalPace(dryCalm.body, neutral.body, 'recreational', createThermalPace());
    expect(dry).toBeGreaterThan(wet);
  });

  it('a colder, wetter, windier day slows the pace further, so the effort scale stays monotone', () => {
    const neutral = steady({ seconds: 3 * 3600, sport: 'hike', clo: 0.9, vo2Net: 12, speed: 1.1, air: 1.1, temp: 15, rh: 60 });
    const factor = (temp: number) => {
      const r = steady({ seconds: 3 * 3600, sport: 'hike', clo: 0.9, vo2Net: 12, speed: 1.1, air: 6, temp, rh: 97, rain: 8 });
      return thermalPace(r.body, neutral.body, 'recreational', createThermalPace());
    };
    const factors = [10, 5, 0, -5].map(factor);
    for (let i = 1; i < factors.length; i++) expect(factors[i]).toBeLessThan(factors[i - 1]);
    expect(factors[factors.length - 1]).toBeGreaterThan(0.5);
  });
});

describe('clothing', () => {
  it('follows the activity and the start temperature, and a mountain day starts in mountain clothing', () => {
    expect(chooseClothing('run', 600, 15, 3, 3, false).clo).toBe(0.3);
    expect(chooseClothing('run', 600, -10, 3, 3, false).clo).toBeGreaterThan(0.3);
    expect(chooseClothing('hike', 300, 15, 3, 1.2, false).clo).toBe(0.5);
    expect(chooseClothing('hike', 300, -20, 3, 1.2, false).clo).toBeGreaterThan(2);
    // An equipped climber is dressed for the mountain from the first step, shell included.
    const alpine = chooseClothing('alpine', 250, -15, 8, 0.5, false);
    expect(alpine.clo).toBeGreaterThanOrEqual(1.2);
    expect(alpine.shell).toBe(true);
    // Rain puts a shell on a hiker.
    expect(chooseClothing('hike', 300, 8, 4, 1.2, true).shell).toBe(true);
  });

  it('keeps a normally equipped climber out of hypothermia through three hours at −15 °C in wind', () => {
    const clothing = chooseClothing('alpine', 250, -15, 8, 0.5, false);
    const r = steady({ seconds: 3 * 3600, sport: 'alpine', clo: clothing.clo, shell: clothing.shell, vo2Net: 20, speed: 0.5, air: 4.5, temp: -15, rh: 60 });
    const end = 3 * 3600 - 1;
    expect(r.core[end]).toBeGreaterThan(36.6);
    expect(r.shiverVo2[end]).toBe(0);
  });

  it('insulation falls with wind and with walking, and a shell keeps part of the wind out (ISO 9920)', () => {
    const plain: Clothing = { clo: 1, shell: false };
    const shelled: Clothing = { clo: 1, shell: true };
    expect(resultantInsulation(plain, 5, 0)).toBeLessThan(resultantInsulation(plain, 0.15, 0));
    expect(resultantInsulation(plain, 0.15, 1.2)).toBeLessThan(resultantInsulation(plain, 0.15, 0));
    expect(resultantInsulation(shelled, 5, 0)).toBeGreaterThan(resultantInsulation(plain, 5, 0));
    // Beyond the standard's range the correction is held, not extrapolated.
    expect(resultantInsulation(plain, 12, 3)).toBe(resultantInsulation(plain, 3.5, 1.2));
  });
});
