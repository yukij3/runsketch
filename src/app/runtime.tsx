import { createContext, useContext, useSyncExternalStore, type ReactNode } from 'react';
import { createActions, type Actions } from './actions';
import { translate, type Translate } from './i18n';
import type { AppState } from './state';
import type { Store } from './store';

export interface Runtime {
  store: Store<AppState>;
  actions: Actions;
}

export function createRuntime(store: Store<AppState>): Runtime {
  return { store, actions: createActions(store) };
}

const RuntimeContext = createContext<Runtime | null>(null);

export function RuntimeProvider({ runtime, children }: { runtime: Runtime; children: ReactNode }) {
  return <RuntimeContext.Provider value={runtime}>{children}</RuntimeContext.Provider>;
}

export function useRuntime(): Runtime {
  const runtime = useContext(RuntimeContext);
  if (!runtime) throw new Error('RuntimeProvider is missing');
  return runtime;
}

/** Subscribe to a slice. The selector must return a stable reference (a stored value or a primitive). */
export function useApp<T>(selector: (state: AppState) => T): T {
  const { store } = useRuntime();
  const read = () => selector(store.get());
  return useSyncExternalStore(store.subscribe, read, read);
}

export function useActions(): Actions {
  return useRuntime().actions;
}

export function useT(): Translate {
  return translate;
}
