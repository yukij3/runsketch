# Changelog

## 0.2.0 — 2026-09-13

A realism release. The engine still makes one deterministic pass per second, but most of what happens inside that pass has changed: fatigue is counted by effort instead of by the clock, weather is fetched for the date and place and acts second by second, mountain days are modelled up to 8849 m, and the recorded signals look more like what comes off a watch.

### Terrain and ground

- Surface and difficulty tags now come from the routing data (BRouter and Valhalla) and set speed, energy cost and footing per way, instead of every path costing the same.
- One grade limit and one ascent algorithm for the whole app, a DEM patch filter that also runs on steep trails, and bridges and tunnels interpolated across instead of following the terrain under them.
- Climbs use an exponent of 0.7 and descents 0.8, with steep descents blending toward Kay's record-pace curve by how well the athlete descends, and speed carried over a crest rather than snapping back.
- Runners walk steep ground when walking is genuinely faster, in bouts of varying length, and keep a vertical-speed ceiling that matches their level.
- Rough ground is no longer counted twice for walkers: a walk takes the slower speed and the dearer cost of surface and difficulty rather than their product, which is what made a rocky trek descent crawl. Running still pays both.

### Fatigue

- Load is effort-weighted rather than a fixed percentage per hour: the same distance costs more when it was run harder, and descents leave extra damage that shows up later in the run.
- Glycogen runs down toward a wall with a fuel intake that depends on the athlete's level; past the wall the pace turns ragged, with walk breaks, instead of getting smoother.
- A small reserve above critical speed (D′) drains on climbs and refills below it, and running economy slowly gets worse — which is what holds heart rate up while pace falls.
- The race preset bends Riegel's exponent by level, so a beginner fades more over a marathon than an elite runner.

### Heart rate

- The recovery constant matches what is measured: about 100 s while still moving, 160 s only once stopped, with a faster fall after brief surges and a short hold when starting again.
- The slow component is 10 bpm on foot and 15 on a ride; cardiac drift has a soft ceiling and shares its budget with the economy loss instead of stacking on top of it.
- Heart rate no longer sits on a flat shelf at the maximum: it is squeezed below the altitude-adjusted maximum and never goes above it.
- Minute-scale wander was added, so the share of unchanged consecutive samples now matches a real strap file.
- Drift, heat strain and the loss of economy now share one budget instead of stacking, so a beginner's long steady run no longer ends pinned at 94–97 % of maximum heart rate; the drift rate itself varies by level.

### Weather

- Choosing a date and place fetches the weather from Open-Meteo — archive, recent forecast or an analog year, depending on how far away the date is — and adjusts it for the route's elevation.
- The field is sampled at the athlete's position and time every second, so a long activity walks into its own weather: temperature, wind, rain and snow all change along the way.
- Wet, muddy, snowy and icy ground is tracked per place with a 48-hour spin-up, so descents are slower where rain actually fell, and ice is graded between +1 and −2 °C.
- A two-node heat balance with clothing, sweating and shivering drives both heart rate and pace, in manual and automatic weather alike; in neutral conditions it changes nothing. Skin blood flow follows the effort's own set point, so skin warms by the measured 2–3 °C between 15 and 25 °C and a 10 km in the heat loses the few per cent it should.
- Wind costs energy on foot and changes air speed on a ride; pressure moves the barometric altitude.

### Mountaineering

- A new activity for mountain days: the Swiss hiking curve with SAC difficulty, climbs limited by the oxygen available rather than by the legs, pack and footwear costs, snow by depth, a snowline that follows latitude, and the breaks of a long summit day.
- Altitude physiology reaches 8849 m with acclimatisation, a falling maximum heart rate and a rising resting rate; hikes high up are paced by the air, which brings the Nepal treks into guide hours.
- High on a mountain the walking gait falls into a rest step instead of shuffling at the walking cadence floor, on the way up only — descents keep a walker's cadence, and plunge-stepping down firm snow is no longer slower than kicking steps up it.
- Example routes for Elbrus, Kazbek, Mont Blanc, Kilimanjaro, Aconcagua, Everest Base Camp and Thorong La.

### What the watch records

- GPS error settles at the start and then holds its offset until a correction jump, rather than jittering independently each second; corner speeds are capped by lateral acceleration.
- Recorded speed is lightly smoothed with a slowly wandering sensor error, so 1 s changes and 1-minute variation match a decoded watch file.
- The barometer has its own texture and weather drift, the temperature sensor follows a wrist warmed by the body and cooled by wind and rain, and the odd second goes missing.
- FIT files carry auto-pause timer events, running dynamics from a strap and temperature; averages are taken over timer time, so stops no longer dilute them.

### App

- An examples menu, weather rows with pins in automatic or manual mode, start time in the route's time zone, and share links that carry the weather settings.
- Warnings say which limit bound the result — oxygen at altitude, climbing rate, flat pace or walking speed — and are written in English and Russian.

### Docs and license

- The model is documented across `docs/physiology.md` and separate pages for terrain, fatigue, weather, mountaineering and what the watch records, each with the numbers the code actually uses and a list of what is still a guess.
- The README describes the tool plainly, in English and Russian.
- `docs/comparison.md` measures ten differences from other generators against published field data — climbs, descents, heart-rate lag and drift, marathon fade, second-to-second texture, stops and heat — including the rows where we come off worse and the two that have no field reference at all.
- The license changed from MIT to PolyForm Noncommercial 1.0.0 with a required credit line. Free use and changes for any noncommercial purpose; making money from it is not allowed. Version 0.1.0 and earlier stay MIT.

## 0.1.0 — 2026-09-13

The baseline: a drawn route becomes GPX, TCX and FIT files through one deterministic per-second simulation, with terrain-driven pace, heart rate that lags behind demand, calibration to a pace, speed, finish-time or effort target, and a map editor that runs entirely in the browser.
