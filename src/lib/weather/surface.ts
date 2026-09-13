// Surface state that belongs to a place, not to the athlete: a water film, soil memory (mud), fresh snow and ice at
// stations along the route, stepped through time from two days before the start. Rain that stops leaves a surface
// that dries over hours; the athlete meets whatever state the station is in when they pass.
import type { SurfaceClass } from '../types';
import { freshSnowDensity, wetSurfaceEvaporation } from './physics';
import { createAmbient, type WeatherField } from './field';

export interface WetFactors {
  /** Water film at which the surface counts as fully wet, mm. */
  capacity: number;
  /** Soil memory e-folding time, h (0: sealed surface without mud). */
  soilTauH: number;
  /** Speed lost on the level when fully wet, share. */
  flat: number;
  /** Speed lost on a steep descent when fully wet, share (scaled by 0.5 + technicality). */
  descent: number;
  /** Share of grip lost when fully wet; corner and descent caps scale with its square root. */
  gripLoss: number;
}

/**
 * Wet surfaces by class. Capacities follow road-weather models (METRo: wet at 0.5 kg/m², Crevier & Delage 2001;
 * RoadSurf: 1 mm storage). Grip: wet asphalt keeps about 70–80 % of dry cornering speed (√(0.3/0.5) = 0.77), people
 * shorten steps and slow down where they expect a slippery floor (Cham & Redfern 2002), and no footwear grips wet ice
 * (Manning & Jones 2001). Speed losses, soil drying times and the mountain classes are HEURISTIC.
 */
export const WET_SURFACE: Readonly<Record<SurfaceClass, WetFactors>> = {
  paved: { capacity: 0.5, soilTauH: 0, flat: 0.01, descent: 0.04, gripLoss: 0.2 },
  compacted: { capacity: 0.8, soilTauH: 12, flat: 0.02, descent: 0.08, gripLoss: 0.3 },
  gravel: { capacity: 0.8, soilTauH: 12, flat: 0.02, descent: 0.08, gripLoss: 0.3 },
  ground: { capacity: 1.5, soilTauH: 36, flat: 0.04, descent: 0.2, gripLoss: 0.6 },
  rough: { capacity: 0.7, soilTauH: 6, flat: 0.04, descent: 0.25, gripLoss: 0.5 },
  sand: { capacity: 2, soilTauH: 12, flat: -0.03, descent: 0, gripLoss: 0 },
  steps: { capacity: 0.5, soilTauH: 6, flat: 0.03, descent: 0.15, gripLoss: 0.4 },
  snow: { capacity: 1, soilTauH: 0, flat: 0.02, descent: 0.1, gripLoss: 0.3 },
  ice: { capacity: 0.5, soilTauH: 0, flat: 0.05, descent: 0.3, gripLoss: 0.6 },
  scree: { capacity: 0.8, soilTauH: 6, flat: 0.03, descent: 0.15, gripLoss: 0.3 },
  rock: { capacity: 0.7, soilTauH: 6, flat: 0.04, descent: 0.25, gripLoss: 0.5 },
};

/** Surface state constants. Runoff above 1 mm with e-folding ≈ 333 s (METRo); melt 0.15 mm w.e. per °C·h (Hock 2003); settling HEURISTIC. */
export const SURFACE_MODEL = {
  stationSpacingM: 200,
  maxStations: 250,
  stepS: 300,
  spinUpStepS: 900,
  spinUpS: 48 * 3600,
  runoffAboveMm: 1,
  runoffPerS: 0.003,
  meltMmPerDegreeHour: 0.15,
  settledDensity: 300,
  settlingPerDay: 0.2,
  /** Soil memory M counts as W = M/(M + mudHalfMm). */
  mudHalfMm: 5,
  /**
   * A water film at least this thick freezes over gradually as the air cools from `iceFrom` to `iceTo` °C (surfaces run a
   * little colder or warmer than the air, so there is no sharp 0 °C line; HEURISTIC band).
   */
  iceFilmMm: 0.05,
  iceFrom: 1,
  iceTo: -2,
} as const;

export interface SurfaceState {
  /** Water film wetness, 0–1. */
  wet: number;
  /** Wetness including soil memory on natural surfaces, 0–1. */
  wetEff: number;
  /** Fresh snow depth, cm. */
  snowCm: number;
  /** Ice cover, 0–1. */
  ice: number;
}

export function createSurfaceState(): SurfaceState {
  return { wet: 0, wetEff: 0, snowCm: 0, ice: 0 };
}

export interface SurfaceGrid {
  /** Epoch seconds of the first stored slot. */
  readonly start: number;
  /** State at route distance s and epoch seconds t (held beyond the stored range). */
  at(s: number, t: number, out: SurfaceState): void;
  /** True when any station was ever wet, snowy or icy after the start. */
  readonly active: boolean;
}

export interface SurfaceStation {
  d: number;
  ele: number;
  surface: SurfaceClass;
}

/**
 * Steps every station from `startEpoch − spinUpS` (or the field start, if later) to `endEpoch` and stores the state
 * from the start on. Stations sit every 200 m (more sparsely on routes over 50 km).
 */
export function precomputeSurface(
  field: WeatherField,
  stations: ReadonlyArray<SurfaceStation>,
  startEpoch: number,
  endEpoch: number,
  spinUpS: number = SURFACE_MODEL.spinUpS,
): SurfaceGrid {
  const M = SURFACE_MODEL;
  const count = stations.length;
  const slots = Math.max(2, Math.ceil((Math.max(endEpoch, startEpoch) - startEpoch) / M.stepS) + 2);
  const t0 = startEpoch - M.stepS;
  const wet = new Float32Array(count * slots);
  const wetEff = new Float32Array(count * slots);
  const snow = new Float32Array(count * slots);
  const ice = new Float32Array(count * slots);
  const amb = createAmbient();
  let active = false;
  const spinFrom = Math.max(startEpoch - Math.max(0, spinUpS), Number.isFinite(field.start) ? field.start - 3600 : -Infinity);
  for (let q = 0; q < count; q++) {
    const st = stations[q];
    const f = WET_SURFACE[st.surface] ?? WET_SURFACE.paved;
    let film = 0;
    let soil = 0;
    let swe = 0;
    let depth = 0;
    let t = Math.min(t0, Number.isFinite(spinFrom) ? spinFrom : startEpoch - Math.max(0, spinUpS));
    let slot = 0;
    const store = (): void => {
      const i = q * slots + slot;
      const w = Math.min(1, film / f.capacity);
      wet[i] = w;
      wetEff[i] = f.soilTauH > 0 ? Math.max(w, soil / (soil + M.mudHalfMm)) : w;
      snow[i] = depth;
      const freeze = Math.min(1, Math.max(0, (amb.temp - M.iceFrom) / (M.iceTo - M.iceFrom)));
      ice[i] = film >= M.iceFilmMm ? freeze * freeze * (3 - 2 * freeze) : 0;
      if (wetEff[i] > 0.05 || depth > 0.1 || ice[i] > 0) active = true;
    };
    while (slot < slots) {
      const dt = t < t0 ? Math.min(M.spinUpStepS, t0 - t) : M.stepS;
      const tMid = t + dt / 2;
      field.at(st.d, tMid, st.ele, amb);
      const hours = dt / 3600;
      const water = amb.precip * hours;
      const snowWater = water * amb.snow;
      const liquid = water - snowWater;
      // Snow: fresh depth from its density, settling, and melt by degree hours.
      if (snowWater > 0) {
        swe += snowWater;
        depth += (snowWater * 100) / freshSnowDensity(amb.temp);
      }
      let melt = 0;
      if (swe > 0) {
        melt = Math.min(swe, M.meltMmPerDegreeHour * Math.max(0, amb.temp) * hours);
        const left = swe - melt;
        depth = left > 0 ? depth * (left / swe) : 0;
        swe = left;
        depth = Math.max((swe * 100) / M.settledDensity, depth * (1 - (M.settlingPerDay * dt) / 86400));
        if (swe <= 1e-6) {
          swe = 0;
          depth = 0;
        }
      }
      // Water film: rain and melt in, evaporation out while wet, fast runoff above the storage limit.
      // Evaporation only acts on an existing film (the sun is only needed then).
      let evaporation = 0;
      if (film > 0) {
        field.sun(st.d, tMid, amb);
        evaporation = wetSurfaceEvaporation(amb.temp, amb.rh, amb.windSpeed, amb.shortwave, amb.pressure) * hours * Math.min(1, film / f.capacity);
      }
      film += liquid + melt - evaporation;
      if (film < 0) film = 0;
      if (film > M.runoffAboveMm) film = M.runoffAboveMm + (film - M.runoffAboveMm) * Math.exp(-M.runoffPerS * dt);
      if (f.soilTauH > 0) soil = (soil + liquid + melt) * Math.exp(-hours / f.soilTauH);
      t += dt;
      if (t >= t0) {
        store();
        slot++;
      }
    }
  }
  const spacing = count > 1 ? stations[1].d - stations[0].d : 1;
  const d0 = count > 0 ? stations[0].d : 0;
  return {
    start: t0,
    active,
    at(s: number, t: number, out: SurfaceState): void {
      if (count === 0) {
        out.wet = 0;
        out.wetEff = 0;
        out.snowCm = 0;
        out.ice = 0;
        return;
      }
      const x = count > 1 ? (s - d0) / spacing : 0;
      const a = x <= 0 ? 0 : x >= count - 1 ? count - 1 : Math.floor(x);
      const b = Math.min(count - 1, a + 1);
      const wx = x <= 0 || x >= count - 1 ? 0 : x - a;
      // Slot k holds the state at t0 + k·stepS.
      const u = (t - t0) / M.stepS;
      const k = u <= 0 ? 0 : u >= slots - 1 ? slots - 1 : Math.floor(u);
      const k1 = Math.min(slots - 1, k + 1);
      const wt = u <= 0 || u >= slots - 1 ? 0 : u - k;
      const pick = (arr: Float32Array): number => {
        const l = arr[a * slots + k] + (arr[a * slots + k1] - arr[a * slots + k]) * wt;
        const r = arr[b * slots + k] + (arr[b * slots + k1] - arr[b * slots + k]) * wt;
        return l + (r - l) * wx;
      };
      out.wet = pick(wet);
      out.wetEff = pick(wetEff);
      out.snowCm = pick(snow);
      out.ice = pick(ice);
    },
  };
}
