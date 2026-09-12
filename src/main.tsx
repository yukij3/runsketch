import './styles/tokens.css';
import './styles/base.css';
import './styles/controls.css';
import './styles/layout.css';
import './styles/map.css';
import './styles/sheet.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { LegCache } from './app/legCache';
import { buildInitialState, decodeShare, loadStored } from './app/persistence';
import { startPipeline } from './app/pipeline';
import { RuntimeProvider, createRuntime } from './app/runtime';
import { createSimClient } from './app/simClient';
import { createStore } from './app/store';
import { shareHash, startSync } from './app/sync';
import { sampleElevations } from './lib/services/elevation';
import { routeLeg } from './lib/services/routing';
import { buildTerrainProfile } from './lib/terrain';

function browserStorage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

const storage = browserStorage();
const legCache = LegCache.load(storage);
const store = createStore(
  buildInitialState({ stored: loadStored(storage), hash: location.hash, language: navigator.language, now: Date.now(), legs: legCache }),
);
const runtime = createRuntime(store);

// simulate() and preset solving run in a worker (latest request wins); without workers they run on this thread.
const simClient = createSimClient({
  createWorker: typeof Worker === 'undefined' ? null : () => new Worker(new URL('./workers/sim.worker.ts', import.meta.url), { type: 'module' }),
});

startPipeline(store, {
  routeLeg,
  buildProfile: (route, activity, signal) => buildTerrainProfile(route, sampleElevations, { activity, signal }),
  simulate: simClient.simulate,
  solvePreset: simClient.solvePreset,
});
startSync(store, { storage, location, history, legCache });

// Dev-only handle for QA scripts (streams, actions); stripped from production builds.
if (import.meta.env.DEV) Object.assign(window, { __runsketch: { ...runtime, simClient, legCache } });

// A share link pasted into this tab replaces the route.
window.addEventListener('hashchange', () => {
  if (location.hash === shareHash(store.get())) return;
  const payload = decodeShare(location.hash);
  if (payload && payload.coords.length > 0) runtime.actions.applyShare(payload);
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RuntimeProvider runtime={runtime}>
      <App />
    </RuntimeProvider>
  </StrictMode>,
);
