// Mirrors preferences into localStorage and the route into location.hash (debounced).
import { encodeShare, saveStored } from './persistence';
import type { AppState } from './state';
import type { Store } from './store';

const PERSISTED: ReadonlyArray<keyof AppState> = ['athlete', 'maxHrAuto', 'session', 'nameAuto', 'units', 'lang', 'profile', 'waypoints', 'view'];

export interface SyncEnv {
  storage: Pick<Storage, 'setItem'> | undefined;
  location: Pick<Location, 'hash' | 'pathname' | 'search'>;
  history: Pick<History, 'replaceState'>;
}

export function shareHash(state: AppState): string {
  return state.waypoints.length > 0 ? `#${encodeShare(state)}` : '';
}

export function startSync(store: Store<AppState>, env: SyncEnv, delayMs = 300): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let last = store.get();

  const flush = () => {
    timer = undefined;
    const s = store.get();
    saveStored(env.storage, s);
    const hash = shareHash(s);
    if (env.location.hash !== hash && !(hash === '' && env.location.hash === '#')) {
      env.history.replaceState(null, '', `${env.location.pathname}${env.location.search}${hash}`);
    }
  };

  const unsubscribe = store.subscribe(() => {
    const s = store.get();
    const changed = PERSISTED.some((k) => s[k] !== last[k]);
    last = s;
    if (!changed) return;
    clearTimeout(timer);
    timer = setTimeout(flush, delayMs);
  });

  return () => {
    unsubscribe();
    if (timer !== undefined) {
      clearTimeout(timer);
      flush();
    }
  };
}
