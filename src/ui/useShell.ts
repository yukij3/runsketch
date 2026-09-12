import { useEffect } from 'react';
import { useApp, useRuntime, useT } from '../app/runtime';

const TEXT_ENTRY = 'input:not([type="radio"]):not([type="checkbox"]):not([type="range"]):not([type="button"]):not([type="file"]), textarea, select, [contenteditable=""], [contenteditable="true"]';

/** Ctrl/Cmd+Z undo, Shift+Ctrl/Cmd+Z or Ctrl+Y redo, Delete/Backspace removes the selected waypoint, Escape deselects. */
export function useShortcuts(): void {
  const { store, actions } = useRuntime();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const typing = e.target instanceof Element && e.target.closest(TEXT_ENTRY) !== null;
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();
      if (mod && !e.altKey && (key === 'z' || key === 'y')) {
        if (typing) return;
        e.preventDefault();
        if (key === 'y' || e.shiftKey) actions.redo();
        else actions.undo();
        return;
      }
      if (typing || mod) return;
      const selected = store.get().selectedId;
      if (!selected) return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        actions.removeWaypoint(selected);
      } else if (e.key === 'Escape') {
        actions.select(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [store, actions]);
}

export function useDocumentMeta(): void {
  const t = useT();
  const lang = useApp((s) => s.lang);
  useEffect(() => {
    document.documentElement.lang = lang;
    document.title = t('docTitle');
  }, [lang, t]);
}
