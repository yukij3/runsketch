import type { LngLat } from '../types';

const NI = (): never => { throw new Error('not implemented'); };

export interface PlaceResult {
  id: string;
  name: string;
  /** Secondary line: city, region, country. */
  detail: string;
  lon: number;
  lat: number;
  bbox?: [number, number, number, number];
}

/** Photon autocomplete. Caller debounces; pass an AbortSignal to cancel. */
export async function searchPlaces(_q: string, _opts?: { bias?: LngLat; lang?: string; signal?: AbortSignal }): Promise<PlaceResult[]> { return NI(); }
