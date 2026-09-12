import type { LngLat } from '../types';

const NI = (): never => { throw new Error('not implemented'); };

export interface ImportedRoute { coords: LngLat[]; name?: string }

/** GPX (trk/rte/wpt) or TCX track → coordinates. Throws a readable Error on invalid input. */
export function parseRouteFile(_text: string, _filename: string): ImportedRoute { return NI(); }
