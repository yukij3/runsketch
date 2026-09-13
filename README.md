# Runsketch

[![Runsketch in the browser: a 7.7 km loop over Montjuïc, Barcelona drawn on an open map, with stacked traces of elevation, pace, heart rate and cadence below it. The playhead sits at the top of the main climb, where recorded heart rate is 179 bpm against a demand of 173. The side panel holds route, athlete and session settings, and FIT, TCX and GPX download buttons.](docs/screenshot.webp)](https://yukij3.github.io/runsketch/)

Runsketch makes an activity file from a route you draw on a map. You set the route, the athlete and a target (pace, speed, finish time or effort level). It simulates the session second by second and writes a FIT, TCX or GPX file with what a watch would have recorded: position, altitude, heart rate, cadence, temperature, and power on rides.

It is a static site on GitHub Pages under the PolyForm Noncommercial License 1.0.0 (see [License](#license)). The map editor, the simulation and the file writers all run in your browser. There is no account, no API key and no backend of ours.

→ **https://yukij3.github.io/runsketch/**

[Коротко по-русски](#по-русски)

---

## How it works

Each leg between the points you click is routed along roads, paths or mountain trails by open routing services. Elevation is read from an open terrain model every 5 m along the route. Spikes from bridges and buildings are removed and the profile is smoothed before we turn it into grade.

The engine then goes along the route once per second. First it decides how the person moves: slower on climbs, a little faster on gentle descents, braking on steep ones, walking where a runner would walk. From speed, grade and ground it works out how much oxygen the muscles need, and heart rate follows that need with a delay. Cadence, power, GPS positions, altitude and device temperature come out of the same pass. The traces on screen and all three files are built from that one result, and the same inputs with the same seed give the same file.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/diagrams/effort-model-dark.svg">
  <img src="docs/diagrams/effort-model.svg" alt="Effort model: terrain grade feeds the speed plan, the speed plan sets heart-rate demand (metabolic %VO2R equals %HRR, plus a slow component of 10 bpm on foot and 15 on a ride), HR kinetics lag behind demand through a fast vagal part (tau 10 s rising, 30 s recovering) and a slow sympathetic part (tau 50 s rising, 100 s recovering while moving and 160 s once stopped), and a sensor model gives recorded HR. Weather runs through one heat balance, which compares the body in the real air with the same run in neutral air and then forks: a pace factor on the speed plan and a heat share folded into the heart-rate drift budget. Cadence, power, GPS error and altimeter come from the same run, and one seeded result feeds both the preview and the FIT, TCX and GPX files.">
</picture>

The formulas, constants and their sources are in [`docs/physiology.md`](docs/physiology.md), along with a list of the numbers that are still our own judgement rather than measurements.

## Features

- **Route.** Click to add points and drag to move them. Undo and redo, close the loop, out-and-back, reverse, GPX or TCX import, place search. Routing profiles for roads and paths, trails, alpine terrain, bike, road bike and MTB, or straight lines. The examples menu has a hilly run over Montjuïc in Barcelona, ascents of Elbrus, Kazbek, Mont Blanc, Kilimanjaro and Aconcagua, and two treks in Nepal.
- **Activity and athlete.** Run, ride, walk, hike and mountaineering. The athlete profile takes age, sex, weight, height, resting and maximum heart rate, fitness level and heart-rate sensor (chest strap or wrist).
- **Target.** Average pace, speed or finish time, or an effort level (Easy, Steady, Tempo, Race) solved for this athlete on this route. You can also enter an average heart rate: the pace stays as it is and the engine finds the fitness that gives that average. Even, negative or positive split, pace variability, stops, GPS noise and a seed.
- **Pace.** Grade, surface and technicality from OpenStreetMap tags, altitude, a warm-up, corners, stops, and fatigue that builds up from effort, climbing and descending rather than from elapsed time. On steep grades runners switch to walking and back. On a bike, speed comes from a power balance (Martin et al. 1998).
- **Heart rate.** A target from oxygen demand through heart-rate reserve, followed by a fast and a slow part. Both fall more slowly than they rise and respond faster in fitter athletes. On top: a slow component above threshold, cardiac drift that grows in heat, and chest-strap or wrist-sensor noise.
- **Weather and altitude.** Weather for the chosen date and place is filled in automatically and changes during the activity: temperature, wind, rain or snow, and wet ground. Altitude lowers aerobic capacity, up to high mountains.
- **Recorded signals.** GPS error that drifts over time instead of jumping from point to point, barometric altitude with its own drift, device temperature warmed by the wrist, running dynamics and auto-pauses at stops in FIT, and the occasional skipped second.
- **Files and app.** FIT, TCX and GPX with the same points and laps. Elevation, pace, heart rate (demand and recorded) and cadence on one shared playhead. Laps and splits, calories, a share link, metric and imperial units.

## Compared with other generators

Most activity generators we know of are paid. fakemy.run sells downloads in token packs, which came to about $0.42–0.60 per file in September 2026. SimuRun, Dibma and Fake My Stats charge per file, in credits or by subscription. Drawing and previewing are usually free there, and the file is what you pay for.

The main technical difference is where heart rate comes from. fakemy.run computes it as `avg · (0.7 + 0.3 · sin(π · i/N))` plus independent random noise at each track point, where `i/N` is the point's position in the list. So heart rate is lowest at the start and the finish and highest exactly halfway, whatever the terrain. A climb, a sprint or a stop doesn't change it, and with fresh noise at every point there is no inertia. Pace gets independent noise on each short segment and doesn't depend on grade.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/diagrams/hr-hill-dark.svg">
  <img src="docs/diagrams/hr-hill.svg" alt="Line chart of heart rate over a 28-minute, 5 km run with one hill. fakemy.run's heart rate is a noisy grey band that peaks at half-time on flat ground and falls during the climb. Runsketch's dashed heart-rate demand rises on the climb and drops at the crest; its solid recorded heart rate lags behind it: about 100 seconds into the climb it runs some 6 bpm under demand, then crosses over and sits 6 to 7 bpm above it by the top, and past the crest it holds 13 to 15 bpm above demand for half a minute, closing to within 3 bpm about a minute after the crest and within 2 bpm about two minutes after. Recorded heart rate peaks at 181 bpm against a maximum of 184, and wanders by about 2 bpm from minute to minute.">
</picture>

<sub>Runsketch lines are real engine output: 3 km flat, 800 m at +8 %, 800 m at −8 %, 400 m flat, 5:30/km, recreational runner, chest strap, seed 42. Grey: fakemy.run's formula at its defaults (avg 150, variability 10 %) over the same 1,655 seconds. The lag figures quoted here are read off a 31-second moving average of both lines, since the recorded trace carries about 2 bpm of minute-scale wander.</sub>

In Runsketch the terrain sets the speed, speed sets oxygen demand, and heart rate follows demand with a lag. In the chart, recorded heart rate runs a few beats under demand through the first half of the climb, passes it by the top as the slow component builds, and stays 13 to 15 bpm above demand for half a minute past the crest.

The rest, side by side:

| | Runsketch | fakemy.run |
|---|---|---|
| Formats | FIT, TCX, GPX | GPX |
| Cadence, temperature, power | cadence and device temperature; power on rides; running dynamics in FIT | not written |
| GPS | error correlated over time and distance | points on the routed line with sub-metre independent jitter |
| Preview and file | built from the same result | preview charts use their own random draws and differ from the file |

Two of the paid tools ship their generation code on a public page, commented, where anyone can read it. Fake My Stats computes pace from the same Minetti (2002) cost-of-running polynomial this project uses, with the paper named in a comment, and its heart rate rises on a 28-second time constant and recovers on a 55-second one. Ours separates the fast vagal response from the slower sympathetic one, so the equivalent ratio depends on the transition: 2.0 between efforts and 3.2 after a full stop. Which is closer to right is an open question — the studies that time both directions were done on cyclists and on clinical groups, and we know of none that measured runners on rolling ground. Their page says heart rate "ramps and recovers with a delay"; the code does what the claim says. Dibma layers a gradient multiplier, a cumulative climb-driven fatigue term and a separate drift term, and its GPS error is an AR(1) process, carried over from one point to the next rather than drawn fresh each second, which is the right shape for receiver noise. It writes FIT with cadence, stops and laps.

The differences that remain are narrower, and each can be checked against field data. Fake My Stats takes descent speed straight from the cost curve, as though effort were held constant: that gives 1.67 times flat speed at −10 % and 2.0 at −20 %, which the code then caps at 1.28–1.40. The cap keeps the numbers plausible, but it leaves the curve flat, so it never comes back down. Race records turn over instead, at about 1.23 at −10 %, 1.03 at −20 %, and slower than flat by −30 %, because runners brake on steep ground. Gradient enters their heart rate uphill only, so a descent leaves it untouched, where here a fast descent keeps heart rate up. Dibma's climb multiplier stops at 1.50 from +12 % upward, where a climb of +20 % costs nearer 2.1; its drift and its late fatigue are keyed to a fraction of the activity rather than to elapsed time, so a half-hour run and a five-hour run drift alike, and its heart-rate lag is applied once per record, so the time constant follows the recording rate. SimuRun reads the terrain into its heart rate over a lagged window, but its pace has no gradient term at all, being distance over a single average speed, so its two channels describe different runs.

On climbs we come out the fastest of the three rather than the slowest. At +10 % the Minetti equal-effort curve gives 0.60 of flat speed and the race records 0.65, while this engine gives about 0.74. That rests on the observation that runners do not hold effort constant on hills (Townshend 2010), which is a modelling choice and not a settled question.

Ten of these differences are measured rather than argued about in [`docs/comparison.md`](docs/comparison.md): climbs and descents against hill-race records, heart-rate lag and drift, fade over a marathon, second-to-second texture against a real watch file, stops and heat. It says where we come out worse too — our climbs are faster than the records by design, our default runner fades less than a typical marathon field, and we model no cold penalty at all.

On the free side, gpx.studio is an open-source route editor built on the same kind of open services. Its default timing mode spreads a total duration over the route by gradient, spending more time on climbs; a constant speed is the manual alternative. It doesn't invent heart rate, cadence or power, though it does preserve those channels when they are already in a file you import. The open-source generators we've looked at on GitHub mostly need a Mapbox token, a routing API key or a server of their own, and most of them write no heart rate.

## The model

Details and citations: [`docs/physiology.md`](docs/physiology.md), with [terrain](docs/terrain.md), [fatigue](docs/fatigue.md), [weather](docs/weather.md), [mountaineering](docs/mountaineering.md) and [what the watch records](docs/recording.md) on their own pages. Short version:

- **Grade → speed.** Pace factor `F(g) = 0.0021g² + 0.034g + 1` (g in %), applied as `F^-0.7` uphill and `F^-0.8` downhill, so runners work a little harder uphill and ease off downhill; steep descents blend toward Kay's (2012) record-pace curve by how well the athlete descends, capped at 1.15–1.24× flat speed; walking and hiking use Tobler's function, mountain days the Swiss hiking curve; rides solve Martin et al. (1998) for speed from a power plan.
- **Demand.** Net VO₂ from Minetti et al. (2002) energy cost, `%HRR = %VO₂R` (Swain & Leutholtz 1997), HRmax `208 − 0.7·age` (Tanaka 2001).
- **Inertia.** Two parallel first-order parts, each slower to recover than to rise and scaled by fitness: a fast vagal part for the first 25 % of heart-rate reserve (τ 10 s up, 30 s down) and a slow sympathetic part above it (τ 50 s up, 100 s down while moving, 160 s once stopped); a slow component above threshold, 10 bpm on foot and 15 on a ride; cardiac drift after ~12 min, more of it in the heat (Wingo 2005, Coyle & González-Alonso 2001).
- **Fatigue.** Load is counted by effort rather than by the clock, with descents doing extra damage, glycogen running down towards the wall, and running economy slowly getting worse — which is what holds heart rate up while pace falls.
- **Noise.** Ornstein–Uhlenbeck processes on log-speed (long-range correlated, not white), on HR and on GPS error.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/diagrams/model-curves-dark.svg">
  <img src="docs/diagrams/model-curves.svg" alt="Two small line charts, each speed given relative to that same gait on the flat. Grade to speed: running drops to 0.74× at a +10 % climb and 0.53× at +20 %; downhill it peaks at 1.16× at −9 % and then turns back down, and a shaded band shows descent skill spreading the descent branch from beginner to elite, whose upper edge is Kay's (2012) curve fitted to hill-race records and peaks at 1.23× at −10 %. Walking follows Tobler's curve, peaking at 1.19× at −5 %. Running at constant energy cost would mean 2.0× at −20 %, which leaves the top of the chart, so energy cost alone does not set downhill pace. Heart-rate inertia: when demand steps from 120 to 150 bpm, heart rate covers 63 % of the step in 50 seconds; when demand drops back to 120 bpm it covers 63 % of the fall in 100 seconds if the runner keeps moving, and 160 seconds once stopped.">
</picture>

<sub>Real engine output. Left: the solid line is a recreational runner, the band runs from beginner to elite. Right: a recreational runner with resting heart rate 55 and maximum 185 bpm.</sub>

## Data sources

All reached directly from your browser. Please respect their fair-use policies.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/diagrams/architecture-dark.svg">
  <img src="docs/diagrams/architecture.svg" alt="Architecture: GitHub Pages serves static files once. The map and route editor, the simulation engine and the FIT, TCX and GPX writers all run in your browser. The editor calls five open, key-less services over HTTPS: map tiles from OpenFreeMap with a Mapterhorn hillshade; routing from BRouter, FOSSGIS OSRM and FOSSGIS Valhalla, in an order that depends on the routing profile and ending in a local straight line, with Valhalla also returning each way's surface, sac_scale, bridge and tunnel tags; elevation from Mapterhorn, then AWS Terrain Tiles, then Open-Meteo; weather from Open-Meteo for the route's date and place, as a forecast, a historical forecast, the archive, or an analog year for dates past the forecast horizon; and place search from Photon. There is no server of ours: no accounts, keys or uploads.">
</picture>

- Map tiles: [OpenFreeMap](https://openfreemap.org) © [OpenMapTiles](https://openmaptiles.org), data © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright) (ODbL)
- Routing: [BRouter](https://brouter.de), [FOSSGIS OSRM](https://routing.openstreetmap.de), [FOSSGIS Valhalla](https://valhalla1.openstreetmap.de) for mountain trails and for the surface and difficulty tags of each way
- Elevation: [Mapterhorn](https://mapterhorn.com/attribution), fallback [AWS Terrain Tiles](https://registry.opendata.aws/terrain-tiles/), [Open-Meteo](https://open-meteo.com) (Copernicus GLO-90)
- Weather: [Open-Meteo](https://open-meteo.com) ([CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)), with ERA5 from the [Copernicus Climate Change Service](https://cds.climate.copernicus.eu); values are interpolated along the route and adjusted for its elevation
- Search: [Photon](https://photon.komoot.io) by komoot
- FIT encoding: [@markw65/fit-file-writer](https://github.com/markw65/fit-file-writer) (MIT)

## Development

```sh
npm ci
npm run dev        # http://localhost:5173
npm test           # vitest (XSD validation needs xmllint)
npm run build      # typecheck + production build
```

Pushing to `main` runs tests and deploys `dist/` to GitHub Pages (`.github/workflows/deploy.yml`).

---

## По-русски

Runsketch делает из маршрута, нарисованного на карте, файл тренировки в формате FIT, TCX или GPX. Пульс в нём меняется вслед за рельефом с задержкой. Всё работает прямо в браузере, без аккаунта, ключей и сервера; остальная документация на английском.

## License

Runsketch is licensed under the [PolyForm Noncommercial License 1.0.0](LICENSE) (SPDX `PolyForm-Noncommercial-1.0.0`).

You may use, copy and change it, and build on it in other projects, for free and for any noncommercial purpose. You may not make money from it: selling it, paid hosting, paid features and ads are all commercial use.

Every copy and every changed version, including a hosted one, must carry the credit line from [LICENSE](LICENSE): `Required Notice: Copyright 2026 Dmitrij Tretakov (https://github.com/yukij3/runsketch)`.

The third-party libraries and data listed above keep their own licenses.
