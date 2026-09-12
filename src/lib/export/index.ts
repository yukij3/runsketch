import type { ExportFormat, ExportInput } from '../types';
import { buildFit } from './fit';
import { EXPORT_MIME, exportFilename } from './filename';
import { buildGpx } from './gpx';
import { buildTcx } from './tcx';

export { buildFit, buildGpx, buildTcx };
export { downloadBlob } from './download';
export { EXPORT_MIME, exportFilename, slugify } from './filename';

export function exportActivity(
  format: ExportFormat,
  input: ExportInput,
): { filename: string; mime: string; blob: Blob } {
  const mime = EXPORT_MIME[format];
  const filename = exportFilename(format, input.session);
  if (format === 'fit') {
    const bytes = buildFit(input);
    const owned = new Uint8Array(bytes.byteLength); // ArrayBuffer-backed copy, as BlobPart requires
    owned.set(bytes);
    return { filename, mime, blob: new Blob([owned], { type: mime }) };
  }
  const xml = format === 'gpx' ? buildGpx(input) : buildTcx(input);
  return { filename, mime, blob: new Blob([xml], { type: mime }) };
}
