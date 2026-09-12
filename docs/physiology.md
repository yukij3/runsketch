# Physiology & motion models

This is how Runsketch turns a line on a map into a workout that looks like somebody actually did it: what the engine does, why it does it that way, and where the numbers come from. Some numbers are measured, some are our own judgement. The judgement calls are marked as such, and there's a list of them at the end.

## The idea in one paragraph

Most fake-run generators start with the heart rate. They take the average, draw a hump over the whole activity and sprinkle random jitter on top. That's why the files look wrong: heart rate has nothing to do with the hill you just ran up, and it jumps around from one second to the next in a way no heart does. Runsketch works the other way round. First it decides how a person would move along the route: slower on climbs, a little faster on gentle descents, braking on steep ones, walking the really steep bits. From the movement it works out how much oxygen the muscles need. Heart rate follows that need with a delay, like a real heart. Cadence, power, GPS points and altitude come out of the same pass. Everything is computed once per second, and the same inputs with the same seed always give the same file.

## Terrain

Elevation data is too noisy to use as it is. One metre of error over a 5 m step is already a 20 % grade, so a raw elevation model turns every flat street into a staircase.

The route is resampled every 5 m and elevation is read at each point. A running median over five points (about 25 m) removes single-pixel spikes like buildings, bridges and water edges. The profile is then smoothed with a Gaussian-weighted local fit, σ = 15 m for Mapterhorn's detailed tiles and 25 m for the coarser 30–90 m sources. Grade is measured over a centred 40 m baseline, and total ascent ignores wiggles smaller than 3 m.

## Running on hills

### Why not just use the energy cost of running uphill

The classic lab data is Minetti et al. (2002), who measured the energy cost of running on a treadmill from −45 % to +45 %. If you assume people run at constant metabolic power, you get a speed for every grade. Uphill that works well. Downhill it falls apart: the model has you running twice your flat speed on a −20 % slope. Nobody does that. Braking, footing and plain caution get in the way.

Strava hit the same problem and rebuilt its Grade Adjusted Pace in 2017 from the heart rate of a very large number of runners instead of oxygen cost. Their curve is fastest at around −10 %, and by about −18 % you are no quicker than on the flat. The method is described in their patent (US11623121B1).

Runsketch uses a quadratic with that shape, the pace factor from ultraPacer:

```
F(g) = 0.0021·g² + 0.034·g + 1          g = grade in percent
actual pace = flat pace × F(g)
```

It's used between −22 % and +16 % and continued as a straight line outside that range. The easiest grade is −8.1 % (F = 0.862), and at −16.2 % you're back to flat pace. We couldn't trace these coefficients to an original source, only to a write-up of them, so the exact values are provisional. The shape agrees with everything else we found.

### Nobody paces a hill perfectly

If runners held perfectly even effort, heart rate would stay flat over hills. It doesn't. It goes up on climbs and comes down on descents, because people don't slow down quite enough going up and don't speed up enough coming down. Runsketch softens the pace factor to get this:

```
speed multiplier = F(g)^(−0.8), never more than 1.2× flat speed
```

The 0.8 is our choice, not a measurement. It produces heart-rate rises on climbs that look right in traces, and it's the first number we'd tune against real recordings. In practice:

| Grade | −25 % | −15 % | −8 % | −5 % | 0 | +5 % | +8 % | +10 % | +15 % | +20 % |
|---|---|---|---|---|---|---|---|---|---|---|
| Running speed vs flat | 0.75 | 1.03 | 1.13 | 1.11 | 1 | 0.85 | 0.76 | 0.70 | 0.58 | 0.48 |
| Walking speed vs flat | 0.59 | 0.84 | 1.07 | 1.19 | 1 | 0.84 | 0.76 | 0.70 | 0.59 | 0.50 |

### Power-hiking

On a steep trail even good runners walk. When the planned running speed on a climb of 6 % or more drops below 1.8 m/s (about 9:15/km), the runner walks. Between 1.8 and 2.05 m/s, and between 4 and 6 %, running and walking blend so there's no sudden jump. The walking speed is the one that costs the same metabolic power as running would, using Minetti's walking cost, and it's capped at an effort the athlete could hold for about half an hour. Cadence and heart-rate demand switch to the walking gait while it lasts.

### Everything else that shapes the pace

- **Warm-up.** The run starts 3–6 % slower, depending on fitness, and eases to normal over the first 5 minutes.
- **Fatigue.** After 45 minutes speed fades by 1–5 % per hour, less for fitter athletes. Second halves of real road races are typically 4–6 % slower.
- **Pacing.** Even, negative split (from 1.5 % slower at the start to 1.5 % faster at the finish) or positive split (from 2 % faster to 2 % slower).
- **Corners.** Speed is capped at √(a·R), with R the turn radius measured over ±5 m and a = 2.5 m/s² running, 1.5 walking, 4 on a bike. Runners start braking before the corner (1.2 m/s²) and pick up speed at no more than 0.6 m/s² afterwards.
- **Stops.** "Few" means 0–2 stops of 20–90 s per hour, never in the first 10 minutes. "Urban" means a short stop every 400–900 m, 5–45 s long with a median of 15 s, like traffic lights. After a stop the runner speeds up again at 0.45–0.6 m/s² instead of jumping straight back to pace.

Pace wobble isn't white noise either. Stride-to-stride variation in running is correlated over long stretches (Jordan et al. 2006, 2007). Runsketch adds three slow random processes (Ornstein–Uhlenbeck) to log-speed:

| Time scale | Size at default variability | Stands for |
|---|---|---|
| 4 s | 1 % | footing, small obstacles |
| 45 s | 2 % | breathing, attention, surface |
| 10 min | 1.5 % | mood, wind, energy |

Walks and hikes get 1.5 times more. The variability slider scales all three.

On top of all this sits a single effort scale. The engine searches for the value that makes moving time match your target, so 5:30/km comes out as 5:30/km on average whatever the hills did along the way.

## Walking and hiking

Walking uses Tobler's hiking function, scaled to your flat walking speed:

```
speed multiplier = exp(−3.5·(|s + 0.05| − 0.05))          s = grade as a decimal
```

Walking is fastest on a gentle −5 % slope, 19 % above flat. Tobler's curve already describes how people really walk, so unlike the running curve it isn't softened. With the 0.8 exponent a +30 % climb would come out 25 % faster than both Tobler and Naismith's rule.

Energy cost comes from Minetti's walking curve for the grade, plus a penalty for walking fast: above 1.3 m/s walking gets expensive quickly, about ×1.2 at 1.8 m/s. That penalty is a rough fit to the classic U-shaped cost curve (Ralston 1958), not a published formula.

## Cycling

On a bike it works the other way: the rider has a power plan, and speed comes out of the physics. The model is Martin et al. (1998), which predicted measured power with R² = 0.97 and a standard error of 2.7 W:

```
P·Ec = v·[ ½ρ(CdA + Fw)·v² + Crr·m·g·cos θ + (91 + 8.7·v)·10⁻³ + m·g·sin θ ] + (m + I/r²)·v·dv/dt
```

| Constant | Value | Where from |
|---|---|---|
| Chain efficiency Ec | 0.977 | Martin 1998 |
| Wheel drag area Fw | 0.0044 m² | Martin 1998 |
| Wheel inertia I, radius r | 0.14 kg·m², 0.311 m | Martin 1998 |
| Drag area CdA | 0.32 m², riding on the hoods | typical value |
| Rolling resistance Crr | 0.004 | typical road tyres |
| Bike | 9 kg | typical value |

Air density comes from altitude and air temperature, and the equation is stepped four times a second.

On top of the physics:

- Riders push harder on climbs and ease off going down: power = flat power × (1 + 0.03 per percent of grade), between 0 and 1.35 times. The rule is a simplification, not a measured curve.
- Above 40 km/h on descents steeper than −4 % the rider stops pedalling, and brakes to about 65 km/h on long descents. On gentle descents there are short pedal bursts of 3–8 s every 40–120 s.
- On flat roads there are short freewheel breaks, 2–5 s every 1–3 minutes.
- Power has pedal-stroke surges (1 s and 3 s) and slower wander (20 s and 60 s). Drag wanders too, for position changes and gusts.
- If a climb is too steep for the planned power, the rider crawls at 3.6 km/h instead of stopping, and you get a warning.

As with running, one effort scale is solved so that moving time matches the target.

## From movement to oxygen

Heart rate follows how hard the body is working, so every second of movement is turned into oxygen demand: net VO₂, in ml/kg/min above rest.

**Running.** Here Runsketch uses the pace factor again rather than Minetti's energy cost:

```
VO₂net = 3.6 J/kg/m × v × F(g) × 60 / 20.9
```

3.6 J/kg/m is the cost of running on the flat, and 20.9 kJ is the energy released per litre of oxygen (both from Minetti 2002). v × F(g) is the equivalent flat speed. Because the Strava-style curve was built from heart rate, it gives more believable downhill heart rates than oxygen cost does. Oxygen cost falls steeply on descents, heart rate in practice much less.

There are two corrections. Below −8 % the pace factor rises again because you're braking, not because your heart is working harder, so for heart rate it's held at its lowest value there. And braking on steep descents still costs something, so the equivalent speed never goes below 60 % of the flat speed for the same effort.

**Walking.** Minetti's walking cost for the grade, times the fast-walking penalty, times speed.

**Cycling.** Power divided by 21 % gross efficiency and body mass, minus the resting 3.5 ml/kg/min. When coasting, demand doesn't fall to zero: holding your position, cold air and concentration still cost something. We set that at 12 % of the VO₂ reserve at low speed, rising to 24 % at 58 km/h. It's an estimate.

Demand is smoothed over 5 s on foot and 8 s on the bike, since muscles don't respond to single strides or pedal strokes.

**Altitude.** Above 1500 m, VO₂max drops by 8 % per 1000 m, which is the order of magnitude reported by Fulco et al. (1998). The same pace is harder in the mountains.

## How hard is that for this person

Oxygen demand becomes a target heart rate through the heart-rate reserve. Swain & Leutholtz (1997) showed that the share of heart-rate reserve used matches the share of VO₂ reserve almost exactly (slope 1.00, intercept −0.1):

```
share = VO₂net / (VO₂max − 3.5)
target HR = HRrest + (HRmax − HRrest) × (0.08 + 0.92 × share)
```

The 0.08 is there because resting heart rate is usually measured lying down or sitting, and just standing up adds around ten beats. Near the top the target is squeezed smoothly, so it approaches the maximum without hitting it, much like the flattening seen in lab tests.

If you don't enter your own values, the defaults are:

| | Beginner | Recreational | Trained | Elite |
|---|---|---|---|---|
| VO₂max, ml/kg/min (women −6) | 35 | 45 | 55 | 66 |
| Lactate threshold, share of VO₂ reserve | 0.70 | 0.75 | 0.83 | 0.88 |
| Heart-rate response times | ×1.4 | ×1.0 | ×0.75 | ×0.6 |

Maximum heart rate defaults to 208 − 0.7 × age (Tanaka et al. 2001, a meta-analysis of 351 studies with 18,712 people).

Two effects make the target creep up over time.

**Slow component.** Above the lactate threshold heart rate never really settles, it keeps climbing along with blood lactate. Runsketch adds up to about 15 bpm, depending on how far above threshold you are. It builds with a 7-minute time constant (Zakynthinaki 2015) and fades a little more slowly when you ease off.

**Cardiac drift.** During a long steady effort the heart pumps slightly less blood per beat after 10–20 minutes and makes up for it by beating faster (Coyle & González-Alonso 2001). Heat makes this much stronger. Wingo et al. (2005) measured a 12 % rise, from 151 to 169 bpm, between minutes 15 and 45 of cycling at 35 °C. Runsketch starts drift after 12 minutes of moving time:

| Air temperature | 10 °C | 15 °C | 21 °C | 25 °C | 30 °C | 35 °C |
|---|---|---|---|---|---|---|
| Drift per hour | 1.9 % | 3 % | 5.1 % | 7.4 % | 11.6 % | 18.1 % |

Drift is stronger at higher intensity, stops at 15 % and partly wears off while you stand still. The temperature curve is our fit through a handful of measurements. On a 90-minute steady run the last 10 minutes come out 3 bpm above minutes 15–25 at 10 °C, 14 bpm at 25 °C and 20 bpm at 32 °C.

Heat deliberately doesn't slow the runner down. If it did, the slower pace would lower the demand and hide the drift.

## Heart-rate inertia

This is the part paid generators skip, and the reason Runsketch exists.

A heart doesn't jump to a new rate when effort changes. The first part of the increase when you start moving is quick: the vagus nerve simply stops holding the heart back. Going higher needs the sympathetic nervous system and adrenaline, which is slower. Coming back down is slower again. Some measured time constants, to give a sense of scale:

- Starting light cycling: τ ≈ 8 s in endurance-trained people, ≈ 27 s in untrained ones.
- Treadmill in healthy adults: τ ≈ 33 s going up, ≈ 96 s coming down.
- Treadmill speed changes around moderate effort, fitted with two stages: 19 s and 38 s.
- Trained rowers vs untrained students: half-time of 24 s vs 47 s (Bunc et al. 1988).

Runsketch splits the heart rate above rest into two parts that move independently:

| Part | Covers | Rising | Falling |
|---|---|---|---|
| Vagal | the first 25 % of heart-rate reserve | τ = 10 s | τ = 30 s |
| Sympathetic | everything above it | τ = 50 s | τ = 160 s |

All four are multiplied by the fitness factor from the table above. The split and the exact values are our choice, anchored to the measurements above, and the 25 % boundary in particular is a judgement call.

Two parts behave in a way a single delay can't. Setting off from standing, heart rate shoots up within seconds. A change high in the range, like the start of a climb or cresting it, is slow and lopsided. For a recreational athlete with a resting heart rate of 55 and a maximum of 185, heart rate covers 63 % of a jump in:

| Jump | Going up | Coming down |
|---|---|---|
| 70 ↔ 100 bpm | 20 s | 59 s |
| 120 ↔ 150 bpm | 50 s | 160 s |

The same 100 → 160 bpm jump takes 30 s for an elite athlete, 50 s for a recreational one and 70 s for a beginner.

One more detail came out of looking at traces. If you set off again after a short stop while heart rate is still falling, the slow part stops falling straight away. Without this, heart rate kept sagging for another half a minute after the runner was already moving, and that looked wrong.

The activity starts with heart rate 20 beats above resting.

### What it looks like on a hill

A 25-year-old recreational runner (resting 50, max 191) covers 5 km at an average of 5:30/km: 2 km flat, 1 km at +8 %, 2 km flat. Averaged over eight seeds:

- Pace is 5:08/km on the flat and 6:46/km on the climb. Cadence goes from 173 to 175 steps per minute.
- Heart rate is 168 bpm before the climb and 178 bpm at the top.
- 30 seconds into the climb it has covered only a third of that rise. It gets to 63 % after about 80 seconds.
- At the crest demand drops at once. Heart rate needs about 95 seconds to come 63 % of the way down, longer than it took to rise.
- A few minutes later it settles at 172 bpm, not back at 168, because of drift and the slow component.

A 30-second stop in the middle of a flat run takes heart rate from 159 down to 137 bpm. Twenty seconds after setting off again it's at 144, and a minute later it's back to 156.

Same runner and pace with 1 km downhill in the middle instead:

| Grade | Pace on the descent | Speed vs flat | Heart-rate demand vs flat |
|---|---|---|---|
| −8 % | 5:01/km | +12 % | −4 bpm |
| −15 % | 5:23/km | +2 % | −12 bpm |
| −25 % | 6:56/km | −26 % | −39 bpm |

## What the sensor records

Everything so far is the "true" heart rate. The file gets what a sensor would have recorded.

- **Chest strap:** slow wander of about 1.2 bpm that changes over 15 s, plus 0.4 bpm of fast noise. Good lab models of heart rate leave 2–2.5 bpm unexplained, so that's the size to aim for.
- **Wrist sensor:** the signal is averaged over about 5 s, which adds a little lag, then wanders by about 2 bpm over 20 s, plus 0.6 bpm of fast noise. Wrist sensors are much less reliable during exercise than at rest (Bent et al. 2020), so there are occasional glitches too. Each lasts 20–90 s and either locks onto running cadence or reads 10–20 bpm low. They're most likely in the first 10 minutes (about one per half hour at that rate) and rarer after that (about one per two hours). How often, how long and how big are guesses.

Heart rate is written in whole beats, between resting − 5 and maximum + 2.

## Cadence

**Running**, in steps per minute:

```
spm = (147.6 + 7.9·v) × (1 + 0.0062·uphill % − 0.0025·downhill %) − 120·(height − 1.75 m)
```

The speed part is a straight-line fit to treadmill data from 30 experienced runners: 169 steps per minute at 2.7 m/s, 178 at 3.8 m/s. Cadence goes up about 4 % on a 7 % climb (Padulo et al. 2012). Taller runners take fewer, longer steps. Burns et al. (2019) found 123 fewer steps per minute per metre of height among 100 km racers. The downhill part is our estimate. On descents steeper than −12 % runners take short quick steps, so cadence doesn't drop below the flat cadence for the same effort. Running cadence stays between 140 and 205, wanders by about 1.2 steps per minute, and starts 2.5 lower in the first 5 minutes.

**Walking:** `spm = 64.3 + 36.5·v`, a fit to the CADENCE-Adults treadmill table (96 at 0.9 m/s, 129 at 1.8 m/s). It goes 0.4 % lower per percent of climb and stays between 80 and 135.

**Cycling:** 90 rpm on the flat, 2.4 rpm less per percent of climb, between 62 and 100, and 5 rpm lower for beginner and recreational riders. Professional riders average 89 rpm on flat stages and 71 on long mountain climbs (Lucia et al. 2001). Cadence ticks up briefly when power surges, drops to zero when coasting, and can't go past what the lowest gear allows at crawling speed.

Files store cadence for foot sports the way watches do, in strides per minute (half the steps).

## Power

For rides, power comes straight out of the cycling model.

For runs the engine also estimates Stryd-style running power, `m·v / 0.98`, scaled by Minetti's energy cost for the grade (in full uphill, square-rooted downhill so descents don't collapse to almost nothing) with 3 % noise. Files don't carry it yet. Walks and hikes get no power at all, since there's no mainstream walking power meter to imitate.

## GPS and altitude

Real GPS error isn't random from one second to the next. It's strongly correlated in time and space, and independent jitter on every point would add a lot of fake distance (Ranacher et al. 2016). Sports watches are typically within 1.5–2 m in open sky, and their distance is usually 3–6 % off: short in cities and forests, long on a running track (Gilgen-Ammann et al. 2020).

Every recorded point is the true position plus:

- a slowly wandering offset, about 1.5 m, changing over a few minutes;
- a reflection-like error that changes with distance travelled, about 0.6 m over 20 m;
- 2 cm of fast noise;
- corner cutting from a 1.5 s tracking lag, at most 6 m, with the along-track part taken out so points never lag behind the distance.

The GPS noise setting scales all of it: ×0.6 for low, ×1 for normal, ×2 for high. When you stop, the position stays put. No single second can move more than 25 % (or 0.5 m) further than the distance actually covered, so the track never spikes. Distance and speed in the file come from the true path, the way watches rely on the accelerometer and Doppler speed rather than raw positions.

Altitude is the smoothed terrain plus a barometer-like drift of about 0.8 m over 5 minutes, rounded to 0.2 m. There's no constant offset, since that would only push the track out of line with maps.

## Effort presets and matching an average heart rate

The Easy / Steady / Tempo / Race buttons don't pick a pace. They search for the average speed that puts this athlete, on this route, at a given average share of VO₂ reserve:

| | Easy | Steady | Tempo | Race |
|---|---|---|---|---|
| Run, ride | 60 % | 70 % | 80 % | 88 % |
| Hike | 35 % | 45 % | 55 % | 63 % |
| Walk | 25 % | 32 % | 40 % | 47 % |

Walking speeds can't reach running efforts, so walks and hikes have their own lower steps. Race effort holds for 30 minutes and then eases off with duration, following Riegel's exponent of 1.06.

If you enter a target average heart rate, the pace stays exactly as it was. The engine searches instead for the VO₂max that gives that average over moving time, to within half a beat. If the answer falls outside 25–85 ml/kg/min, you get a warning, because that's outside the usual human range.

The engine also warns when a target isn't sustainable: when flat ground alone would need more than 100 % of VO₂ reserve, or when some stretch averages more effort than the athlete could hold for that long. The limit runs from 25 % above threshold for 6 minutes down to 5 % above threshold for 3 hours. Those margins are rough.

## How it's tested

The tests check behaviour rather than formulas:

- On a 1 km climb at +8 %, heart rate rises by 6–25 bpm, has covered less than 60 % of the rise after 30 s, reaches 63 % after 30–150 s, and recovers after the crest more slowly than it rose.
- A 30 bpm step down takes more than 1.5 times as long as the same step up. A beginner responds more than twice as slowly as an elite athlete.
- 90 minutes steady at 25 °C drifts by 4–20 bpm, and clearly less at 10 °C.
- At −8 % the runner is faster than on the flat but by no more than 1.2 times. At −25 % they're no faster than on the flat.
- A 30 s stop drops heart rate by 5–25 bpm, and the runner accelerates away instead of jumping back to pace.
- A trained athlete covers the same route at the same pace at least 8 bpm lower than a recreational one.
- On a ride, climbs cost more power at lower cadence, and fast descents are mostly coasting with zero power and cadence.

## What's still a guess

These numbers need real data the most:

- The hill exponent of 0.8, and the ultraPacer coefficients we couldn't trace to their source.
- The split between the vagal and sympathetic parts at 25 % of heart-rate reserve, and their four time constants.
- How drift depends on temperature between the few published measurements.
- Wrist sensor glitches: how often, how long, how large.
- Downhill cadence, the cost of fast walking, and what a rider spends while coasting.
- The endurance limits behind the warnings.

The best check would be a set of real recordings with GPS, elevation and heart rate on hilly routes, compared against what Runsketch produces for the same route and pace. A useful minimum: on a 5–10 % climb, heart rate should rise by 5–15 bpm and take 30–90 s to get most of the way there.

## References

Hills and pace

- Minetti AE, Moia C, Roi GS, Susta D, Ferretti G. Energy cost of walking and running at extreme uphill and downhill slopes. *J Appl Physiol* 93:1039–1046, 2002. https://journals.physiology.org/doi/full/10.1152/japplphysiol.01177.2001
- Strava Engineering. Improving Grade Adjusted Pace, 2017. https://medium.com/strava-engineering/improving-grade-adjusted-pace-b9a2a332a5dc
- US patent 11623121 B1. Using aggregate activity data to generate a grade adjusted pace model. https://patents.google.com/patent/US11623121B1/en
- Grade vs pace, including the ultraPacer model. https://educatedguesswork.org/posts/grade-vs-pace/
- Tobler's hiking function. https://en.wikipedia.org/wiki/Tobler%27s_hiking_function
- Naismith's rule. https://en.wikipedia.org/wiki/Naismith%27s_rule
- Jordan K, Challis JH, Newell KM. *Gait Posture*, 2006. https://pubmed.ncbi.nlm.nih.gov/16182530/
- Jordan K et al. *Hum Mov Sci*, 2007. https://pubmed.ncbi.nlm.nih.gov/17161484/
- Riegel PS. Athletic records and human endurance. *Am Sci* 69:285–290, 1981. https://pubmed.ncbi.nlm.nih.gov/7235349/
- Heart rate and pace across road and uphill races. https://pmc.ncbi.nlm.nih.gov/articles/PMC5408286/

Cycling

- Martin JC, Milliken DL, Cobb JE, McFadden KL, Coggan AR. Validation of a mathematical model for road cycling power. *J Appl Biomech* 14:276–291, 1998. https://journals.humankinetics.com/view/journals/jab/14/3/article-p276.xml
- Lucia A, Hoyos J, Chicharro JL. Preferred pedalling cadence in professional cycling. *Med Sci Sports Exerc* 33:1361–1366, 2001. https://pubmed.ncbi.nlm.nih.gov/11474339/

Heart rate

- Tanaka H, Monahan KD, Seals DR. Age-predicted maximal heart rate revisited. *J Am Coll Cardiol* 37:153–156, 2001. https://www.sciencedirect.com/science/article/pii/S0735109700010548
- Swain DP, Leutholtz BC. Heart rate reserve is equivalent to %VO2 reserve, not to %VO2max. *Med Sci Sports Exerc* 29:410–414, 1997. https://pubmed.ncbi.nlm.nih.gov/9139182/
- Bunc V, Heller J, Leso J. Kinetics of heart rate responses to exercise. *J Sports Sci* 6(1), 1988. https://www.tandfonline.com/doi/abs/10.1080/02640418808729792
- Heart-rate on-kinetics during light exercise. https://pmc.ncbi.nlm.nih.gov/articles/PMC5492202/
- On- and off-transient heart-rate kinetics. https://pmc.ncbi.nlm.nih.gov/articles/PMC5526966/
- First- vs second-order models of heart rate on a treadmill. https://pmc.ncbi.nlm.nih.gov/articles/PMC8059023/
- Zakynthinaki MS. Modelling heart rate kinetics. *PLoS ONE* 10:e0118263, 2015. https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0118263
- Coyle EF, González-Alonso J. Cardiovascular drift during prolonged exercise: new perspectives. *Exerc Sport Sci Rev*, 2001. https://pubmed.ncbi.nlm.nih.gov/11337829/
- Wingo JE, Lafrenz AJ, Ganio MS, Edwards GL, Cureton KJ. *Med Sci Sports Exerc* 37:248–255, 2005. https://pubmed.ncbi.nlm.nih.gov/15692320/
- Ludwig M, Hoffmann K, Endler S, Asteroth A, Wiemeyer J. Measurement, prediction, and control of individual heart rate responses to exercise. *Front Physiol* 9:778, 2018. https://www.frontiersin.org/journals/physiology/articles/10.3389/fphys.2018.00778/full
- Bent B, Goldstein BA, Kibbe WA, Dunn JP. Investigating sources of inaccuracy in wearable optical heart rate sensors. *npj Digit Med* 3:18, 2020. https://pubmed.ncbi.nlm.nih.gov/32047863/
- Fulco CS, Rock PB, Cymerman A. Maximal and submaximal exercise performance at altitude. *Aviat Space Environ Med*, 1998.

Cadence and running power

- Cadence and stride length across running speeds. https://pmc.ncbi.nlm.nih.gov/articles/PMC12222555/
- Padulo J et al. *J Strength Cond Res* 26:1331–1339, 2012. https://pubmed.ncbi.nlm.nih.gov/22126973/
- Burns GT, Zendler JD, Zernicke RF. Step frequency patterns of elite ultramarathon runners during a 100-km road race. *J Appl Physiol*, 2019. https://journals.physiology.org/doi/full/10.1152/japplphysiol.00374.2018
- CADENCE-Adults: walking cadence and intensity. https://pmc.ncbi.nlm.nih.gov/articles/PMC6337834/
- Running effectiveness. https://www.tredict.com/blog/running_effectiveness_in_tredict/

GPS

- Ranacher P, Brunauer R, Trutschnig W, Van der Spek S, Reich S. Why GPS makes distances bigger than they are. *Int J Geogr Inf Sci* 30:316–333, 2016. https://pmc.ncbi.nlm.nih.gov/articles/PMC4786863/
- Gilgen-Ammann R, Schweizer T, Wyss T. Accuracy of distance recordings in eight positioning-enabled sport watches. *JMIR mHealth uHealth* 8:e17118, 2020. https://pmc.ncbi.nlm.nih.gov/articles/PMC7381051/
- Positioning accuracy of sports watches. *Measurement*, 2024. https://www.sciencedirect.com/science/article/pii/S0263224124003117
