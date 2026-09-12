import './styles/tokens.css';
import './styles/base.css';
import './styles/controls.css';
import './styles/layout.css';
import './styles/map.css';
import './styles/sheet.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { buildInitialState, decodeShare, loadStored } from './app/persistence';
import { startPipeline } from './app/pipeline';
import { RuntimeProvider, createRuntime } from './app/runtime';
import { createStore } from './app/store';
import { shareHash, startSync } from './app/sync';
import { sampleElevations } from './lib/services/elevation';
import { routeLeg } from './lib/services/routing';
import { simulate } from './lib/sim';
import { buildTerrainProfile } from './lib/terrain';

function browserStorage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

const storage = browserStorage();
const store = createStore(
  buildInitialState({ stored: loadStored(storage), hash: location.hash, language: navigator.language, now: Date.now() }),
);
const runtime = createRuntime(store);

startPipeline(store, {
  routeLeg,
  buildProfile: (route, activity, signal) => buildTerrainProfile(route, sampleElevations, { activity, signal }),
  simulate,
});
startSync(store, { storage, location, history });

// Dev-only handle for QA scripts (streams, actions); stripped from production builds.
if (import.meta.env.DEV) Object.assign(window, { __runsketch: runtime });

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
