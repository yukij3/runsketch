# Treks and high mountains

[Physiology & motion models](physiology.md) explains how Runsketch moves an athlete along a route and how their heart answers. Hills, surfaces and altitude below 2800 m are on the [Terrain](terrain.md) page, heat, cold and wind on [Weather](weather.md). This page covers what changes when the route leaves the valley: thin air all the way to the top of Everest, climbs that are limited by oxygen rather than by the legs, boots, crampons and a pack, snow that routers can't see, and the breaks of a long mountain day. As elsewhere, some numbers are measured, some are our judgement, and the judgement calls are listed at the end.

## The idea in one paragraph

A summit day doesn't look like a slow hike. People set off in the dark and climb at a few hundred metres an hour. They get slower the higher they go, even though the slope doesn't get steeper. They stop every hour, put crampons on where the snow starts, rest on the top and come down much faster than they went up. Their heart rate stays surprisingly low, because at altitude the heart can't reach its usual maximum. Runsketch builds all of that from the same one-second simulation. Altitude lowers VO₂max and maximum heart rate and raises resting heart rate. On climbs, speed is capped by the oxygen the athlete can still spend at that height, and gear and snow make every step more expensive. Breaks follow a guided day's rhythm. There are two foot activities for this: **Hike** for treks, and **Mountaineering** («Альпинизм») for glacier and high-altitude summit days.

## Hike or Mountaineering

A hike keeps the walking model from the [Terrain](terrain.md) page. It uses Tobler's curve, technical paths slow it down more than they slow a mountaineer, and it has no gear. Altitude physiology, the pack and mountain breaks are available to it too, and high up a trek gets an oxygen budget of its own: a third of the reserve, fading in between 1500 and 3000 m.

Mountaineering changes five things:

- speed on a grade follows the Swiss hiking-time formula instead of Tobler;
- difficulty grades slow it only mildly;
- climbs are capped by an oxygen budget;
- boots, crampons, slow walking and snow add to the cost;
- snow is inferred above a snowline.

It also starts with different defaults: acclimatisation "A week", an 8 kg pack, mountain boots, crampons, firm snow, mountain breaks, and a target of 8 hours of moving time instead of a pace. A pace per kilometre means little on a day that covers 5 km in 12 hours.

## Altitude, from sea level to 8849 m

### It's the air, not the metres

What matters is how much oxygen each breath carries. We compute it from the model atmosphere of West (1996):

```
PB  = exp(6.63268 − 0.1112·h − 0.00149·h²)     Torr, h in km
PIO₂ = 0.2093 × (PB − 47)                        inspired oxygen, Torr
```

That gives 149 Torr at sea level, 78 at 5000 m and 43 on the summit of Everest. 43 Torr is the value both the American Everest expedition of 1981 and the Operation Everest II chamber study worked with. West's model is the mean of his all-season and summer models for the latitudes where most high mountains stand. On a given day the real pressure can differ by a few percent. Everest's summit is about 11.5 Torr higher in summer than in winter (West et al. 1983). We don't model the season.

### VO₂max

Up to 2800 m we use the most careful measurement we found. Wehrlin & Hallén (2006) took trained athletes into a hypobaric chamber and saw VO₂max fall by 6.3 % per 1000 m from about 300 m, in a straight line. Above 2800 m the loss follows the hypoxia of the air instead:

```
up to 2800 m:  f = 1 − 0.063 per 1000 m above 300 m   (onset rounded over a few tens of metres)
above:         f = 1 − 1.287·x^1.719,  x = 1 − PIO₂/PIO₂(sea level)
```

The curve meets the straight line at 2800 m and passes through 0.283 at 43 Torr. That's the share Operation Everest II's volunteers kept after 40 days of acclimatisation: the five measured at every pressure went from 4.13 l/min at sea level to 1.17 on the simulated summit (Cymerman et al. 1989). We fit the curve to those litres per minute. Per kilogram the same volunteers went from 49.1 to 15.3 ml/kg/min, a ratio of 0.31.

Acclimatisation barely brings VO₂max back. Calbet et al. (2003) measured 54 % of sea-level VO₂max on arrival at 5260 m and 58.5 % after nine to ten weeks there. So instead of a separate curve, people who have just arrived lose up to 12 % more of the deficit. That extra loss ramps in between 2800 and 4500 m. The setting has three steps:

- **None:** arrived within two days (A = 0).
- **A week:** A = 0.5.
- **Full:** three weeks or more, or rotations (A = 1).

VO₂max never drops below 15 % of its sea-level value.

The earlier rule in the engine, 8 % per 1000 m above 1500 m with a floor of 60 %, started the loss too late and stopped it far too early. On Everest it left a climber with twice the aerobic capacity the chamber study found.

### Heart rate

Maximum heart rate falls at altitude. In a pooled analysis of 86 studies it drops about 1.7 bpm per 1000 m in acute hypoxia (Mourot 2018). It drops further after weeks up high. Lundby & van Hall (2001) measured:

- 186 bpm at sea level;
- 170 in acute hypoxia;
- 155 after weeks at 5400 m;
- 142–144 in two climbers at 8750 m without oxygen.

We tie the drop to the VO₂max loss, and make it stronger with acclimatisation:

```
HRmax factor = 1 − (0.20 + 0.15·A) × (1 − f − 0.02)
```

The 0.02 is a dead band. The first 2 % of VO₂max loss, up to about 620 m, leaves maximum heart rate alone. Recreational runners showed no change up to 2286 m (Squires & Buskirk 1982).

Resting heart rate rises above 1500 m. Well-acclimatised climbers rested at 57, 70 and 80 bpm at sea level, 5400 m and 6300 m (Karliner et al. 1985):

```
resting factor = 1 + min(0.5, (0.02·u + 0.012·u²) × (1 + 0.3·(1 − A)))      u = km above 1500 m
```

Just-arrived people get 30 % more of the rise, and the rise stops at +50 %.

<!-- chart: heart rate over the Elbrus summit day with its altitude-lowered maximum and raised resting level as moving bands -->

Both levels change every second with the elevation under the athlete, and every part of the heart-rate model uses them. That includes the reserve, the soft ceiling near the maximum, the heart-rate inertia and the range the recorded file is clamped to. A summit trace can't reach the sea-level maximum, and a rest stop at 5000 m doesn't fall to the sea-level resting rate.

This all applies to every sport, not only mountaineering. A run at 4000 m records a lower peak heart rate and a higher floor than the same run at sea level.

Just arrived against three weeks or more, VO₂max keeps 89 % of its sea-level value at 2000 m either way, 71 % and 74 % at 4000 m, 62 % and 66 % on Mont Blanc (4808 m), 53 % and 58 % on Elbrus (5642 m), 39 % and 45 % on Aconcagua (6961 m) and 20 % and 28 % on Everest. Maximum heart rate keeps 98 % and 97 % at 2000 m, 95 % and 91 % at 4000 m, 91 % and 86 % on Elbrus and 84 % and 76 % on Everest. Resting heart rate is 16 % and 13 % higher at 4000 m and 38 % and 29 % higher on Elbrus. It reaches its +50 % cap from about 6400 m for the just-arrived and 7200 m for the acclimatised.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="diagrams/mountaineering-altitude-dark.svg">
  <img src="diagrams/mountaineering-altitude.svg" alt="VO₂max, maximum heart rate and resting heart rate as a share of their sea-level values from 0 to 8849 m, for someone who has just arrived and for someone acclimatised three weeks or more. VO₂max falls in a straight line to 84 % at 2800 m and then faster with the thinner air: 89 % at 2000 m for both, then just arrived against three weeks 82 % and 83 % at 3000 m, 71 % and 74 % at 4000 m, 62 % and 66 % on Mont Blanc (4808 m), 53 % and 58 % on Elbrus (5642 m), 50 % and 55 % on Kilimanjaro (5895 m), 39 % and 45 % on Aconcagua (6961 m), 28 % and 36 % at 8000 m and 20 % and 28 % on Everest. Maximum heart rate stays put to about 620 m and falls further with acclimatisation: 98 % and 97 % at 2000 m, 95 % and 91 % at 4000 m, 91 % and 86 % on Elbrus and 84 % and 76 % on Everest. Resting heart rate rises from 1500 m: +2 % and +1 % at 2000 m, +16 % and +13 % at 4000 m, +38 % and +29 % on Elbrus, and it stops at +50 % from about 6400 m just arrived and 7200 m acclimatised. Open circles mark the measurements: Calbet's 54 % and 58.5 % at 5260 m, Operation Everest II's 28.3 % at 43 Torr, Lundby and van Hall's 155 of 186 bpm after weeks at 5400 m and 142–144 at 8750 m, and Karliner's resting 70 and 80 bpm against 57 at 5400 and 6300 m.">
</picture>

For the default athlete (35 years, resting 55, maximum 184) on Elbrus after a week at altitude, that means:

- VO₂max at 55 % of its sea-level value;
- maximum heart rate 162;
- resting heart rate 73.

### Holding an effort for hours

A lower VO₂max isn't the whole story. At the same share of their reduced capacity, people last much less long at altitude:

- Time to exhaustion fell 14.5 % per 1000 m in Wehrlin & Hallén's chamber, more than twice the VO₂max loss.
- Climbing speed falls faster than VO₂max: a 24 % loss of VO₂max cut it by 41 % in the analysis of Matthews et al. (2020).
- Acclimatisation helps here even though VO₂max doesn't recover (Fulco et al. 1998).

So the share of the reserve a mountaineer can hold for a whole day shrinks as well:

```
sustainable share = 1 − 0.5 × (1 − 0.3·A) × (1 − f)
```

On Elbrus after a week that's 0.81. The 0.5 and the 0.3 are our calibration against guided summit days, not measurements.

### Warnings

Runsketch warns when:

- a mountaineering day reaches its highest point after 13:00 local time. Parties on Elbrus must start down by 14:00. On Everest, climbers who died had reached the summit at a median of 13:00–13:59, survivors at 09:00–09:59 (Firth et al. 2008).
- a route goes above 5500 m without acclimatisation.
- a route goes above 7500 m, where most ascents use bottled oxygen, which we don't model.

## Climbing and descending

### The shape of a mountain path

Mountaineering uses the Swiss hiking-time formula, the one behind the times on Swiss trail signposts. It was fitted to Gerhard Weber's timings on more than 150 routes. Minutes per kilometre are a 15th-degree polynomial in the slope, 14.3 min/km (4.2 km/h) on the flat, held constant beyond ±40 %. Relative to the flat it gives 1.08 at −5 %, 0.71 at +10 %, 0.44 at +20 % and 0.21 at +40 %. Tobler, which hikes use, gives 1.19, 0.70, 0.50 and 0.25 at the same grades.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="diagrams/mountaineering-grade-dark.svg">
  <img src="diagrams/mountaineering-grade.svg" alt="Two line charts from the engine. Left: walking speed relative to flat on the Swiss hiking-time formula used for mountaineering and on Tobler's function used for hikes, from −40 % to +40 %. Swiss: 0.39 at −40 %, 0.52 at −30 %, 0.72 at −20 %, 1.00 at −10 %, 1.08 at −5 %, 0.86 at +5 %, 0.71 at +10 %, 0.57 at +15 %, 0.44 at +20 %, 0.29 at +30 % and 0.21 at +40 %. Tobler: 0.35, 0.50, 0.70, 1.00, 1.19, 0.84, 0.70, 0.59, 0.50, 0.35 and 0.25 at the same grades. Right: the Swiss curve's vertical rate at its 4.2 km/h on the flat: 180 m/h at +5 %, 300 at +10 %, then level near 370 m/h from +15 to +40 % (357, 371, 369 and 358 at +15, +20, +30 and +40 %), between the DIN 33466 planning rate of 300 m/h and the Swiss Alpine Club's 400 m/h. Downhill it is 226 m/h at −5 %, 422 at −10 %, 604 at −20 % and about 655 m/h at −30 to −40 %.">
</picture>

On climbs up to +20 % the two curves stay within 0.06 of each other. The largest gap is on gentle descents, 0.11 at −5 %, where Tobler peaks at 1.19 and the Swiss curve gives 1.08. We picked the Swiss one for its steep end. Its climbing rate levels off near 370 m/h between +15 and +40 %, which is what the German DIN 33466 (300 m/h) and Swiss Alpine Club (400 m/h) planning rules assume. Tobler, at the same 4.2 km/h on the flat, climbs a little slower than the Swiss curve up to about +12 % and faster from there. Its vertical rate keeps rising to about 441 m/h near +30 % and only then falls, to 414 m/h at +40 %, so from +20 to +40 % it sits above both planning rules and above the Swiss curve. Descents are fastest near 655 m/h vertical on −30 to −40 %.

### Difficulty grades

OSM tags hiking paths with the SAC scale, from T1 (a cleared trail) to T6 (glacier with high sliding risk, rock pitches). On a hike, technical ground slows walking a lot: to 0.57 of the flat speed at T4 and 0.39 at T5. That's right for a hiker on a scramble.

On the normal routes up big mountains, though, T4–T6 mostly marks crevasse and sliding risk on a broad snow slope, not slow footing. When we tried factors of 0.4–0.7 on top of the oxygen limit, guided summit days came out 20–40 % too slow. Mountaineering uses mild factors instead:

| Grade | T1 | T2 | T3 | T4 | T5 | T6 |
|---|---|---|---|---|---|---|
| Speed going up | 1 | 1 | 0.95 | 0.9 | 0.8 | 0.7 |
| Speed going down | 1 | 1 | 0.95 | 0.9 | 0.85 | 0.8 |

Coming down is not the harder direction. A party that kicked steps up a snow slope plunge-steps back down it, so above T4 the descent factor is the gentler of the two.

The grade and the ground (snow, scree and so on) aren't multiplied together: a walker takes the slower speed and the dearer cost of the two. They describe the same ground from two sides, and a scree slope tagged T4 is scree, not scree with a difficulty penalty laid on top. On mountaineering days technical ground doesn't add a separate cost. The cost comes from the ground class and the gear.

### Climbs are capped by oxygen

On every climb steeper than 2 % (blending in from level ground), speed can't go above the speed whose oxygen cost fits a budget:

```
budget = share × (VO₂max·f − 3.5) × sustainable share
```

f is the VO₂max factor at that point. The cost is the loaded walking cost described below, so the pack, boots, crampons and snow all slow the climb.

The share is 0.5 when the planned flat walking speed is the Swiss standard 4.2 km/h. It grows and shrinks in proportion to the planned speed, between 0.1 and 1. That way a faster target climbs harder, and moving time still changes smoothly with effort, which the calibration needs. The engine still solves one effort scale so that moving time matches the target exactly. The cap decides where the time goes: slow high up, quicker low down.

For the default athlete (VO₂max 45, 70 kg) with an 8 kg pack, mountain boots and crampons on firm snow, at a share of 0.5, the cap on a 30 % slope is 471 m/h at 1000 m for someone who has just arrived, 361 at 3000 m, 278 at 4000 m, 201 at 5000 m, 159 on Elbrus (5642 m), 86 on Aconcagua (6961 m) and 41 at 8000 m. After a week it is 473, 368, 294, 223, 183, 110 and 63 m/h at the same heights, and after three weeks 475, 375, 310, 246, 208, 136 and 87.

Guides quote 155–300 m/h at 4000–5000 m, 140–260 at 5000–5900 m and 100–170 between 6000 and 7000 m, breaks included, so the cap sits where it should. Nobody on a mountain day moves slower than 0.08 m/s, which is 86 m/h on a 30 % slope. Above about 7500 m that floor, not the budget, sets the pace on steep ground, so the model says little about the last thousand metres of an 8000 m peak.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="diagrams/mountaineering-climb-cap-dark.svg">
  <img src="diagrams/mountaineering-climb-cap.svg" alt="Climbing rate on a 30 % slope capped by the oxygen budget, against altitude, for the default athlete (VO₂max 45, 70 kg) with an 8 kg pack, mountain boots and crampons on firm snow, at a share of 0.5. Just arrived, after a week and after three weeks: 471, 473 and 475 m/h at 1000 m; 361, 368 and 375 at 3000 m; 278, 294 and 310 at 4000 m; 201, 223 and 246 at 5000 m; 159, 183 and 208 on Elbrus at 5642 m; 86, 110 and 136 on Aconcagua at 6961 m; 41, 63 and 87 at 8000 m. Guide rates, breaks included, are drawn as boxes: 155–300 m/h at 4000–5000 m, 140–260 at 5000–5900 m and 100–170 between 6000 and 7000 m. Nobody moves slower than 0.08 m/s, 86 m/h on this slope, and the budget drops under that floor from about 7000 m just arrived, 7500 m after a week and 8050 m after three weeks.">
</picture>

### Descents

Descents have no oxygen cap: nobody on a summit day comes down limited by breath. Speed follows the Swiss curve, the ground and the descent grade factor. It can't go past a brisk 2.3 m/s, or past a pace whose cost exceeds the athlete's VO₂max. In the examples below people come down two to three times faster than they go up, as guided parties do.

### Effort presets

On a mountaineering day Easy / Steady / Tempo / Race aim at 36 / 45 / 54 / 63 % of the reserve. The reserve there is the part the athlete can still sustain at that altitude, not the sea-level one. The effort is also averaged over the climbs only, whenever climbs are at least a fifth of the moving time. A descent on snow or scree costs more or less because of the ground, not because anyone chose to go harder. The ladder is calibrated so that Steady lands inside guide times (see the examples).

## Load, footwear and snow

All of these multiply Minetti's walking cost, the one hikes already use. Minetti stays the baseline, and each item adds what it adds.

### Pack

A backpack scales the whole net cost of walking, climbs included:

```
×(1 + 1.96·(pack/body)^1.36)
```

This is the load-carriage equation of Looney et al. (2022). It was fitted on loads up to two thirds of body mass, and we don't go beyond that. For a 70 kg athlete, 5 kg costs ×1.054 and 8 kg ×1.10. For a 75 kg athlete, 15 kg costs ×1.22 and 25 kg ×1.44. The pack counts on walks, hikes and mountaineering days; its default is 0 except on mountaineering days.

<!-- chart: walking cost multiplier vs pack mass for 60, 70 and 80 kg athletes, next to the footwear multiplier vs speed for mountain boots, boots with crampons and double boots -->

### Boots and crampons

Weight on the feet costs far more than weight on the back. Heavier footwear costs 0.7–0.96 % per 100 g at normal walking speed (Jones et al. 1986; Legg & Mahanty 1986), but hardly anything at the slow speeds of walking in snow (Smolander et al. 1989). We charge 0.4 % per 100 g above a 0.6 kg pair of trail shoes up to 0.6 m/s, rising to 0.8 % from 1.4 m/s. The pair masses are:

| Footwear | Pair mass |
|---|---|
| Trail shoes | 0.6 kg |
| Mountain boots (La Sportiva G2 Evo) | 2.1 kg |
| Double boots (Scarpa Phantom 8000) | 2.7 kg |

With crampons switched on, they add 0.87 kg (Petzl Vasak) wherever the ground is snow or ice. Mountain boots with crampons cost ×1.095 at summit-day speeds and ×1.19 at a brisk 1.4 m/s.

### Slow walking

Minetti's cost is the cost at the most economical speed. Below that, every metre gets dearer, because you spend time holding yourself upright between steps. The walking term of the load-carriage equations (Looney et al. 2019, 2022) gives 2.24 J/kg/m at 1 m/s and more below it. We add that surcharge to the level part of the cost:

| Speed | 0.2 m/s | 0.3 m/s | 0.5 m/s | 0.8 m/s | 1 m/s |
|---|---|---|---|---|---|
| Level cost | ×2.0 | ×1.6 | ×1.25 | ×1.04 | ×1 |

On steep ground the climbing part of the cost dominates, so the surcharge matters most on flat stretches of a slow day, like a summit plateau or a crater rim.

### Snow

On a mountaineering day the snow setting sets the footprint depth:

| Snow | Footprint | Cost | Speed |
|---|---|---|---|
| Firm | 1 cm | ×1.075 | ×0.87 |
| Soft | 8 cm | ×1.6 | ×0.80 |
| Deep | 20 cm | ×2.5 | ×0.67 |

The cost grows in a straight line with depth, following Pandolf, Haisman & Goldman (1976): 1 + 0.075 per cm, at most ×4. Speed is 0.88 × (1 − 0.012 per cm), never below half. Unpacked snow is walked about 0.7 times as fast as packed snow for the same oxygen (Connolly 2002), and fresh snow slowed competitive mountaineers to 0.88 of their path speed (Carceller et al. 2019).

Firm snow deserves a comment. The classic military tables give hard-packed snow a cost factor of 1.3–1.6 (Soule & Goldman 1972; Givoni & Goldman 1971). Those were measured walking off-track in boots at normal speed. On a tracked, frozen normal route at 0.3 m/s, that value made every glacier summit day hours too slow. We brought firm snow down to 1.075 by matching guide times. When a hike or run crosses a way tagged as snow, the table value of 1.3 still applies.

<!-- chart: snow cost and speed multipliers vs footprint depth, with firm, soft and deep marked and the table value 1.3 for hard-packed snow -->

When the weather adds fresh snow on top of snow the terrain already counts, the stronger of the two effects applies, not both.

### Other mountain ground

| Ground | Walking speed | Walking cost |
|---|---|---|
| Bare ice, with crampons | 0.8 | 1.15 |
| Bare ice, without crampons | 0.56 | 1.15 |
| Scree, going up | 0.6 | 1.8 |
| Scree, going down | 0.8 | 1.2 |
| Rock at T4 or harder (scrambling) | 0.55 | 1.6 |

Climbing loose scree is mechanically close to walking on sand, which costs about twice as much. Coming down it is easier. A boulder trail more than doubled the cost of walking and cut preferred speed by 14 % (Gast et al. 2019), and just 2.5 cm of unevenness adds 28 % (Voloshina et al. 2013). Rock below T4 counts as an ordinary rough path. We found no measurements at all for glacier ice with or without crampons.

### Snow nobody tagged

On a mountaineering day, ground above the snowline counts as snow in two cases: where the router gave no surface, and where a T4-or-harder way only says "ground". The reason is in the routing section below. The snowline defaults from the latitude of the route's start: 5000 m within 20° of the equator, 4500 m at 30° and 3000 m from 45°, linear in between. That puts it at 3170 m on Elbrus, 4240 m on Aconcagua and 5000 m on Kilimanjaro. It's a rough stand-in for a seasonal thing we don't know, so the Mountain settings let you set it.

Ground tagged as rock, scree or ice keeps its own class above the snowline.

<!-- chart: default snowline vs absolute latitude, with the five summit days placed by latitude and summit height -->

<!-- cold-weather: start -->
### Cold

With automatic weather, the air temperature is corrected to the route's own elevation at 6.5 °C per kilometre, so the summit is colder than the hut. A temperature you set by hand stays the same all day, at every height.

Cold reaches both heart rate and pace through the body heat balance on the [Weather](weather.md) page. Cool air takes some of the cardiac drift away, though never below zero. Cold muscle also slows the athlete: on the Kazbek and Mont Blanc examples, at −4 and −6 °C, the day comes with a note that cold, wind and wet clothing cost up to 3–4 % of the pace. The clothing a walker or hiker wears is chosen from the air at the start, up to 1.8 clo in frost. What the model still doesn't charge for is the bulk of those layers, a hood and mitts.
<!-- cold-weather: end -->

## Breaks

A guided mountain day has a rhythm. Rainier guides take four 15-minute breaks on the way up and two or three on the way down, with shorter stops every one to two hours. Planning methods such as Munter's add 15–20 % to the moving time for breaks. The Mountain breaks setting, the default for mountaineering, lays out:

- **On the way up:** 10 minutes after every 60 minutes of moving time. Above 5000 m it's every 50 minutes, above 6000 m every 45.
- **Gear stop:** 12 minutes where snow or ice starts, to put crampons on. Only if the day starts below the snow.
- **Summit:** 15 minutes at the highest point.
- **On the way down:** 8 minutes every 75 minutes.

No regular break falls within 20 minutes before the gear stop or the summit, so nobody rests five minutes short of the top. Each break's length varies by about ±30 %, between 0.6 and 1.6 times its planned length, fixed by the seed.

The schedule is laid on the moving time the terrain alone suggests: grade, ground and the slowing of high climbs, scaled to the target. It doesn't depend on the solved effort, so breaks don't wander while the engine searches for the right pace. In the examples, breaks take 12–18 % of the elapsed time. In the files, every break is a timer pause.

<!-- chart: the Kazbek summit day as a timeline of elevation and speed, with regular breaks, the gear stop at the snowline, the summit stop and the descent breaks -->

### The rest step

The pause on a locked knee between steps isn't a stop, so it never shows as a pause in the file. It shows in the cadence. On a climb the walking-cadence fit would ask for an ever shorter shuffle as the party slows; a climber instead keeps a step of about half a metre and waits on the straight leg, so cadence follows the step length down to 25 steps a minute.

It's a way of going up, so that's where it applies: on grades over 5 %, or on ground so slow (under 0.35 m/s) that nobody is striding anywhere. Coming down, the same party plunge-steps at an ordinary turnover, with a floor of 70 steps a minute.

The result is a day whose cadence changes with the direction of travel. The example days average 33–53 steps a minute overall; on the Elbrus climb it is 32 and on the descent 66, and Kilimanjaro runs 28 up and 83 down the scree.

## Routing to alpine terrain

### Two trail profiles

The toolbar has **Trail** and **Alpine**. Each tries routers in order and falls back to straight lines:

| Profile | Tries |
|---|---|
| Trail | BRouter `hiking-mountain` (SAC limit 6, preferring T2) → Valhalla pedestrian up to T6 → OSRM foot |
| Alpine | BRouter `hiking-mountain` (SAC limit 6, preferring T4) → Valhalla pedestrian up to T6 |

The router defaults don't work on mountains, and each one fails differently:

- **BRouter's `hiking-mountain`** doesn't forbid paths above its SAC limit of 3. It makes them cost 999 times as much. On alpine legs the search then runs until the server's watchdog kills it. In our tests on 2026-09-13 that took 8–54 s on Mont Blanc and Elbrus. Or it finds a way around: Thorong La came back as an 82 km detour instead of 14.5 km. With `profile:SAC_scale_limit=6` in the request the same legs route in 1–2.5 s. The preferred grade only breaks ties between otherwise equal routes.
- **The FOSSGIS OSRM foot profile** gives every path at T2 or harder a speed of zero. On Kazbek it snapped to points 1.5 and 3.8 km away, which our 250 m snap check rejects. That's why Alpine skips it.

<!-- chart: provider chains for the Trail and Alpine profiles, and what each router does with default settings on a T5 glacier leg -->

- **Valhalla** stops at T1 unless asked otherwise. At `max_hiking_difficulty` 6 it routes all our examples, usually along almost the same line as BRouter. We send the route request as a simple GET, so the browser needs no CORS preflight.

BRouter returns way tags with the route. Valhalla needs a second request (`trace_attributes`) along the returned shape, which gives each edge's path class, a coarse surface and the SAC grade. Every host gets one request at a time, at most one per second for the FOSSGIS servers, and each attempt times out after 15 s.

### Why glaciers are invisible

Routers describe the ways they follow. Glaciers and scree aren't ways: OSM maps them as areas you walk across. In our check, 96 % of the Elbrus route, all of the Mont Blanc route above the Goûter hut and 70 % of the Kazbek route lay inside glacier areas, and none of that shows up in a router's way tags.

Where a mapper did tag a path `surface=snow`, BRouter still reports it as an unknown surface, because its tag table has no snow, ice or scree. Valhalla's surface grades have no snow either. That's why mountaineering infers snow from elevation instead. A T4–T6 way above the snowline whose surface is unknown is, on these routes, almost always a snow slope.

### Elevation near summits

The detailed elevation tiles only cover countries with lidar. Elsewhere the best global data is about 30 m, and it rounds summits off. At the summit points we measured:

| Summit | Error |
|---|---|
| Mont Blanc (lidar) | −3 m |
| Elbrus | −16 m |
| Kilimanjaro | −17 m |
| Kazbek | −26 m |
| Aconcagua | −66 m |
| Everest | −139 m |

Smoothing takes off a little more. The effect on the physiology is small: 66 m changes VO₂max by about one percent. The recorded maximum altitude will be a little short of the number on the summit sign.

## The examples

The examples menu has five summit days and two trek stages. Every waypoint is an OSM hut, camp, pass or summit, and snaps within 163 m of the alpine route.

### Summit days

Each loads as Mountaineering at Steady, with its own start time, temperature and mountain settings:

| | Elbrus, south route | Kazbek from Betlemi hut | Mont Blanc, Goûter route | Kilimanjaro summit night | Aconcagua, normal route |
|---|---|---|---|---|---|
| Route | Garabashi station 3847 m → Pastukhov rocks → saddle → West summit → back | Betlemi hut 3650 m → summit → back | Goûter hut 3835 m → Dôme du Goûter → Vallot hut → summit → back | Barafu camp 4673 m → Stella Point → Uhuru Peak → Barafu → Mweka camp 3100 m | Cólera camp 5950 m → Independencia → foot of the Canaleta → summit → back |
| Distance, highest point | 13.6 km, 5642 m | 12.5 km, 5054 m | 11.2 km, 4808 m | 16.1 km, 5895 m | 5.4 km, 6961 m |
| Start, air | 02:30, −8 °C | 02:00, −4 °C | 02:00, −6 °C | 23:30, −5 °C | 03:00, −15 °C |
| Acclimatisation, pack | Full, 5 kg | A week, 8 kg | A week, 6 kg | A week, 5 kg | A week, 5 kg |
| Feet, snow | Mountain boots, crampons, firm | Mountain boots, crampons, soft | Mountain boots, crampons, firm | Mountain boots, no crampons | Double boots, crampons, firm |
| Snowline | 3170 m (latitude) | 4300 m | 3000 m (latitude) | 6000 m (no snow) | 6300 m |
| **Simulated, elapsed** | **14.4 h** | **12.3 h** | **9.6 h** | **14.7 h** | **10.9 h** |
| Moving, of which up | 12.4 h, 9.8 h | 10.7 h, 8.9 h | 8.3 h, 5.8 h | 12.7 h, 7.9 h | 9.1 h, 8.7 h |
| On top at | 12:14 | 10:52 | 07:47 | 07:25 | 11:38 |
| Climb rate while climbing | 229 m/h | 181 m/h | 237 m/h | 188 m/h | 131 m/h |
| Average cadence | 43 spm | 46 spm | 51 spm | 53 spm | 33 spm |
| Guide times, elapsed | 11–16 h | 12–14 h | 7–10 h | 12–15 h | 11–14 h |

The simulated rows are the default athlete at Steady with seed 5, on the real routed lines with our own elevation data. Three other seeds move the elapsed time by 0.26–0.66 h, mostly through break lengths. The climb rate comes from the recorded altitude, the way a watch counts it.

Elbrus is the longest of the five, at the top of the guided range of 9–14 h. Where the day starts and how long the party has been up there decide most of it: from the Bochki huts 140 m lower, a week acclimatised instead of fully, the same route took 2.3 h longer and topped out after the usual turnaround. Parties who ride the snowcat to the Pastukhov rocks skip the first 800 m of climbing altogether.

<!-- chart: simulated elapsed time for the five summit days against their guide ranges, split into moving time up, moving time down and breaks -->

Guides quote, for comparison:

- Elbrus: 8–10 h up from Garabashi, 3–6 h down.
- Mont Blanc: 4–6 h up from the Goûter hut, 3–4 h down.
- Kilimanjaro: 6–8 h from Barafu to Uhuru, 12–15 h to Mweka.
- Aconcagua: 8–10 h up from Cólera, 3–4 h down.

Heart rate averages 109–118 bpm over these days and peaks at 133–146. That's low next to a sea-level maximum of 184, and it's what the altitude table asks for: on the Elbrus summit, fully acclimatised, the same athlete's maximum is 158 and their resting rate 71; on Aconcagua 156 and 83.

Nobody tops out late any more. Elbrus reaches the summit at 12:14 from a 02:30 start, Kazbek at 10:52, Aconcagua at 11:38, so none of the five carries the turnaround warning.

The regression tests don't use these routed lines, because a test shouldn't depend on a router and a tile server. They use stand-in profiles with each route's distance, its climb to the highest point and its SAC grades, and require every example to land inside its guide range.

The elevation data leaves its own mark. Outside the countries with lidar we sample a 30 m global model, and on a broad glacier it wanders: a quarter of the Elbrus climb reads steeper than 40 % although the slope averages 27 %, and about 2 km of the route hits the 45 % limit for walking, which is where that warning comes from. It costs less time than it looks: put through the hiking curve, the wobble adds under 2 % to the climb on the summit days, and widening the smoothing from 15 to 25 m changes the Elbrus day by about a minute. What it does change is the totals, which read 1826 m of climb where the map gives about 1795 m from the station to the summit.

### Treks

The Everest base camp stage (Lobuche → Gorak Shep → base camp → Gorak Shep, 10.7 km, up to 5364 m) and the Thorong La crossing (Thorong Phedi → High Camp → pass → Muktinath, 14.7 km, up to 5416 m) load as hikes on the Trail profile, with mountain breaks. Their target is the guide time rather than a preset: the middle of the guide range less a fifth for breaks. The base camp stage's 5–7.5 hours become 5 hours of moving time; Thorong La's 7–9 hours become 6.4.

That keeps the menu showing the day the books describe. The presets are close to it in their own right: part-acclimatised, Steady gives 5.7 h for the base camp stage and 8.9 h for Thorong La, both inside the guide ranges. Easy is gentler than a guided party walks, 7.1 h and 11.3 h, and Thorong La at Easy is meant to sit outside the book's 7–9 h rather than match it. A party that hasn't acclimatised is slower again, which is also as it should be: the times in a trekking guide assume people who have been walking up the valley for a week.

## Export

| | Mountaineering | Hike |
|---|---|---|
| FIT sport / sub-sport | `mountaineering` (16) / `generic` (0) | `hiking` (17) / `generic` |
| TCX | `Other` | `Other` |
| GPX `<type>` | `mountaineering` | `hiking` |
| Default title | "Night ascent", «Ночное восхождение» | "Morning hike" |

FIT has no mountaineering sub-sport. `expedition` (66) is Garmin's once-an-hour multi-day recording mode, not a sport, and a file with heart rate every second shouldn't claim it. TCX only knows Running, Biking and Other. `mountaineering` is the word Garmin Connect itself writes into GPX exports. Laps and the session also carry minimum, average and maximum temperature. What the watch's temperature sensor and barometer record, cold or not, is covered in [What the watch records](recording.md).

Platforms treat the type differently:

- **Garmin Connect** has a Mountaineering activity type. It sits under "Other", and Garmin users report that those activities don't count towards Hill Score, while hikes do.
- **Strava** has no Mountaineering type at all. It reads the type of a FIT upload from the sport field but doesn't publish how it maps the values it doesn't have. We haven't tested what a sport 16 upload becomes: it could be Hike, Workout, Rock Climb or your default sport. If it matters, export the day as a hike.

## How it's tested

As on the physiology page, the tests check behaviour:

- Inspired oxygen is 149 Torr at sea level and 42.5–43.5 Torr at 8848 m.
- At 5400 m maximum heart rate keeps 90–92 % of its sea-level value on arrival and 83–87 % after acclimatisation. Resting heart rate is 20–30 % higher there after acclimatisation, more than 30 % higher at 6300 m, higher still for the just-arrived, and never more than +50 %.
- A run at 4000 m records a lower maximum heart rate and a higher floor than the same run at sea level.
- The Swiss curve's vertical rate stays between 350 and 380 m/h from +15 to +40 %.
- A 15 kg pack costs ×1.22 and 25 kg ×1.44 for a 75 kg athlete. Boots with crampons cost about ×1.095 at 0.5 m/s. Slow walking costs ×1.25 at 0.5 m/s and ×1.6 at 0.3 m/s. The climb-speed solver inverts the loaded cost to six decimals.
- Softer snow is slower and dearer. Scree is easier down than up. Snow is inferred only on mountaineering days. Bare ice without crampons is 0.7 times as fast.
- A mountaineering day meets its moving-time target within ±0.5 %, is identical for the same seed and has no invalid values. At Steady it climbs a 20 % slope more than 20 % slower starting from 4900 m than starting from 900 m, and a faster target climbs harder with a higher heart rate.
- A mountain day starting below the snowline:
  - breaks take 10–25 % of the elapsed time;
  - the summit stop is longer than 8 minutes and falls within 60 m of the top;
  - a gear stop sits at the snowline;
  - no regular break comes in the 15 minutes before the summit;
  - every stop is a pause in the file.
- The warnings for a late summit, an unacclimatised ascent above 5500 m and heights above 7500 m fire when they should and not otherwise.
- Each summit-day example at Steady lands inside its guide range.

## What's still a guess

- **Firm snow at ×1.075.** It's calibrated to guide times, well below the 1.3–1.6 of the measured tables. Soft (8 cm) and deep (20 cm) footprints are judgement too.
- **Sustainable share at altitude.** Both the 0.5 loss and the 0.3 of it that acclimatisation restores are fitted to guided days.
- **The climb share.** 0.5 at 4.2 km/h, proportional to the planned speed, between 0.1 and 1.
- **The mountaineering presets** (36 / 45 / 54 / 63 %), and averaging effort over climbs only.
- **Per-example settings.** Acclimatisation, pack, snow, crampons and snowline were chosen so each day looks like a typical guided ascent. Kazbek without acclimatisation and with soft snow, Aconcagua's snowline at 6300 m and Kilimanjaro without snow are our reading of those days, not data.
- **The stand-in profiles** the calibration runs on, instead of the real routed lines.
- **Ice without crampons at 0.7** of the speed with them. Ice, scree and scrambling rock factors in general: no measurements found for any of them.
- **The mild SAC factors** for mountaineering.
- **The dead band** that keeps maximum heart rate unchanged for the first 2 % of VO₂max loss. The 12 % extra loss for the just-arrived and its ramp from 2800 to 4500 m. The resting heart-rate formula above 6300 m and its +50 % cap.
- **The snowline by latitude.** Real snow cover depends on season, aspect and the year.
- **Break lengths and intervals**, and the ±30 % spread.
- **The rest step.** Half a metre a step, a floor of 25 steps a minute, and the 5 % grade and 0.35 m/s that decide where it applies.
- **The trek oxygen budget.** A third of the reserve against a mountaineer's half, fading in between 1500 and 3000 m.
- **Which factor wins on walked ground.** Taking the slower speed and the dearer cost of surface and difficulty, rather than multiplying them, is a judgement about what the two tags mean, not a measurement.
- **How Strava files a FIT with sport 16.**

The best check would be real summit-day recordings with barometric altitude and heart rate from Elbrus, Kilimanjaro or Mont Blanc. The most useful single numbers: vertical rate in each 1000 m band, break times, and maximum heart rate near the top.

## References

Altitude

- West JB. Prediction of barometric pressures at high altitudes with the use of model atmospheres. *J Appl Physiol* 81:1850–1854, 1996. https://doi.org/10.1152/jappl.1996.81.4.1850
- West JB, Lahiri S, Maret KH, Peters RM, Pizzo CJ. Barometric pressures at extreme altitudes on Mt. Everest: physiological significance. *J Appl Physiol* 54:1188–1194, 1983. https://doi.org/10.1152/jappl.1983.54.5.1188
- Wehrlin JP, Hallén J. Linear decrease in VO2max and performance with increasing altitude in endurance athletes. *Eur J Appl Physiol* 96:404–412, 2006. https://doi.org/10.1007/s00421-005-0081-9
- Cymerman A, Reeves JT, Sutton JR et al. Operation Everest II: maximal oxygen uptake at extreme altitude. *J Appl Physiol* 66:2446–2453, 1989. https://doi.org/10.1152/jappl.1989.66.5.2446
- Calbet JAL, Boushel R, Rådegran G, Søndergaard H, Wagner PD, Saltin B. Why is VO2max after altitude acclimatization still reduced despite normalization of arterial O2 content? *Am J Physiol Regul Integr Comp Physiol* 284:R304–R316, 2003. https://doi.org/10.1152/ajpregu.00156.2002
- Fulco CS, Rock PB, Cymerman A. Maximal and submaximal exercise performance at altitude. *Aviat Space Environ Med* 69:793–801, 1998. https://pubmed.ncbi.nlm.nih.gov/9715971/
- Mourot L. Limitation of maximal heart rate in hypoxia: mechanisms and clinical importance. *Front Physiol* 9:972, 2018. https://doi.org/10.3389/fphys.2018.00972
- Lundby C, van Hall G. Peak heart rates at extreme altitudes. *High Alt Med Biol* 2:41–45, 2001. https://doi.org/10.1089/152702901750067909
- Squires RW, Buskirk ER. Aerobic capacity during acute exposure to simulated altitude, 914 to 2286 meters. *Med Sci Sports Exerc* 14:36–40, 1982. https://doi.org/10.1249/00005768-198201000-00007
- Karliner JS, Sarnquist FF, Graber DJ, Peters RM, West JB. The electrocardiogram at extreme altitude: experience on Mt. Everest. *Am Heart J* 109:505–513, 1985. https://doi.org/10.1016/0002-8703(85)90555-1
- Matthews T, Perry LB, Lane TP et al. Into thick(er) air? Oxygen availability at humans' physiological frontier on Mount Everest. *iScience* 23:101718, 2020. https://doi.org/10.1016/j.isci.2020.101718
- Firth PG, Zheng H, Windsor JS et al. Mortality on Mount Everest, 1921–2006: descriptive study. *BMJ* 337:a2654, 2008. http://www.himalayandatabase.com/downloads/Ever-BMJ1208.pdf

Walking on mountains

- Swiss hiking-time formula (Schweizer Wanderwege, swisstopo). Meier C. Die praktische Wanderzeitformel. *Die Alpen* 2013/05. https://www.sac-cas.ch/de/die-alpen/die-praktische-wanderzeitformel-25135/
- Marschzeitberechnung (DIN 33466, DAV, SAC). https://de.wikipedia.org/wiki/Marschzeitberechnung
- Tobler's hiking function. https://en.wikipedia.org/wiki/Tobler%27s_hiking_function
- SAC hiking scale in OpenStreetMap. https://wiki.openstreetmap.org/wiki/Key:sac_scale
- Northwest Alpine Guides, Mount Rainier climbs. https://www.northwestalpineguides.com/northwest-climbs/mount-rainier/
- Guide times: Mont Blanc Goûter route, https://www.ascensionmontblanc.fr/en/voies/gouter ; Elbrus south route, https://www.elbrustours.ru/en/itinerary_south/ ; Kazbek, https://climbinggeorgia.com/mount-kazbek/ ; Aconcagua, https://www.adventurealternative.com/argentina/climb-mount-aconcagua/route-descriptions/

Load, footwear and ground

- Looney DP, Santee WR, Hansen EO, Bonventre PJ, Chalmers CR, Potter AW. Estimating energy expenditure during level, uphill, and downhill walking. *Med Sci Sports Exerc* 51:1954–1960, 2019. https://doi.org/10.1249/MSS.0000000000002002
- Looney DP, Lavoie EM, Vangala SV et al. Modeling the metabolic costs of heavy military backpacking. *Med Sci Sports Exerc* 54:646–654, 2022. https://doi.org/10.1249/MSS.0000000000002833
- Jones BH, Knapik JJ, Daniels WL, Toner MM. The energy cost of women walking and running in shoes and boots. *Ergonomics* 29:439–443, 1986. https://doi.org/10.1080/00140138608968277
- Legg SJ, Mahanty A. Energy cost of backpacking in heavy boots. *Ergonomics* 29:433–438, 1986. https://doi.org/10.1080/00140138608968276
- Smolander J, Louhevaara V, Hakola T, Ahonen E, Klen T. Cardiorespiratory strain during walking in snow with boots of differing weights. *Ergonomics* 32:3–13, 1989. https://doi.org/10.1080/00140138908966063
- Pandolf KB, Haisman MF, Goldman RF. Metabolic energy expenditure and terrain coefficients for walking on snow. *Ergonomics* 19:683–690, 1976. https://doi.org/10.1080/00140137608931583
- Soule RG, Goldman RF. Terrain coefficients for energy cost prediction. *J Appl Physiol* 32:706–708, 1972. https://doi.org/10.1152/jappl.1972.32.5.706
- Richmond PW, Potter AW, Santee WR. Terrain factors for predicting walking and load carriage energy costs: review and refinement. *J Sport Hum Perf* 3(3):1–26, 2015. https://doi.org/10.12922/jshp.0067.2015
- Connolly DA. The energy expenditure of snowshoeing in packed vs. unpacked snow at low-level walking speeds. *J Strength Cond Res* 16:606–610, 2002. https://pubmed.ncbi.nlm.nih.gov/12423193/
- Carceller A, Javierre C, Corominas J, Viscor G. Differences in cardiorespiratory responses in winter mountaineering according to the pathway snow conditions. *High Alt Med Biol* 20:89–93, 2019. https://doi.org/10.1089/ham.2018.0096
- Gast K, Kram R, Riemer R. Preferred walking speed on rough terrain: is it all about energetics? *J Exp Biol* 222:jeb185447, 2019. https://doi.org/10.1242/jeb.185447
- Voloshina AS, Kuo AD, Daley MA, Ferris DP. Biomechanics and energetics of walking on uneven terrain. *J Exp Biol* 216:3963–3970, 2013. https://doi.org/10.1242/jeb.081711

Routing, maps and files

- BRouter profiles. https://brouter.de/brouter/profiles2/
- Valhalla API reference. https://valhalla.github.io/valhalla/api/turn-by-turn/api-reference/
- FOSSGIS routing server and foot profile. https://routing.openstreetmap.de/about.html ; https://github.com/fossgis-routing-server/cbf-routing-profiles
- Mapterhorn elevation tiles and coverage. https://mapterhorn.com/
- Garmin FIT SDK. https://developer.garmin.com/fit/
- Strava, uploading activity files. https://developers.strava.com/docs/uploads/
- Garmin forum: climbing, hiking, Hill Score and activity types. https://forums.garmin.com/apps-software/mobile-apps-web/f/garmin-connect-web/344019/climbing-hiking-hill-score-and-activity-types-in-connect-and-their-translations
