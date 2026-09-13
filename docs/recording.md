# What the watch records

[Physiology & motion models](physiology.md) explains how Runsketch decides how someone moves along a route and how their heart responds. This page covers the step after that: how the simulated motion becomes something that looks like it came off a real watch. A real recording isn't the truth plus a little noise. GPS points arrive a bit early or late, altitude comes from air pressure, the temperature sensor sits against a warm wrist, and the file skips a second now and then. We model those things one by one. Some of the numbers come from measurements, some are our own judgement, and the judgement calls are listed at the end.

## The idea in one paragraph

Every second the engine knows exactly where the athlete is, how fast they move, how fast their heart beats and how often their feet land. A watch never knows any of that exactly. It smooths speed, its position wanders by a few metres and its barometer hears gusts and weather. An optical sensor needs time to find the pulse, and the file itself has gaps and pauses. We keep the true motion for everything that has to add up, like distance, moving time and average pace. We add sensor behaviour only to what the file shows second by second. Then we check the result against real Garmin recordings, using the same statistics on both.

## What we compared against

We decoded a handful of public Garmin FIT files: the sample activities that ship with the python-fitparse test suite. The most useful one is a 47-minute, 9 km run from 2015 on a fēnix 2, recorded every second with a chest strap. The others are shorter fēnix 5 runs, walks and rides, a fēnix 5 and an Edge 820 recording the same ride, and a cycling computer file with auto-pauses. We measured the steady middle of the runs, from 10 minutes in to 5 minutes before the end, only where speed was above 2 m/s, which is 1848 seconds of the fēnix 2 file. Then we ran Runsketch through the same measurements: eight seeds per column, the default athlete, a chest strap and "normal" GPS.

| | Garmin fēnix 2, 1 s, chest strap | Runsketch, flat 10 km at 5:00/km | Runsketch, 10 km of city blocks at 4:50/km |
|---|---|---|---|
| Speed: SD of the change from one second to the next | 0.049 m/s | 0.047 m/s | 0.054 m/s |
| Speed: spread around a 61 s moving average | 4.4 % | 4.1 % | 4.2 % |
| …correlation with the previous second | 0.94 | 0.94 | 0.93 |
| GPS: SD of the distance between consecutive points | 0.92 m | 0.83 m | 0.88 m |
| …correlation with the previous step | 0.72 | 0.63 | 0.64 |
| Chest strap HR: SD of the 1 s change | 0.61 bpm | 0.61 bpm | 0.59 bpm |
| …seconds with no change | 64 % | 64 % | 66 % |
| …spread around a 61 s moving average | 1.50 bpm | 1.99 bpm | 1.55 bpm |
| …spread around a 121 s moving average | 2.44 bpm | 3.24 bpm | 2.49 bpm |
| Cadence: seconds where whole strides per minute don't change | 81 % | 78 % | 75 % |
| Altitude 1 s steps: none / 0.2 m / 0.4 m or more | 48 / 45 / 7 % | 53 / 44 / 3 % | 47 / 47 / 6 % |
| Skipped seconds | 0.7 % of intervals | 0.6 % | 0.6 % |

The rows that measure a spread around a moving average need both the width of that average and the span they were measured over quoted with them, or they mean nothing. The width matters because the spread grows steeply with it: on the same file, heart rate spreads 0.95 bpm around a 31 s average, 1.50 around 61 s, 2.44 around 121 s and 3.37 around 181 s, more than tripling across that range. The span matters just as much. Taken over the whole file instead of the steady middle, that 61 s figure becomes 2.62 bpm, because the opening ramp dominates the residuals. Everything in the table uses a centred average of the stated width over the steady middle only.

Measured that way, heart rate is where we are the noisier one: 1.99 bpm against the file's 1.50 at 61 s, and 3.24 against 2.44 at 121 s, about a third more at both widths. Speed sits slightly under the file at both.

The city-block route turns 90° every 200 m and rolls ±10 m every 2 km, so it has corners and small hills like a real street run. One old watch on one run is a sanity check, not a fit. Modern multi-band watches draw tighter tracks, and we'd like more files like this.

## Corners on drawn routes

Speed through a corner is capped at √(a·R): a = 2.5 m/s² running, 1.5 walking and hiking, 4 on a bike. Runners brake at up to 1.2 m/s² before a corner and pick up speed at no more than 0.6 m/s² after it.

The tricky part is R. A route from a router or a hand-drawn line is a polyline, and a gentle bend on a road can be drawn as a vertex every 50 m. If you measure the turn over ±5 m, each vertex looks like a sharp kink. A 150 m radius drawn with 50 m chords would then cap a rider near 28 km/h. So the window grows with the speed being tested: the three points used to measure the circle sit v·1.5 s apart along the route, between 5 and 40 m. At running speed a vertex still reads as the street corner it usually is. At riding speed the heading change is spread over tens of metres.

In practice a 90° street corner holds a runner to 3.0 m/s, a walker to 2.3 m/s and a rider to 19 km/h. The same 150 m radius drawn with 50 m chords doesn't slow a rider below 68 km/h.

## Starting and stopping

**Standing start.** Real files begin with a few seconds of standing: the watch starts recording, then the person sets off. Runsketch records 2–5 seconds of standing before the first step, with speed and cadence at zero. Heart rate starts 20 beats above resting.

**The first steps.** A watch counts cadence from steps, and the first steps from standing aren't running steps. For 10 seconds around any standstill, and below 2.2 m/s, running cadence blends in from walking cadence, which it matches fully at 0.8 m/s. On a typical start that gives 85 steps per minute at 0.6 m/s, 121 at 1.2 m/s, 150 at 1.8 m/s and 164 at 2.3 m/s. The same blend applies when slowing into a stop.

**Traffic lights.** The "urban" stop setting places a signalised crossing every 400–900 m. We use the pedestrian delay formula from the Highway Capacity Manual (2010), d = (C − g)² / 2C, where C is the signal cycle and g the effective walk time. That formula assumes people arrive at random. It works out to stopping with probability (C − g)/C and then waiting a uniform 0 to C − g seconds. Each crossing gets a cycle of 60–120 s and a walk time of 10–30 s. Nobody waits for a light halfway up a climb, so a stop that lands on a grade steeper than 6 % moves up to 150 m further on, or is dropped. Stops are at least 60 m apart.

Over 300 km that comes out at a stop at 80 % of crossings, or 1.2 per kilometre. The average wait is 38 s (median 35 s), 37 % of waits are longer than 45 s, and the longest is 93 s. After a stop the runner speeds up at 0.45–0.6 m/s².

## Speed as the watch writes it

Two things make recorded speed look the way it does, and only one of them is the sensor.

The motion itself isn't steady. Pace wobbles on time scales of 4 s, 15 s and 45 s (1.2 %, 3 % and 2.5 % at default variability) plus a slow 10-minute wander. The 15-second part carries most of the minute-to-minute variation a real watch shows. That wobble is real movement: heart rate and cadence follow it. The details are in the physiology doc.

Then the watch processes it. The speed field in the file is the true speed passed through a light smoothing filter, once forwards and once backwards with a 1 s time constant each way. Running it both ways means it adds no delay against distance. On top of that sits a sensor error that wanders slowly (time constant 25 s, lightly smoothed). Its size is 0.02 m/s plus 5 % of speed, which is about 0.19 m/s at 5:00/km. Wrist GNSS speed errors are larger than that: Gløersen et al. (2018) measured an interquartile range of 0.66 m/s on a 1 Hz wrist watch. Below 2 m/s the filter and the error shrink, so starts and stops aren't smeared. Speed is written to 0.01 m/s, is exactly zero while standing and never zero while moving.

Distance is left alone. It comes from the true path, so lap splits, moving time and the average pace you asked for all stay exact.

## GPS positions

Real GPS error is correlated in time and space, and plain random jitter on every point makes the track far too long (Ranacher et al. 2016). So the error is built from slow parts:

- **Timing error.** Each fix is the route point a little ahead of or behind where the athlete really is, as if the receiver's filter latency varied with signal quality. It's about 1.2 s of travel, changes over roughly 8 s and uses speeds up to 4 m/s, so at running pace it moves points by around 4 m along the path. This is what makes consecutive points unevenly spaced without adding sideways zigzag, which is the part that inflates track length.
- **A slowly wandering offset** of about 1.5 m that changes over a few minutes.
- **A reflection-like error** of about 0.4 m that changes with distance travelled, over 20 m.
- **A slow wander** of about 0.3 m over half a minute, which keeps going while standing still.
- **Corner cutting** from a 1.5 s tracking lag, at most 6 m, with the along-track part removed so points never fall behind the distance.
- 2 cm of fast noise.

The GPS setting scales all of it: ×0.5 for low, ×1 for normal, ×1.6 for high. The spacing between consecutive points then has an SD of 0.5 m (low), 0.8–0.9 m (normal) and 1.4 m (high), against 0.92 m on the fēnix 2. A spike guard stops any single second from moving more than 2.25 m further than the true step at normal (scaled with the setting), and never more than 1.5 times the step plus 3 m. The recorded track length stays close to the true distance: 0.3 % short on city blocks, where corners get cut, and within 0.1 % on a straight road.

**Standing still.** A watch at a traffic light doesn't freeze. The timing error holds, but whatever lead or lag the receiver had fades over about 15 s, and the slow parts keep drifting. Standing points wander about a metre and a half over a 20-second light and a few metres over a minute.

**A receiver that hasn't settled.** In some real files the first fixes repeat and the track starts off to one side, then jumps back. In 30 % of Runsketch activities the receiver is still settling at the start. The first 2–4 fixes repeat. The track starts 10–40 m away in a random direction and closes to about half of that. A correction jump comes 5–15 s in, and the last fifth fades within a few seconds. Across 40 seeds, 15 started this way, with correction jumps of 5–14 m.

GPX files carry no distance or speed, so the importer works them out from the points. Because the track length stays so close to the truth, a GPX and a FIT of the same activity agree on distance.

## Altitude

Altitude is modelled on a barometric watch, which is what most running watches use. It starts from the smoothed terrain and adds:

- **A calibrated start.** The first reading matches the terrain, with no constant offset, which would only push the track out of line with maps.
- **A small stretch of height differences**, 0–4 % depending on the seed. Barometric devices over-estimate total ascent, while GPS-only ones under-estimate it (Sánchez & Villena 2020). We keep the stretch deliberately modest.
- **Slow wander** of about 0.8 m over 5 minutes.
- **Weather.** A change in air pressure reads as a change in height, about 8.3 m per hPa near sea level. When the activity has weather data, we use the real pressure trend at the athlete since the start, converted with the atmosphere's scale height. Without it, the drift rate wanders slowly (about 1.5 m per hour, changing over 3 hours). That's mostly inside the Met Office "falling slowly" band of up to 1.5 hPa in 3 hours. Over two hours on flat ground the altitude drifts 3 m on average and 6 m at most.
- **Fast pressure noise** from gusts, arm swing and the sensor: about 9 cm with a 3 s time constant, 1.6 times more while moving.

Altitude is written in 0.2 m steps, like barometric watches. On a route with corners and small hills the mix of unchanged, 0.2 m and larger steps comes out close to the real file; on a flat road there are fewer of the larger steps, since the terrain isn't contributing any (see the table at the top).

Recorded altitude counted with a 3 m threshold gives 2–5 % more climb than the terrain on a rolling 12 km route. On a flat 10 km it gives nothing, or a few metres. The ascent and descent totals in the file come from the smoothed terrain instead, the way platforms that correct elevation report them.

## Heart-rate sensor

The heart rate from the physiology model is the true one. The file gets what a sensor makes of it, and the two sensor types behave differently.

**Chest strap.** A strap measures the heart's electrical signal, so it tracks the true rate closely. In treadmill tests a Polar H7 agreed with an ECG almost perfectly (concordance 0.996), while wrist watches ranged from 0.81 to 0.92 (Gillinov et al. 2017). All we add is a small slow wander and a little jitter. The real strap trace has about two thirds of seconds unchanged, and so does ours. Over a minute, though, most of what moves a strap trace isn't the sensor at all but the physiological wander that the [physiology](physiology.md) page adds to the true heart rate, and there we sit about a third above the real file at every window we checked.

**Wrist sensor.** An optical sensor reads blood volume under the skin and averages over a few seconds, so its trace is smoother and lags a little. It is also less reliable during exercise than at rest (Bent et al. 2020). Two effects stand out.

*The first ramp.* Icenhower et al. (2025) compared a Garmin Forerunner 45 with a Polar H10 on outdoor walk–jog sessions. On the first ramp-up the wrist read 14.35 bpm low on average, and 72 % of people were off by more than 5 bpm. On the second ramp the gap was only 2.5 bpm. Runsketch gives 85 % of wrist recordings a first-ramp under-read. While true heart rate is still climbing in the first minutes, the sensor reports 25–50 % of the rise less, at most 10–20 bpm. The ramp counts as over once true heart rate rises less than 2 bpm in 20 seconds, and at the latest after 5 minutes. Then the gap closes with a time constant of 45–90 s. Across 12 seeds, strap minus wrist averages 13.6 bpm between 30 seconds and 3 minutes, and nothing at all 15 minutes in.

*Glitches.* Now and then a wrist sensor locks onto running cadence or reads well low for a while. Each episode lasts 20–90 s. It is a cadence lock when the cadence sits 10–60 above the heart rate, and otherwise a reading 10–20 bpm low. They're more likely in the first 10 minutes (about one per half hour at that rate) than later (about one per two hours).

> **Noise sizes, current values.** These are the numbers most likely to be retuned. Chest strap: a slow wander of 1.2 bpm with a 25 s time constant, plus 0.2 bpm of jitter per second. That gives a 1 s change SD of about 0.6 bpm with 65 % of seconds unchanged. Wrist: a slow wander of 2 bpm with a 25 s time constant, plus 0.6 bpm of jitter, all passed through a 5 s averaging filter together with the first-ramp under-read and any glitch. That gives a 1 s change SD of about 0.4 bpm with 84 % of seconds unchanged. Heart rate is written in whole beats, between resting − 5 and maximum + 2.

## Cadence as recorded

Running cadence gets a slow wander of 1.2 steps per minute (30 s time constant) plus 0.2 of jitter, and is kept in whole steps. The real file changes its whole-strides value in about one second in five, and ours in about one in four.

Watches store foot cadence in strides per minute, half the steps, and so do all three exports. FIT has a separate `fractional_cadence` field, so a cadence of 171 steps is written as 85 and a half. Garmin writes walking cadence the same way. TCX and GPX only take whole numbers. Always rounding the half up (or down) would bias every odd step count by a quarter of a stride, so an exact half keeps the previous value when that is one of its two neighbours, and rounds up otherwise. The GPX export of a run from Strava's own Android app stores the same strides-per-minute values. Ride cadence stays in revolutions per minute.

## Temperature

The temperature in a watch file isn't the air. The sensor is inside the watch, and the watch is on a wrist. Garmin's manual says so directly: "Your body temperature affects the temperature reading." In the fēnix 2 run the watch read 20–23 °C while the air, according to weather reanalysis for that place and hour, was about 16 °C. On one ride a fēnix 5 on the wrist read 19 °C while an Edge 820 on the handlebar read 13 °C.

On foot, the reading settles at air + k·(wrist − air), with k = 0.55 / (1 + 0.22·v). Here v is airflow, smoothed over 30 s. The wrist temperature comes from the body's own heat balance on the [weather](weather.md) page: mean skin, less a tenth of the gap between skin and air, since hands and wrists vasoconstrict before the trunk does. Two things then change the coupling. Rain wets the strap and cools it, taking up to 30 % off k from 1 mm/h. A sleeve over the watch — anything from 0.9 clo of clothing — cuts the airflow it feels to a quarter and halves the limb's cooling. Airflow is the air the athlete actually meets, their speed plus the headwind, so running into a wind reads colder than the same speed in still air. The reading moves towards that value with a 10-minute time constant, starting 0–1.5 °C above air. A slow wander of 0.4 °C is added, and the whole-degree value only changes once the reading is 0.6 °C away from it, so it steps one degree at a time.

Without a heat balance to read — there always is one now — the wrist would fall back to a fixed curve of skin against air temperature. That fallback is still in the code for tests that drive the channel on its own.

A ride models a computer on the handlebar instead: air temperature plus up to 1.5 °C from its own electronics and sun, blown away by airflow, with a 5-minute time constant.

What that gives over the last 10 minutes:

| | Run at 5 °C | Run at 15 °C | Run at 25 °C | Run at 32 °C | Walk at 15 °C | Ride at 15 °C |
|---|---|---|---|---|---|---|
| Recorded temperature | 12 °C | 19–20 °C | 27 °C | 33 °C | 21–22 °C | 15–16 °C |

When weather data is available, air temperature changes second by second and the sensor follows it, wind and rain included. The heart never reads this stream: cardiac drift has one rate, and heat and cold reach the heart through the heat balance itself.

## Running dynamics

A Garmin paired with a chest strap or a running pod adds running dynamics to every record: ground contact time, vertical oscillation, step length and so on. Runsketch writes them for runs, walks and hikes with a chest strap. Wrist-only recordings get none, as with a real watch that has no strap or pod.

- **Ground contact time** is 250 ms at 3 m/s and falls by 30 ms per m/s, kept between 180 and 330 ms. Each athlete gets a personal offset (SD 15 ms) and a small wander. The fēnix 2 with its strap showed 240–250 ms at 3.0 m/s and 212–228 ms at 4.0 m/s. Walking steps (cadence below 140) get 420–560 ms.
- **Vertical oscillation** is a personal 7–11 cm with a small wander, or about 5 cm while walking. Real files showed 7.3–8.4 cm on a fēnix 5 and 10.4–11.5 cm on the fēnix 2, and Garmin's gauge puts most runners between 6.4 and 11.5 cm.
- **Step length** is speed × 60 / cadence, so it always agrees with the speed and cadence in the same record. Contact time as a share of the stride (two steps) and vertical ratio (oscillation over step length) follow from it.
- **Left–right balance** is 50 % plus a personal offset (SD 0.8 %) and a small wander.

At 5:00/km the default athlete averages 234 ms of contact, 7 cm of oscillation, a 1.15 m step and a 6.1 % vertical ratio.

## How the file is written

**One plan for all three formats.** Before writing anything, the exporter decides which seconds a device would have written. GPX, TCX and FIT of the same activity then hold exactly the same points.

**Skipped seconds.** Even in 1-second mode a Garmin misses a second now and then. The fēnix 2 run has 20 gaps in 2833 seconds: 17 of 2 s, one of 3 s and two of 4 s. Runsketch drops seconds at about the same rate: 2 s gaps 80 % of the time, 3 s and 4 s gaps 10 % each. The first and last point of the activity and of every lap are always kept, and so are the points on either side of a pause. With GPS noise set to off, the exact-geometry setting, nothing is skipped. Over 12 runs this came to 0.63 % of intervals.

**Auto-pause.** A stop of 3 seconds or more in the middle of an activity becomes an auto-pause; a standing start or finish doesn't. We copied the layout of a real Garmin cycling computer file:
- a record with zero speed as the athlete stops;
- a timer `stop_all` event with the trigger set to auto;
- no records while paused;
- a timer `start` event, again auto, with the first moving record.

Shorter halts stay in timer time, since a watch needs a few seconds below its speed threshold before it pauses. When a file has proper timer events, Strava takes moving time from the device instead of estimating it.

**Timer time and averages.** Lap and session timer time is elapsed time minus the paused seconds. Average speed is distance over timer time, which is how the FIT profile defines it. Average heart rate, temperature and running dynamics are averaged over the seconds in timer time, so an auto-paused wait doesn't drag them down. Moving time is written separately.

On a 10 km urban run at 5:00/km with 10 auto-paused lights, the file says 3502 s elapsed, 3004 s of timer time and 3000 s moving. The average speed is 3.329 m/s against the 3.333 m/s asked for; the difference is the standing start and the second each pause begins with.

**Provenance.** FIT files say they come from a development device with product number 0, and TCX files carry no real unit or product id. We don't pretend to be a particular watch.

### Where each value goes

| Value | FIT record | TCX trackpoint | GPX point |
|---|---|---|---|
| Position | `position_lat`, `position_long` | `Position` | `lat`, `lon` (7 decimals) |
| Altitude | `enhanced_altitude` (0.2 m steps) | `AltitudeMeters` | `ele` |
| Distance | `distance` | `DistanceMeters` | none, the importer measures the points |
| Speed | `enhanced_speed` | `ns3:Speed` | none |
| Heart rate | `heart_rate` | `HeartRateBpm` | `gpxtpx:hr` |
| Cadence, on foot | `cadence` + `fractional_cadence`, strides/min | `ns3:RunCadence`, whole strides/min | `gpxtpx:cad`, whole strides/min |
| Cadence, ride | `cadence`, rpm | `Cadence` | `gpxtpx:cad` |
| Power | `power` (rides) | `ns3:Watts` (rides) | none |
| Temperature | `temperature`, whole °C | none | `gpxtpx:atemp` |
| Running dynamics | `stance_time`, `stance_time_percent`, `vertical_oscillation`, `vertical_ratio`, `step_length`, `stance_time_balance` | none | none |
| Auto-pause | timer `stop_all` / `start` events, trigger auto | a new `Track` inside the lap | a time gap in the segment |
| Skipped second | no record | no trackpoint | no point |

| Lap and session value | FIT `lap` / `session` | TCX `Lap` |
|---|---|---|
| Timer time | `total_timer_time` | `TotalTimeSeconds` |
| Elapsed and moving time | `total_elapsed_time`, `total_moving_time` | none |
| Average speed | distance / timer time | `ns3:AvgSpeed`, distance / timer time |
| Average heart rate | over timer time | over timer time |
| Temperature | `avg_temperature`, `max_temperature`, `min_temperature` over timer time | none |
| Running dynamics | `avg_stance_time`, `avg_vertical_oscillation`, `avg_step_length` and the rest | none |
| Ascent and descent | from the smoothed terrain | none |

FIT messages follow Garmin's "summary last" order: file id, device info, timer start, records with their pause events, timer stop, laps, session, activity.

## How it's tested

The tests check what a file looks like rather than the formulas behind it:

- On 10 km of city blocks at normal GPS, the spacing between consecutive points has an SD between 0.7 and 1.1 m, with a correlation to the previous step above 0.5. On city blocks, a flat run and a walk, the track stays within −1 % and +1.5 % of the true distance.
- Between 2 and 12 of 20 seeds start with a settling receiver: a repeated first fix, then a jump of more than 2.5 m within 25 seconds.
- Altitude: 40–58 % of 1 s steps unchanged, over 38 % at ±0.2 m and 2–12 % at 0.4 m or more. A flat 10 km never gains more than 10 m, and recorded climb is 0.95–1.15 times the terrain's. Two hours of weather drift stay under 10 m, and a given pressure change replaces the random drift exactly.
- The wrist temperature is always a whole number and changes one degree at a time. At 15 °C it starts at 15–17 °C and ends a run 4–7 °C above the air. A handlebar unit ends within 14–17 °C. When the air warms by 10 °C the reading follows by more than 6 °C.
- Recorded speed, with a 61 s moving average of itself taken out, has a lag-1 correlation above 0.85. It is exactly zero whenever the athlete stands still, while distance and moving time still hit the target.
- Whole strides per minute stay unchanged in 70–90 % of seconds, and nothing below 1 m/s is counted faster than 135 steps per minute.
- A chest strap leaves 55–75 % of seconds unchanged, with a 1 s change SD between 0.45 and 0.75 bpm.
- Over eight seeds, a wrist sensor reads 10–16 bpm below a strap on average between 30 seconds and 3 minutes, and within 2 bpm after 15 minutes.
- Urban lights stop the athlete at 68–86 % of crossings, with waits of 1–110 s averaging 30–40 s, more than a fifth of them over 45 s. None are on grades steeper than 6 %.
- A ride down a road drawn with ±15° vertices every 50 m is at least 97 % as fast as down a straight one, and a 150 m radius doesn't cap it below 60 km/h. A 90° street corner still holds a runner under 3.1 m/s and a rider under 22 km/h, and a 10 m hairpin holds a rider under 26 km/h.

## What's still a guess

- The size of the speed sensor error and of the 15-second pace wobble. Both were fitted to a single real run.
- The GPS timing error, the other GPS error sizes, and how the three GPS settings map to open sky, cities and forests.
- The settling start: how often it happens (30 %), how far off it starts (10–40 m) and how the correction plays out. The real file we saw jumped 30 m in one go, while ours correct in smaller steps.
- The barometer's 0–4 % height stretch, the size of its fast noise and the weather drift rate when there's no weather data.
- The temperature model's wrist coupling, skin temperature and time constants. Real watches often start several degrees warm, straight from indoors, while ours start near air temperature.
- Wrist heart rate: how many recordings under-read the first ramp, by how much, how fast they catch up, and how often glitches happen.
- The minute-scale heart-rate wander, twice over. First, the statistic itself is meaningless without the width of the moving average and the span it covers, and at matched widths we are above the one real file we have, not below it: 1.99 bpm against 1.50 at 61 s over the steady middle, 3.24 against 2.44 at 121 s. Second, the target it was tuned to looks mis-set. The house figure of 2.35 bpm was quoted at a 61 s window, and we could not reproduce it from the file that way under any span we tried: the file gives 2.44 at 121 s over the steady middle, or 2.62 at 61 s over the whole run. Both are plausible provenances and we don't know which was meant. Our own value has moved 1.01 → 0.85 → 1.99 bpm across versions, and the change that raised it was aimed at matching a real strap. The next tuning pass should settle the window and the span before it picks a number. Nothing about the engine changes in this release.
- Personal ranges of the running dynamics, and the walking values.
- Signal cycles of 60–120 s and walk times of 10–30 s, and the assumption that everyone waits for the green.
- That auto-pause kicks in after 3 seconds and is always on. Many runners switch it off.
- The skipped-second rate, taken from one watch.
- The cadence blend at starts and stops.

The best check would be a set of current multi-band watch recordings, 1-second, with a chest strap, on known routes. We'd run the same statistics as the table at the top on them, route for route.

## References

Recording format and devices

- Garmin FIT SDK: protocol and profile (message and field definitions, units and scales; `Profile.xlsx` in the SDK download). https://developer.garmin.com/fit/protocol/
- Garmin FIT SDK: Encode Activity Recipe (message order, timer events). https://github.com/garmin/fit-javascript-sdk/blob/main/test/encode-activity-recipe.test.js
- Garmin FIT SDK cookbook: elapsed, timer and moving durations. https://developer.garmin.com/fit/cookbook/durations/
- Garmin Training Center Database v2 and ActivityExtension v2 schemas. https://www8.garmin.com/xmlschemas/TrainingCenterDatabasev2.xsd, https://www8.garmin.com/xmlschemas/ActivityExtensionv2.xsd
- GPX 1.1 schema and Garmin TrackPointExtension v1. https://www.topografix.com/GPX/1/1/, https://www8.garmin.com/xmlschemas/TrackPointExtensionv1.xsd
- Strava: uploading activity files. https://developers.strava.com/docs/uploads/
- Garmin fēnix 8 owner's manual: the activity temperature reading is not accurate. https://www8.garmin.com/manuals/webhelp/GUID-EECCAC99-90D6-4AB1-9A3A-EC433D3365E2/EN-US/GUID-6E06604B-869D-4F27-9BD0-4916C177E215.html
- Garmin Forerunner 965 owner's manual: running dynamics and colour gauges. https://www8.garmin.com/manuals/webhelp/GUID-0221611A-992D-495E-8DED-1DD448F7A066/EN-US/GUID-62A09512-518A-424A-8491-FE2B80CD2091.html
- Sample FIT files from the python-fitparse test suite. https://github.com/dtcooper/python-fitparse/tree/master/tests/files
- A run exported as GPX by Strava's Android app (test fixture in the Elevate project). https://github.com/thomaschampagne/elevate/blob/HEAD/desktop/src/connectors/file/fixtures/activities-02/runs/strava_export/20170319_run_906581465.gpx

GPS and altitude

- Gløersen Ø, Kocbach J, Gilgien M. Tracking performance in endurance racing sports: evaluation of the accuracy offered by three commercial GNSS receivers aimed at the sports market. *Front Physiol* 9:1425, 2018. https://doi.org/10.3389/fphys.2018.01425
- Ranacher P, Brunauer R, Trutschnig W, Van der Spek S, Reich S. Why GPS makes distances bigger than they are. *Int J Geogr Inf Sci* 30:316–333, 2016. https://pmc.ncbi.nlm.nih.gov/articles/PMC4786863/
- Gilgen-Ammann R, Schweizer T, Wyss T. Accuracy of distance recordings in eight positioning-enabled sport watches. *JMIR mHealth uHealth* 8:e17118, 2020. https://doi.org/10.2196/17118
- Sánchez R, Villena M. Comparative evaluation of wearable devices for measuring elevation gain in mountain physical activities. *Proc Inst Mech Eng P* 234, 2020. https://doi.org/10.1177/1754337120918975
- Met Office. Pressure tendency terms in the marine glossary. https://weather.metoffice.gov.uk/guides/coast-and-sea/glossary
- Open-Meteo weather API (pressure and temperature series; ERA5 reanalysis for past weather). https://open-meteo.com/

Heart rate

- Icenhower A et al. Investigating the accuracy of Garmin PPG sensors on differing skin types based on the Fitzpatrick scale. *Front Digit Health*, 2025. https://doi.org/10.3389/fdgth.2025.1553565
- Gillinov S, Etiwy M, Wang R et al. Variable accuracy of wearable heart rate monitors during aerobic exercise. *Med Sci Sports Exerc* 49:1697–1703, 2017. https://doi.org/10.1249/MSS.0000000000001284
- Bent B, Goldstein BA, Kibbe WA, Dunn JP. Investigating sources of inaccuracy in wearable optical heart rate sensors. *npj Digit Med* 3:18, 2020. https://pubmed.ncbi.nlm.nih.gov/32047863/

Stops

- Transportation Research Board. *Highway Capacity Manual 2010*, pedestrian delay at signalised intersections, p. 18-69, as quoted in: The Highway Capacity Manual's method for calculating bicycle and pedestrian levels of service (UCLA Lewis Center). https://www.lewis.ucla.edu/wp-content/uploads/sites/2/2014/09/HCM-BICYCLE-AND-PEDESTRIAN-LEVEL-OF-SERVICE-THE-ULTIMATE-WHITE-PAPER.pdf
