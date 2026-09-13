import { LoaderCircle, TriangleAlert } from 'lucide-react';
import { useApp, useActions, useT } from '../../app/runtime';
import { cx } from '../controls';

export function EmptyPlate() {
  const t = useT();
  const actions = useActions();
  return (
    <div className="empty-plate">
      <h2 className="empty-plate__title">{t('emptyTitle')}</h2>
      <p className="empty-plate__body">{t('emptyBody')}</p>
      <button type="button" className="btn btn--primary" onClick={() => actions.loadExample()}>
        {t('loadExample')}
      </button>
      <p className="empty-plate__hint">{t('exampleHint')}</p>
    </div>
  );
}

/** Pipeline stage in words (routing, elevation, simulation) plus recoverable errors. The traces strip owns the playhead readout. */
export function MapFoot({ styleFailed }: { styleFailed: boolean }) {
  const t = useT();
  const actions = useActions();
  const routing = useApp((s) => s.routing);
  const terrainState = useApp((s) => s.terrain.state);
  const simState = useApp((s) => s.sim.state);
  const simError = useApp((s) => s.sim.error);

  let text = '';
  let tone: 'busy' | 'error' | null = null;
  let retry: (() => void) | null = null;
  if (routing.state === 'busy') {
    text = t('statusRouting', { done: routing.done, total: routing.total });
    tone = 'busy';
  } else if (terrainState === 'busy') {
    text = t('statusElevation');
    tone = 'busy';
  } else if (terrainState === 'error') {
    text = t('statusElevationFailed');
    tone = 'error';
    retry = actions.retryTerrain;
  } else if (simState === 'busy') {
    text = t('statusSimulating');
    tone = 'busy';
  } else if (simState === 'error') {
    text = t('statusSimFailed', { message: simError ?? '' });
    tone = 'error';
  } else if (styleFailed) {
    text = t('styleFailed');
    tone = 'error';
  }

  return (
    <div className="map-foot" aria-live="polite">
      {text ? (
        <p className={cx('map-status__chip', tone === 'error' && 'is-error')}>
          {tone === 'busy' ? <LoaderCircle className="spin" size={13} aria-hidden="true" /> : null}
          {tone === 'error' ? <TriangleAlert size={13} aria-hidden="true" /> : null}
          <span>{text}</span>
          {retry ? (
            <button type="button" className="link-btn" onClick={retry}>
              {t('retry')}
            </button>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}
