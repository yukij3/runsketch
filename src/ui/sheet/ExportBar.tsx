import { Download } from 'lucide-react';
import { useState } from 'react';
import { APP_VERSION, FILE_CREATOR_NAME } from '../../app/config';
import { useApp, useRuntime, useT } from '../../app/runtime';
import { exportFilename } from '../../lib/export/filename';
import type { ExportFormat } from '../../lib/types';
import { cx } from '../controls';

const FORMATS: ExportFormat[] = ['fit', 'tcx', 'gpx'];

export function ExportBar() {
  const t = useT();
  const { store } = useRuntime();
  const hasResult = useApp((s) => s.sim.result !== null && s.sim.state !== 'error');
  const busy = useApp((s) => s.routing.state === 'busy' || s.terrain.state === 'busy' || s.sim.state === 'busy');
  const session = useApp((s) => s.session);
  const [working, setWorking] = useState(false);
  const [status, setStatus] = useState<{ error: boolean; text: string } | null>(null);
  const ready = hasResult && !busy;

  const run = async (format: ExportFormat) => {
    setWorking(true);
    setStatus(null);
    try {
      // Encoders load on first export; the FIT writer alone is ~85 KB.
      const { exportActivity, downloadBlob } = await import('../../lib/export');
      const s = store.get();
      if (!s.sim.result) return;
      const file = exportActivity(format, { result: s.sim.result, session: s.session, athlete: s.athlete, appName: FILE_CREATOR_NAME, appVersion: APP_VERSION });
      downloadBlob(file.blob, file.filename);
      setStatus({ error: false, text: t('exportSaved', { file: file.filename }) });
    } catch (err) {
      setStatus({ error: true, text: t('exportFailed', { message: err instanceof Error ? err.message : String(err) }) });
    } finally {
      setWorking(false);
    }
  };

  const stem = exportFilename('fit', session).replace(/\.fit$/, '');
  const hint = !hasResult ? t('exportUnavailable') : busy ? t('exportBusy') : null;

  return (
    <footer className="export-bar" aria-label={t('exportLabel')}>
      <div className="export-bar__buttons">
        {FORMATS.map((f) => (
          <button
            key={f}
            type="button"
            className={cx('btn', 'export-bar__btn', f === 'fit' && 'btn--primary')}
            disabled={!ready || working}
            aria-label={t('exportAs', { format: f.toUpperCase() })}
            onClick={() => void run(f)}
          >
            <Download size={15} strokeWidth={1.75} aria-hidden="true" />
            <span>{f.toUpperCase()}</span>
          </button>
        ))}
      </div>
      <p className={cx('export-bar__meta', status?.error && 'is-error')} aria-live="polite">
        {status ? (
          status.text
        ) : hint ? (
          hint
        ) : (
          <span className="num" title={`${stem}.fit`}>
            {stem}
            <span className="export-bar__ext">.fit · .tcx · .gpx</span>
          </span>
        )}
      </p>
    </footer>
  );
}
