import pkg from '../../package.json';

export const APP_NAME = 'Runsketch';
export const APP_VERSION: string = pkg.version;
export const REPO_URL = 'https://github.com/yukij3/runsketch';

/**
 * Name written into GPX creator, TCX Creator and FIT device_info. Empty by owner decision
 * (generated files carry no Runsketch signature); set to APP_NAME to sign files.
 */
export const FILE_CREATOR_NAME = '';

export const STORAGE_KEY = 'runsketch:v1';
export const HISTORY_LIMIT = 100;
export const MAX_IMPORT_WAYPOINTS = 60;

/** Debounce per pipeline stage, ms. */
export const DELAYS = { route: 250, terrain: 400, sim: 120 } as const;

export const POSITRON_STYLE_URL = 'https://tiles.openfreemap.org/styles/positron';
export const MAPTERHORN_TILEJSON_URL = 'https://tiles.mapterhorn.com/tilejson.json';
export const FIX_THE_MAP_URL = 'https://www.openstreetmap.org/fixthemap';
