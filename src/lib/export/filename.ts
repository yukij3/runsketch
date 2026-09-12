import type { ExportFormat, SessionSettings } from '../types';
import { activityTitle, localParts } from './common';

export const EXPORT_MIME: Record<ExportFormat, string> = {
  gpx: 'application/gpx+xml',
  tcx: 'application/vnd.garmin.tcx+xml',
  fit: 'application/vnd.ant.fit',
};

const pad = (n: number, width = 2) => String(n).padStart(width, '0');

/**
 * Filesystem-safe slug that keeps non-Latin letters ("Утренний бег" → "утренний-бег").
 * Diacritics are dropped only from ASCII base letters, so Cyrillic й/ё survive recomposition.
 */
export function slugify(text: string, maxLength = 48): string {
  return text
    .normalize('NFKD')
    .replace(/([A-Za-z])\p{M}+/gu, '$1')
    .normalize('NFC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLength)
    .replace(/-+$/, '');
}

/** YYYY-MM-DD_HHmm_<type>_<slug>.<ext>, wall-clock time at the start location. */
export function exportFilename(format: ExportFormat, session: SessionSettings): string {
  const p = localParts(session.startTime, session.utcOffsetMin);
  const stamp = `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}_${pad(p.hour)}${pad(p.minute)}`;
  const slug = slugify(activityTitle(session)) || session.type;
  return `${stamp}_${session.type}_${slug}.${format}`;
}
