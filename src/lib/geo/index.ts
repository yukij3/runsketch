// Geodesy helpers. Coordinates are [lon, lat].
import type { LngLat } from '../types';

const NI = (): never => { throw new Error('not implemented'); };

/** Great-circle distance in metres. */
export function haversine(_a: LngLat, _b: LngLat): number { return NI(); }
/** Initial bearing a→b in degrees [0, 360). */
export function bearing(_a: LngLat, _b: LngLat): number { return NI(); }
/** Cumulative distances (metres), same length as coords, starting at 0. */
export function cumulativeDistances(_coords: LngLat[]): number[] { return NI(); }
export function polylineLength(_coords: LngLat[]): number { return NI(); }
/** Point at distance d along a line with precomputed cumulative distances. */
export function interpolateAlong(_coords: LngLat[], _cum: number[], _d: number): LngLat { return NI(); }
/** Resample at a fixed spacing (last point always included). */
export function resampleLine(_coords: LngLat[], _spacing: number): { coords: LngLat[]; d: number[] } { return NI(); }
/** Move a point by metres east/north. */
export function offsetMeters(_p: LngLat, _east: number, _north: number): LngLat { return NI(); }
export function bbox(_coords: LngLat[]): [minLon: number, minLat: number, maxLon: number, maxLat: number] { return NI(); }
/** Google encoded polyline. */
export function encodePolyline(_coords: LngLat[], _precision?: number): string { return NI(); }
export function decodePolyline(_str: string, _precision?: number): LngLat[] { return NI(); }
