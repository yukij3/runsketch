import type { LngLat, TerrainProfile } from '../types';

const NI = (): never => { throw new Error('not implemented'); };

export interface ElevationSamples {
  /** Metres; NaN where no source answered. */
  ele: Float64Array;
  source: TerrainProfile['elevationSource'];
}

export type ElevationSampler = (coords: LngLat[], signal?: AbortSignal) => Promise<ElevationSamples>;

/** Terrarium formula: (R*256 + G + B/256) - 32768. */
export function decodeTerrarium(_r: number, _g: number, _b: number): number { return NI(); }

/** Mapterhorn z13 terrarium webp → AWS terrarium png → Open-Meteo. Bilinear interpolation, tile cache. */
export const sampleElevations: ElevationSampler = async () => NI();
