import { Link2, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { MessageKey } from '../../app/i18n';
import { legsSummary } from '../../app/i18n';
import { countLegs, routeCoords } from '../../app/pipeline';
import { useApp, useRuntime, useT } from '../../app/runtime';
import { shareHash } from '../../app/sync';
import { formatDecimal, formatDistance, formatElevation } from '../../lib/format';
import { polylineLength } from '../../lib/geo';
import { DataRow, IconButton, Section, cx } from '../controls';
import { waypointLabel, waypointRole } from '../labels';
import { unitLabels } from '../units';

export function RouteSection() {
  const t = useT();
  const { store, actions } = useRuntime();
  const waypoints = useApp((s) => s.waypoints);
  const legs = useApp((s) => s.legs);
  const profile = useApp((s) => s.profile);
  const units = useApp((s) => s.units);
  const terrain = useApp((s) => s.terrain);
  const routingBusy = useApp((s) => s.routing.state === 'busy');
  const selectedId = useApp((s) => s.selectedId);
  const [copy, setCopy] = useState<'idle' | 'copied' | 'failed'>('idle');

  const counts = useMemo(() => countLegs({ waypoints, profile, legs }), [waypoints, profile, legs]);
  const distance = useMemo(() => {
    const coords = routeCoords({ waypoints, profile, legs });
    return coords ? polylineLength(coords) : null;
  }, [waypoints, profile, legs]);

  useEffect(() => {
    if (copy === 'idle') return;
    const timer = setTimeout(() => setCopy('idle'), 2500);
    return () => clearTimeout(timer);
  }, [copy]);

  const copyLink = async () => {
    const url = `${location.origin}${location.pathname}${location.search}${shareHash(store.get())}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopy('copied');
    } catch {
      history.replaceState(null, '', url);
      setCopy('failed');
    }
  };

  const u = unitLabels(units, t);
  const p = terrain.profile;
  const stale = routingBusy || terrain.state === 'busy';
  const elev = (m: number | undefined) => (p && m !== undefined ? formatElevation(m, units) : undefined);

  return (
    <Section id="route" title={t('sectionRoute')} busy={stale}>
      <dl className={cx('table', stale && 'is-stale')}>
        <DataRow label={t('distance')} value={distance !== null ? formatDistance(distance, units, 2) : undefined} unit={u.distance} />
        <DataRow label={t('ascentDescent')}>
          <span className="num">{p ? `+${elev(p.ascent)} / −${elev(p.descent)}` : '–'}</span>
          {p ? <span className="unit">{u.elevation}</span> : null}
        </DataRow>
        <DataRow label={t('elevationRange')}>
          <span className="num">{p && p.points.length ? `${elev(p.minEle)} / ${elev(p.maxEle)}` : '–'}</span>
          {p && p.points.length ? <span className="unit">{u.elevation}</span> : null}
        </DataRow>
        <DataRow label={t('legs')}>
          <span className={cx('legs-status', counts.fallback > 0 && 'is-warn')}>{legsSummary(counts)}</span>
          {counts.fallback > 0 ? (
            <>
              <span className="row__note">{t('straightFallbackHint')}</span>
              {counts.pending === 0 ? (
                <button type="button" className="link-btn" onClick={actions.retryFallbackLegs}>
                  {t('retryRouting')}
                </button>
              ) : null}
            </>
          ) : null}
        </DataRow>
        <DataRow label={t('elevationSource')} text value={p ? t(`src_${p.elevationSource}` as MessageKey) : undefined} />
      </dl>

      <h3 className="subhead">{t('waypoints')}</h3>
      {waypoints.length === 0 ? (
        <p className="sheet-note">{t('noWaypoints')}</p>
      ) : (
        <ol className="wp-list">
          {waypoints.map((w, i) => {
            const label = waypointLabel(t, i, waypoints.length);
            return (
              <li key={w.id} className={cx('wp-list__item', w.id === selectedId && 'is-selected')}>
                <span className={cx('wp-glyph', `wp-glyph--${waypointRole(i, waypoints.length)}`)} aria-hidden="true" />
                <button
                  type="button"
                  className="wp-list__name"
                  aria-pressed={w.id === selectedId}
                  onClick={() => {
                    actions.select(w.id === selectedId ? null : w.id);
                    actions.flyTo([w.lon, w.lat], 15, [w.lon, w.lat, w.lon, w.lat]);
                  }}
                >
                  {label}
                </button>
                <span className="wp-list__coord num">
                  {`${formatDecimal(w.lat, 5)}, ${formatDecimal(w.lon, 5)}`}
                </span>
                <IconButton icon={X} label={t('removeWaypoint', { name: label })} onClick={() => actions.removeWaypoint(w.id)} className="icon-btn--sm" tipSide="left" />
              </li>
            );
          })}
        </ol>
      )}

      <div className="sheet-actions">
        <button type="button" className="btn btn--quiet" onClick={() => void copyLink()} disabled={waypoints.length === 0}>
          <Link2 size={15} strokeWidth={1.75} aria-hidden="true" />
          {t('copyLink')}
        </button>
        <span className="sheet-actions__status" role="status">
          {copy === 'copied' ? t('linkCopied') : copy === 'failed' ? t('linkCopyFailed') : ''}
        </span>
      </div>
    </Section>
  );
}
