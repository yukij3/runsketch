import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mapPhotonFeatures, photonLang, photonUrl, searchPlaces } from './geocode';

const fixture = (name: string) => readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), 'utf8');
const LAUSANNE = fixture('photon-lausanne.json');
const BERLIN = fixture('photon-brandenburger-tor.json');

describe('mapPhotonFeatures', () => {
  it('maps a real city result with extent → bbox', () => {
    const results = mapPhotonFeatures(JSON.parse(LAUSANNE));
    expect(results).toHaveLength(3);
    expect(results[0]).toEqual({
      id: 'R1685018',
      name: 'Lausanne',
      detail: 'Vaud, Switzerland',
      lon: 6.6327025,
      lat: 46.5218269,
      // Photon sends [west, north, east, south]
      bbox: [6.583863, 46.4548726, 6.7208093, 46.6025814],
    });
    expect(results[1].id).toBe('N439656613');
    expect(results[1].detail).toBe('Allée des Bacounis, Vaud, Switzerland');
    expect(results[1].bbox).toBeUndefined();
  });

  it('maps a real landmark result with street and house number', () => {
    const results = mapPhotonFeatures(JSON.parse(BERLIN));
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]).toMatchObject({
      id: 'W518071791',
      name: 'Brandenburger Tor',
      detail: 'Pariser Platz 1, Berlin, Deutschland',
      lon: 13.3777034,
      lat: 52.5162699,
    });
    expect(new Set(results.map((r) => r.id)).size).toBe(results.length);
    for (const r of results) {
      expect(Number.isFinite(r.lon) && Number.isFinite(r.lat)).toBe(true);
      expect(r.name.length).toBeGreaterThan(0);
    }
  });

  it('names address-only features from street and house number, skips junk', () => {
    const results = mapPhotonFeatures({
      features: [
        { properties: { street: 'Hauptstraße', housenumber: '5', city: 'Tübingen', country: 'Deutschland' }, geometry: { coordinates: [9.05, 48.52] } },
        { properties: { name: 'Nowhere' }, geometry: { coordinates: ['x', 1] } },
        { properties: { name: 'No geometry' } },
        null,
      ],
    });
    expect(results).toEqual([{ id: '9.050000,48.520000', name: 'Hauptstraße 5', detail: 'Tübingen, Deutschland', lon: 9.05, lat: 48.52 }]);
    expect(mapPhotonFeatures({ message: 'q parameter is required' })).toEqual([]);
    expect(mapPhotonFeatures(null)).toEqual([]);
  });
});

describe('Photon request', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('maps unsupported languages to default', () => {
    expect(photonLang('ru')).toBe('default');
    expect(photonLang('en-GB')).toBe('en');
    expect(photonLang('DE')).toBe('de');
    expect(photonLang('fr_CH')).toBe('fr');
    expect(photonLang(undefined)).toBe('default');
  });

  it('builds the URL with location bias', () => {
    expect(photonUrl('Brandenburger Tor', { bias: [13.405, 52.52], lang: 'ru' })).toBe(
      'https://photon.komoot.io/api/?q=Brandenburger%20Tor&limit=6&lat=52.52000&lon=13.40500&lang=default',
    );
    expect(photonUrl('x', { bias: [373.405, 52.52] })).toContain('lon=13.40500');
    expect(photonUrl('x')).toBe('https://photon.komoot.io/api/?q=x&limit=6&lang=default');
  });

  it('searchPlaces fetches and maps; blank queries skip the network', async () => {
    const fetchMock = vi.fn(async () => new Response(LAUSANNE, { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await searchPlaces('   ')).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
    const results = await searchPlaces('Lausanne', { lang: 'fr', bias: [6.6, 46.5] });
    expect(results[0].name).toBe('Lausanne');
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toContain('lang=fr');
  });
});
