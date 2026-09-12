import type { LngLat, SnapProfile } from '../lib/types';

/**
 * Montjuïc loop, Barcelona: Plaça d'Espanya → Palau Nacional → Passeig Olímpic → castle → Miramar →
 * Poble-sec → Plaça d'Espanya. ~7.7 km with a ~130 m climb, so heart rate visibly lags the ascent and
 * recovers on the way down. Points are the OSRM foot snap locations (checked 2026-09-12, all < 50 m).
 */
export const EXAMPLE_ROUTE: { profile: SnapProfile; coords: LngLat[] } = {
  profile: 'foot',
  coords: [
    [2.149677, 41.375102],
    [2.153217, 41.368806],
    [2.157483, 41.364711],
    [2.165936, 41.363325],
    [2.171142, 41.368209],
    [2.163243, 41.372612],
    [2.149677, 41.375102],
  ],
};
