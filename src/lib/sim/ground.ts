// The ground under the route: speed, O2-cost, rolling-resistance and pace-noise factors per track point from the
// profile's surface class and technicality. Absent tags are neutral. Every ground effect enters the engine through
// these per-point arrays, so another ground state (a wet surface, snow) can multiply in at one place.
import type { SnowCondition, SurfaceClass, TerrainProfile } from '../types';
import type { Track } from './track';

export interface GroundFactors {
  /** Running speed multiplier. */
  runSpeed: number;
  /** Running O2-cost multiplier. */
  runCost: number;
  /** Walking speed multiplier. */
  walkSpeed: number;
  /** Walking O2-cost multiplier. */
  walkCost: number;
  /** Bike rolling-resistance multiplier (1 = road tyres on asphalt, Crr 0.004). */
  rolling: number;
  /** Extra share of the fast pace noise (uneven footing). */
  roughness: number;
  /** Walking speed and cost multipliers on descents where they differ (loose ground); the walk values otherwise. */
  walkDown?: { speed: number; cost: number };
}

/**
 * Relative to paved road. Running: uneven ground +5 % cost (Voloshina & Ferris 2015), sand ×1.2–1.6 (Zamparo 1992;
 * Lejeune 1998). Walking: woodchips +27 % (Kowalsky 2021), a rocky trail −14 % preferred speed (Gast 2019), sand
 * ×1.8–2.7 (Zamparo 1992; Lejeune 1998). In-between classes, rolling resistance off pavement and roughness HEURISTIC.
 * Steps get their speed limits in the kinematics (see STEPS).
 *
 * Mountain ground, walking speed and cost: firm snow 0.85 and 1.3 (hard-packed snow η 1.3 in the Soule & Goldman terrain
 * table, 1.6 in Givoni & Goldman 1971; fresh snow slows competitive mountaineers to 0.88 uphill, Carceller 2019; softer
 * snow in snowFactors); bare glacier ice with crampons 0.8 and 1.15 (no data found; HEURISTIC); scree 0.6 and 1.8 up,
 * 0.8 and 1.2 down (climbing loose scree is mechanically close to sand, η 1.8–2.1); rock from T4 up, i.e. scrambling,
 * 0.55 and 1.6 (a boulder trail doubles the cost of transport and cuts preferred speed by 14 %, Gast 2019; ±2.5 cm of
 * unevenness adds 28 %, Voloshina 2013). Running on snow and ice 0.7 and 1.3; on scree and rock, rolling and roughness
 * HEURISTIC.
 */
export const GROUND: Readonly<Record<SurfaceClass, GroundFactors>> = {
  paved: { runSpeed: 1, runCost: 1, walkSpeed: 1, walkCost: 1, rolling: 1, roughness: 0 },
  compacted: { runSpeed: 0.98, runCost: 1.02, walkSpeed: 0.97, walkCost: 1.05, rolling: 1.8, roughness: 0.1 },
  ground: { runSpeed: 0.96, runCost: 1.04, walkSpeed: 0.95, walkCost: 1.08, rolling: 2.5, roughness: 0.2 },
  gravel: { runSpeed: 0.94, runCost: 1.05, walkSpeed: 0.9, walkCost: 1.12, rolling: 3, roughness: 0.25 },
  rough: { runSpeed: 0.85, runCost: 1.1, walkSpeed: 0.85, walkCost: 1.4, rolling: 5, roughness: 0.6 },
  sand: { runSpeed: 0.75, runCost: 1.4, walkSpeed: 0.65, walkCost: 2.1, rolling: 10, roughness: 0.3 },
  steps: { runSpeed: 1, runCost: 1, walkSpeed: 1, walkCost: 1, rolling: 6, roughness: 0.3 },
  snow: { runSpeed: 0.7, runCost: 1.3, walkSpeed: 0.85, walkCost: 1.3, rolling: 8, roughness: 0.2 },
  ice: { runSpeed: 0.7, runCost: 1.3, walkSpeed: 0.8, walkCost: 1.15, rolling: 3, roughness: 0.3 },
  scree: { runSpeed: 0.7, runCost: 1.4, walkSpeed: 0.6, walkCost: 1.8, rolling: 10, roughness: 0.5, walkDown: { speed: 0.8, cost: 1.2 } },
  rock: { runSpeed: 0.6, runCost: 1.3, walkSpeed: 0.55, walkCost: 1.6, rolling: 6, roughness: 0.6 },
};

/**
 * Footprint depth on snow by condition on a mountain day, cm, averaged over a whole snow section rather than taken from
 * trail-breaking studies: a frozen, tracked névé leaves about 1 cm, soft afternoon snow 8 cm, deep snow 20 cm. Shallower
 * than breaking trail through untouched snow, since most of a normal route is already tracked (HEURISTIC).
 */
export const SNOW_DEPTH_CM: Readonly<Record<SnowCondition, number>> = { firm: 1, soft: 8, deep: 20 };

/**
 * Mountaineering on snow with a footprint `depthCm` deep: cost 1 + 0.075·z, at most 4 (Pandolf, Haisman & Goldman 1976:
 * 1.18 + 0.089·z W/kg per km/h, z in cm); speed 0.88·(1 − 0.012·z), at least 0.5 (unpacked snow is walked about 0.7 as
 * fast as packed at the same VO2, Connolly 2002; HEURISTIC slope). Firm snow costs ≈1.08 and walks at ≈0.87, close to
 * what fresh snow cost competitive mountaineers uphill (speed ×0.88; Carceller 2019), and less than the hard-packed snow of the military
 * terrain tables (1.3), measured off-track in boots at normal walking speeds; that value stays for tagged snow on other
 * activities (GROUND.snow).
 */
export function snowFactors(depthCm: number): { speed: number; cost: number } {
  const z = Math.max(0, Number.isFinite(depthCm) ? depthCm : SNOW_DEPTH_CM.firm);
  return { speed: Math.max(0.5, 0.88 * (1 - 0.012 * z)), cost: Math.min(4, 1 + 0.075 * z) };
}

/** Technicality of T4 (alpine_hiking), where hands come into play and glacier routes begin. */
export const ALPINE_T4 = 0.6;

/**
 * Mountaineering speed by technicality (T1 = 0 … T6 = 1): [t, up, down]. On glacier normal routes T4–T6 tags mostly mark
 * crevasse and sliding risk rather than slow ground, so the factors stay mild (HEURISTIC; stronger ones, 0.4–0.7 at
 * T4–T6, made guided summit days 20–40 % too slow once an oxygen limit caps the climbs).
 */
const ALPINE_TECHNICALITY: ReadonlyArray<readonly [t: number, up: number, down: number]> = [
  [0, 1, 1],
  [0.2, 1, 1],
  [0.4, 0.95, 0.95],
  [0.6, 0.9, 0.9],
  [0.8, 0.8, 0.85],
  [1, 0.7, 0.8],
];

/** Alpine speed multiplier for technicality t, blending the down and up factors by `up` (0 descent … 1 climb). */
export function alpineTechnicalitySpeed(t: number, up: number): number {
  const x = Math.min(1, Math.max(0, Number.isFinite(t) ? t : 0));
  const w = Math.min(1, Math.max(0, up));
  for (let k = 1; k < ALPINE_TECHNICALITY.length; k++) {
    const [t1, up1, down1] = ALPINE_TECHNICALITY[k];
    if (x > t1 && k < ALPINE_TECHNICALITY.length - 1) continue;
    const [t0, up0, down0] = ALPINE_TECHNICALITY[k - 1];
    const f = (x - t0) / (t1 - t0);
    const upSpeed = up0 + (up1 - up0) * f;
    const downSpeed = down0 + (down1 - down0) * f;
    return downSpeed + (upSpeed - downSpeed) * w;
  }
  return 1;
}

/** Bare ice without crampons is walked this much slower (HEURISTIC). */
export const ICE_WITHOUT_CRAMPONS = 0.7;

/** Snowline by absolute latitude, [degrees, m] (HEURISTIC; seasonal snow cover is not known). */
const SNOWLINE: ReadonlyArray<readonly [lat: number, m: number]> = [
  [20, 5000],
  [30, 4500],
  [45, 3000],
];

/** Snowline estimate for a latitude, m: 5000 m within 20° of the equator, 4500 m at 30°, 3000 m from 45°. */
export function defaultSnowline(lat: number): number {
  const a = Math.abs(Number.isFinite(lat) ? lat : 45);
  if (a <= SNOWLINE[0][0]) return SNOWLINE[0][1];
  for (let k = 1; k < SNOWLINE.length; k++) {
    const [a1, m1] = SNOWLINE[k];
    const [a0, m0] = SNOWLINE[k - 1];
    if (a <= a1) return m0 + ((m1 - m0) * (a - a0)) / (a1 - a0);
  }
  return SNOWLINE[SNOWLINE.length - 1][1];
}

/** Speed limits on steps, m/s: running, walking up, walking down (HEURISTIC; a steady stair climb is ≈3 km/h). */
export const STEPS = { run: 1.2, walkUp: 1.0, walkDown: 1.2 } as const;

/**
 * Technicality t (SAC T1 = 0 … T6 = 1, trail visibility, mountain-bike scale): running speed 1 − 0.8·t^1.35 (≈0.91 at
 * T2, 0.77 at T3, 0.6 at T4, 0.41 at T5), walking speed 1 − 0.8·t^1.2 (≈0.88, 0.73, 0.57, 0.39). Technical ground slows
 * people for footing more than for energy, yet costs more per metre: on a rocky trail walkers chose a 14 % lower speed
 * at more than twice the cost of transport (Gast 2019). Cost therefore rises as speed falls, to speed^−0.8 running
 * and speed^−1.1 walking, so effort stays near that of the smooth path. Anchored to routing-engine speeds for SAC
 * grades; HEURISTIC.
 */
export function technicalityFactors(t: number): GroundFactors {
  const x = t > 0 ? Math.min(1, t) : 0;
  const runSpeed = 1 - 0.8 * x ** 1.35;
  const walkSpeed = 1 - 0.8 * x ** 1.2;
  return { runSpeed, runCost: runSpeed ** -0.8, walkSpeed, walkCost: walkSpeed ** -1.1, rolling: 1 + 3 * x, roughness: x };
}

/** Walking weight technical ground forces on a runner: T5 and up everywhere, T4 and up on climbs over 10 % (HEURISTIC). */
export function technicalWalkWeight(technicality: number, grade: number): number {
  const s = (x: number): number => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
  return Math.max(s((technicality - 0.6) / 0.2), grade > 0.1 ? s((technicality - 0.45) / 0.15) : 0);
}

/** Per-track-point ground factors; running multiplies surface by technicality, walking takes the harsher of the two. */
export interface GroundTrack {
  runSpeed: Float64Array;
  runCost: Float64Array;
  walkSpeed: Float64Array;
  walkCost: Float64Array;
  rolling: Float64Array;
  roughness: Float64Array;
  technicality: Float64Array;
  /** 1 on steps, 0 elsewhere. */
  steps: Float64Array;
  /** 1 on snow or ice (where crampons go on), 0 elsewhere. */
  snow: Float64Array;
}

export interface GroundOptions {
  /** Mountaineering: footprint depth on snow, cm (default: firm snow; see snowFactors). */
  snowDepthCm?: number;
  /**
   * Mountaineering: the mild technicality factors, combined with the surface by the slower of the two and without a
   * technicality cost; snow wherever the surface is unknown above the snowline, or where a T4+ way names only its path
   * class (routers report glacier snow as an unknown surface); bare ice slower without crampons.
   */
  alpine?: { snowlineM: number; crampons: boolean };
}

const finite = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const smooth01 = (x: number): number => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

/**
 * Ground factors for each track point, matched to the profile points the track kept. Null when no point carries a
 * surface or technicality (OSRM, straight lines, synthetic profiles), so untagged routes cost nothing extra; mountaineering
 * always gets factors, since snow is inferred from elevation. Direction-dependent factors blend over ±2 % of grade.
 */
export function groundTrack(profile: TerrainProfile, track: Track, options: GroundOptions = {}): GroundTrack | null {
  const pts = Array.isArray(profile?.points) ? profile.points : [];
  const alpine = options.alpine;
  if (!alpine && !pts.some((p) => p && (p.surface !== undefined || finite(p.technicality)))) return null;
  const snow = snowFactors(options.snowDepthCm ?? SNOW_DEPTH_CM.firm);
  const n = track.n;
  const out: GroundTrack = {
    runSpeed: new Float64Array(n).fill(1),
    runCost: new Float64Array(n).fill(1),
    walkSpeed: new Float64Array(n).fill(1),
    walkCost: new Float64Array(n).fill(1),
    rolling: new Float64Array(n).fill(1),
    roughness: new Float64Array(n),
    technicality: new Float64Array(n),
    steps: new Float64Array(n),
    snow: new Float64Array(n),
  };
  let d0 = NaN;
  let j = 0;
  for (const p of pts) {
    if (j >= n) break;
    if (!p || !finite(p.d) || !finite(p.lon) || !finite(p.lat)) continue;
    if (Number.isNaN(d0)) d0 = p.d;
    // buildTrack keeps strictly increasing distances measured from the first valid point.
    if (Math.abs(p.d - d0 - track.d[j]) > 1e-6) continue;
    const t = finite(p.technicality) ? Math.min(1, Math.max(0, p.technicality)) : 0;
    let cls = p.surface;
    if (alpine && track.ele[j] >= alpine.snowlineM && (cls === undefined || (t >= ALPINE_T4 && cls === 'ground'))) cls = 'snow';
    const surface = cls ? GROUND[cls] : undefined;
    const tech = technicalityFactors(t);
    let walkSpeed = surface?.walkSpeed ?? 1;
    let walkCost = surface?.walkCost ?? 1;
    const up = smooth01((track.grade[j] + 0.02) / 0.04);
    if (surface?.walkDown) {
      walkSpeed = surface.walkDown.speed + (walkSpeed - surface.walkDown.speed) * up;
      walkCost = surface.walkDown.cost + (walkCost - surface.walkDown.cost) * up;
    }
    if (alpine) {
      if (cls === 'snow') {
        walkSpeed = snow.speed;
        walkCost = snow.cost;
      }
      if (cls === 'ice' && !alpine.crampons) walkSpeed *= ICE_WITHOUT_CRAMPONS;
      out.walkSpeed[j] = Math.min(walkSpeed, alpineTechnicalitySpeed(t, up));
      out.walkCost[j] = walkCost;
    } else {
      // Surface and technicality describe the same ground from two sides: a scree slope tagged T4 is scree, not scree
      // with a T4 penalty laid on top. Multiplying them counted the same roughness twice in the speed and twice again
      // in the cost, and the cost is what an effort preset solves against, so a tagged mountain trail came out slower
      // than any party walks it. The walker takes the slower speed and the dearer cost of the two, not their product.
      out.walkSpeed[j] = Math.min(walkSpeed, tech.walkSpeed);
      out.walkCost[j] = Math.max(walkCost, tech.walkCost);
    }
    out.runSpeed[j] = (surface?.runSpeed ?? 1) * tech.runSpeed;
    out.runCost[j] = (surface?.runCost ?? 1) * tech.runCost;
    out.rolling[j] = Math.max(surface?.rolling ?? 1, tech.rolling);
    out.roughness[j] = Math.max(surface?.roughness ?? 0, tech.roughness);
    out.technicality[j] = tech.roughness;
    out.steps[j] = cls === 'steps' ? 1 : 0;
    out.snow[j] = cls === 'snow' || cls === 'ice' ? 1 : 0;
    j++;
  }
  return out;
}
