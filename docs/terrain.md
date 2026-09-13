# Terrain

[Physiology & motion models](physiology.md) explains how Runsketch turns movement into oxygen demand and heart rate. This page is about the step before that: how the ground under a route shapes the movement itself. It covers how elevation data becomes a grade, how fast people go up and down, what happens after the top of a climb, when runners walk, what surfaces and technical trails do, how cadence changes on hills, and altitude up to 2800 m. Heat and wind have their own page, [Weather](weather.md), and so does high altitude, [Mountaineering](mountaineering.md).

As in the physiology doc, some numbers are measured and some are our own judgement. The judgement calls are listed at the end. Unless a number is quoted from a paper, it comes from the engine: either a constant in the code or a simulation we ran.

## From elevation data to grade

### Spikes and smoothing

The route is resampled every 5 m and elevation is read at each point. A running median over five points (about 25 m) removes single-pixel spikes. The profile is then smoothed with a Gaussian-weighted local fit, σ = 15 m for Mapterhorn's detailed tiles and 25 m for the coarser 30–90 m sources. A local fit rather than a plain average keeps the start and end of a climb in place. Grade is measured over a centred 40 m baseline.

### Tree tops and roofs

The coarser elevation tiles are built on a surface model. Surface models measure the top of whatever is there, so a stand of trees or a row of buildings along the road sits 5–20 m above the ground. At 30 m pixels the edge of such a patch becomes a step over one or two pixels. On a flat route that reads as short ramps of 20 % and more. Before we dealt with this, a flat 10 km route with a dozen tree stands came out with over 100 m of climbing.

What gives a patch away is that it comes back. A road that climbs keeps climbing, or at least stays up. A tree stand is a bump that returns to the level it started from within a few hundred metres. So we look for exactly that shape:

- The terrain's own slope is taken as the running median of grade over ±75 m. Short excursions don't move a median, but ramps of any length do.
- An edge is a run of at most 60 m whose grade departs from that slope by more than 60 % of how steep this kind of way plausibly is (see below), and never more than 18 %.
- An edge worth at least 3 m opens a patch. The patch closes if later edges bring the level back to within 2.5 m, or 35 % of its height, within 350 m.
- The edge steps of a closed patch are subtracted, and whatever the ground does underneath is kept.

On a synthetic flat 10 km route with twelve raised patches 6–16 m high and 40–240 m wide, sampled like 30 m pixels, smoothing alone leaves 118 m of ascent and grades up to 20 %. With the patch filter it's flat again. A real 300 m climb at 12 % with the same patches on top keeps its 36 m of ascent to within 5 %. So does a 3 km switchback trail of 25–35 % ramps, because a climb never returns to the level it started from, however steep or zigzagging it is.

<!-- chart: DEM filter before/after — flat 10 km route with twelve canopy patches: raw 30 m pixels, smoothing only (118 m of ascent), with the patch filter (flat) -->


### Bridges and tunnels

A bridge crosses a valley that the elevation data shows, and a tunnel goes under a hill. Where the route's way tags say `bridge`, `tunnel` or `man_made=bridge`, the elevation under the structure is ignored. The way runs in a straight line between its ends. A 320 m bridge over a 25 m deep valley would otherwise add 25 m of ascent and 25 % grades. Valhalla reports these tags, but BRouter's tag list doesn't include them. An untagged bridge is left to the patch filter, which catches gullies up to 350 m wide.

<!-- chart: bridge over a 25 m valley — elevation data under the bridge against the tagged way running straight between its ends -->


### How steep a way can be

Grades are limited to ±45 % on foot, the range over which Minetti et al. (2002) measured the energy cost of walking and running. Rides are limited to ±35 %, about as steep as the steepest paved streets (Baldwin Street in New Zealand, Ffordd Pen Llech in Wales).

Way tags add limits of their own, because elevation data is often steeper than the way really is: a road cut into a slope, a path along a cliff edge. Public roads are held to 25 %, since steeper ramps are rare enough to be named records. Footways and bridleways are held to 35 %, tracks to 30 % and paths to 45 %. Steps, via ferratas, scree, snow, ice and any path with a mountain-hiking grade of T2 or harder have no extra limit, because steep ground is real there. When a way carries several tags, the most permissive limit wins. If the engine had to limit grades somewhere, a warning says on roughly how many metres.

### Counting ascent

Ascent is counted the same way everywhere. A change of direction counts once the elevation has come back 3 m from the last high or low point, which is the idea behind BRouter's filtered ascent and the counters in barometric watches.

The route panel counts it on the cleaned terrain profile. The activity summary, lap ascent and climb rate count it on the recorded altitude, which wanders like a barometer (see [What the watch records](recording.md)). So the file usually shows a few percent more than the route. Climb rate is measured over the same confirmed climbing legs, so an altimeter that only steps up every few seconds doesn't inflate it.

<!-- chart: ascent counting — noisy recorded altitude against the 3 m turning-point legs, with the ascent each counts -->


## Pace on climbs and descents

### Climbs

Running speed on a grade starts from the pace factor F(g) described in the physiology doc, a quadratic with the shape of Strava's heart-rate-based Grade Adjusted Pace. Uphill, running speed is flat speed × F^−0.7.

The exponent says runners don't slow down quite enough on climbs to keep their effort level. Townshend et al. (2010) put a gas analyser on eight experienced runners pacing themselves over a hilly course. They ran 23 % slower uphill, and their oxygen uptake rose from 89 % of their ventilatory threshold on the flat to 100 % on the climbs, about 12 % more. An exponent of 0.7 gives that rise on 5–8 % climbs. The 0.8 we used before gave about 7 %.

<!-- chart: grade → cost — Minetti's energy cost per metre of running and walking against grade, next to the heart-rate pace factor F(g) and the planned running speed multiplier -->


### Descents

Descending is a skill, and it varies far more between people than climbing does. The typical curve, the one heart-rate data from ordinary runners describes, is F^−0.8, never faster than 1.15× flat speed. Hill-race records describe what skilled descenders do. Kay (2012) fitted a quartic to the record times of 91 uphill and 15 downhill fell races. It is fastest at −10.3 %, 1.23× flat speed, and still at flat pace near −21 %.

Runsketch blends between the two with a descent skill that depends on the fitness level:

| | Beginner | Recreational | Trained | Elite |
|---|---|---|---|---|
| Descent skill | 0 | 0.35 | 0.65 | 0.9 |
| Cap on descent speed vs flat | 1.15× | 1.19× | 1.22× | 1.24× |

The top speed on a descent is capped at 1.15 + 0.1 × skill times flat speed. Unskilled runners also hold back on steep ground. A beginner goes up to 40 % slower than the blended curve by −32 %, a recreational runner about 11 % slower, an elite runner hardly at all.

Skill matters most where the ground is steep and rough. The spread in descending ability in fell races is largest there (Kay 2014), and the better finishers in trail ultramarathons are relatively faster on descents (Genitrini et al. 2022). Technical ground (see Surfaces below) therefore lowers the effective skill by up to 70 % and the cap by up to 15 %.

The speed multiplier this gives, before any walking, vertical-speed limit or surface is applied, is the same for every level uphill: 0.87× at +5 %, 0.74× at +10 %, 0.53× at +20 % and 0.42× at +30 %. Downhill it spreads with skill. At −10 % a beginner goes 1.12× flat speed, a recreational runner 1.16× and an elite runner 1.22×. At −20 % it's 0.75×, 0.90× and 1.02×, and at −30 % 0.41×, 0.60× and 0.71×.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="diagrams/terrain-descent-dark.svg">
  <img src="diagrams/terrain-descent.svg" alt="Running speed as a multiple of flat speed from a 40 % descent to a 40 % climb, before walking, the vertical-speed ceiling or surface. Uphill every level shares one curve: 0.87× at +5 %, 0.74× at +10 %, 0.53× at +20 % and 0.42× at +30 %. Downhill the curves split by descent skill. A beginner (skill 0) peaks at 1.13× near −8 % and holds back on steep ground: 1.11× at −5 %, 1.12× at −10 %, 0.97× at −15 %, 0.75× at −20 % and 0.41× at −30 %. A recreational runner (0.35) goes 1.12×, 1.16×, 1.06×, 0.90× and 0.60× at the same grades, a trained runner (0.65) 1.14×, 1.19×, 1.12×, 0.97× and 0.68×, and an elite runner (0.9) 1.15×, 1.22×, 1.16×, 1.02× and 0.71×, within 0.015 of Kay's 2012 curve fitted to hill-race records, which peaks at 1.23× at −10 %.">
</picture>

In a full simulation we put a 400 m descent between two 8 km flats. A recreational runner at 5:45/km covered it at 1.12× the flat speed at −10 %, 0.87× at −20 % and 0.58× at −30 %. An elite runner at 4:00/km managed 1.20×, 1.01× and 0.71×. A beginner at 7:00/km went at 1.10× and 0.72× at −10 % and −20 %, and walked most of the −30 % stretch.

Heart rate doesn't drop as far as speed on steep descents. Braking, footing and concentration keep it up. At the same oxygen uptake, trail runners' heart rate was higher running fast downhill than running uphill (Lemire et al. 2021). So below about −8 % the heart-rate demand never counts as easier than 85 % of the flat speed of the same effort.

### Vertical speed has a ceiling

On a steep climb what limits people is how fast they can gain height, not how fast they move along the slope. Kay's race records show no gradient beyond which runners gain height more slowly: the steeper the course, the more vertical metres per hour, up to the steepest races in his data. The fastest ascent in his data was 2045 m/h. The vertical kilometre record at Fully, on a slope of more than 50 %, stands at 27:21, about 2190 m/h.

Runsketch caps the sustained vertical speed on climbs by fitness level: 800 m/h for a beginner, 1100 recreational, 1500 trained and 1950 elite. The cap is scaled by the athlete's VO₂max against the level's default, between 0.6 and 1.3 times. Pace wobble is squeezed above 95 % of the cap, so random variation can approach the ceiling but never cross it. The cap applies to walks and hikes as well.

For 1 km climbs between two 8 km flats, at the same four paces, the engine gives:

| | Beginner, 7:00/km | Recreational, 5:45/km | Trained, 4:50/km | Elite, 4:00/km |
|---|---|---|---|---|
| Vertical speed at +15 % | 670 m/h | 1000 m/h | 1180 m/h | 1430 m/h |
| Vertical speed at +30 % | 680 m/h | 1020 m/h | 1440 m/h | 1750 m/h |

<!-- chart: vertical speed against grade by level — planned climbing speed flattening into the 800 / 1100 / 1500 / 1950 m/h ceilings -->


## After the crest

Nobody hits flat pace the moment a climb ends. In Townshend's study, speed on the level stayed changed for 78 s after a climb and 24 s after a descent: slower after climbs, faster after descents. So on runs the planned speed multiplier doesn't jump when the grade changes. After a climb it rises towards the new value with a time constant of 30 s, and after a descent it falls with a time constant of 10 s. Going into a climb or a descent stays immediate.

We ran a recreational runner at an average of 5:30/km over 2 km flat, then 1 km at +8 %, then 3 km flat, with variability at zero and eight seeds. Ten seconds after the crest they were at 85 % of the flat speed that followed, 92 % after 30 s, 97 % after a minute, 99 % after 90 s and 100 % after two minutes.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="diagrams/terrain-crest-dark.svg">
  <img src="diagrams/terrain-crest.svg" alt="Speed as a share of the flat speed that follows, averaged over eight seeds with variability at zero for a recreational runner at an average of 5:30/km, from 60 seconds before to 180 seconds after the top of a 1 km climb at +8 % and the bottom of a 1 km descent at −8 %. On the climb the runner holds about 79 % of the later flat speed. After the crest speed comes back gradually rather than at once: 85 % at 10 s, 92 % at 30 s, 97 % at 60 s, 99 % at 90 s and 100 % at 120 s, staying within 2 % from 73 s. On the descent the runner goes about 115 % of the later flat speed, still 113.5 % at the bottom, and is within 2 % of it from 26 s.">
</picture>

Speed stays within 2 % of the flat speed from 73 s on. The same run over a 1 km descent at −8 % reaches the flat still going 113.5 % of the speed that follows, and is within 2 % of it from 26 s.

This only applies to runs, and only when a climb or descent levels out. A crest that drops straight into a descent picks up downhill speed at once.

## Walking on steep ground

### Walks and hikes

Walks and hikes follow Tobler's hiking function, scaled to the flat walking speed and capped at 1.2×:

| Grade | −30 % | −20 % | −10 % | −5 % | 0 | +10 % | +20 % | +30 % |
|---|---|---|---|---|---|---|---|---|
| Walking speed vs flat | 0.50 | 0.70 | 1.00 | 1.19 | 1 | 0.70 | 0.50 | 0.35 |

Mountaineering uses a different curve, the Swiss hiking-time formula, described on its own page.

### When a runner walks a climb

On a steep enough climb walking is cheaper than running, and the grade where that happens depends on the speed. Giovanelli et al. (2016) had runners walk and run at a fixed 0.35 m/s of vertical speed. Walking cost less at every incline from 15.8° up. Ortiz et al. (2017) found that on a 30° incline walking is cheaper below 0.7 m/s, and the two gaits cost the same at 0.8 m/s. Brill & Kram (2021) showed the transition speed falls as the incline steepens.

Runsketch uses a speed along the slope below which walking a climb is at least as economical as running. It rises from zero at a 3 % grade to 2.0 m/s at 3°, then falls through 1.9 m/s at 9.4°, 1.3 m/s at 15.8° and 0.75 m/s at 30°. In grades that works out to 1.96 m/s at +10 %, 1.72 at +20 %, 1.27 at +30 % and 0.97 at +45 %.

<!-- chart: walk–run transition speed against grade with its four anchors, each level's threshold after its offset, and each level's planned climbing speed -->


People switch to running before it is actually cheaper, 0.5–0.9 km/h below the speed where the two gaits cost the same (Minetti et al. 1994). Elite athletes switch closer to it (Brill & Kram 2021). So the threshold is lowered by 0.15 m/s for beginners and recreational runners, 0.1 m/s for trained and 0.05 m/s for elite athletes.

The decision uses the grade over a 200 m baseline, so a short ramp or a leftover bump in the elevation data never makes anyone walk. It also uses the planned running speed, capped by the athlete's critical speed and the vertical-speed ceiling.

Around the threshold the gait doesn't flip in one step. Walking takes a share of the time, and that share grows as the planned speed falls. On steep grades the band is wider, because athletes mix walking and running there (Whiting et al. 2020 link this to fatigue in the calf muscles). The walking share is spent in bouts:

- When walking and running are evenly split, each bout lasts about 150 s on grades up to 6 % and about 20 s from 15 % up.
- Every switch draws a random length factor from the seed, with a spread of 40 %, so bouts on a steady climb don't repeat like clockwork.
- A switch needs at least 25 s or 50 m in the current gait.

A power-hiking runner walks at the speed that costs the same as running would, but no faster than 85 % of the running speed or 1.75 m/s. Cadence switches to walking cadence. Heart-rate demand never falls below half of what flat running at the planned pace would ask, because someone walking a climb in the middle of a run is still working hard.

On the 1 km climbs from the table above:

- The **beginner** at 7:00/km walks every climb from +12 % up.
- The **recreational** runner at 5:45/km runs up to +15 %. On +20 to +40 % they walk 34–49 % of the time, in walking bouts of about 30–40 s and running bouts of 40–55 s.
- The **trained** and **elite** runners at 4:50 and 4:00/km run even +40 %. Their vertical-speed ceiling still keeps them above the walk–run threshold.

### Walking steep descents

Runners walk a descent when it gets too steep to run, or when running it would only be a shuffle. Too steep means a band from −25 to −30 %, which moves up to 15 percentage points steeper with descent skill. A shuffle means any descent steeper than −8 % where the running speed it allows falls under 1.4 m/s. Walked descents go at 1.8 m/s × (1 + 0.8 × skill), shaped by Tobler's function and the surface.

With the same 8 km flats around a 400 m descent:

- The beginner walks 73 % of a −25 % descent and 94 % of a −30 % one.
- The recreational runner walks from −35 %, and the trained runner from −40 %.
- The elite runner still runs −40 %, at half their flat speed.

### Steps and technical ground

Steps up are always walked. Speed on steps is capped at 1.0 m/s walking up, 1.2 m/s walking down and 1.2 m/s running down. Technical ground makes runners walk too: everywhere from mountain-hiking grade T5, and on climbs steeper than 10 % from T4. Both come in gradually over a short band.

## Surfaces and technical trails

### Where the tags come from

Routes from BRouter and Valhalla carry OpenStreetMap way tags. BRouter lists them per stretch of the route. Valhalla reports a coarser set of attributes (way use, road class, a rough surface grade, SAC grade, bridge and tunnel), which we translate into the same tags. OSRM routes and hand-drawn lines carry no tags, so they are treated as plain paved ground with no extra cost.

### Surface classes

Each point gets a surface class from its tags. Specific tags beat general ones: steps and via ferratas beat the surface tag, `surface` beats `tracktype`, and both beat the road class. `smoothness` can only make a surface rougher. Speed and cost are relative to paved road, separately for running and walking. Cost multiplies the oxygen demand of the movement, so it shows up in heart rate.

| Class | Tags | Run speed | Run cost | Walk speed | Walk cost | Bike rolling | Pace wobble |
|---|---|---|---|---|---|---|---|
| paved | asphalt, concrete, paving stones, sett, cobblestone and similar; roads and footways without a surface tag | 1 | 1 | 1 | 1 | ×1 | +0 |
| compacted | compacted, fine_gravel, clay; tracktype grade1–2 | 0.98 | 1.02 | 0.97 | 1.05 | ×1.8 | +10 % |
| ground | unpaved, ground, dirt, earth, grass, woodchips; tracktype grade3; paths, tracks and bridleways without a surface tag | 0.96 | 1.04 | 0.95 | 1.08 | ×2.5 | +20 % |
| gravel | gravel, pebblestone, shells; tracktype grade4 | 0.94 | 1.05 | 0.90 | 1.12 | ×3 | +25 % |
| rough | rock and stone below T4, unhewn cobblestone, stepping stones; tracktype grade5; smoothness very_bad or worse; via ferrata | 0.85 | 1.10 | 0.85 | 1.40 | ×5 | +60 % |
| sand | sand, mud, salt | 0.75 | 1.40 | 0.65 | 2.10 | ×10 | +30 % |
| steps | highway=steps | speed limits, see above | | | | ×6 | +30 % |

The anchors:
- On sand, running costs 1.2 times as much per metre (Zamparo et al. 1992) to 1.6 times (Lejeune et al. 1998), and walking 1.8 to 2.7 times.
- Running on a surface uneven by a couple of centimetres costs 5 % more (Voloshina & Ferris 2015).
- Walking on woodchips costs 27 % more than on a sidewalk, with dirt, gravel and grass in between (Kowalsky et al. 2021).
- On a rocky trail walkers chose a 14 % slower speed, and it cost them more than twice as much per metre (Gast et al. 2019).

<!-- chart: surface factor by class — running and walking speed and cost multipliers as paired bars from paved to sand -->


Mud sits with sand. The classes in between are our interpolation. Snow, ice, scree and scrambling rock have classes of their own, described on the mountaineering page.

### Technicality

How difficult a way is gets a number from 0 to 1, taken from the highest of its difficulty tags:

| Tag | Values → technicality |
|---|---|
| sac_scale | hiking (T1) 0, mountain_hiking (T2) 0.2, demanding_mountain_hiking (T3) 0.4, alpine_hiking (T4) 0.6, demanding_alpine_hiking (T5) 0.8, difficult_alpine_hiking (T6) 1 |
| trail_visibility | intermediate 0.1, bad 0.25, horrible 0.4, no 0.5 |
| mtb:scale | 1: 0.15, 2: 0.35, 3: 0.55, 4: 0.75, 5: 0.9, 6: 1 |

Technical ground slows people mostly because of footing, but it also costs more per metre. That's what Gast et al. saw: slower, yet more expensive. So speed falls with technicality t, and cost rises as speed falls:

- running speed 1 − 0.8·t^1.35, running cost speed^−0.8
- walking speed 1 − 0.8·t^1.2, walking cost speed^−1.1

| | T2 | T3 | T4 | T5 |
|---|---|---|---|---|
| Running speed | 0.91 | 0.77 | 0.60 | 0.41 |
| Walking speed | 0.88 | 0.73 | 0.57 | 0.39 |

<!-- chart: technicality 0–1 against running and walking speed and cost multipliers, with T1–T6 marked -->

Surface class and technicality describe the same ground from two sides, so they are combined rather than stacked:

- **Running** multiplies them. A runner is slowed both by what is underfoot and by having to pick a line.
- **Walking** takes the slower speed and the dearer cost of the two, not their product. A scree slope tagged T4 is scree, not scree with a T4 penalty on top. Multiplying counted the same roughness twice, and since the cost is what an effort preset solves against, a tagged mountain trail came out slower than any party walks it: a routed Thorong La descent was solved at 0.47 m/s where parties walk about 0.72.

| Ground | Walker: speed, cost | Runner: speed, cost |
|---|---|---|
| earth path, T2 | 0.88, 1.15 | 0.87, 1.12 |
| rough path, T3 | 0.73, 1.41 | 0.65, 1.36 |
| scree, T4 | 0.57, 1.87 | 0.42, 2.11 |
| rock, T5 | 0.39, 2.83 | 0.24, 2.66 |

Technicality also lowers descent skill (see Descents) and makes pace less steady: the fast wobble on descents grows by up to 1.5 × technicality at −20 %.

### Wet, snowy and icy ground

Weather puts a state on the ground that belongs to the place rather than to the athlete: a water film, mud that remembers earlier rain, fresh snow and ice. The [weather](weather.md) page explains how it builds up and dries. On foot this state multiplies the dry factors above, class by class:

- A wet surface costs a little speed on the level and more on steep descents, and the descent loss grows with technicality.
- Ice slows walking and running further, steep icy descents most of all.
- Less grip lowers corner speed limits.

How wet a place is comes from the weather model, which steps every 200 m of the route from two days before the start. What that wetness costs is a property of the class:

| Class | Speed lost when fully wet, level | On a steep descent | Grip lost |
|---|---|---|---|
| paved | 1 % | 4 % | 20 % |
| compacted, gravel | 2 % | 8 % | 30 % |
| earth path | 4 % | 20 % | 60 % |
| rough path, rock | 4 % | 25 % | 50 % |
| scree | 3 % | 15 % | 30 % |
| steps | 3 % | 15 % | 40 % |
| sand | 3 % faster, it firms up | — | — |
| snow | 2 % | 10 % | 30 % |
| ice | 5 % | 30 % | 60 % |

The descent loss starts at −5 %, is full by −25 %, and is scaled by 0.5 + technicality. A fully wet earth path at T2 therefore runs 15 % slower at −20 %, and rough T3 ground 21 % slower. A drying descent gets its speed back as the film goes, not on a timer of its own.

Ice is graded rather than switched on. A film of at least 0.05 mm freezes as the air cools: nothing at +1 °C, about a quarter at 0 °C, three quarters at −1 °C and fully from −2 °C down. Fully icy ground keeps half its running speed on the level and 43 % on a −20 % descent; walking keeps 60 % and 45 %. The short, braced steps cost 15 % more oxygen. With crampons on a mountain day, walking keeps 90 % and 83 %, the extra cost is 5 %, and the grip lost falls from 60 % to 20 %.

Ice needs a film that is already there, and near freezing most precipitation falls as snow instead. In a test at 0 °C, 85 % of a 4 mm/h fall came down as snow and 1.7 cm settled, so the ground was snowy rather than icy.

What it costs in practice: a recreational runner descending 2 km at −20 % on an earth path at T2, aiming at 5:30/km overall, covers it at 6:05/km dry at 12 °C and 6:22/km in 4 mm/h of rain, and the engine warns that the wet descents were about 11 % slower. The same descent on rough T3 ground as a hike goes from 18:09/km to 19:45/km.

### What it does to a run

To see these factors at work we ran a flat 6 km route at an average of 5:30/km. Only the middle 2 km changed. Moving time is fixed by the target, so the road on either side gets faster to make up for a slow middle. Averages over four seeds.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="diagrams/terrain-surfaces-dark.svg">
  <img src="diagrams/terrain-surfaces.svg" alt="Dot plot of a flat 6 km run at an average of 5:30/km in which only the middle 2 km change, four seeds, recreational runner. For each surface, pace and heart-rate demand in the middle 2 km against the road on either side: asphalt 5:29 in the middle and 5:30 on the road, heart-rate demand 157 and 156 bpm; dirt path 5:38 in the middle and 5:26 on the road, heart-rate demand 158 and 158 bpm; gravel 5:42 in the middle and 5:24 on the road, heart-rate demand 158 and 158 bpm; dirt path, T2 5:59 in the middle and 5:15 on the road, heart-rate demand 160 and 161 bpm; rough path, T3 7:08 in the middle and 4:41 on the road, heart-rate demand 164 and 173 bpm; sand 6:34 in the middle and 4:58 on the road, heart-rate demand 174 and 169 bpm. Moving time is fixed, so the slower the middle, the faster the road around it: sand and a T3 path make the road 4:58 and 4:41/km. Sand asks 18 bpm more than asphalt in the middle, a T3 path 7 bpm more, and on the T3 run the fast road asks more than the path itself.">
</picture>

With asphalt in the middle the whole run stays at 5:29–5:30/km and asks 156–157 bpm. A dirt path in the middle takes 5:38/km, gravel 5:42, a dirt path at T2 5:59, sand 6:34 and a rough T3 path 7:08, and the road around them speeds up to 5:26, 5:24, 5:15, 4:58 and 4:41/km. Compared with asphalt, sand asks 18 bpm more and a T3 path 7 bpm more. Heart rate goes up while pace drops. On the T3 run the fast road even asks more than the path itself, 173 bpm against 164.

## Cadence on grades

At a fixed speed on a treadmill, runners take quicker, shorter steps uphill, about 4.5 % more at 7 % (Padulo et al. 2013), and only 0.6–1.8 % fewer at −13 % (Robinson et al. 2025). Outdoors people also slow down on climbs, and the slower speed wins. Across 3001 Garmin-recorded runs by 148 runners, cadence was lower on uphill stretches than on the level and unchanged downhill (Chan et al. 2025).

Runsketch keeps the speed term from the physiology doc and adds a grade term that holds at a fixed speed:

```
spm = (147.6 + 7.9·v) × (1 + 0.25 % per % uphill up to 12 %, then 0.1 % per % − 0.1 % per % downhill) − 120·(height − 1.75 m)
```

On descents steeper than −15 % runners take short quick steps, so cadence doesn't drop below the flat cadence of the same effort. A recreational runner who does 3.03 m/s on the flat and runs each grade at the speed it gives takes 176 steps per minute at −25 %, 174 at −10 %, 172 on the flat, 169 at +10 % and 166 at +20 %. Held at 3.03 m/s everywhere, the same runner would take 185, 170, 172, 176 and 178.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="diagrams/terrain-cadence-dark.svg">
  <img src="diagrams/terrain-cadence.svg" alt="Running cadence against grade from −30 % to +30 % for a recreational runner 1.75 m tall who runs 3.03 m/s on the flat. Running at the speed each grade gives, cadence changes little: 176 steps per minute at −25 %, 174 at −10 %, 172 on the flat, 169 at +10 % and 166 at +20 %. Held at the same 3.03 m/s everywhere, the grade term shows: 185 at −25 %, 170 at −10 %, 172 on the flat, 176 at +10 % and 178 at +20 %. Steeper than −15 % runners take short quick steps, so cadence never drops below the flat cadence of the same effort.">
</picture>

Walking cadence drops 0.4 % per percent of climb: 108 steps per minute at 1.2 m/s on the flat, 102 at +15 % and 95 at +30 %. A runner's walking bouts on a steep climb show this walking cadence. At 1 m/s on +20 % that's 93 steps per minute, where running at the same speed would be 161.

## Altitude below 2800 m

Wehrlin & Hallén (2006) put endurance athletes in a pressure chamber at simulated altitudes from 300 to 2800 m. VO₂max fell in a straight line, 6.3 % per 1000 m (4.6–7.5 % between individuals), and the loss was already measurable between 300 and 800 m. That fits elite results: distance events from 800 m up are 2–4 % slower above 1000 m (Hamlin et al. 2015), and Fulco et al. (1998) report reduced VO₂max from 580 m. Runsketch follows this line from 300 m, with the start rounded over a few tens of metres:

| Elevation | 500 m | 1000 m | 1500 m | 2000 m | 2500 m | 2800 m |
|---|---|---|---|---|---|---|
| VO₂max | 0.987 | 0.956 | 0.924 | 0.893 | 0.861 | 0.843 |

<!-- chart: VO₂max, maximum heart rate and resting heart rate multipliers from 0 to 2800 m, with and without acclimatisation -->


This is applied every second at the athlete's elevation, for every sport, so the same pace is a larger share of what the athlete can do. Heart rate changes a little too:

- **Maximum heart rate.** It stays put until VO₂max has dropped 2 %, around 620 m. Recreational runners showed no change up to 2286 m (Squires & Buskirk 1982), and acute hypoxia lowers it by about 1.7 bpm per 1000 m (Mourot 2018). At 2000 m it is 1.7 % lower without acclimatisation and 3 % lower with full acclimatisation; at 2800 m, 2.7 % and 4.8 %.
- **Resting heart rate.** It rises from 1500 m: +1.7 % at 2000 m and +6 % at 2800 m without acclimatisation.
- **Effort presets.** Easy to Race measure effort against the reduced VO₂ reserve, so the same preset comes out slower at altitude. Time to exhaustion falls about twice as fast as VO₂max (Wehrlin & Hallén 2006), and walking days measure their effort against what is still sustainable there.
- **Climbing rate on foot.** Walks and treks also get an oxygen budget on climbs, a third of the reserve, fading in from 1500 m and full above 3000 m, so a walker's climbing rate falls with the air rather than with the slope. The [mountaineering](mountaineering.md) page covers it, and the same budget at half the reserve on summit days.

Above 2800 m the loss follows the oxygen pressure of the air instead. That, and acclimatisation, is on the [mountaineering](mountaineering.md) page.

## How it's tested

- A flat 10 km route with twelve raised patches 6–16 m high shows less than 20 m of ascent and no grade above 8 %, on both detailed and coarse tiles, on a road and on T2–T3 paths.
- A 300 m climb at 12 % keeps its ascent within 5 % and its grade within 15 %, with or without patches. A 3 km switchback trail of 25–35 % ramps keeps its ascent within 5 %.
- A tagged bridge or tunnel over a 25 m valley or hill gives under 0.5 m of ascent. Untagged, the same route shows more than 20 m.
- A 30 % ramp on a residential road is limited to 25 %, and the clamped metres are reported. On steps it stays at 30 %.
- Tags from real BRouter and Valhalla routes on alpine trails (Hörnli ridge, Aconcagua, Kazbek) come out as the expected classes.

## What's still a guess

- **Surface magnitudes.** Only a few points are measured: sand, uneven ground, woodchips for walking, a rocky trail. The compacted, ground, gravel and rough factors in between are our interpolation. So are mud with sand, the rolling resistance factors for bikes and the extra pace wobble per surface.
- **Technicality.** The curves 1 − 0.8·t^1.35 and 1 − 0.8·t^1.2, the cost exponents, the numbers given to trail visibility and the mountain-bike scale, and the grades at which T4 and T5 force walking. Combining surface and technicality by the harsher of the two for a walker, and by their product for a runner, is a judgement call as well: the walking side is anchored on guide times for trekking passes, the running side on nothing but the two curves.
- **Walking bouts.** The 20 s and 150 s bout lengths, their 40 % spread, the 25 s / 50 m minimum, and hiking at no more than 85 % of running speed and 1.75 m/s.
- **Who walks.** The transition offsets per level are rough. In our checks trained and elite runners never walk a 1 km climb up to 40 % at steady paces. Real recordings may well show them power-hiking sooner.
- **Vertical speed limits.** Only the elite value has anchors (race records). The 800, 1100 and 1500 m/h for the other levels and the 0.6–1.3 scaling with VO₂max are our estimates.
- **After the crest.** The 30 s and 10 s time constants come from one study of eight runners on one course. We don't know what happens when a climb runs straight into a descent, or after climbs on walks and hikes.
- **Descent skill.** The values 0, 0.35, 0.65 and 0.9, the caution curve for unskilled runners, the 1.15–1.25× caps, the −25 to −30 % walking band, the 1.4 m/s shuffle rule and the walked descent speed.
- **The pace factor itself.** The coefficients we couldn't trace to their source, and the 0.7 and 0.8 exponents.
- **Cadence.** The +0.25 % per % uphill is a compromise between lab data at a fixed speed and field data at a free one. The −0.1 % downhill and the steep-descent floor are ours.
- **Elevation cleaning.** The patch filter's constants (60 m edges, 350 m width, 2.5 m closing tolerance) and the plausible grades per road class.
- **Altitude.** Wehrlin & Hallén studied trained athletes. We don't know whether less trained people lose the same share, and the heart-rate adjustments below 2800 m are small, loosely anchored estimates.
- **Wet and icy ground.** The speed lost per class when wet, and the ice and crampon factors, are our estimates; only the grip values are anchored to measurements. The freezing band of +1 to −2 °C stands in for surfaces running a little colder or warmer than the air.

## References

Elevation and grade

- Minetti AE, Moia C, Roi GS, Susta D, Ferretti G. Energy cost of walking and running at extreme uphill and downhill slopes. *J Appl Physiol* 93:1039–1046, 2002. https://doi.org/10.1152/japplphysiol.01177.2001
- BRouter, filtered ascent and way tags. https://brouter.de/brouter/
- Valhalla trace_attributes. https://valhalla.github.io/valhalla/api/map-matching/api-reference/

Climbs, descents and pacing

- Strava Engineering. Improving Grade Adjusted Pace, 2017. https://medium.com/strava-engineering/improving-grade-adjusted-pace-b9a2a332a5dc
- Grade vs pace, including the ultraPacer model. https://educatedguesswork.org/posts/grade-vs-pace/
- Townshend AD, Worringham CJ, Stewart IB. Spontaneous pacing during overground hill running. *Med Sci Sports Exerc* 42:160–169, 2010. https://doi.org/10.1249/mss.0b013e3181af21e2
- Kay A. Pace and critical gradient for hill runners: an analysis of race records. *J Quant Anal Sports* 8(4), 2012. https://doi.org/10.1515/1559-0410.1456
- Kay A. Importance of descending skill for performance in fell races: a statistical analysis of race results. *J Quant Anal Sports* 10, 2014. https://doi.org/10.1515/jqas-2013-0075
- Genitrini M, Fritz J, Zimmermann G, Schwameder H. Downhill sections are crucial for performance in trail running ultramarathons: a pacing strategy analysis. *J Funct Morphol Kinesiol* 7:103, 2022. https://doi.org/10.3390/jfmk7040103
- Lemire M et al. High-intensity downhill running exacerbates heart rate and muscular fatigue in trail runners. *J Sports Sci* 39:815–825, 2021. https://doi.org/10.1080/02640414.2020.1847502
- Vertical Kilometer World Circuit. VK world record smashed at Fully. https://vkworldcircuit.com/vk-world-record-smashed-at-fully/

Walking and the walk–run transition

- Tobler W. Three presentations on geographical analysis and modeling. NCGIA Technical Report 93-1, 1993. https://en.wikipedia.org/wiki/Tobler%27s_hiking_function
- Giovanelli N, Ortiz ALR, Henninger K, Kram R. Energetics of vertical kilometer foot races; is steeper cheaper? *J Appl Physiol* 120:370–375, 2016. https://doi.org/10.1152/japplphysiol.00546.2015
- Ortiz ALR, Giovanelli N, Kram R. The metabolic costs of walking and running up a 30-degree incline: implications for vertical kilometer foot races. *Eur J Appl Physiol* 117:1869–1876, 2017. https://doi.org/10.1007/s00421-017-3677-y
- Brill JW, Kram R. Does the preferred walk–run transition speed on steep inclines minimize energetic cost, heart rate or neither? *J Exp Biol* 224:jeb233056, 2021. https://doi.org/10.1242/jeb.233056
- Minetti AE, Ardigò LP, Saibene F. The transition between walking and running in humans: metabolic and mechanical aspects at different gradients. *Acta Physiol Scand* 150:315–323, 1994. https://doi.org/10.1111/j.1748-1716.1994.tb09692.x
- Whiting CS, Allen SP, Brill JW, Kram R. Steep (30°) uphill walking vs. running: COM movements, stride kinematics, and leg muscle excitations. *Eur J Appl Physiol* 120:2147–2157, 2020. https://doi.org/10.1007/s00421-020-04437-y

Surfaces

- Zamparo P, Perini R, Orizio C, Sacher M, Ferretti G. The energy cost of walking or running on sand. *Eur J Appl Physiol* 65:183–187, 1992. https://doi.org/10.1007/bf00705078
- Lejeune TM, Willems PA, Heglund NC. Mechanics and energetics of human locomotion on sand. *J Exp Biol* 201:2071–2080, 1998. https://doi.org/10.1242/jeb.201.13.2071
- Voloshina AS, Ferris DP. Biomechanics and energetics of running on uneven terrain. *J Exp Biol* 218:711–719, 2015. https://doi.org/10.1242/jeb.106518
- Kowalsky DB, Rebula JR, Ojeda LV, Adamczyk PG, Kuo AD. Human walking in the real world: interactions between terrain type, gait parameters, and energy expenditure. *PLoS ONE* 16:e0228682, 2021. https://doi.org/10.1371/journal.pone.0228682
- Gast K, Kram R, Riemer R. Preferred walking speed on rough terrain: is it all about energetics? *J Exp Biol* 222:jeb185447, 2019. https://doi.org/10.1242/jeb.185447
- OpenStreetMap SAC hiking scale. https://wiki.openstreetmap.org/wiki/Key:sac_scale

Cadence

- Padulo J, Powell D, Milia R, Ardigò LP. A paradigm of uphill running. *PLoS ONE* 8:e69006, 2013. https://doi.org/10.1371/journal.pone.0069006
- Robinson RM, Donahue SR, Chebbi A, Hahn ME. Biomechanical strategies to achieve faster running speeds on level ground, uphill and downhill grades. *Sci Rep* 15:33917, 2025. https://doi.org/10.1038/s41598-025-09968-y
- Chan ZYS, Ferber R, Cheung RTH. Speed and cadence adaptations during overground sloped running under real-world conditions. *Sport Sci Health*, 2025. https://doi.org/10.1007/s11332-025-01540-5
- Burns GT, Zendler JM, Zernicke RF. Step frequency patterns of elite ultramarathon runners during a 100-km road race. *J Appl Physiol* 126:462–468, 2019. https://doi.org/10.1152/japplphysiol.00374.2018

Altitude

- Wehrlin JP, Hallén J. Linear decrease in VO2max and performance with increasing altitude in endurance athletes. *Eur J Appl Physiol* 96:404–412, 2006. https://doi.org/10.1007/s00421-005-0081-9
- Hamlin MJ, Hopkins WG, Hollings SC. Effects of altitude on performance of elite track-and-field athletes. *Int J Sports Physiol Perform* 10:881–887, 2015. https://doi.org/10.1123/ijspp.2014-0261
- Fulco CS, Rock PB, Cymerman A. Maximal and submaximal exercise performance at altitude. *Aviat Space Environ Med* 69:793–801, 1998. https://pubmed.ncbi.nlm.nih.gov/9715971/
- Squires RW, Buskirk ER. Aerobic capacity during acute exposure to simulated altitude, 914 to 2286 meters. *Med Sci Sports Exerc* 14:36–40, 1982. https://doi.org/10.1249/00005768-198201000-00007
- Mourot L. Limitation of maximal heart rate in hypoxia: mechanisms and clinical importance. *Front Physiol* 9:972, 2018. https://doi.org/10.3389/fphys.2018.00972
