import type { ActivityType, LngLat, TerrainProfile } from '../types';
import type { ElevationSampler } from '../services/elevation';

const NI = (): never => { throw new Error('not implemented'); };

export interface TerrainOptions {
  spacing?: number; // default 5 m
  activity?: ActivityType;
  signal?: AbortSignal;
}

/** Pure: resampled coords + raw DEM samples → smoothed profile with grade and ascent. NaNs are interpolated. */
export function computeProfile(_coords: LngLat[], _rawEle: ArrayLike<number>, _spacing: number, _activity: ActivityType, _source: TerrainProfile['elevationSource']): TerrainProfile { return NI(); }

/** Resample route, sample DEM, compute profile. */
export async function buildTerrainProfile(_route: LngLat[], _sampler: ElevationSampler, _opts?: TerrainOptions): Promise<TerrainProfile> { return NI(); }
