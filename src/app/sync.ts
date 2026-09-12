// Mirrors preferences into localStorage, routed legs into the leg cache, and the route into location.hash (debounced).
import type { LegCache } from './legCache';
import { encodeShare, saveStored } from './persistence';
import type { AppState } from './state';
import type { Store } from './store';

const PERSISTED: ReadonlyArray<keyof AppState> = [
  'athlete',
  'maxHrAuto',
  'session',
  'nameAuto',
  'targetAuto',
  'effortPreset',
  'units',
  'lang',
  'profile',
  'waypoints',
  'view',
  'legs',
];

export interface SyncEnv {
  storage: Pick<Storage, 'setItem'> | undefined;
  location: Pick<Location, 'hash' | 'pathname' | 'search'>;
  history: Pick<History, 'replaceState'>;
  /** Routed legs survive reloads through this cache (optional). */
  legCache?: Pick<LegCache, 'remember' | 'save'>;
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
    if (env.legCache) {
      env.legCache.remember(s.legs);
      env.legCache.save(env.storage);
    }
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
