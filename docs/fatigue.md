# Fatigue

[Physiology & motion models](physiology.md) explains how Runsketch turns movement into oxygen demand and heart rate, and [Terrain](terrain.md) how the ground shapes the movement. This page is about what a long activity does to the athlete: the load that builds up, the damage descents leave behind, the fuel that runs out, the reserve above critical speed, and the running economy that slowly gets worse. It also shows how all of that comes out in pace and heart rate over hours. Heat is on the [Weather](weather.md) page, thin air on the [Mountaineering](mountaineering.md) one, and what the watch writes down on [What the watch records](recording.md).

As on the other pages, some numbers are measured and some are our judgement, and the judgement calls are listed at the end. Unless a number is quoted from a paper, it comes from the engine: either a constant in the code or a simulation we ran.

## The idea in one paragraph

Fatigue used to be a clock. After 45 minutes the speed faded by a fixed percentage per hour, and that was all: the same fade on a flat 10 km and on a mountain 50 km, for a jog and for a race. Now five things are integrated every moving second, all from the athlete's own VO₂max so that matching an average heart rate never changes the motion. **Load** counts the metabolic work done so far, weighted by how hard it was. **Descent load** counts the braking. **Glycogen** drains and can run out. **D′** is the small reserve above critical speed that a climb can spend. And **running economy** slowly gets worse, which is part of what keeps heart rate up while the pace falls away. A marathon therefore slows down where a 10 km doesn't, a hilly first half costs the later flats, and a beginner who set off too fast can hit the wall at 29 km and start walking.

## Load, not the clock

Load is counted in **flat-running kilometres**. Every second, the energy the movement actually costs, from Minetti's curves and the ground factors, is divided by the 3600 J/kg it takes to run a flat kilometre. A kilometre at +10 % costs 1.66 of them; a kilometre on sand costs 1.4.

That is then weighted by how hard the second was, because two hours of jogging do not leave the legs where two hours of racing do. The weight is `exp(1.92·(f − 0.65))`, where f is the share of VO₂ reserve, taken from Banister's TRIMP weighting for men and centred on a steady run:

| Share of VO₂ reserve | 0.55 | 0.60 | 0.65 | 0.70 | 0.80 | 0.88 |
|---|---|---|---|---|---|---|
| Load per flat km | 0.83 | 0.91 | 1.00 | 1.10 | 1.33 | 1.56 |

Capacity then falls with the load. The curve starts at a given slope and bends over towards a ceiling rather than hitting a floor, so an ultra keeps getting slower hour after hour instead of settling onto a plateau:

```
speed × = 1 − max × (1 − exp(−slope · x / max)),   x = softplus(load − onset, 3 km)
```

| | Beginner | Recreational | Trained | Elite |
|---|---|---|---|---|
| Onset | 8 km | 15 km | 25 km | 35 km |
| Initial slope | 0.45 %/km | 0.3 %/km | 0.2 %/km | 0.12 %/km |
| Ceiling | 35 % | 30 % | 25 % | 20 % |

At a steady 75 % of VO₂ reserve, which weights each kilometre at 1.2, that works out as speed lost by the end of:

| Distance | 10 km | 21 km | 42 km | 60 km | 100 km |
|---|---|---|---|---|---|
| Beginner | 2.1 % | 7.0 % | 14.8 % | 19.8 % | 26.8 % |
| Recreational | 0.3 % | 3.0 % | 9.0 % | 13.2 % | 19.6 % |
| Trained | — | 0.5 % | 4.7 % | 7.9 % | 13.4 % |
| Elite | — | — | 1.8 % | 4.0 % | 8.1 % |

The shape comes from the durability literature. Critical power and the first ventilatory threshold don't move after 40 or 80 minutes of steady work, but they are 6–10 % lower after two hours, and fitter athletes lose less (Clark et al. 2019; Stevenson et al. 2022; Barrett & Maunder 2025). The onsets, slopes and ceilings themselves are ours, fitted so that second halves of recreational marathons come out 4–9 % slower, which is what large race datasets show (Deaner et al. 2015; Smyth & Muniz-Pumares 2020).

<!-- chart: speed lost against load in flat-running kilometres, one line per level, with the onset and ceiling of each marked -->

### Not front-loading a long day

A fade this strong would otherwise make a 100 km run start far too fast, because the engine solves one effort scale to hit the target moving time and the fade has to be paid for somewhere. So for anything longer than two hours, the engine works out beforehand how much of the fade the route can carry and still keep the first hour within 6 % of the average speed, and applies only that share. A beginner's 100 km at 9:00/km runs its first hour under 1.08 times the overall average, and still slows from block to block right to the end.

## What it does to a marathon

A flat marathon by the default recreational athlete, three seeds, chest strap:

| Target | 5–10 km | 20–25 km | 35–40 km | Second half | HR 5–10 km → 35–40 km | HR:pace at the finish |
|---|---|---|---|---|---|---|
| 5:41/km | 5:27 | 5:36 | 5:58 | 6.7 % slower | 162 → 168 | 1.139 |
| 5:30/km | 5:08 | 5:18 | 6:14 | 11.5 % slower | 169 → 164 | 1.193 |

The last column is the decoupling ratio used by Smyth et al. (2022) on 82,303 marathon runners: heart rate as a share of maximum divided by speed, at the finish, against the same ratio over 5–10 km. They measured 1.16 ± 0.22, and it starts to open up around 25 km. The slower target lands inside that; the faster one is above it because one of its three seeds hit the wall, which is its own section below.

The heart rate is the part worth watching. At 5:41/km it climbs 6 bpm while the pace drops 30 s/km. Nothing in the model pushes heart rate up directly here: the pace fade on its own would bring it down, and what more than cancels that is the slow rise described next — cardiac drift and the oxygen the lost economy costs, sharing one budget.

<!-- chart: recreational flat marathon — 5 km pace and mean heart rate per split, with the decoupling ratio on a second axis -->

## Economy gets worse, and that is what holds heart rate up

The same pace costs more oxygen late in a long run. It begins after about 4 km of load and saturates over the next 12, reaching a ceiling that depends on the level:

| Load | 10 km | 20 km | 40 km | 80 km |
|---|---|---|---|---|
| Beginner, O₂ cost | ×1.036 | ×1.066 | ×1.086 | ×1.090 |
| Recreational | ×1.020 | ×1.037 | ×1.048 | ×1.050 |
| Trained | ×1.014 | ×1.026 | ×1.033 | ×1.035 |
| Elite | ×1.010 | ×1.018 | ×1.024 | ×1.025 |

The ceilings are 2.5 % for elite, 3.5 % trained, 5 % recreational and 9 % beginner. The two anchors are Zanini et al. (2024), who measured +2.3 % energy cost after 90 minutes at the first lactate threshold in faster runners against +4.3 % in slower ones, and Unhjem (2024), who found relative intensity rising 2.6 % in trained runners against 8.3 % in active adults after an hour at 70 % of VO₂max.

### One budget for the slow rise

Three things make heart rate creep up over a long effort: cardiac drift, heat strain, and the extra oxygen the lost economy costs. Each used to add its own rise, and together they could pin a long steady run near the maximum, which is not what long runs look like.

They now press on **one ceiling**. The three are added up, the sum is squeezed towards the same soft limit — linear to 10 % above the underlying demand, approaching 18 % — and each keeps its share of what is left in proportion. What economy adds is already inside the oxygen demand, so once the limit has been applied it is taken back out again rather than counted a second time. Taking it straight off the drift instead would drag heart rate down late in a long run, because the economy loss keeps growing while drift levels off.

Cardiac drift itself is now a single neutral rate, 3 % of heart rate per hour of moving time after the first 12 minutes, measured in neutral weather: 15 °C, dry and calm. Warm or cold air no longer bends that rate. Weather reaches heart rate through the heat balance on the [Weather](weather.md) page instead, measured against the same neutral air, so the two can't be counted twice.

How fast drift builds does depend on the athlete, because a trained heart holds its stroke volume far better through a long effort:

| | Beginner | Recreational | Trained | Elite |
|---|---|---|---|---|
| Drift rate, relative to neutral | ×1.6 | ×1.15 | ×1 | ×0.85 |

That spread is our own choice, not a measured rate. With the smaller economy losses above, it is now where most of the difference between levels lives.

What comes out, on 90 minutes at a steady 70 % of VO₂ reserve on the flat, with pace noise switched off and three seeds averaged:

| | Elite | Trained | Recreational | Beginner |
|---|---|---|---|---|
| Decoupling over the two halves | 2.3 % | 2.8 % | 3.4 % | 5.1 % |
| Heart rate | 149 → 155 | 149 → 156 | 150 → 157 | 151 → 161 |
| Pace fade | 3.2 % | 3.3 % | 4.0 % | 5.2 % |

Coaches call anything under 5 % over a long steady run a sign of a well-built aerobic base. Before this pass every level came out at about 2.5 %, so every simulated runner looked highly trained. Now the level matters.

Heart rate also no longer sits on a flat shelf at the maximum when a target is beyond the athlete: it is squeezed smoothly towards the ceiling and reflected below it, and it carries a minute-scale physiological wander — about 1.99 bpm around a 61-second moving average, against 1.50 bpm in the one decoded strap file we compare with, so we wander rather more than it does. That statistic is meaningless without its window, and both figures move steeply with it. The sensor side of that is on the [recording](recording.md) page.

<!-- chart: 90 min steady at 70 % of VO2 reserve — heart rate and speed for beginner, recreational and elite, as a share of their own 10–25 min averages -->

## Descents leave a mark

Braking downhill is eccentric work: it damages muscle rather than just spending fuel, and Minetti's energy cost knows nothing about it. So descent is counted separately, in weighted metres down. Anything steeper than −8 % counts up to double, and walking a descent counts at 0.3, because walkers brake far less per metre.

The damage saturates with an e-folding scale of 2000 m of that weighted descent:

| Weighted descent | 500 m | 1000 m | 2000 m | 4000 m | 10000 m |
|---|---|---|---|---|---|
| Damage | 0.22 | 0.39 | 0.63 | 0.86 | 0.99 |

At full saturation it does three things, all by level:

| | Beginner | Recreational | Trained | Elite |
|---|---|---|---|---|
| Later descents slower by | 24 % | 20 % | 16 % | 14 % |
| Everything slower by | 10 % | 8 % | 6 % | 4.5 % |
| O₂ cost higher by | 5 % | 4 % | 3 % | 2 % |

On a 26 km route where only the first half differs, the speed over 15–26 km compared with the speed over the first 2 km:

| First half | Flat | Rolling ±8 % (487 m down) | 12 km at −6 % (758 m down) |
|---|---|---|---|
| Later flat speed | 0.978 | 0.954 | 0.968 |

And the same descent twice in one run, a −8 % kilometre at 1 km and again at 23 km: 5:03 the first time, 5:17 the second, 4.6 % slower for the same grade at the same target pace.

The anchors: about 40 minutes of downhill running at −12 % costs untrained runners 23.5 % of their knee-extensor strength and trained runners 16.4 %, and flat running straight afterwards costs 7–10 % more oxygen (Bontemps et al. 2020). Energy cost 48 hours later is still 3.2 % higher (Braun & Dutto 2003). After a mountain ultramarathon the cost of running downhill rose 13.1 % while level and uphill running were unchanged (Vernillo et al. 2015). In 16 trail ultramarathons, late-race slowdown was larger on the descents than on the climbs (Genitrini et al. 2022). The three ladders above are our reading of that, not measurements.

<!-- chart: the same -8 % descent early and late in one run, speed and heart rate against distance, with the damage saturation curve inset -->

## Glycogen and the wall

Carbohydrate is the only fuel that can run out inside one activity. The store follows Rapoport (2010): the liver holds 2.5 % of body mass at 360 kcal/kg, and the leg muscles are 21.4 % of body mass in men and 20 % in women, at a density that depends on training:

| | Beginner | Recreational | Trained | Elite |
|---|---|---|---|---|
| Muscle glycogen | 70 kcal/kg | 80 | 100 | 120 |
| Whole store | 24.0 kcal/kg | 26.1 | 30.4 | 34.7 |
| Carbohydrate taken in | 90 kcal/h | 120 | 150 | 180 |

The store is drawn from the seed with a spread of about 25 %, so two runners with the same profile don't run out at the same kilometre. What is burnt each second is the oxygen cost times the carbohydrate share of the fuel mixture, which rises with intensity through 60 % at 75 % of VO₂max. Intake is a flat trickle: experienced runners drink and gel to a plan, beginners take much less.

**The wall starts when the store falls below 25 % of where it began**, because performance drops well before the tank is empty (Karlsson & Saltin; Rapoport 2010), and only when the five-minute average effort is at least 0.72 of VO₂ reserve. Slow running is mostly fat-fuelled, and walls in the field cluster in marathons run near race effort (Smyth 2021).

What happens then is not simply a slower steady pace:

- the pace drops by a further 25 %, ramped in over 1500 m and still fading after that;
- the runner walks about a fifth of the time, in bouts of roughly a minute and a half;
- the fast pace noise nearly doubles and the slow wander is two and a half times bigger, so the splits go ragged.

A beginner on a flat marathon, ten seeds each:

| Target | Walls | Mean onset | Walk share after 30 km | Bout length | 5 km split variability, 25–40 km |
|---|---|---|---|---|---|
| 6:30/km | 9 of 10 | 29.3 km (26–36) | 18 % | 105 s | 4.8–14.8 % |
| 7:00/km | 9 of 10 | 33.1 km (29–41) | 14 % | 104 s | 1.2–15.7 % |

A recreational runner at 5:00/km walls in 8 of 10 seeds at 33.3 km. The same runner at 5:41/km never does. In the seeds that don't wall, the 5 km splits over the same stretch vary by 0.6–1.5 %.

Field data puts the average wall at 29.5 km, with runners slowing 37–40 % for about 10 km, and prevalence running from roughly 15 % of sub-3-hour runners to over 40 % of those finishing beyond 5 hours (Smyth 2021). The onset lands where it should; the depth is close.

One mechanical detail matters for calibration. A threshold like this would make moving time jump as the effort scale changes, and the engine solves that scale by bisection. So the wall is found once at the solved effort, the distance where it starts is frozen, and the effort is solved again with the wall in place. A wall in the last kilometre is ignored, because it changes nothing anyone would see. When it happens, the file comes with a warning saying roughly where.

<!-- chart: a walled beginner marathon against a seed that didn't — 1 km splits, walking seconds marked, and the glycogen store draining to its threshold -->

## D′: the small reserve above critical speed

Critical speed is the fastest pace that is not eating into a finite reserve. We put it at the lactate-threshold share of VO₂ reserve plus 0.15, capped at 0.95: that is 0.85 for a beginner, 0.90 recreational and 0.95 for trained and elite. The reserve above it, D′, is measured in flat-equivalent metres: 116, 136, 150 and 156 m by level, against the 136 ± 39 m that Smyth & Muniz-Pumares (2020) estimated for recreational marathoners.

It drains at the excess speed above critical speed and refills below it, in Skiba's differential form, with the time constant clamped to the 120–340 s that over-ground running studies report. Standing at a traffic light refills it; so does walking a climb, which is why the walk-or-run decision uses critical speed itself rather than the draining ceiling, or the decision would flip back and forth. The ceiling it imposes is critical speed when empty and roughly a six-minute effort when full.

In practice it only bites at race effort on a long climb. A 1.5 km climb at +8 % between two flats:

| Target | Flat before | First 500 m of the climb | Last 500 m | Heart rate |
|---|---|---|---|---|
| 4:30/km | 4:06 | 5:23 | 5:32 | 182 → 182 |
| 5:00/km | 4:34 | 5:57 | 6:10 | 180 → 182 |

So the runner starts the climb over critical speed, spends the reserve, and is 3 % slower near the top at the same heart rate. Below critical speed the whole mechanism does nothing at all, which is right: an easy run never touches it.

<!-- chart: race-effort climb — speed, the D' ceiling and the D' balance draining over the climb and refilling on the flat after it -->

## Other sports

Rides carry load too, at 0.6 of the cost per joule, because pedalling has no impact and little eccentric work. A six-hour ride at a steady target drops from 147 W in the first hour to 140 W in the last, 4.7 % down. Walks, hikes and mountaineering days carry load, descent damage and economy loss, but no glycogen and no D′: a summit day is limited by the air and the legs long before carbohydrate runs out, and the oxygen cap on climbs described on the [mountaineering](mountaineering.md) page does that job.

## Race efforts and how far the Riegel exponent bends

The Race preset holds its effort for 30 minutes and then eases off with duration, following Riegel's power law. The exponent now depends on the level:

| | Beginner | Recreational | Trained | Elite |
|---|---|---|---|---|
| Riegel exponent | 1.09 | 1.08 | 1.07 | 1.06 |
| Race effort at 30 min | 0.880 | 0.880 | 0.880 | 0.880 |
| at 1 h | 0.831 | 0.836 | 0.841 | 0.846 |
| at 2 h | 0.785 | 0.794 | 0.804 | 0.814 |
| at 4 h | 0.741 | 0.754 | 0.768 | 0.782 |

Riegel's own 1.06 came from world records. Vickers & Vertosick (2016) found it well calibrated up to the half marathon but at least ten minutes too fast at the marathon for half of recreational runners, and used 1.07 themselves. The ladder above says slower runners fade harder, which is what every large marathon dataset shows.

The presets measure effort **with** the fatigue economy loss included, so a solved pace is judged on the heart rate the athlete really carries late in a long run rather than on a fresh one. That does not slow long races twice: the loss shares the slow-rise budget above instead of stacking on top of it. Counting it did make the solved paces a little more honest, and a little slower. On a flat marathon:

| Steady | Beginner | Recreational | Trained | Elite |
|---|---|---|---|---|
| Solved pace | 8:18/km | 6:08 | 4:53 | 4:00 |
| Mean effort reached | 0.698 | 0.700 | 0.700 | 0.700 |

The Race preset on the same marathon comes out at 8:04, 5:42, 4:23 and 3:29 per kilometre, at mean efforts of 0.720, 0.754, 0.781 and 0.804 of VO₂ reserve.

## How it's tested

The tests check behaviour, not formulas:

- A recreational flat marathon runs its second half 4–9 % slower, finishes with a decoupling ratio of 1.12–1.18, and still hits its target moving time within 0.5 %.
- An easy marathon fades at least two percentage points less than the same marathon at race effort.
- Over 90 minutes steady, decoupling is 1–3 % for an elite athlete, more for a recreational one, and at least 5 % for a beginner.
- A hilly or descending first half leaves the later flats slower than a flat start does.
- A marathon at 25 °C doesn't let heart rate trend downwards late on even effort.
- A beginner's 100 km keeps slowing block after block without a plateau, and its first hour is within 8 % of the overall average.
- A hard marathon hits the wall: the warning appears, the wall lands between 25 and 40 km, the worst 5 km runs at 50–75 % of the 5–20 km pace, and the moving time still matches. The same marathon run easy doesn't wall.
- A six-hour ride fades between 2 and 15 %.

## What's still a guess

- **The wall's effort gate.** It is an absolute 0.72 of VO₂ reserve, the same for everyone, while the efforts the presets solve for are not: on a flat marathon a beginner's Race effort lands at 0.720, right on the gate, against 0.754 for a recreational runner and 0.804 for an elite one. So whether a beginner at Race walls at all turns on the third decimal place of a number nobody chose with that in mind. The gate should be relative to the athlete's own threshold, and this is the first thing we would change.
- **The drift spread by level.** ×1.6 for a beginner down to ×0.85 for an elite athlete is our own choice, not a measured rate. It carries most of the difference in decoupling between levels, so it is doing a lot of work for a number with no measurement behind it.
- **The load weighting.** Banister's 1.92 was fitted to training load over whole sessions, not to within-session fatigue, and the 0.65 centre is ours.
- **The fade curve.** Onsets of 8–35 km, slopes, the 20–35 % ceilings and the 3 km softening around the onset. Only the two-hour anchor is measured, and it is measured on cyclists and trained runners.
- **The economy ladder.** The 4 km onset, the 12 km saturation, and the ceilings themselves. The two studies behind them measured trained and moderately trained runners over 60–90 minutes; the beginner ceiling of 9 % is an extrapolation past both, and the shape after two hours is guesswork.
- **The one-budget squeeze.** That drift, heat and lost economy should share a ceiling is sound, but the 10 % knee, the 18 % limit and splitting what is left in proportion are all ours.
- **Descent damage.** Counting steeper than −8 % at double, walking at 0.3, the 2000 m saturation scale, and all three ladders. The field evidence says descents hurt later descents most; the sizes are ours.
- **Glycogen.** Muscle density by level, the 25 % spread, the straight-line carbohydrate share standing in for Romijn's curve, and the intake ladder. Nobody's intake is really a constant trickle.
- **The wall itself.** The 25 % threshold, the further 25 % slowdown, the 1500 m ramp, walking a fifth of the time in 90 s bouts, and the noise multipliers. Real walls are more varied than this, and some runners stop altogether.
- **Critical speed and D′.** Threshold plus 0.15, the four D′ values, the 120–340 s refill clamp and the six-minute ceiling when full.
- **Rides** at 0.6 of the load per joule, and no glycogen or D′ for them.
- **The first-hour lead** of 6 %, and compressing the fade to keep it.
- **The Riegel ladder** by level.
- **Nothing carries over.** Every activity starts fresh: no state remembers yesterday's long run, and within a run nothing recovers over hours the way muscle damage and glycogen really do. Stops refill D′ and let some drift go, and that is all.

The best check would be a set of real recordings from the same runner over a season: a flat marathon, a hilly ultra and a long easy run, with heart rate and splits, so the fade, the decoupling and the wall could be fitted per person instead of per level.

## References

Durability and pace decay

- Clark IE, Vanhatalo A, Thompson C et al. Dynamics of the power-duration relationship during prolonged endurance exercise and influence of carbohydrate ingestion. *J Appl Physiol* 127:726–736, 2019. https://doi.org/10.1152/japplphysiol.00207.2019
- Stevenson JD, Kilding AE, Plews DJ, Maunder E. Prolonged cycling reduces power output at the moderate-to-heavy intensity transition. *Eur J Appl Physiol* 122:2673–2682, 2022. https://doi.org/10.1007/s00421-022-05036-9
- Barrett AMS, Maunder E. Prolonged running reduces speed at the moderate-to-heavy intensity transition without additional reductions due to increased eccentric load. *Eur J Appl Physiol*, 2025. https://doi.org/10.1007/s00421-025-05792-4
- Maunder E, Seiler S, Mildenhall MJ, Kilding AE, Plews DJ. The importance of 'durability' in the physiological profiling of endurance athletes. *Sports Med* 51:1619–1628, 2021. https://doi.org/10.1007/s40279-021-01459-0
- Deaner RO, Carter RE, Joyner MJ, Hunter SK. Men are more likely than women to slow in the marathon. *Med Sci Sports Exerc* 47:607–616, 2015. https://doi.org/10.1249/MSS.0000000000000432
- Vickers AJ, Vertosick EA. An empirical study of race times in recreational endurance runners. *BMC Sports Sci Med Rehabil* 8:26, 2016. https://doi.org/10.1186/s13102-016-0052-y
- Riegel PS. Athletic records and human endurance. *Am Sci* 69:285–290, 1981. https://pubmed.ncbi.nlm.nih.gov/7235349/
- Banister EW. Modeling elite athletic performance. In: *Physiological Testing of Elite Athletes*, 1991.

Heart rate over long efforts

- Smyth B, Maunder E, Meyler S, Hunter B, Muniz-Pumares D. Decoupling of internal and external workload during a marathon: an analysis of durability in 82,303 recreational runners. *Sports Med* 52:2283–2295, 2022. https://doi.org/10.1007/s40279-022-01680-5
- Zanini M, Folland JP, Blagrove RC. Durability of running economy: differences between quantification methods and performance status in male runners. *Med Sci Sports Exerc* 56:2230–2240, 2024. https://doi.org/10.1249/MSS.0000000000003499
- Unhjem RJ. Changes in running economy and attainable maximal oxygen consumption in response to prolonged running: the impact of training status. *Scand J Med Sci Sports* 34:e14637, 2024. https://doi.org/10.1111/sms.14637
- Hunter B, Meyler S, Maunder E et al. Durability of parameters associated with endurance running in marathoners. *Eur J Sport Sci*, 2025. https://doi.org/10.1002/ejsc.70073

Glycogen

- Rapoport BI. Metabolic factors limiting performance in marathon runners. *PLoS Comput Biol* 6:e1000960, 2010. https://doi.org/10.1371/journal.pcbi.1000960
- Smyth B. How recreational marathon runners hit the wall: a large-scale data analysis of late-race pacing collapse in the marathon. *PLoS ONE* 16:e0251513, 2021. https://doi.org/10.1371/journal.pone.0251513
- Karlsson J, Saltin B. Diet, muscle glycogen and endurance performance. *J Appl Physiol* 31:203–206, 1971. https://doi.org/10.1152/jappl.1971.31.2.203

Critical speed and D′

- Smyth B, Muniz-Pumares D. Calculation of critical speed from raw training data in recreational marathon runners. *Med Sci Sports Exerc* 52:2637–2645, 2020. https://doi.org/10.1249/MSS.0000000000002412
- Skiba PF, Chidnok W, Vanhatalo A, Jones AM. Modeling the expenditure and reconstitution of work capacity above critical power. *Med Sci Sports Exerc* 44:1526–1532, 2012. https://doi.org/10.1249/MSS.0b013e3182517a80
- Skiba PF, Fulford J, Clarke DC, Vanhatalo A, Jones AM. Intramuscular determinants of the ability to recover work capacity above critical power. *Eur J Appl Physiol* 115:703–713, 2015. https://doi.org/10.1007/s00421-014-3050-3

Descents and muscle damage

- Bontemps B, Vercruyssen F, Gruet M, Louis J. Downhill running: what are the effects and how can we adapt? A narrative review. *Sports Med* 50:2083–2110, 2020. https://doi.org/10.1007/s40279-020-01355-z
- Braun WA, Dutto DJ. The effects of a single bout of downhill running and ensuing delayed onset of muscle soreness on running economy performed 48 h later. *Eur J Appl Physiol* 90:29–34, 2003. https://doi.org/10.1007/s00421-003-0857-8
- Vernillo G, Savoldelli A, Zignoli A et al. Energy cost and kinematics of level, uphill and downhill running: fatigue-induced changes after a mountain ultramarathon. *J Sports Sci* 33:1998–2005, 2015. https://doi.org/10.1080/02640414.2015.1022870
- Genitrini M, Fritz J, Zimmermann G, Schwameder H. Downhill sections are crucial for performance in trail running ultramarathons: a pacing strategy analysis. *J Funct Morphol Kinesiol* 7:103, 2022. https://doi.org/10.3390/jfmk7040103
- Millet GY, Tomazin K, Verges S et al. Neuromuscular consequences of an extreme mountain ultra-marathon. *PLoS ONE* 6:e17059, 2011. https://doi.org/10.1371/journal.pone.0017059
