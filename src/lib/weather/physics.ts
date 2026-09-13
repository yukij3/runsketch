// Near-surface meteorology used by the weather field, the surface state and the heat balance: humidity, air density,
// pressure with height, wind at body height, wet-bulb and globe temperature, wind chill, precipitation phase, snow
// density and evaporation from a wet surface. Pure functions, SI units unless named otherwise.

export const R_DRY = 287.05;
export const R_VAPOUR = 461.5;
export const GRAVITY = 9.80665;
export const KELVIN = 273.15;

const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);

/** Saturation vapour pressure over water, hPa (Magnus form with the WMO-No. 8 2018 coefficients). */
export function vapourPressureHpa(tC: number): number {
  return 6.112 * Math.exp((17.62 * tC) / (243.12 + tC));
}

/** Relative humidity, %, from air and dew-point temperature (1–100). */
export function relativeHumidity(tC: number, dewC: number): number {
  return clamp((100 * vapourPressureHpa(Math.min(dewC, tC))) / vapourPressureHpa(tC), 1, 100);
}

/** Dew point, °C, from air temperature and relative humidity (inverse Magnus). */
export function dewPointFromHumidity(tC: number, rhPct: number): number {
  const g = Math.log(clamp(rhPct, 1, 100) / 100) + (17.62 * tC) / (243.12 + tC);
  return (243.12 * g) / (17.62 - g);
}

/** Moist air density, kg/m³: dry air and water vapour partial pressures over their gas constants. */
export function airDensityMoist(pressureHpa: number, tC: number, dewC: number): number {
  const e = vapourPressureHpa(Math.min(dewC, tC));
  const tK = tC + KELVIN;
  return ((pressureHpa - e) * 100) / (R_DRY * tK) + (e * 100) / (R_VAPOUR * tK);
}

/** Scale height of the atmosphere at air temperature tC, m (≈ 8.0 km at 0 °C, 8.3 km at 10 °C). */
export function scaleHeight(tC: number): number {
  return (R_DRY * (tC + KELVIN)) / GRAVITY;
}

/** Pressure `dz` metres above a level where it is `pressureHpa`, hypsometric at mean temperature tC. */
export function pressureAtHeight(pressureHpa: number, dz: number, tC: number): number {
  return pressureHpa * Math.exp(-dz / scaleHeight(tC));
}

/** ISA surface pressure at elevation, hPa. */
export function standardPressure(elevationM: number): number {
  return 1013.25 * Math.pow(1 - 2.25577e-5 * clamp(elevationM, -400, 8000), 5.25588);
}

/** Ratio of wind speed at height z to the 10 m wind over roughness z0 (neutral log profile; WMO/TD-1555, EN 1991-1-4). */
export function windHeightFactor(z: number, z0: number): number {
  return Math.log(z / z0) / Math.log(10 / z0);
}

/**
 * Wind at the athlete over the 10 m value: 1.5 m over roughly open terrain (z0 = 0.1 m, WMO roughness classes) ≈ 0.59.
 * Forest, streets and ridges are not told apart yet (HEURISTIC single exposure).
 */
export const BODY_WIND_FACTOR = windHeightFactor(1.5, 0.1);

/** FAO-56 Eq. 47: wind at 2 m from 10 m (0.748). */
export const WIND_2M_FACTOR = 4.87 / Math.log(67.8 * 10 - 5.42);

/**
 * Wet-bulb temperature, °C, from air temperature and relative humidity at sea-level pressure (Stull 2011; within
 * −1…+0.65 °C for 5–99 % and −20…50 °C).
 */
export function wetBulb(tC: number, rhPct: number): number {
  const rh = clamp(rhPct, 5, 99);
  return (
    tC * Math.atan(0.151977 * Math.sqrt(rh + 8.313659)) +
    Math.atan(tC + rh) -
    Math.atan(rh - 1.676331) +
    0.00391838 * Math.pow(rh, 1.5) * Math.atan(0.023101 * rh) -
    4.686035
  );
}

/**
 * Mean radiant temperature outdoors, °C, from global irradiance and sun elevation (SolarCal, Arens et al. 2015, with
 * sky view 1, ground reflectance 0.2, projected area factor 0.25; direct share of the global irradiance from the sun
 * elevation, HEURISTIC split).
 */
export function meanRadiantTemperature(tC: number, shortwave: number, sunElevDeg: number): number {
  if (!(shortwave > 0)) return tC;
  const sinH = Math.max(0.05, Math.sin((clamp(sunElevDeg, 0, 90) * Math.PI) / 180));
  const direct = sunElevDeg > 0 ? 0.7 * shortwave : 0;
  const diffuse = shortwave - direct;
  const directNormal = direct / sinH;
  const erf = (0.7 / 0.95) * 0.725 * (0.5 * (diffuse + 0.2 * shortwave) + 0.25 * directNormal);
  return tC + erf / (0.725 * 4.7);
}

/**
 * Black-globe temperature, °C, for a 150 mm globe in air tC with mean radiant temperature mrtC and wind v m/s: solves
 * Tg⁴ + d·Tg = Tmrt⁴ + d·Ta in kelvin with d = 1.1e8·v^0.6/(0.95·0.15^0.4) (Guo et al. 2018, as in thermofeel).
 */
export function globeTemperature(tC: number, mrtC: number, windMps: number): number {
  const d = (1.1e8 * Math.pow(Math.max(0.1, windMps), 0.6)) / (0.95 * Math.pow(0.15, 0.4));
  const ta = tC + KELVIN;
  const rhs = Math.pow(mrtC + KELVIN, 4) + d * ta;
  let tg = ta;
  for (let i = 0; i < 20; i++) {
    const f = tg * tg * tg * tg + d * tg - rhs;
    const step = f / (4 * tg * tg * tg + d);
    tg -= step;
    if (Math.abs(step) < 1e-4) break;
  }
  return tg - KELVIN;
}

/**
 * Outdoor wet-bulb globe temperature, °C: 0.7·natural wet bulb + 0.2·globe + 0.1·air. The natural wet bulb is taken
 * as Stull's psychrometric wet bulb plus a small radiant share, which reads a little low in sun and still air.
 */
export function wbgt(tC: number, rhPct: number, windMps: number, mrtC: number): number {
  const globe = globeTemperature(tC, mrtC, windMps);
  const natural = wetBulb(tC, rhPct) + 0.1 * (globe - tC);
  return 0.7 * natural + 0.2 * globe + 0.1 * tC;
}

/** Wind chill temperature, °C (JAG/TI 2001 as used by NWS and Environment Canada), for air ≤ 10 °C and wind at 10 m in km/h. */
export function windChill(tC: number, windKmh: number): number {
  if (tC > 10 || windKmh <= 4.8) return tC;
  const v = Math.pow(windKmh, 0.16);
  return 13.12 + 0.6215 * tC - 11.37 * v + 0.3965 * tC * v;
}

/** Share of precipitation falling as snow from the wet-bulb temperature (logistic around 0.5 °C; Jennings et al. 2018 threshold). */
export function snowShare(wetBulbC: number): number {
  return 1 / (1 + Math.exp((wetBulbC - 0.5) / 0.6));
}

/** Fresh snow density, kg/m³ (Hedstrom & Pomeroy 1998): 68 at −15 °C, 92 at −2 °C, 119 at 0 °C and above. */
export function freshSnowDensity(tC: number): number {
  return 67.92 + 51.25 * Math.exp(Math.min(0, tC) / 2.59);
}

/** Saturation vapour pressure, kPa (FAO-56 Eq. 11). */
function saturationKpa(tC: number): number {
  return 0.6108 * Math.exp((17.27 * tC) / (tC + 237.3));
}

/**
 * Evaporation from a wet surface, mm/h: Penman (1948) combination with the FAO forms, wind function
 * 2.6·(1 + 0.54·u₂) mm/day per kPa of vapour pressure deficit, net radiation ≈ 0.92·SW − 40 W/m² (HEURISTIC) and
 * psychrometric constant from the pressure. Drying a 0.5 mm film takes ≈ 4 h in overcast 15 °C and ≈ 0.7 h in sun.
 */
export function wetSurfaceEvaporation(tC: number, rhPct: number, wind10: number, shortwave: number, pressureHpa: number): number {
  const es = saturationKpa(tC);
  const ea = es * clamp(rhPct, 1, 100) / 100;
  const u2 = Math.max(0, wind10) * WIND_2M_FACTOR;
  const delta = (4098 * es) / ((tC + 237.3) * (tC + 237.3));
  const gamma = 0.665e-3 * (pressureHpa / 10);
  const netMmDay = (Math.max(0, 0.92 * Math.max(0, shortwave) - 40) * 0.0864) / 2.45;
  const aero = 2.6 * (1 + 0.54 * u2) * Math.max(0, es - ea);
  return Math.max(0, (delta * netMmDay + gamma * aero) / (delta + gamma) / 24);
}
