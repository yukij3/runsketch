# Runsketch — implementation plan

Free, open-source, fully client-side alternative to fakemy.run.

## Why it exists (the two complaints)

1. **Paid.** fakemy.run charges $0.47–0.80 per GPX; Dibma, SimuRun, Fake My Stats likewise. → Everything here is static, key-less, MIT.
2. **Heart rate ignores terrain and has no inertia.** fakemy.run: `HR = avg·(0.7+0.3·sin(π·i/N)) + white noise` — index-driven hump, blind to hills, i.i.d. jitter, real mean ≈ 0.89·avg. → One effort model drives every channel; HR follows metabolic demand through first-order kinetics with asymmetric time constants, slow component and cardiac drift.

## Architecture

```
Browser only (GitHub Pages)
├─ MapLibre GL 6 + OpenFreeMap positron (tiles)      attribution: OSM, OpenMapTiles
├─ Routing   BRouter → FOSSGIS OSRM → straight line   per-leg, cached, 1 req at a time
├─ DEM       Mapterhorn terrarium webp z13 → AWS terrarium png → Open-Meteo points
├─ Search    Photon (debounced autocomplete)
├─ Engine    src/lib/sim  (pure TS, seeded, 1 Hz)
└─ Export    FIT (@markw65/fit-file-writer, MIT) · TCX v2+AX2 · GPX 1.1+TPX v1
```

```
src/
  lib/types.ts            shared contract (do not break)
  lib/geo/                haversine, bearing, resample, polyline codec, bbox
  lib/services/           http queue, routing, elevation (terrarium decode), geocode
  lib/terrain/            DEM sampling → despike → smooth → grade → ascent (TerrainProfile)
  lib/sim/                rng, pace (Minetti/GAP, Tobler, cycling power), hr kinetics,
                          cadence, stops, gps noise, simulate(), stats/laps
  lib/export/             gpx, tcx, fit, download, filenames
  lib/import/             gpx/tcx route import
  app/                    store (useSyncExternalStore), persistence (localStorage + URL hash), i18n (en, ru)
  ui/                     MapPlate, DrawToolbar, SearchBox, ProtocolSheet (sections), Traces (SVG charts + playhead), ExportBar
  styles/                 tokens.css, base.css
```

## Simulation pipeline (1 Hz)

1. **Terrain**: resample route every 5 m → DEM bilinear sample → median(5) despike → Gaussian σ≈20 m → grade on centred 40 m baseline, clamp ±45 % (foot) / ±25 % (bike) → ascent with 3 m hysteresis.
2. **Speed plan** (per profile point):
   - Run: Minetti 2002 cost `Cr(i)`; speed on grade chosen so `Cr(i)·v ≈ Cr(0)·v_flat` (constant metabolic power), partial compliance (runners do not fully hold effort), downhill speed cap on steep descents.
   - Walk/hike: Tobler hiking function scaled to target.
   - Ride: solve `P = v·(m·g·(Crr·cosθ + sinθ) + ½ρ·CdA·v²)` for v at target power, braking cap on descents.
   - Target calibration: iterate so moving time matches target pace/duration.
   - Pacing strategy (even/negative/positive), warm-up ramp, fatigue fade, turn slowdowns at sharp bearings.
3. **Integrate in time**: step 1 s along the distance axis with speed plan × correlated noise (Ornstein–Uhlenbeck on log-speed, τ≈20–60 s) → positions at every whole second. Stops (urban: lights/crossings) as zero-speed intervals.
4. **Metabolic demand → HR demand**: intensity = VO2(v, grade)/VO2max (fitness-level VO2max), `%HRR ≈ %VO2R` (Swain) → `HRss = HRrest + %HRR·(HRmax−HRrest)`.
5. **HR kinetics**: `dHR/dt = (HRss + drift + slow − HR)/τ`, τ_on ≈ 30 s (trained) … 50 s (beginner), τ_off ≈ 1.3–2× τ_on; slow component above threshold; cardiac drift ∝ intensity·duration·temperature; AR(1) sensor noise ±1–2 bpm; clamp to [rest, max].
6. **Cadence**: run spm from speed (step-length model, ~150–190), grade effect, noise; ride rpm 75–95 with coasting on descents; walk ~100–125.
7. **Power**: cycling from the model; running power estimate `m·v·Cr/η`-style.
8. **GPS**: correlated horizontal error (OU, σ 1.5–4 m, τ ≈ 30–60 s) + tiny white jitter; altimeter drift ±0.5 m.
9. **Stats**: moving/elapsed, laps per km/mi, avg/max, ascent from recorded elevation with hysteresis, calories.

Preview === export: one `simulate()` result feeds charts and all writers.

## UI (direction: lab protocol sheet)

See the contract comment in `index.html`. Map plate + drawing toolbar, stacked traces with shared playhead (elevation/grade, pace, HR demand vs response, cadence), protocol sheet (route, athlete, session, export). EN/RU, metric/imperial.

## Phases

| # | Phase | Output | Verification |
|---|---|---|---|
| 1 | Contract + scaffold | types, config, deps | `tsc`, `vite build` |
| 2 | Engine (parallel) | geo+services+terrain · sim · export+import | unit tests, round-trip decode, XSD-shape tests |
| 3 | Physiology realism review | adversarial panel on HR/pace traces | scenario tests (climb lag, recovery, drift, stops) |
| 4 | UI build | app shell, map, sheet, traces, export | browser run via chrome-devtools, desktop + mobile |
| 5 | Integration QA | end-to-end: draw → simulate → download → decode | real network calls to BRouter/Mapterhorn |
| 6 | Finish review | impeccable finish reviewer | disposition ship/fix |
| 7 | Publish | GitHub repo, Actions → Pages, README | live URL loads, CI green |

## Non-goals

No accounts, no backend, no device/app spoofing in files, no direct Strava upload (needs a client secret).
