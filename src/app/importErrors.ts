// Route-file import failures in the interface language.
import { RouteImportError } from '../lib/import';
import type { MessageKey, Translate } from './i18n';

export function importErrorText(t: Translate, err: unknown): string {
  if (err instanceof RouteImportError) {
    const detail = err.code === 'invalidXml' && err.detail ? ` (${err.detail})` : '';
    return t(`importError_${err.code}` as MessageKey, { detail, root: err.detail ?? '' });
  }
  return err instanceof Error ? err.message : String(err);
}
