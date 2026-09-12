#!/usr/bin/env node
// Live contract check for the key-less services Runsketch calls from the browser.
// Runs the real src/lib modules (Node >= 23.6 strips TypeScript types natively) against
// OSRM, BRouter, Photon, Open-Meteo, Mapterhorn and AWS terrarium, once each, sending a
// browser-like Origin header and verifying that every response carries CORS.
//
//   node scripts/smoke-services.mjs
import { registerHooks } from 'node:module';
import { inflateSync } from 'node:zlib';

const ORIGIN = 'https://runsketch.github.io';
const BERLIN = [
  [13.3777, 52.5163],
  [13.405, 52.52],
];
const LAUSANNE = [
  [6.6323, 46.519],
  [6.65, 46.53],
];

// The app imports '../geo' and './http' without extensions (bundler resolution); map them to .ts files.
registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (err) {
      if (!specifier.startsWith('.')) throw err;
      for (const suffix of ['.ts', '/index.ts']) {
        try {
          return nextResolve(specifier + suffix, context);
        } catch {
          // try the next suffix
        }
      }
      throw err;
    }
  },
});

const requests = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const url = String(input);
  const headers = new Headers(init.headers);
  headers.set('Origin', ORIGIN);
  const t0 = performance.now();
  const res = await realFetch(url, { ...init, headers });
  requests.push({
    host: new URL(url).host,
    status: res.status,
    cors: res.headers.get('access-control-allow-origin'),
    type: res.headers.get('content-type'),
    ms: Math.round(performance.now() - t0),
  });
  return res;
};

const routing = await import('../src/lib/services/routing.ts');
const geocode = await import('../src/lib/services/geocode.ts');
const elevation = await import('../src/lib/services/elevation.ts');

/** Minimal PNG decoder (8-bit RGB/RGBA, non-interlaced) so AWS terrarium tiles can be decoded without a canvas. */
function decodePng(buf) {
  let off = 8;
  let width = 0;
  let height = 0;
  let depth = 0;
  let colorType = 0;
  let interlace = 0;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      depth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  if (depth !== 8 || interlace !== 0 || (colorType !== 2 && colorType !== 6)) {
    throw new Error(`unsupported PNG depth=${depth} color=${colorType} interlace=${interlace}`);
  }
  const ch = colorType === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * ch;
  const out = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const o = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? out[o + x - ch] : 0;
      const b = y > 0 ? out[o - stride + x] : 0;
      const c = x >= ch && y > 0 ? out[o - stride + x - ch] : 0;
      let v = line[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      } else if (filter !== 0) throw new Error(`bad PNG filter ${filter}`);
      out[o + x] = v & 0xff;
    }
  }
  return { width, height, channels: ch, data: out };
}

const nodePngLoader = async (source, z, x, y, signal) => {
  const res = await fetch(source.url(z, x, y), { signal });
  if (res.status >= 400 && res.status < 500) return null;
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const png = decodePng(Buffer.from(await res.arrayBuffer()));
  return elevation.terrariumFromRgba(png.data, png.width, png.height, png.channels);
};

const results = [];
async function check(name, fn) {
  const before = requests.length;
  const t0 = performance.now();
  try {
    const detail = await fn();
    const mine = requests.slice(before);
    const noCors = mine.filter((r) => r.cors !== '*' && r.cors !== ORIGIN);
    if (mine.length === 0) throw new Error('no HTTP request was made');
    if (noCors.length) throw new Error(`missing CORS header from ${noCors.map((r) => r.host).join(', ')}`);
    results.push({ name, ok: true, detail, ms: Math.round(performance.now() - t0), http: mine });
  } catch (err) {
    results.push({ name, ok: false, detail: err instanceof Error ? err.message : String(err), ms: Math.round(performance.now() - t0), http: requests.slice(before) });
  }
}

const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

// The app gives each provider 8 s (DEFAULT_TIMEOUT_MS). BRouter has been seen taking ~12 s on a cold
// request, which in the app correctly falls through to OSRM; here the budget is wider so a slow day
// shows up as a latency warning instead of a contract failure.
const APP_TIMEOUT_MS = 8000;
const providerErrors = [];
const router = routing.createRouter({
  timeoutMs: 20_000,
  onProviderError: (spec, err) => providerErrors.push(`${spec.provider}: ${err instanceof Error ? err.message : String(err)}`),
});

async function routeCheck(a, b, profile, expected) {
  providerErrors.length = 0;
  const t0 = performance.now();
  const leg = await router(a, b, profile);
  const ms = performance.now() - t0;
  assert(leg.provider === expected && !leg.fallback, `expected ${expected}, got ${leg.provider} fallback=${leg.fallback}; ${providerErrors.join('; ')}`);
  assert(leg.coords.length > 5, 'too few vertices');
  const slow = ms > APP_TIMEOUT_MS ? ` — WARNING: slower than the app's ${APP_TIMEOUT_MS} ms budget, the app would fall back` : '';
  return `${leg.coords.length} vertices, ${Math.round(leg.distance)} m${slow}`;
}

await check('OSRM routed-foot · Berlin', () => routeCheck(BERLIN[0], BERLIN[1], 'foot', 'osrm'));

await check('BRouter hiking-mountain · Lausanne', () => routeCheck(LAUSANNE[0], LAUSANNE[1], 'hiking', 'brouter'));

await check('Photon search (lang ru → default)', async () => {
  const places = await geocode.searchPlaces('Brandenburger Tor', { bias: BERLIN[0], lang: 'ru' });
  assert(places.length > 0, 'no results');
  const p = places[0];
  assert(Number.isFinite(p.lon) && Number.isFinite(p.lat), 'bad coordinates');
  return `${places.length} results; first: ${p.name} — ${p.detail}`;
});

let meteo = [];
await check('Open-Meteo elevation', async () => {
  meteo = await elevation.fetchOpenMeteoElevations([LAUSANNE[0], BERLIN[0]]);
  assert(meteo.length === 2 && meteo.every(Number.isFinite), `bad response ${JSON.stringify(meteo)}`);
  assert(Math.abs(meteo[0] - 496) < 30, `Lausanne elevation ${meteo[0]} far from ~496 m`);
  return `Lausanne ${meteo[0]} m, Berlin ${meteo[1]} m`;
});

await check('Mapterhorn z13 webp tile · Lausanne', async () => {
  const t = elevation.lonLatToTile(LAUSANNE[0][0], LAUSANNE[0][1], 13, 512);
  const res = await fetch(elevation.MAPTERHORN_Z13.url(13, t.x, t.y));
  const bytes = (await res.arrayBuffer()).byteLength;
  assert(res.status === 200, `HTTP ${res.status}`);
  assert(res.headers.get('content-type') === 'image/webp', `content-type ${res.headers.get('content-type')}`);
  return `13/${t.x}/${t.y}, ${Math.round(bytes / 1024)} KB`;
});

await check('AWS terrarium z13 decode + bilinear vs Open-Meteo', async () => {
  const sample = elevation.createElevationSampler({
    loadTile: nodePngLoader,
    sources: [elevation.AWS_TERRARIUM_Z13],
    pointElevations: null,
  });
  const res = await sample([LAUSANNE[0], BERLIN[0]]);
  assert(res.source === 'aws-terrarium', `source ${res.source}`);
  const [laus, berlin] = res.ele;
  assert(Number.isFinite(laus) && Number.isFinite(berlin), 'NaN elevation');
  if (meteo.length === 2) {
    assert(Math.abs(laus - meteo[0]) < 20 && Math.abs(berlin - meteo[1]) < 20, `DEM ${laus.toFixed(1)}/${berlin.toFixed(1)} vs Open-Meteo ${meteo.join('/')}`);
  }
  return `Lausanne ${laus.toFixed(1)} m, Berlin ${berlin.toFixed(1)} m`;
});

let failed = 0;
for (const r of results) {
  if (!r.ok) failed++;
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}  (${r.ms} ms)`);
  console.log(`      ${r.detail}`);
  for (const h of r.http) console.log(`      ${h.status} ${h.host}  cors=${h.cors ?? '—'}  ${h.type ?? ''}  ${h.ms} ms`);
}
console.log(failed ? `\n${failed} of ${results.length} checks failed` : `\nall ${results.length} checks passed`);
process.exit(failed ? 1 : 0);
