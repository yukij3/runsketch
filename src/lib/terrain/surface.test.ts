import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { WAY_TAG_KEYS } from '../route/ways';
import { parseBrouterGeojson, parseBrouterWays, parseValhallaRoute, parseValhallaWays } from '../services/routing';
import { STEEP, WAY_TAG_RULES, wayTraits } from './surface';

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`../services/__fixtures__/${name}`, import.meta.url), 'utf8'));

describe('wayTraits', () => {
  it.each([
    ['highway=residential surface=asphalt', { surface: 'paved', technicality: 0, gradeLimit: 0.25, structure: false }],
    ['highway=residential', { surface: 'paved', technicality: 0, gradeLimit: 0.25, structure: false }],
    ['highway=steps surface=paving_stones', { surface: 'steps', technicality: 0, gradeLimit: STEEP, structure: false }],
    ['highway=track tracktype=grade4', { surface: 'gravel', technicality: 0, gradeLimit: 0.3, structure: false }],
    ['highway=track surface=compacted tracktype=grade4', { surface: 'compacted', technicality: 0, gradeLimit: 0.3, structure: false }],
    ['highway=path sac_scale=demanding_mountain_hiking', { surface: 'ground', technicality: 0.4, gradeLimit: STEEP, structure: false }],
    ['highway=path trail_visibility=bad sac_scale=hiking', { surface: 'ground', technicality: 0.25, gradeLimit: 0.45, structure: false }],
    ['highway=tertiary surface=asphalt smoothness=horrible', { surface: 'rough', technicality: 0, gradeLimit: 0.25, structure: false }],
    ['highway=path surface=sand smoothness=very_bad', { surface: 'sand', technicality: 0, gradeLimit: 0.45, structure: false }],
    ['highway=secondary bridge=viaduct', { surface: 'paved', technicality: 0, gradeLimit: 0.25, structure: true }],
    ['highway=secondary bridge=no tunnel=building_passage', { surface: 'paved', technicality: 0, gradeLimit: 0.25, structure: true }],
    ['highway=track mtb:scale=2+', { surface: 'ground', technicality: 0.35, gradeLimit: 0.3, structure: false }],
    ['incline=up', { technicality: 0, structure: false }],
    ['highway=path surface=snow sac_scale=alpine_hiking', { surface: 'snow', technicality: 0.6, gradeLimit: STEEP, structure: false }],
    ['highway=path surface=snow smoothness=very_horrible', { surface: 'snow', technicality: 0, gradeLimit: STEEP, structure: false }],
    ['highway=path surface=ice', { surface: 'ice', technicality: 0, gradeLimit: STEEP, structure: false }],
    ['highway=path surface=scree sac_scale=mountain_hiking', { surface: 'scree', technicality: 0.2, gradeLimit: STEEP, structure: false }],
    ['highway=track surface=mud', { surface: 'sand', technicality: 0, gradeLimit: 0.3, structure: false }],
    ['highway=path surface=rock sac_scale=demanding_alpine_hiking', { surface: 'rock', technicality: 0.8, gradeLimit: STEEP, structure: false }],
    ['highway=path surface=rock sac_scale=demanding_mountain_hiking', { surface: 'rough', technicality: 0.4, gradeLimit: STEEP, structure: false }],
    ['highway=path surface=stone smoothness=horrible mtb:scale=4', { surface: 'rock', technicality: 0.75, gradeLimit: STEEP, structure: false }],
    ['highway=path natural=bare_rock sac_scale=difficult_alpine_hiking', { surface: 'rock', technicality: 1, gradeLimit: STEEP, structure: false }],
    ['highway=path natural=bare_rock', { surface: 'rough', technicality: 0, gradeLimit: 0.45, structure: false }],
    ['highway=path natural=glacier sac_scale=demanding_alpine_hiking', { surface: 'ice', technicality: 0.8, gradeLimit: STEEP, structure: false }],
  ] as const)('%s', (tags, expected) => {
    expect(wayTraits(tags)).toEqual(expected);
  });

  it('knows nothing without tags', () => {
    expect(wayTraits('')).toBeUndefined();
  });

  it('only reads keys the routers keep', () => {
    for (const rule of WAY_TAG_RULES) {
      const [key, value] = rule.tag.split('=');
      expect(WAY_TAG_KEYS.has(key), rule.tag).toBe(true);
      expect(value, rule.tag).toBeTruthy();
    }
  });

  it('gates rows by technicality without letting them set technicality', () => {
    const gated = WAY_TAG_RULES.filter((rule) => rule.minTechnicality !== undefined);
    expect(gated.length).toBeGreaterThan(0);
    for (const rule of gated) expect(rule.technicality, rule.tag).toBeUndefined();
  });

  it('describes a real alpine path from BRouter (Hörnli trail, Zermatt)', () => {
    const json = fixture('brouter-hiking-mountain-hornli.json');
    const ways = parseBrouterWays(json, parseBrouterGeojson(json))!;
    const traits = ways.map((w) => wayTraits(w.tags)!);
    expect(traits.map((t) => t.surface)).toEqual(['steps', 'ground', 'steps', 'paved', 'ground', 'ground', 'ground', 'ground']);
    expect(traits.map((t) => t.technicality)).toEqual([0, 0, 0, 0, 0, 0.4, 0, 0.4]);
  });

  it('describes the alpine fixtures from BRouter (Aconcagua) and Valhalla (Kazbek)', () => {
    const json = fixture('brouter-alpine-aconcagua.json');
    const brouter = parseBrouterWays(json, parseBrouterGeojson(json))!.filter((w) => w.tags);
    expect(brouter.map((w) => wayTraits(w.tags))).toEqual(brouter.map(() => ({ surface: 'ground', technicality: 0.8, gradeLimit: STEEP, structure: false })));
    const route = parseValhallaRoute(fixture('valhalla-pedestrian-kazbek.json'));
    const traits = parseValhallaWays(fixture('valhalla-trace-kazbek.json'), route)!.map((w) => wayTraits(w.tags)!);
    expect(traits.map((t) => t.technicality)).toEqual([0.2, 0.4, 0.4, 0.6, 0.8]);
    expect(new Set(traits.map((t) => t.surface))).toEqual(new Set(['ground']));
  });
});
