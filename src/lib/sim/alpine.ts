// Mountain days in engine units: the session's mountain settings, the oxygen budget and footwear along the track, and
// the terrain-only time profile the break schedule is laid on.
import type { Footwear, SessionSettings, TerrainProfile } from '../types';
import { mountainDefaults } from './athlete';
import { SNOW_DEPTH_CM, defaultSnowline, snowFactors, type GroundTrack } from './ground';
import { HIKE_CLIMB, type AlpineContext, type ClimbO2 } from './kinematics';
import { ACCLIMATISATION, VO2_REST, altitudeEndurance, packLoadFactor } from './models';
import type { Track } from './track';

/** Smoothstep from 0 to 1 over 0 … 1. */
const smooth01 = (x: number): number => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

/** Footwear pair masses, kg: trail shoes, mountain boots (La Sportiva G2 Evo 1050 g per boot), double boots (Scarpa Phantom 8000 1310 g). */
export const FOOTWEAR_PAIR_KG: Readonly<Record<Footwear, number>> = { 'trail-shoes': 0.6, 'mountain-boots': 2.1, 'double-boots': 2.7 };
/** A pair of crampons, kg (Petzl Vasak 845–895 g). */
export const CRAMPONS_KG = 0.87;

/** Mountain settings resolved for the engine. */
export interface Mountain {
  /** Acclimatisation A, 0…1. */
  acclimatisation: number;
  packKg: number;
  /** Footwear pair mass without crampons, kg. */
  pairKg: number;
  crampons: boolean;
  snowDepthCm: number;
  /** Explicit, or estimated from the latitude of the route's start. */
  snowlineM: number;
}

/** The session's mountain fields (absent ones take the activity's defaults) in engine units. */
export function mountainOf(session: SessionSettings, profile: TerrainProfile): Mountain {
  const fallback = mountainDefaults(session.type);
  const start = Array.isArray(profile?.points) ? profile.points.find((p) => p && Number.isFinite(p.lat)) : undefined;
  const snowline = session.snowlineM ?? fallback.snowlineM;
  return {
    acclimatisation: ACCLIMATISATION[session.acclimatisation ?? fallback.acclimatisation] ?? 0,
    packKg: session.packKg ?? fallback.packKg,
    pairKg: FOOTWEAR_PAIR_KG[session.footwear ?? fallback.footwear] ?? FOOTWEAR_PAIR_KG['trail-shoes'],
    crampons: session.crampons ?? fallback.crampons,
    snowDepthCm: SNOW_DEPTH_CM[session.snow ?? fallback.snow] ?? SNOW_DEPTH_CM.firm,
    snowlineM: typeof snowline === 'number' && Number.isFinite(snowline) ? snowline : defaultSnowline(start ? start.lat : 45),
  };
}

/**
 * Oxygen budget and footwear per track point. The budget is the net VO2 a climb may use at a share of 1:
 * (VO2max·f − 3.5)·altitudeEndurance(f, A), f the altitude VO2max multiplier at the point.
 */
export function alpineContext(track: Track, ground: GroundTrack | null, altitude: Float64Array, vo2max: number, mountain: Mountain, bodyKg: number): AlpineContext {
  const n = track.n;
  const budget = new Float64Array(n);
  const footKg = new Float64Array(n);
  for (let j = 0; j < n; j++) {
    const f = altitude[j];
    budget[j] = Math.max(0, vo2max * f - VO2_REST) * altitudeEndurance(f, mountain.acclimatisation);
    footKg[j] = mountain.pairKg + (mountain.crampons && ground && ground.snow[j] > 0 ? CRAMPONS_KG : 0);
  }
  const snow = snowFactors(mountain.snowDepthCm);
  return { budget, footKg, load: packLoadFactor(mountain.packKg, bodyKg), snowSpeed: snow.speed, snowCost: snow.cost };
}

/**
 * Oxygen budget on the climbs of a walking or trekking day, with the weight that fades it in over HIKE_CLIMB's
 * elevation band. Null when the route never reaches that band: low walks then run exactly as they did before.
 */
export function climbOxygen(track: Track, altitude: Float64Array, vo2max: number, acclimatisation: number): ClimbO2 | null {
  const n = track.n;
  let top = -Infinity;
  for (let j = 0; j < n; j++) if (track.ele[j] > top) top = track.ele[j];
  if (!(top > HIKE_CLIMB.fromM)) return null;
  const budget = new Float64Array(n);
  const weight = new Float64Array(n);
  const vam = new Float64Array(n);
  const span = Math.max(1, HIKE_CLIMB.fullM - HIKE_CLIMB.fromM);
  for (let j = 0; j < n; j++) {
    const f = altitude[j];
    budget[j] = Math.max(0, vo2max * f - VO2_REST) * altitudeEndurance(f, acclimatisation);
    weight[j] = smooth01((track.ele[j] - HIKE_CLIMB.fromM) / span);
    vam[j] = 1 + weight[j] * (f * altitudeEndurance(f, acclimatisation) - 1);
  }
  return { budget, weight, vam };
}

/** Distance where snow or ice starts after snow-free ground, m (where crampons go on); null when it never does. */
export function gearPoint(track: Track, ground: GroundTrack | null): number | null {
  if (!ground || track.n < 2 || ground.snow[0] > 0) return null;
  for (let j = 1; j < track.n; j++) if (ground.snow[j] > 0) return track.d[j];
  return null;
}

/**
 * Expected moving time at each track point from the terrain alone, scaled to `targetTime`: time per metre ∝ 1/speed with
 * speed = grade multiplier × ground; on climbs also × f·altitudeEndurance(f) relative to the start, since the oxygen
 * budget slows high climbs. Breaks are laid on this profile, so they do not move while the calibration solves the effort.
 */
export function expectedMovingTime(
  track: Track,
  rel: Float64Array,
  ground: GroundTrack | null,
  altitude: Float64Array,
  acclimatisation: number,
  targetTime: number,
): Float64Array {
  const n = track.n;
  const time = new Float64Array(n);
  if (n < 2) return time;
  const base = altitude[0] * altitudeEndurance(altitude[0], acclimatisation);
  const speed = (j: number): number => {
    const climb = track.grade[j] > 0.02 ? (altitude[j] * altitudeEndurance(altitude[j], acclimatisation)) / base : 1;
    return Math.max(0.02, rel[j] * (ground ? ground.walkSpeed[j] : 1) * climb);
  };
  let prev = speed(0);
  for (let j = 1; j < n; j++) {
    const next = speed(j);
    time[j] = time[j - 1] + (track.d[j] - track.d[j - 1]) / (0.5 * (prev + next));
    prev = next;
  }
  const scale = time[n - 1] > 0 ? targetTime / time[n - 1] : 0;
  for (let j = 0; j < n; j++) time[j] *= scale;
  return time;
}
