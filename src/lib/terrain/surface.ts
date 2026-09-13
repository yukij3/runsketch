// OSM way tags → what the ground under a profile point is like: surface class, technicality, whether the DEM shows
// the way at all (bridges, tunnels) and how steep this kind of way plausibly gets. One table; extend it with rows.
import type { SurfaceClass } from '../types';
import { parseWayTags } from '../route/ways';

/** No plausible-grade limit beyond the activity's own. */
export const STEEP = Infinity;

export interface WayTagRule {
  /** `key=value`, or `key=*` for any value except `no`. */
  tag: string;
  /** Surface class. The first matching row in table order that sets one wins, so specific rows precede road-class defaults. */
  surface?: SurfaceClass;
  /** Makes the surface at least this rough (smoothness). */
  rougher?: SurfaceClass;
  /** 0 = smooth path … 1 = alpine or technical; the highest matching value wins. */
  technicality?: number;
  /** Steepest grade this kind of way plausibly has; the most permissive matching value wins, so a steep-way tag beats a road class. */
  gradeLimit?: number;
  /** The DEM does not show this way: the valley under a bridge, the hill over a tunnel. */
  structure?: boolean;
  /** The row applies only on ways at least this technical (from the rows without this field); it sets no technicality itself. */
  minTechnicality?: number;
}

const rows = (key: string, values: readonly string[], rule: Omit<WayTagRule, 'tag'>): WayTagRule[] =>
  values.map((value) => ({ tag: `${key}=${value}`, ...rule }));

/** Plausible grade of public roads: ramps above 25 % are rare enough to be named records (Baldwin Street, Ffordd Pen Llech ≈ 35 %). */
const ROAD_GRADE = 0.25;
const FOOTWAY_GRADE = 0.35;
const TRACK_GRADE = 0.3;
const PATH_GRADE = 0.45;
/** Technicality of sac_scale=alpine_hiking (T4), the first grade where hands are needed on rock. */
const T4 = 0.6;

/**
 * Surface classes follow the order of energy cost and speed on foot: compacted and fine gravel barely differ from
 * paved; dirt, then loose gravel, cost a few per cent more; rock and very rough ways slow walkers by about 14 % (Gast
 * et al. 2019); sand costs 1.2–1.6× running and about 2× walking (Zamparo et al. 1992, Lejeune et al. 1998). Mud sits
 * with sand. Mountain ground has classes of its own: snow, ice (glacier), scree, and rock where the way is T4 or harder,
 * i.e. scrambling; below T4, rock underfoot is a rough path. Glaciers and scree are mostly mapped as areas, so these
 * classes appear only where a way itself carries the tag. Technicality follows the SAC hiking scale T1–T6 (0 … 1),
 * trail visibility and the mountain-bike scale.
 */
export const WAY_TAG_RULES: readonly WayTagRule[] = [
  // Structures.
  { tag: 'bridge=*', structure: true },
  { tag: 'tunnel=*', structure: true },
  { tag: 'man_made=bridge', structure: true },

  // Ways steep by construction; their class beats the surface tag.
  { tag: 'highway=steps', surface: 'steps', gradeLimit: STEEP },
  { tag: 'highway=via_ferrata', surface: 'rough', technicality: 1, gradeLimit: STEEP },

  // surface=*
  ...rows(
    'surface',
    ['paved', 'asphalt', 'chipseal', 'concrete', 'concrete:plates', 'concrete:lanes', 'paving_stones', 'paving_stones:lanes', 'sett', 'cobblestone', 'bricks', 'metal', 'metal_grid', 'wood', 'rubber', 'tartan', 'acrylic'],
    { surface: 'paved' },
  ),
  ...rows('surface', ['compacted', 'fine_gravel', 'clay'], { surface: 'compacted' }),
  ...rows('surface', ['unpaved', 'ground', 'dirt', 'earth', 'grass', 'grass_paver', 'woodchips', 'artificial_turf'], { surface: 'ground' }),
  ...rows('surface', ['gravel', 'pebblestone', 'shells'], { surface: 'gravel' }),
  ...rows('surface', ['rock', 'stone', 'bare_rock'], { surface: 'rock', minTechnicality: T4 }),
  ...rows('surface', ['rock', 'stone', 'bare_rock', 'unhewn_cobblestone', 'stepping_stones'], { surface: 'rough' }),
  ...rows('surface', ['scree', 'shingle'], { surface: 'scree', gradeLimit: STEEP }),
  { tag: 'surface=snow', surface: 'snow', gradeLimit: STEEP },
  ...rows('surface', ['ice', 'glacier'], { surface: 'ice', gradeLimit: STEEP }),
  ...rows('surface', ['sand', 'mud', 'salt'], { surface: 'sand' }),

  // natural=* on the way itself (routers rarely report it; glaciers, scree and bare rock are mostly mapped as areas).
  { tag: 'natural=glacier', surface: 'ice', gradeLimit: STEEP },
  { tag: 'natural=scree', surface: 'scree', gradeLimit: STEEP },
  { tag: 'natural=bare_rock', surface: 'rock', minTechnicality: T4 },
  { tag: 'natural=bare_rock', surface: 'rough' },

  // tracktype=* where no surface is tagged: grade1–2 hard, grade3 mixed, grade4 mostly soft, grade5 soft.
  ...rows('tracktype', ['grade1', 'grade2'], { surface: 'compacted' }),
  { tag: 'tracktype=grade3', surface: 'ground' },
  { tag: 'tracktype=grade4', surface: 'gravel' },
  { tag: 'tracktype=grade5', surface: 'rough' },

  // Road class: the surface when nothing more specific is tagged, and the plausible grade.
  ...rows(
    'highway',
    ['motorway', 'motorway_link', 'trunk', 'trunk_link', 'primary', 'primary_link', 'secondary', 'secondary_link', 'tertiary', 'tertiary_link', 'unclassified', 'residential', 'living_street', 'service', 'road', 'busway', 'cycleway', 'pedestrian'],
    { surface: 'paved', gradeLimit: ROAD_GRADE },
  ),
  ...rows('highway', ['footway', 'platform'], { surface: 'paved', gradeLimit: FOOTWAY_GRADE }),
  { tag: 'highway=bridleway', surface: 'ground', gradeLimit: FOOTWAY_GRADE },
  { tag: 'highway=track', surface: 'ground', gradeLimit: TRACK_GRADE },
  { tag: 'highway=path', surface: 'ground', gradeLimit: PATH_GRADE },

  // smoothness=* only ever makes a surface rougher.
  ...rows('smoothness', ['very_bad', 'horrible', 'very_horrible', 'impassable'], { rougher: 'rough' }),

  // Difficulty. From T2 up, steep ground is real, so no plausible-grade limit applies.
  { tag: 'sac_scale=hiking', technicality: 0 },
  { tag: 'sac_scale=mountain_hiking', technicality: 0.2, gradeLimit: STEEP },
  { tag: 'sac_scale=demanding_mountain_hiking', technicality: 0.4, gradeLimit: STEEP },
  { tag: 'sac_scale=alpine_hiking', technicality: T4, gradeLimit: STEEP },
  { tag: 'sac_scale=demanding_alpine_hiking', technicality: 0.8, gradeLimit: STEEP },
  { tag: 'sac_scale=difficult_alpine_hiking', technicality: 1, gradeLimit: STEEP },
  { tag: 'trail_visibility=intermediate', technicality: 0.1 },
  { tag: 'trail_visibility=bad', technicality: 0.25 },
  { tag: 'trail_visibility=horrible', technicality: 0.4 },
  { tag: 'trail_visibility=no', technicality: 0.5 },
  { tag: 'mtb:scale=1', technicality: 0.15 },
  { tag: 'mtb:scale=2', technicality: 0.35 },
  { tag: 'mtb:scale=3', technicality: 0.55, gradeLimit: STEEP },
  { tag: 'mtb:scale=4', technicality: 0.75, gradeLimit: STEEP },
  { tag: 'mtb:scale=5', technicality: 0.9, gradeLimit: STEEP },
  { tag: 'mtb:scale=6', technicality: 1, gradeLimit: STEEP },
];

export interface WayTraits {
  surface?: SurfaceClass;
  /** 0 when tags are known but name no difficulty. */
  technicality: number;
  /** Plausible grade for this kind of way; absent when no row limits it. */
  gradeLimit?: number;
  structure: boolean;
}

/** Order for `rougher`: smoothness never turns sand, mountain ground or steps into a rough path. */
const ROUGHNESS: Readonly<Record<SurfaceClass, number>> = { paved: 0, compacted: 1, ground: 2, gravel: 3, rough: 4, sand: 5, snow: 6, ice: 7, scree: 8, rock: 9, steps: 10 };

const RULES = new Map<string, Array<{ order: number; rule: WayTagRule }>>();
WAY_TAG_RULES.forEach((rule, order) => {
  const list = RULES.get(rule.tag) ?? [];
  list.push({ order, rule });
  RULES.set(rule.tag, list);
});

const memo = new Map<string, WayTraits | undefined>();

/** Traits of a way from its tags (see WAY_TAG_RULES); undefined when no tags are known. */
export function wayTraits(tags: string): WayTraits | undefined {
  if (!tags) return undefined;
  if (memo.has(tags)) return memo.get(tags);
  const matches: Array<{ order: number; rule: WayTagRule }> = [];
  for (const [key, value] of parseWayTags(tags)) {
    // Scales carry suffixes such as mtb:scale=2+ or 3-.
    const exact = RULES.get(`${key}=${value}`) ?? RULES.get(`${key}=${value.replace(/[+-]$/, '')}`);
    if (exact) matches.push(...exact);
    const any = value !== 'no' ? RULES.get(`${key}=*`) : undefined;
    if (any) matches.push(...any);
  }
  matches.sort((a, b) => a.order - b.order);
  const traits: WayTraits = { technicality: 0, structure: false };
  for (const { rule } of matches) {
    if (rule.technicality !== undefined && rule.minTechnicality === undefined) traits.technicality = Math.max(traits.technicality, rule.technicality);
  }
  let rougher: SurfaceClass | undefined;
  for (const { rule } of matches) {
    if (rule.minTechnicality !== undefined && traits.technicality < rule.minTechnicality) continue;
    if (rule.surface && !traits.surface) traits.surface = rule.surface;
    if (rule.rougher && (!rougher || ROUGHNESS[rule.rougher] > ROUGHNESS[rougher])) rougher = rule.rougher;
    if (rule.gradeLimit !== undefined) traits.gradeLimit = Math.max(traits.gradeLimit ?? 0, rule.gradeLimit);
    if (rule.structure) traits.structure = true;
  }
  if (rougher && traits.surface !== 'steps' && (!traits.surface || ROUGHNESS[rougher] > ROUGHNESS[traits.surface])) traits.surface = rougher;
  if (memo.size > 5000) memo.clear();
  memo.set(tags, traits);
  return traits;
}
