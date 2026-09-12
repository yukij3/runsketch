import type { LngLat, RouteLeg, SnapProfile } from '../types';

const NI = (): never => { throw new Error('not implemented'); };

export type LegGeometry = Omit<RouteLeg, 'fromId' | 'toId'>;

/** Route between two points. Chain: BRouter → FOSSGIS OSRM → straight line (fallback: true). Cached by leg key. */
export async function routeLeg(_a: LngLat, _b: LngLat, _profile: SnapProfile, _signal?: AbortSignal): Promise<LegGeometry> { return NI(); }
