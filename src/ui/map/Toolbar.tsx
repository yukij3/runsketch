import { ArrowLeftRight, ArrowUpDown, FileUp, IterationCcw, Redo2, Trash2, Undo2, X } from 'lucide-react';
import { useEffect, useRef, useState, type ChangeEvent, type Ref } from 'react';
import type { MessageKey } from '../../app/i18n';
import { importErrorText } from '../../app/importErrors';
import { useActions, useApp, useT } from '../../app/runtime';
import { SNAP_PROFILES } from '../../app/state';
import { parseRouteFile } from '../../lib/import';
import type { SnapProfile } from '../../lib/types';
import { IconButton, cx } from '../controls';
import { SearchBox } from './SearchBox';

function Notice() {
  const t = useT();
  const actions = useActions();
  const notice = useApp((s) => s.notice);
  useEffect(() => {
    if (notice?.kind !== 'info') return;
    const timer = setTimeout(actions.dismissNotice, 9000);
    return () => clearTimeout(timer);
  }, [notice, actions]);
  return (
    <div className="notice-slot" aria-live="polite">
      {notice ? (
        <div className={cx('notice', `notice--${notice.kind}`)} role={notice.kind === 'error' ? 'alert' : undefined}>
          <p>{notice.text}</p>
          <IconButton icon={X} label={t('dismiss')} onClick={actions.dismissNotice} className="icon-btn--sm" tipSide="left" />
        </div>
      ) : null}
    </div>
  );
}

export function Toolbar({ ref }: { ref?: Ref<HTMLDivElement> }) {
  const t = useT();
  const actions = useActions();
  const profile = useApp((s) => s.profile);
  const count = useApp((s) => s.waypoints.length);
  const canUndo = useApp((s) => s.past.length > 0);
  const canRedo = useApp((s) => s.future.length > 0);
  const closed = useApp((s) => {
    const w = s.waypoints;
    return w.length >= 2 && Math.abs(w[0].lon - w[w.length - 1].lon) < 1e-7 && Math.abs(w[0].lat - w[w.length - 1].lat) < 1e-7;
  });
  const fileRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const clearRef = useRef<HTMLSpanElement>(null);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (!confirming) return;
    confirmRef.current?.focus();
    const timer = setTimeout(() => setConfirming(false), 6000);
    return () => clearTimeout(timer);
  }, [confirming]);

  const endConfirm = (restoreFocus: boolean) => {
    setConfirming(false);
    if (restoreFocus) requestAnimationFrame(() => clearRef.current?.querySelector('button')?.focus());
  };

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const route = parseRouteFile(await file.text(), file.name);
      const n = actions.importTrack(route.coords, route.name);
      actions.notify('info', t('imported', { file: file.name, count: n }));
    } catch (err) {
      actions.notify('error', t('importFailed', { file: file.name, message: importErrorText(t, err) }));
    }
  };

  return (
    <div className="toolbar-wrap" ref={ref}>
      <div className="toolbar" role="group" aria-label={t('toolbarLabel')}>
        <SearchBox />
        <div className="toolbar__group">
          <label className="sr-only" htmlFor="rs-profile">
            {t('profileLabel')}
          </label>
          <select id="rs-profile" className="select select--toolbar" value={profile} onChange={(e) => actions.setProfile(e.target.value as SnapProfile)}>
            {SNAP_PROFILES.map((p) => (
              <option key={p} value={p}>
                {t(`profile_${p}` as MessageKey)}
              </option>
            ))}
          </select>
        </div>
        <div className="toolbar__group">
          <IconButton icon={Undo2} label={t('undo')} onClick={actions.undo} disabled={!canUndo} />
          <IconButton icon={Redo2} label={t('redo')} onClick={actions.redo} disabled={!canRedo} />
        </div>
        <div className="toolbar__group">
          <IconButton icon={IterationCcw} label={t('closeLoop')} onClick={actions.closeLoop} disabled={count < 2 || closed} />
          <IconButton icon={ArrowLeftRight} label={t('outAndBack')} onClick={actions.outAndBack} disabled={count < 2} />
          <IconButton icon={ArrowUpDown} label={t('reverse')} onClick={actions.reverse} disabled={count < 2} />
        </div>
        <div className="toolbar__group">
          <IconButton icon={FileUp} label={t('importRoute')} onClick={() => fileRef.current?.click()} />
          <input ref={fileRef} type="file" accept=".gpx,.tcx,.fit" className="sr-only" tabIndex={-1} aria-hidden="true" onChange={(e) => void onFile(e)} />
          <span ref={clearRef} className="toolbar__clear">
            {confirming ? (
              <span
                className="toolbar__confirm"
                role="group"
                aria-label={t('clearConfirm')}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    e.stopPropagation();
                    endConfirm(true);
                  }
                }}
              >
                <span className="toolbar__confirm-text">{t('clearConfirm')}</span>
                <button
                  ref={confirmRef}
                  type="button"
                  className="btn btn--sm btn--danger"
                  onClick={() => {
                    actions.clear();
                    endConfirm(false);
                  }}
                >
                  {t('clearYes')}
                </button>
                <button type="button" className="btn btn--sm" onClick={() => endConfirm(true)}>
                  {t('cancel')}
                </button>
              </span>
            ) : (
              <IconButton icon={Trash2} label={t('clearRoute')} onClick={() => setConfirming(true)} disabled={count === 0} />
            )}
          </span>
        </div>
      </div>
      <Notice />
    </div>
  );
}
