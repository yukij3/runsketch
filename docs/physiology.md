# Physiology & motion models

This is the page for the part of Runsketch that turns movement into a heartbeat: how much oxygen a given speed on a given slope asks for, what share of this person's capacity that is, how their heart rate follows it with a delay, and how one effort scale is solved so the activity lands on the pace or duration you asked for. Some numbers are measured, some are our own judgement. The judgement calls are marked and listed at the end.

The ground under the route, what a long day does to the athlete, thin air, weather and the file itself have their own pages:

- [Terrain](terrain.md) — elevation data into grade, speed up and down, surfaces, when a runner walks, cadence on hills, altitude to 2800 m.
- [Fatigue](fatigue.md) — load, descent damage, glycogen and the wall, D′, running economy, how a marathon comes apart.
- [Treks and high mountains](mountaineering.md) — altitude to 8849 m, oxygen-capped climbs, pack and boots, mountain breaks.
- [Weather](weather.md) — heat, cold, wind, rain, and what they do to the heart and the ground.
- [What the watch records](recording.md) — GPS, barometer, sensors, pauses and the exported files.

## The idea in one paragraph

Most fake-run generators start with the heart rate. They take an average, draw a hump over the whole activity and sprinkle jitter on top. That is why the files look wrong: the heart rate has nothing to do with the hill the runner just went up, and it jumps about from one second to the next in a way no heart does. Runsketch works the other way round. First it decides how a person would move along the route. From that movement it works out how much oxygen the muscles need. The heart rate follows that need with a delay, like a real heart. Cadence, power, position and altitude come out of the same pass. Everything is computed once per second, and the same inputs with the same seed always give the same file.

## From movement to oxygen

Every second of movement becomes an oxygen demand: net VO₂ in ml/kg/min, above rest.

**Running.** Here we use the heart-rate pace factor F(g) rather than Minetti's energy cost:

```
VO₂net = 3.6 J/kg/m × v × F_hr(g) × 60 / 20.9
```

3.6 J/kg/m is the cost of running a flat metre and 20.9 kJ the energy released per litre of oxygen, both from Minetti et al. (2002). The quadratic F(g) itself, its shape and where it comes from are described on the [terrain](terrain.md) page, which also owns the speed a runner actually holds on a slope.

F_hr differs from F in two places, both downhill:

- Below the vertex of the parabola, −8.1 %, F rises again. That rise is braking and footing, not the heart working harder, so for heart rate the factor is held at its lowest value from there on.
- Braking still costs something, so the heart-rate-equivalent speed never falls below **85 %** of the flat speed of the same effort. At the same oxygen uptake, trail runners' heart rate was higher running fast downhill than running uphill (Lemire et al. 2021), and traces show steep descents sitting only 10–25 bpm under the flats around them.

When a runner walks a steep bit in the middle of a run, heart-rate demand never drops below **half** of what flat running at the planned pace would ask. Somebody power-hiking a climb is still braced and working, and Minetti's walking cost alone would put them at a stroll.

**Walking.** Minetti's walking cost for the grade, times a penalty for walking fast: above 1.3 m/s walking gets expensive quickly, about ×1.2 at 1.8 m/s. That penalty is a rough fit to the classic U-shaped cost curve (Ralston 1958), not a published formula. Packs, boots and slow mountain walking add their own factors, described on the [mountaineering](mountaineering.md) page.

**Cycling.** Crank power divided by a gross efficiency of 21 % and body mass, minus the resting 3.5 ml/kg/min. Coasting doesn't fall to zero: holding position, cold air and concentration cost something, which we put at 12 % of the VO₂ reserve at low speed rising to 24 % at 58 km/h. That one is an estimate.

Two multipliers sit on top of all of these. The ground multiplies the cost per metre — sand, rough trail, snow — as described on the [terrain](terrain.md) and [mountaineering](mountaineering.md) pages. Running economy slowly gets worse as load builds up, which is on the [fatigue](fatigue.md) page. Both raise oxygen demand at an unchanged speed, so both show up in the heart rate.

Demand is then low-passed: 5 s on foot, 8 s on the bike. Muscles don't answer single strides or pedal strokes, and neither does the oxygen they draw.

Altitude lowers the capacity this demand is measured against, 6.3 % per 1000 m from 300 m up to 2800 m and by the oxygen pressure of the air above that. The details are on the [terrain](terrain.md) and [mountaineering](mountaineering.md) pages.

<!-- chart: oxygen demand against speed for running, walking and cycling, with the downhill heart-rate floor marked against Minetti's falling cost -->

## How hard that is for this person

Oxygen demand becomes a target heart rate through the heart-rate reserve. Swain & Leutholtz (1997) showed that the share of heart-rate reserve used matches the share of VO₂ reserve almost exactly (slope 1.00, intercept −0.1):

```
share  = VO₂net / (VO₂max − 3.5)
demand = HRrest + (HRmax − HRrest) × (0.08 + 0.92 × share)
```

The 0.08 is there because resting heart rate is usually measured lying down or sitting, and standing up alone adds around ten beats. The share is capped at 1.15, and the result is squeezed twice: once smoothly from 18 bpm below the maximum towards 6 below it, which is the flattening lab tests see near the top, and once at the very end, from 5 below towards 1 below. Resting and maximum heart rate are not constants either: at altitude both move, every second, as described on the [mountaineering](mountaineering.md) page.

If you don't enter your own values, the defaults are:

| | Beginner | Recreational | Trained | Elite |
|---|---|---|---|---|
| VO₂max at 35, ml/kg/min (women −6) | 35 | 45 | 55 | 66 |
| Lactate threshold, share of VO₂ reserve | 0.70 | 0.75 | 0.83 | 0.88 |
| Heart-rate response times | ×1.4 | ×1.0 | ×0.75 | ×0.6 |
| Warm-up, first 5 minutes slower by | 6 % | 5 % | 4 % | 3 % |

VO₂max is adjusted for age from that 35-year-old baseline. People who keep training hold their capacity fairly well into their fifties and lose it faster afterwards (Tanaka & Seals 2008), while population averages fall about a tenth per decade (Kaminsky et al. 2015), which overstates the loss at a fixed fitness level. Our curve sits between them:

| Age | 25 | 35 | 45 | 55 | 65 | 75 |
|---|---|---|---|---|---|---|
| VO₂max against age 35 | 1.02 | 1.00 | 0.945 | 0.88 | 0.80 | 0.72 |

Maximum heart rate defaults to 208 − 0.7 × age (Tanaka et al. 2001, a meta-analysis of 351 studies with 18,712 people). Resting heart rate is taken as entered, and never closer than 40 bpm to the maximum.

<!-- chart: %VO2 reserve to heart rate for the four levels, with the two soft caps near the maximum and the upright floor marked -->

## Two things that make the target creep up

**The slow component.** Above the lactate threshold, heart rate never really settles: it keeps climbing with blood lactate. We add up to **10 bpm on foot and 15 bpm on a bike**, in proportion to how far above threshold the effort sits, building with a 7-minute time constant (Zakynthinaki 2015) and fading a little more slowly, 7.5 minutes, when the effort eases. The split between the sports follows Carter et al. (2000), who measured a slow component about a third smaller in running than in cycling.

**Cardiac drift.** During a long effort the heart pumps slightly less blood per beat and makes up for it by beating faster (Coyle & González-Alonso 2001). In the engine, drift starts after 12 minutes of moving time, grows with intensity, partly wears off while you stand still, and is held by a soft limit rather than a hard cut: it rises freely to about 10 % of the heart rate and then bends towards a ceiling of 18 %. Because the [fatigue](fatigue.md) page's economy loss already raises oxygen cost on its own, drift keeps 90 % of its rate, so the two are not counted twice.

Drift has one rate: 3 % of heart rate per hour of moving time, calibrated at 15 °C in calm, dry air, and scaled by level — a beginner's heart drifts nearly twice as fast as an elite one, which is on the [fatigue](fatigue.md) page. It no longer bends with temperature; that curve is gone. Heat and cold reach the heart only through the heat balance on the [weather](weather.md) page, which compares this activity with the same movement in that same neutral air and adds the difference to the drift before the shared ceiling: **8 % per °C of core temperature** and **9 % per 1 % of body mass lost**. In neutral air the difference is exactly zero, so nothing is counted twice, and cold air makes it negative. Over 90 minutes at 3 m/s that comes to about 14 bpm of drift at 25 °C against 10 bpm at 10 °C. Heat now reaches the pace as well.

<!-- chart: drift and the slow component over a 90-minute steady run — demand with each part switched on in turn -->

## Heart-rate inertia

This is the part paid generators skip, and the reason Runsketch exists.

A heart doesn't jump to a new rate when effort changes. The first part of the rise when you set off is quick: the vagus nerve simply stops holding the heart back. Going higher needs the sympathetic system and adrenaline, which is slower. Coming back down is slower again. Some measured time constants, for scale:

- Starting light cycling: τ ≈ 8 s in endurance-trained people, ≈ 27 s in untrained ones.
- Treadmill in healthy adults: τ ≈ 33 s going up, ≈ 96 s coming down after stopping.
- Treadmill running, 11 healthy adults (8 men, 3 women, mean age 32.5), with the speed nudged ±0.25 m/s around each person's own moderate-to-vigorous pace: a single exponential fits at τ = 70.6 ± 16.8 s, and two fit better, at 18.6 ± 7.9 s and 38.0 ± 16.0 s.
- Trained rowers against untrained students: half-time 24 s against 47 s (Bunc et al. 1988).

We split the heart rate above rest into two parts that move independently:

| Part | Covers | Rising | Falling |
|---|---|---|---|
| Vagal | the first 25 % of heart-rate reserve | τ = 10 s | τ = 30 s |
| Sympathetic | everything above it | τ = 50 s | τ = 100 s after a held effort, 160 s once you stop |

That running study is the closest thing we have to a measurement of the rising side, and it is worth being exact about what it does and doesn't support. The shape is ours: something fast, then something slower, fitting better than a single exponential. The constants are not. We rise with 10 s and 50 s against their 18.6 and 38.0, and we scale both by fitness and split them by share of heart-rate reserve instead of running a plain two-exponential cascade. Nor can that protocol say anything about coming back down: it perturbs the speed around one operating point and detrends the result, which is how you measure a linearised response, and a linearised response has no asymmetry in it to find.

All of them are multiplied by the fitness factor from the table above. Two more details come from looking at traces:

- **After a short surge the fall is faster.** A minute-long push doesn't leave the adrenaline of a twenty-minute climb, so the falling time constant slides from 100 s for an effort held for minutes down to 60 s for a brief one. How brief is judged by how far a 2-minute average of the sympathetic part still sits above a 10-minute one.
- **Setting off again after a stop.** For 20 seconds after the first moving second, heart rate stops falling. Without this it kept sagging for half a minute while the runner was already accelerating, which looked wrong. Sympathetic withdrawal also pauses whenever demand is climbing back towards its recent trend.

Two parts behave in a way one delay can't. Setting off from standing, heart rate shoots up within seconds. A change high in the range, like the start of a climb or cresting it, is slow and lopsided. For a recreational athlete, covering 63 % of a step takes:

| Step | Going up | Coming down |
|---|---|---|
| 70 ↔ 100 bpm | ≈ 20 s | ≈ 50 s |
| 120 ↔ 150 bpm | ≈ 50 s | ≈ 100 s |

The same 100 → 160 bpm rise takes about 30 s for an elite athlete, 50 s for a recreational one and 70 s for a beginner. Recovery after a climb is no longer the very slow fall it used to be: the falling constant for a held effort is 100 s, not 160 s, and 160 s is kept for standing still, where the classic post-exercise curve belongs. What that looks like on a hill, crest by crest, is on the [terrain](terrain.md) page.

The activity starts with heart rate 20 beats above resting.

<!-- chart: heart rate against demand over a climb and a stop — the vagal and sympathetic parts drawn separately, with the restart hold marked -->

## From true heart rate to what the file shows

Everything above is the "true" heart rate. Before it reaches the file, three things happen to it, and the first two belong here rather than to the sensor.

- **Near the maximum.** The trace is squeezed smoothly into the last beat below the maximum, starting 4 bpm under it. A real recording doesn't sit on a flat shelf at HRmax, and a hard clamp would draw exactly that.
- **Physiological wander.** Breathing, posture, footing and small changes of effort move the heart rate around its own kinetic response. We add a slow wander, cut to half while standing still, and fading out within 10 bpm of the maximum where the heart has no room left to vary. How large it looks depends entirely on how you measure it: around a 61-second moving average over the steady middle of a run it comes to about 2 bpm, against 1.5 bpm in the one strap file we decoded, so we are the noisier of the two. The [recording](recording.md) page gives the window, the span and the comparison. Anything that still crosses the maximum after the noise is reflected back below it, so the ceiling is never a flat line.
- **The sensor.** A chest strap tracks the truth closely; an optical sensor averages over a few seconds, under-reads the first ramp and glitches now and then. The sizes are on the [recording](recording.md) page.

The file carries whole beats, between resting − 5 and the maximum for that second, never above it.

## Cadence and running power

Cadence starts from a straight-line fit to treadmill data from 30 experienced runners, 169 steps per minute at 2.7 m/s and 178 at 3.8 m/s:

```
spm = 147.6 + 7.9 × v          v in m/s
```

Taller runners take fewer, longer steps: Burns et al. (2019) found 123 fewer steps per minute per metre of height among 100 km racers, and we use 120 per metre against a 1.75 m reference. Running cadence stays between 140 and 205 steps per minute, walking between 80 and 135, and a run starts 2.5 steps per minute lower for the first five minutes. What grade does to cadence is on the [terrain](terrain.md) page; the wander a watch records, and the blend from walking cadence as someone sets off, are on the [recording](recording.md) page.

Cycling cadence is 90 rpm on the flat, 2.4 rpm less per percent of climb, between 62 and 100, and 5 rpm lower for beginner and recreational riders. Professionals average 89 rpm on flat stages and 71 on long mountain climbs (Lucia et al. 2001). It ticks up briefly when power surges, drops to zero while coasting, and can't exceed what the lowest gear allows at crawling speed.

For runs we also estimate Stryd-style running power, m·v / 0.98 scaled by Minetti's cost ratio for the grade — in full uphill, square-rooted downhill so descents don't collapse to nothing — with 3 % noise. Rides carry the crank power from the model below. Walks, hikes and mountain days carry none, since there is no mainstream walking power meter to imitate.

## Cycling physics

On a bike it works the other way round: the rider has a power plan and the speed comes out of the physics. The model is Martin et al. (1998), which predicted measured power with R² = 0.97 and a standard error of 2.7 W:

```
P·Ec = v·[ ½ρ(CdA + Fw)·v² + Crr·m·g·cos θ + (91 + 8.7·v)·10⁻³ + m·g·sin θ ] + (m + I/r²)·v·dv/dt
```

| Constant | Value | Where from |
|---|---|---|
| Chain efficiency Ec | 0.977 | Martin 1998 |
| Wheel drag area Fw | 0.0044 m² | Martin 1998 |
| Wheel inertia I, radius r | 0.14 kg·m², 0.311 m | Martin 1998 |
| Drag area CdA | 0.32 m², on the hoods | typical value |
| Rolling resistance Crr | 0.004 | typical road tyres |
| Bike | 9 kg | typical value |

Air density comes from altitude and air temperature, and the equation is stepped four times a second. Wind acts on the air speed rather than the ground speed, so a tailwind faster than the rider pushes; the wind itself is on the [weather](weather.md) page, and the surface under the tyres on the [terrain](terrain.md) page.

Riders push harder uphill and ease off going down: flat power × (1 + 0.03 per percent of grade), between 0 and 1.35 times. That rule is a simplification, not a measured curve. Above 40 km/h on descents steeper than −4 % the rider stops pedalling and brakes towards about 65 km/h on long ones; on gentle descents there are pedal bursts of 3–8 s every 40–120 s, and on the flat short freewheel breaks of 2–5 s every 1–3 minutes. Power carries pedal-stroke surges (1 s and 3 s) and slower wander (20 s and 60 s), and the drag wanders too, for position changes and gusts. If a climb is too steep for the planned power the rider crawls at 3.6 km/h rather than stopping, and the file says so.

## One effort scale for the whole activity

Everything above describes relative speed: this grade against the flat, this surface against asphalt, this hour against the first. What sets the absolute level is a single effort scale, solved so that **moving time matches your target within 0.5 %**. Ask for 5:30/km and you get 5:30/km on average, whatever the hills did along the way. The search is a bracketed root find on the scale, and because the same integrator runs the search and the recorded pass, the calibrated time is exactly the time in the file.

On top of the scale, three things shape the plan within an activity:

- **Warm-up.** The first five minutes run 3–6 % slower, by level, easing to nothing.
- **Pacing.** Even, negative split (1.5 % slower at the start rising to 1.5 % faster at the finish) or positive split (2 % faster falling to 2 % slower).
- **Pace texture.** Stride-to-stride variation in running is correlated over long stretches (Jordan et al. 2006, 2007), so the wobble is not white noise. We add four slow random processes to log-speed:

| Time scale | Size at default variability | Stands for |
|---|---|---|
| 4 s | 1.2 % | footing, small obstacles |
| 15 s | 3 % | breathing, attention |
| 45 s | 2.5 % | surface, small efforts |
| 10 min | 1.5 % | mood, wind, energy |

Walks and hikes get 1.5 times as much, uneven ground scales up the three fast parts but not the slow wander, and the variability slider scales all of them. The 15-second part carries most of the minute-to-minute variation a real watch shows; the comparison with decoded files is on the [recording](recording.md) page.

### When a target can't be met

Some targets are beyond the athlete or the route, and the engine would rather say so than draw a runner at world-record pace. Four ceilings can hold the motion down:

- **Flat running speed**, at 1.3 times the VO₂ reserve — roughly a few minutes' maximal effort.
- **Walking speed**, at 2.3 m/s, beyond which people run and the walking cost model has no data, and at a whole VO₂ reserve for the loaded walking cost.
- **Vertical speed** on climbs, by level, described on the [terrain](terrain.md) page.
- **The oxygen available at altitude**, described on the [mountaineering](mountaineering.md) page.

When a target is missed, the warning names whichever of these held the motion down for the most seconds, along with the moving time actually reached. A separate warning fires when flat ground alone would need more than the whole VO₂ reserve.

The engine also checks the effort it produced against how long that effort can be held. The limit is a margin over the athlete's threshold share, narrowing with duration:

| Window | 6 min | 15 min | 30 min | 1 h | 3 h |
|---|---|---|---|---|---|
| Margin over threshold | +0.25 | +0.18 | +0.13 | +0.09 | +0.05 |

For a recreational athlete that is about 100 % of VO₂ reserve for 6 minutes, 88 % for half an hour and 80 % for three hours. The worst window that exceeds its limit produces the warning. Those margins are rough.

## Effort presets and matching an average heart rate

The Easy / Steady / Tempo / Race buttons don't pick a pace. They search for the average moving speed that puts this athlete, on this route, at a given mean share of VO₂ reserve:

| | Easy | Steady | Tempo | Race |
|---|---|---|---|---|
| Run, ride | 60 % | 70 % | 80 % | 88 % |
| Hike | 35 % | 45 % | 55 % | 63 % |
| Walk | 25 % | 32 % | 40 % | 47 % |

Walking speeds can't reach running efforts, so walks and hikes have their own lower ladders, and a walk is never planned faster than 2.3 m/s. Mountaineering has a ladder of its own, measured against what altitude still leaves sustainable; it is on the [mountaineering](mountaineering.md) page.

Race effort holds for 30 minutes and then eases off with duration, following Riegel's power law with an exponent that depends on the level — 1.09 for a beginner through 1.06 for an elite athlete. The ladder and what it does to race goals are on the [fatigue](fatigue.md) page, which also explains why the presets deliberately measure effort *without* the fatigue economy loss: Riegel already describes how race speed falls with duration.

Heat no longer eases the presets by a rule of its own. A preset is solved in reference air — 15 °C, 60 % humidity, calm and dry — and the route is then covered again at that same effort in the real weather; the time that takes is what the preset reports. So heat, wind, rain and wet ground lengthen the activity instead of lowering the target effort. The [weather](weather.md) page has it.

The search is a secant method in log speed over the same kinematics `simulate()` runs, so the solved target reproduces the planned effort. It stops within 0.002 of the goal share or after a dozen evaluations, and returns the closest attempt.

**Matching an average heart rate** works the other way round. If you set a target average, the pace stays exactly as it was — every kinematic stream comes out byte-identical — and the engine searches instead for the effective VO₂max that puts the average heart rate on your number, to within half a beat. The average is taken over timer time, the same average the summary and the exported file report, so what you asked for is what the file says. The search is a bisection between 20 and 90 ml/kg/min. If the answer falls outside 25–85, or if the target sits outside resting + 10 to maximum − 2 bpm, or if it simply can't be reached on this route, the file comes with a warning.

<!-- chart: effort presets on one hilly route — solved pace, mean share of VO2 reserve and mean heart rate for the four levels -->

## How it's tested

The tests check behaviour rather than formulas:

- On a 1 km climb at +8 %, heart rate rises 6–25 bpm, has covered less than 60 % of the rise after 30 s, reaches 63 % between 30 and 150 s, and after the crest comes back down within 20–150 s, at most twice as slowly as it rose.
- A 30 bpm step down takes longer to cover 63 % than the same step up, and a beginner responds more than twice as slowly as an elite athlete.
- Heart rate is whole beats inside the athlete's range, and a trained athlete covers the same route at the same pace at least 8 bpm lower than a recreational one.
- An unsustainable target is flagged, and heart rate saturates below the maximum instead of sitting on it.
- Moving time lands within 0.5 % of the target on flat and hilly routes, for pace, speed and duration targets, with stops, pacing strategies and maximum variability.
- The presets order Easy < Steady < Tempo < Race in both speed and heart rate, each landing on its goal share, and Race decays with duration.
- A heart-rate target lands within ±0.5 bpm over timer time and leaves every kinematic stream byte-identical; a higher target implies a lower VO₂max.
- The same input twice gives byte-identical streams; changing the GPS level or the sensor changes nothing else.
- A three-hour ride plus a marathon simulate in well under 300 ms.

## What's still a guess

- **The split between the vagal and sympathetic parts** at 25 % of heart-rate reserve, the rising constants of 10 and 50 s, and the fitness scaling on them. The one running fit we have supports the two-stage shape, not these values.
- **The whole falling side.** No running study measures it. The 100 s while moving, the 160 s once stopped, the faster fall after a short surge and the 20-second restart hold come from lab step tests on cyclists and treadmills, and from watching traces. Nobody has measured heart-rate recovery outdoors on rolling ground, which is where the engine spends most of its time.
- **The upright floor of 0.08** and both soft caps near the maximum, and the widths over which the ceiling squeeze and the reflection work.
- **The physiological wander**: its size, how much of it survives standing still, and how it fades near the maximum. It was fitted to one decoded strap file, and to a figure from that file whose window we could not reproduce; the [recording](recording.md) page has the open question.
- **The slow component** at 10 bpm on foot and 15 on a bike: the mapping from millilitres of oxygen to beats is ours, even though the ratio between the sports is measured.
- **Drift** in every respect that the [weather](weather.md) page doesn't own: the 12-minute onset, the 3 % per hour rate, the intensity weighting, the soft limit and its recovery while stopped. The spread by level — a beginner drifting nearly twice as fast as an elite athlete — is our own choice too, and it now carries most of the difference between levels.
- **The downhill heart-rate floor of 85 %** of the flat speed of the same effort, and the 50 % floor under a walk break inside a run.
- **What a rider spends while coasting**, and the 21 % gross efficiency that turns crank power into oxygen.
- **The endurance margins** behind the sustainability warning, and the 1.3 × VO₂ reserve ceiling on planned flat running speed.
- **Pace texture**: four time scales with sizes fitted to a single real recording, and the 1.5× for walking.
- **The age curve for VO₂max**, which sits between a trained-athlete decline and a population one without being either.

The best check would be a set of real recordings with position, elevation and heart rate from the same athlete on hilly routes, run at known efforts, compared against what Runsketch produces for the same route and target. A useful minimum: on a 5–10 % climb, heart rate should rise 5–15 bpm and take 30–90 s to get most of the way there.

## References

Oxygen cost and pace

- Minetti AE, Moia C, Roi GS, Susta D, Ferretti G. Energy cost of walking and running at extreme uphill and downhill slopes. *J Appl Physiol* 93:1039–1046, 2002. https://doi.org/10.1152/japplphysiol.01177.2001
- Ralston HJ. Energy-speed relation and optimal speed during level walking. *Int Z Angew Physiol* 17:277–283, 1958. https://doi.org/10.1007/BF00698754
- Lemire M et al. High-intensity downhill running exacerbates heart rate and muscular fatigue in trail runners. *J Sports Sci* 39:815–825, 2021. https://doi.org/10.1080/02640414.2020.1847502
- Jordan K, Challis JH, Newell KM. Long range correlations in the stride interval of running. *Gait Posture* 24:120–125, 2006. https://pubmed.ncbi.nlm.nih.gov/16182530/
- Jordan K, Challis JH, Newell KM. Speed influences on the scaling behavior of gait cycle fluctuations during treadmill running. *Hum Mov Sci* 26:87–102, 2007. https://pubmed.ncbi.nlm.nih.gov/17161484/
- Riegel PS. Athletic records and human endurance. *Am Sci* 69:285–290, 1981. https://pubmed.ncbi.nlm.nih.gov/7235349/

Heart rate

- Swain DP, Leutholtz BC. Heart rate reserve is equivalent to %VO2 reserve, not to %VO2max. *Med Sci Sports Exerc* 29:410–414, 1997. https://pubmed.ncbi.nlm.nih.gov/9139182/
- Tanaka H, Monahan KD, Seals DR. Age-predicted maximal heart rate revisited. *J Am Coll Cardiol* 37:153–156, 2001. https://doi.org/10.1016/S0735-1097(00)01054-8
- Tanaka H, Seals DR. Endurance exercise performance in masters athletes: age-associated changes and underlying physiological mechanisms. *J Physiol* 586:55–63, 2008. https://doi.org/10.1113/jphysiol.2007.141879
- Kaminsky LA, Arena R, Myers J. Reference standards for cardiorespiratory fitness measured with cardiopulmonary exercise testing: data from the Fitness Registry and the Importance of Exercise National Database. *Mayo Clin Proc* 90:1515–1523, 2015. https://doi.org/10.1016/j.mayocp.2015.07.026
- Bunc V, Heller J, Leso J. Kinetics of heart rate responses to exercise. *J Sports Sci* 6:39–48, 1988. https://doi.org/10.1080/02640418808729792
- First- and second-order models of the heart-rate response to treadmill running (11 participants; pseudo-random speed changes around a moderate-to-vigorous operating point). https://pmc.ncbi.nlm.nih.gov/articles/PMC8059023/
- Carter H, Jones AM, Barstow TJ, Burnley M, Williams CA, Doust JH. Oxygen uptake kinetics in treadmill running and cycle ergometry: a comparison. *J Appl Physiol* 89:899–907, 2000. https://doi.org/10.1152/jappl.2000.89.3.899
- Zakynthinaki MS. Modelling heart rate kinetics. *PLoS ONE* 10:e0118263, 2015. https://doi.org/10.1371/journal.pone.0118263
- Coyle EF, González-Alonso J. Cardiovascular drift during prolonged exercise: new perspectives. *Exerc Sport Sci Rev* 29:88–92, 2001. https://pubmed.ncbi.nlm.nih.gov/11337829/
- Ludwig M, Hoffmann K, Endler S, Asteroth A, Wiemeyer J. Measurement, prediction, and control of individual heart rate responses to exercise. *Front Physiol* 9:778, 2018. https://doi.org/10.3389/fphys.2018.00778

Cadence, power and cycling

- Martin JC, Milliken DL, Cobb JE, McFadden KL, Coggan AR. Validation of a mathematical model for road cycling power. *J Appl Biomech* 14:276–291, 1998. https://doi.org/10.1123/jab.14.3.276
- Lucia A, Hoyos J, Chicharro JL. Preferred pedalling cadence in professional cycling. *Med Sci Sports Exerc* 33:1361–1366, 2001. https://pubmed.ncbi.nlm.nih.gov/11474339/
- Burns GT, Zendler JM, Zernicke RF. Step frequency patterns of elite ultramarathon runners during a 100-km road race. *J Appl Physiol* 126:462–468, 2019. https://doi.org/10.1152/japplphysiol.00374.2018
- Cadence and stride length across running speeds. https://pmc.ncbi.nlm.nih.gov/articles/PMC12222555/
- Running effectiveness and running power. https://www.tredict.com/blog/running_effectiveness_in_tredict/
