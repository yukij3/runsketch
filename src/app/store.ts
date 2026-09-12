// Minimal external store for useSyncExternalStore: shallow-merge updates, notify only on change.

export interface Store<S extends object> {
  get(): S;
  set(patch: Partial<S> | ((state: S) => Partial<S>)): void;
  subscribe(listener: () => void): () => void;
}

export function createStore<S extends object>(initial: S): Store<S> {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    set(patch) {
      const p = typeof patch === 'function' ? patch(state) : patch;
      const keys = Object.keys(p) as Array<keyof S>;
      if (!keys.some((k) => !Object.is(state[k], p[k]))) return;
      state = { ...state, ...p };
      for (const l of [...listeners]) l();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
