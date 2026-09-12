import { ExternalLink } from 'lucide-react';
import { REPO_URL } from '../../app/config';
import { useActions, useApp, useT } from '../../app/runtime';
import { Segmented } from '../controls';

export function Masthead() {
  const t = useT();
  const actions = useActions();
  const lang = useApp((s) => s.lang);
  const units = useApp((s) => s.units);
  return (
    <header className="masthead">
      <div className="masthead__row">
        <h1 className="wordmark">Runsketch</h1>
        <div className="masthead__tools">
          <Segmented
            size="sm"
            label={t('language')}
            value={lang}
            onChange={actions.setLang}
            options={[
              { value: 'en', label: 'EN', title: 'English' },
              { value: 'ru', label: 'RU', title: 'Русский' },
            ]}
          />
          <Segmented
            size="sm"
            label={t('units')}
            value={units}
            onChange={actions.setUnits}
            options={[
              { value: 'metric', label: t('unit_km') },
              { value: 'imperial', label: t('unit_mi') },
            ]}
          />
          <a className="masthead__link" href={REPO_URL} target="_blank" rel="noreferrer">
            {t('sourceCode')}
            <ExternalLink size={12} strokeWidth={1.75} aria-hidden="true" />
          </a>
        </div>
      </div>
      <p className="masthead__tagline">{t('appTagline')}</p>
    </header>
  );
}
