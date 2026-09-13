import { ChevronDown } from 'lucide-react';
import { Fragment } from 'react';
import { REPO_URL } from '../../app/config';
import type { MessageKey } from '../../app/i18n';
import { useT } from '../../app/runtime';

const CREDITS: ReadonlyArray<{ key: MessageKey; links: ReadonlyArray<readonly [label: string, href: string]> }> = [
  { key: 'credit_osm', links: [['© OpenStreetMap contributors, ODbL', 'https://www.openstreetmap.org/copyright']] },
  {
    key: 'credit_tiles',
    links: [
      ['OpenFreeMap', 'https://openfreemap.org/'],
      ['© OpenMapTiles', 'https://www.openmaptiles.org/'],
    ],
  },
  { key: 'credit_dem', links: [['© Mapterhorn', 'https://mapterhorn.com/attribution']] },
  {
    key: 'credit_demFallback',
    links: [
      ['AWS Terrain Tiles (Mapzen)', 'https://registry.opendata.aws/terrain-tiles/'],
      ['Open-Meteo', 'https://open-meteo.com/'],
    ],
  },
  {
    key: 'credit_routing',
    links: [
      ['BRouter', 'https://brouter.de/'],
      ['FOSSGIS OSRM', 'https://routing.openstreetmap.de/'],
      ['FOSSGIS Valhalla', 'https://valhalla1.openstreetmap.de/'],
    ],
  },
  {
    key: 'credit_weather',
    links: [
      ['Open-Meteo.com', 'https://open-meteo.com/'],
      ['CC BY 4.0', 'https://creativecommons.org/licenses/by/4.0/'],
      ['ERA5, Copernicus Climate Change Service', 'https://cds.climate.copernicus.eu/'],
    ],
  },
  { key: 'credit_search', links: [['Photon by Komoot', 'https://photon.komoot.io/']] },
  { key: 'credit_renderer', links: [['MapLibre GL JS, BSD-3', 'https://maplibre.org/']] },
  { key: 'credit_fit', links: [['@markw65/fit-file-writer, MIT', 'https://github.com/markw65/fit-file-writer']] },
];

export function AboutSection() {
  const t = useT();
  return (
    <details className="about">
      <summary className="about__summary">
        <h2 className="sheet-section__title">{t('sectionAbout')}</h2>
        <ChevronDown className="about__chevron" size={16} strokeWidth={1.75} aria-hidden="true" />
      </summary>
      <div className="about__body">
        <h3 className="subhead">{t('aboutModelTitle')}</h3>
        <p>{t('aboutModel')}</p>
        <h3 className="subhead">{t('aboutDataTitle')}</h3>
        <dl className="table">
          {CREDITS.map((c) => (
            <div key={c.key} className="row row--credits">
              <dt className="row__label">{t(c.key)}</dt>
              <dd className="row__value">
                {c.links.map(([label, href], i) => (
                  <Fragment key={href}>
                    {i > 0 ? ', ' : null}
                    <a href={href} target="_blank" rel="noreferrer">
                      {label}
                    </a>
                  </Fragment>
                ))}
              </dd>
            </div>
          ))}
        </dl>
        <p>{t('aboutPrivacy')}</p>
        <p>
          {t('aboutLicense')}{' '}
          <a href={REPO_URL} target="_blank" rel="noreferrer">
            {t('aboutSource')}
          </a>
        </p>
      </div>
    </details>
  );
}
