# Weather

Runsketch fills in the weather for the date, time and place of an activity, and lets it change as the activity goes on. The air warms after sunrise and cools on the way up, a shower starts and stops, the wind swings round. The engine reads that weather every second at the athlete's simulated position and time. The file then shows what the weather did to the pace, the heart rate, the altimeter and the watch's thermometer.

This page covers where the data comes from, how it becomes conditions second by second, and what each part of the model does. Heart rate, pace and the rest of the physiology are described in [physiology.md](physiology.md).

## The idea in one paragraph

A single temperature for a whole activity is fine for a 30-minute run in town. It isn't for a morning in the mountains:

- the start is at 7 °C before sunrise;
- the ridge is at freezing point in a westerly wind;
- the way down is on rock still wet from a shower two hours earlier.

Runsketch fetches hourly weather for a handful of points along the route, from two days before the start to the day after the finish. The engine turns those points into a field it can query at any distance, time and height.

Rain doesn't slow anyone directly. It wets the ground, and the ground dries at its own pace, place by place. Heat and cold go through a small model of the body's heat balance, which reaches the pace as well as the heart rate.

The fetched data is stored with the session. The same route, start, seed and weather give the same file, even after the forecast has moved on. New sessions use automatic weather; manual conditions are one click away.

## Where the weather comes from

All weather comes from Open-Meteo. We chose it because:

- it needs no key;
- it answers browsers directly;
- it covers the whole world;
- it serves forecasts and past weather in the same format;
- it can adjust values to an elevation we give it.

We send one request per source, with every route point in it. The source depends on the activity date, counted in UTC days from today:

| Activity date | Source | What it is |
|---|---|---|
| Before 2022 | Historical weather API, best match | ERA5 and ERA5-Land reanalysis, and the ECMWF IFS analysis from 2017 |
| 2022 to the day before yesterday | Historical forecast API | The same forecast models, stitched together from the first hours of each run |
| Yesterday to 15 days ahead | Forecast API | The forecast; the API is asked for past hours back to 60 days |
| Further ahead | Historical weather API, the last ten years | One real past year stands in for the date |

ERA5 trails today by about five days. For recent dates, the archived forecasts are both closer to what you would have seen and available right up to today.

If a host says a date is outside its range, we try the next one: forecast, then historical forecast, then archive. Hours missing from an archived forecast are filled from the archive once. After that, any gap of up to three hours takes the nearest valid hour.

**Dates beyond the forecast.** We don't average past years for these. An hourly median smooths away exactly what matters, like a morning shower or a front passing through. Instead:

1. We fetch the same dates from each of the last ten complete years, in one request.
2. We pick the year whose mean temperature, daily precipitation and mean wind over the window are closest to the ten-year median. Each difference is scaled by how much the years vary, and ties go to the more recent year.
3. That year's weather moves onto the requested dates. It is labelled, for example, "Typical for this date (weather of 2019)".

An activity may start inside the forecast and run past its end. The remaining hours then come from that past year, and the first three hours blend from the last forecast hour, a quarter, a half and three quarters of the way.

**Variables.** Ten hourly variables are requested:

- temperature and dew point at 2 m;
- precipitation and snowfall;
- wind speed, direction and gusts at 10 m;
- surface pressure;
- shortwave radiation;
- cloud cover.

Ten is the most Open-Meteo counts as a single call per point.

**Elevation.** Each point carries its route elevation. Open-Meteo moves temperature and pressure to that height and picks a grid cell of similar height. This matters in steep terrain, where its own coarse elevation model can place a valley village hundreds of metres up the slope.

**Rounding.** Values are rounded when they arrive: 0.1 °C, 0.1 mm of precipitation, 0.01 cm of snowfall, 0.1 m/s, 1° of direction, 0.1 hPa, 1 W/m² and 1 % of cloud.

**Failures.** Requests time out after 10 seconds. If Open-Meteo answers "too many requests", nothing more is sent for a minute. When the browser is offline or a fetch fails, automatic mode uses the manual values and says so.

The weather data is from Open-Meteo under CC BY 4.0, with ERA5 and ERA5-Land from the Copernicus Climate Change Service. We interpolate it along the route and adjust it to the route's elevation.

### Which points and which days

Weather is requested for at most 12 points:

- the start and the finish (only the start on a loop whose ends are under 1 km apart);
- points a tenth of the route apart, but never closer than 2 km or farther than 20 km;
- the highest point, the lowest point and the point farthest from the start, unless another point already lies within 1 km along the route and 100 m in height.

Coordinates are rounded to 0.01° (about 1 km) and elevations to 10 m. Dragging a waypoint a little reuses the same weather.

The time window is made of whole UTC days. It starts two days before the start day, so wet ground and snow from earlier are included. It ends one full day after the expected finish.

The expected finish is the target moving time plus a stop allowance (5 % for "few" stops, 20 % for "urban"), with 15 % to spare. Because the window is whole days, moving the start within a day or editing the target fetches nothing new. If a simulation runs longer, the window grows to cover it. If the activity still outlasts the data, the last hour is held and a warning says for how long. The weather stage waits 800 ms after the last change before it fetches.

### Time zones

Open-Meteo reports each location's time zone, but its UTC offset is today's offset, not the offset on the requested date: Zurich in January comes back as UTC+2. We never read that offset. Every hour is indexed by its UTC timestamp. The local offset for any instant comes from the zone name through the browser's time-zone database, daylight saving included.

The start time you type is a wall-clock time at the route, not on your computer. Once the route's zone is known:

- A start you set keeps its wall-clock time and moves to the matching instant.
- A start that follows "now" keeps its instant and only takes the zone's offset.
- A time in the spring gap moves forward by the gap.
- An ambiguous autumn time takes the later of its two occurrences.

## How the weather changes during the activity

The engine already moves the athlete forward one second at a time, distance and time together. At every step it asks the weather field for the conditions at that distance, that moment and that elevation.

There's no separate "arrival time" loop to iterate. To match your target, the engine tries different efforts and runs the whole activity again for each try. Every try meets the weather at its own arrival times.

The field is built from the hourly points like this:

- **Along the route**, values are interpolated linearly between the two nearest points by distance.
- **To the exact height.** The remaining difference between the route and the interpolated point elevation is corrected at 6.5 °C per km for temperature and 6.0 °C per km for dew point, which never exceeds the temperature. Open-Meteo uses the same rates, so the two corrections agree. Pressure follows the hypsometric equation, and humidity is recomputed from temperature and dew point.
- **In time**, temperature, dew point, pressure and cloud are interpolated between hours.
  - Wind is interpolated as a vector, so a wind turning from 350° to 10° passes through north, not south.
  - Precipitation arrives as a total for the hour before, so it's spread evenly over that hour.
- **Sunshine** arrives as the hour's average.
  - We divide it by the average of sin(sun elevation) over that hour, then multiply by the sun's current elevation factor.
  - Radiation is therefore exactly zero before sunrise and doesn't jump on the hour.
  - The sun's position comes from the NOAA solar equations, with no extra request.
- **Rain or snow** follows the wet-bulb temperature (Stull 2011), so humidity counts as well as air temperature. The snow share is:
  - half at a wet bulb of 0.5 °C;
  - 90 % at −0.8 °C;
  - 10 % at 1.8 °C.

  Jennings et al. (2018) found rain and snow equally likely at an air temperature of 1.0 °C across the Northern Hemisphere.
- **Air density**, for the bike and the wind model, is worked out every second from pressure, temperature and humidity.

## Wind

The weather gives wind at 10 m, and it is weaker near the ground. From the log wind profile over roughly open country (roughness length 0.1 m), an athlete at 1.5 m feels 59 % of the 10 m wind. Forests, streets and ridges aren't told apart yet.

The direction of travel is measured over ±10 m of route. That splits the wind each second into a headwind or tailwind and a crosswind.

### On foot

Pushing against the air costs energy in proportion to the force. da Silva, Kram & Hoogkamer (2022) measured this by pulling runners backwards on a treadmill. Gross metabolic power rose 6.13 % for each 1 % of body weight of horizontal force; individuals ranged from 4.17 % to 8.14 %.

The drag area is 0.2 m² per m² of body surface: about 0.37 m² for a 70 kg, 175 cm athlete. That's in line with di Prampero's (1986) air-resistance figures.

```
v_air     = speed + headwind
extra     = ½·ρ·A·(v_air·|v_air| − speed²)       × 0.6 when the wind helps
wind cost = 1 + 6.13 × extra / (m·g)
```

A tailwind gives back only part of what the same headwind takes. Davies (1980) found about a third. Yamashita et al. (2024) found tailwinds helped more than headwinds hurt, at up to 6 m/s. We use 0.6 as a compromise.

At the same effort, speed is divided by the wind cost and oxygen demand is multiplied by it. Heart rate therefore rises into the wind even when the target fixes the average pace.

At sea-level air density:

| Athlete | 5 m/s headwind at body height | Same wind from behind |
|---|---|---|
| Runner at 3.33 m/s (5:00/km) | +11.5 % | −1.6 % |
| Hiker at 1 m/s | +7 % | |

### On a bike

The cycling model (Martin et al. 1998; see physiology.md) already includes air. With weather:

- Drag acts on the air speed, speed plus headwind, instead of on the speed alone. A tailwind faster than the rider pushes.
- Air density changes second by second. The flat power a target speed needs is set in the air at the start.
- Riders push a little harder into a headwind. Planned power rises 1.5 % per m/s of headwind, within −5 % and +10 %.
- Crosswinds don't change the ride yet.

## Surface state belongs to places

A hiker isn't slowed by rain while it falls. What slows people is wet rock, mud and ice, and those stay after the rain has stopped. A descent that was soaked an hour ago is still wet when you arrive, and a path in the sun dries before one in the shade. So wetness belongs to the place, not to the athlete.

**Stations.** There's a station every 200 m along the route, more sparsely on routes over about 50 km. Each station:

- steps through time on its own from two days before the start: every 15 minutes at first, every 5 minutes from the start on;
- uses the weather at its own position and height;
- uses the surface class under it.

The athlete meets whatever state a station is in when they pass it. If no precipitation falls anywhere in that window, the stations aren't computed at all and the ground stays dry.

Each station keeps four things:

- **A water film.**
  - Rain and meltwater go in. Above 1 mm the excess runs off within a few minutes, as in the METRo road-weather model (Crevier & Delage 2001).
  - The film evaporates by the Penman (1948) combination of sunshine, wind and dry air.
  - A 0.5 mm film takes about 4 hours to dry on an overcast day at 15 °C, and about 40 minutes in full sun. On a humid night it doesn't dry.
  - The surface counts as fully wet when the film reaches the class's capacity: 0.5 mm on pavement, 1.5 mm on an earth path.
- **Soil memory, or mud.** Natural surfaces soak up rain and give it back slowly: over 6 hours on rock, 36 hours on earth paths. A path can stay muddy after its surface has dried.
- **Fresh snow.**
  - When precipitation falls as snow, depth grows by its water content at the density of fresh snow for that temperature (Hedstrom & Pomeroy 1998): 68 kg/m³ at −15 °C, 119 kg/m³ at 0 °C.
  - It settles by 20 % a day.
  - It melts by 0.15 mm of water per degree-hour above 0 °C, within the range of melt factors for snow in Hock (2003).
- **Ice.** A film of at least 0.05 mm freezes gradually as the air cools: nothing at +1 °C, about a quarter frozen at 0 °C, fully icy at −2 °C and below. Surfaces run a little colder than the air, and a film does not turn to ice the instant a thermometer passes zero.

| Surface | Fully wet at | Mud memory | Speed lost when wet: level | Steep descent | Grip lost |
|---|---|---|---|---|---|
| Paved | 0.5 mm | — | 1 % | 4 % | 20 % |
| Compacted, gravel | 0.8 mm | 12 h | 2 % | 8 % | 30 % |
| Earth path | 1.5 mm | 36 h | 4 % | 20 % | 60 % |
| Rough path, rock | 0.7 mm | 6 h | 4 % | 25 % | 50 % |
| Scree | 0.8 mm | 6 h | 3 % | 15 % | 30 % |
| Steps | 0.5 mm | 6 h | 3 % | 15 % | 40 % |
| Sand | 2 mm | 12 h | 3 % faster (firmer) | — | — |
| Snow | 1 mm | — | 2 % | 10 % | 30 % |
| Ice | 0.5 mm | — | 5 % | 30 % | 60 % |

**On foot**, the surface state multiplies the dry ground factors from [terrain.md](terrain.md):

```
steep       = 0 on grades above −5 %, rising to 1 at −25 %
wet factor  = 1 − wet × level loss − steep × (wet or muddy) × descent loss × (0.5 + technicality)
snow factor = η^−0.7,   η = 1 + 0.0754 per cm of fresh snow, at most 4.5
ice factor  = 0.6 walking or 0.5 running, blending to 0.4 on steep descents, scaled by how frozen the film is
speed      ×= wet factor × snow factor × ice factor, never below 0.2
```

- **Snow.** The terrain factor comes from Pandolf, Haisman & Goldman (1976): walking in 5 cm of fresh snow costs 1.38 times as much energy. At the same effort, most of that goes into speed (η^−0.7) and the rest into oxygen cost (η^0.3).
- **Crampons.** On a mountain day with crampons on, ice keeps 90 % of walking speed and 80 % on a descent, and costs 5 % more oxygen instead of 15 %. Grip loss on ice drops from 60 % to 20 %. The stronger of the terrain's own snow and the weather's fresh snow is used, never both.
- **Grip.** Corner speed limits shrink with the square root of the grip that's left. People who expect a slippery floor shorten their steps and slow down (Cham & Redfern 2002), and no footwear grips wet ice well (Manning & Jones 2001). The grip values are anchored to those findings; the speed losses in the table are our estimates.

**On a bike**, a wet road keeps 60 % of its cornering grip. Corner speeds drop to about 77 % of dry, close to the 70–80 % that tyre makers report for wet roads. On a wet or icy road, the descent speed limit is up to 20 % lower.

Mapped snow, glacier, scree and bare rock have their own ground factors; the surface state adds the weather on top. Snow already lying before the two-day window isn't part of the surface state.

## Heat, cold, heart rate and pace

A fixed curve of drift against temperature can't tell that a humid, sunny morning at 22 °C is harder than a dry, windy one at 25 °C, or that a hiker soaked by rain at 3 °C loses heat fast. That curve is gone. Heart rate and pace both read a small model of the body's heat balance, and it runs in manual conditions exactly as it runs with a forecast.

The model has core and skin compartments, as in Gagge's two-node model (Gagge, Fobelets & Berglund 1986), and a working-muscle temperature that sits between them. It uses the heat exchange, sweating and clothing terms of the ISO 7933 Predicted Heat Strain model (Malchaire et al. 2001) and the clothing corrections of ISO 9920.

Every second it takes in:

- the heat from the oxygen the muscles use, minus the work that goes into climbing or turning the cranks;
- air temperature and dew point;
- the air moving past the athlete: their own speed plus the wind along and across the direction of travel;
- sunshine, through the mean radiant temperature (SolarCal; Arens et al. 2015);
- rain reaching the athlete, which cools the skin and soaks the clothing;
- the clothing the athlete wears.

It tracks:

- core temperature;
- skin temperature;
- working-muscle temperature, which is what cold takes the power out of;
- sweat rate;
- the water held in clothing, since wet clothing insulates less;
- fluid lost, net of what's drunk;
- shivering.

Dry heat loss follows skin temperature, air, sunshine and wind. Sweat cools only as fast as the air's humidity lets it evaporate.

Everything the balance does is read as a difference: this activity against the same movement in neutral weather, which is 15 °C, 60 % humidity, calm, dry and overcast. The engine steps a second body through that neutral air alongside the real one. Cardiac drift in physiology.md now has a single rate, calibrated for exactly that case, and no longer bends with temperature; heat reaches the heart only through this difference, so the two are never counted twice. In neutral air the two bodies are identical, the heat term is zero and the speed factor is exactly 1.

<!-- Thermal numbers begin. Coefficients, couplings and anchor results of the heat balance. -->
The current numbers:

- **Heart rate** rises 8 % per °C of core temperature above the neutral case, and 9 % per 1 % of body mass lost.
  - When the core warms 1 °C, stroke volume falls 7–8 % (González-Alonso et al. 1997).
  - Each 1 % of body mass lost costs about 5 % of stroke volume (González-Alonso et al. 2000), usually reported as 5–8 bpm. We use a little more, for a reason worth stating: everything here is a difference against the same movement in neutral air, and the reference body sweats too. What reaches heart rate is the gap between the two, which is smaller than either loss on its own, so a coefficient taken straight from absolute measurements comes out short. This is the whole heat→heart-rate coupling, deliberately kept in one place so it can be retuned on its own.
- **Pace** reads the same balance, as a speed factor on foot and a power factor on a ride, always against the same motion in neutral air:
  - **warm skin**, 0.9 % per °C above neutral on foot and 5 % per °C on a ride, past the first 0.3 °C, at most 15 %. People ease off with warm skin long before core temperature differs (Tucker et al. 2006; Ely et al. 2010);
  - **fluid deficit**, 3 % per 1 % of body mass beyond 0.2 %, at most 25 % (Sawka et al. 2007; Casa et al. 2010). This is what makes a hot marathon fade rather than start slowly;
  - **core temperature**, up to 12 % as it goes from 39.3 to 40.5 °C, shifted by fitness (−0.2 °C for a beginner, +0.3 °C for an elite athlete);
  - **cold muscle**, 3 % per °C that working muscle is colder than in neutral air, past the first 0.8 °C. Power falls about 3 % per °C of muscle temperature (Schafer et al. 2024; Bergh & Ekblom 1979);
  - **a falling core**, up to 35 % as it drops from 36 to 34.5 °C;
  - the factor never goes below 0.4, and it multiplies the ground and surface factors rather than replacing them.
- **Where the heat shows.** Not in peak core temperature. Because the pace eases, a marathon that warms from 10 to 30 °C peaks no hotter than the same marathon in constant 10 °C air — 0.01 °C lower, in fact. That is what anticipatory regulation means: the athlete gives up speed to hold temperature. The cost turns up instead as fluid lost (2.1 L against 1.5 L), as about 2 bpm on the average heart rate, and as a finish run slower than the start for the same total time.
- **Regulated core temperature.** The temperature the body regulates towards rises with metabolic rate M, in W/m². ISO 7933 uses 36.8 + 0.0036·(M − 55) °C; we use half that slope, for the same reason as before: our exchange model loses more dry heat at running speeds than ISO 7933 was validated for.
- **Skin blood flow** follows the same metabolic set point the sweating does, not a fixed 36.8 °C. A running core sits near 38 °C, so a fixed reference pinned the vasodilation drive at its ceiling at every air temperature and held mean skin within a couple of degrees of the core. Skin now answers the air: running at 3 m/s it settles at 27.4 °C in 5 °C air, 31.2 °C at 15 °C and 34.2 °C at 25 °C, which is what makes a warm day show in the pace at all.
- **Heat made in the shell.** 15 % of the heat from working muscle and from shivering is released at the skin rather than in the core. Muscle lies under the skin, and shivering is strongest in the superficial muscle. A two-node model that puts every watt in the core holds core temperature up and runs mean skin several degrees too cold in wind and rain.
- **Sweating** is capped at 400 W/m², with skin wettedness at most 0.85 (unacclimatised, ISO 7933). It follows demand with a 10-minute lag.
- **Wet clothing** loses 25 % of its own insulation when soaked, and holds 0.3 kg of water per m² per clo. A wet mid layer measured −16 % walking (Bröde et al. 2008) and casualty coverings −22 to −29 % (Jussila et al. 2014).
- **Shivering** follows core and skin temperature (Tikuisis & Giesbrecht 1999), scaled by body fat, under the ceiling Eyolfson et al. (2001) measured. Exercise barely shifts its onset, so walkers in cold rain still shiver.
- **Clothing** is chosen once, from the planned effort and the conditions at the start, not from temperature alone: the lightest step whose insulation keeps the skin comfortable for that metabolic rate, in that wind, at that speed. A shell goes on for a wet day, always on a mountain day, and for cold windy walks. The steps, in clo:
  - runners: 0.3, 0.45, 0.65, 0.9, 1.2;
  - riders: 0.4, 0.6, 0.9, 1.2, 1.6;
  - walkers and hikers: 0.5, 0.8, 1.1, 1.5, 2, 2.5;
  - mountaineering: 1.2, 1.6, 2, 2.5, 3, 3.5, so an equipped climber starting at −15 °C is dressed for the mountain from the first step and does not slow from hypothermia.

  There are no layer changes. Nobody stops to take a jacket off.
- **Drinking** replaces 30 % of sweat for runners, 50 % for riders and 60 % for walkers and hikers.
- **Warnings.** From 39 °C of core temperature the result says the heat raised the heart rate and eased the pace. Below 36 °C it says the cold slowed the pace and shivering raised the heart rate. Short of that, a cold spell that held the pace down by 3 % over ten minutes is worth its own note.

The tests hold these anchors:

- **Marathon pace at 15 °C:** the core settles between 37.5 and 38.6 °C within the hour, losing 0.4–1.2 L in that hour. Noakes et al. measured 38.9 ± 0.6 °C at the finish.
- **An hour at 30 °C in shade:** 38.2–39.5 °C, at least 0.3 °C hotter than at 15 °C, losing 0.6–1.8 L per hour; sun raises both core and skin above that (Byrne et al. 2006; Barnes et al. 2019).
- **45 minutes of cycling at 35 °C** adds 1.5–14 % to heart rate against neutral air, and more at 45 minutes than at 15. Wingo et al. (2005) measured +12 %.
- **The reference air against itself** adds no heart rate at all and leaves the speed factor at exactly 1.
- **Walking at 5 °C in wind and rain:** mean skin ends at least 8 °C below the same walk in dry calm air, heat production rises at least 20 % on shivering, and the core stays between 36 and 37.8 °C while the walking continues.
- **Cold, wet clothing** slows the pace through cold muscle, and a colder, wetter, windier day slows it further, so the effort scale stays monotone.
- **A climber at −15 °C in wind** keeps a core above 36.6 °C for three hours and never shivers.
- **ISO 9920:** insulation falls with wind and with walking, a shell keeps part of the wind out, and beyond the standard's range the correction is held rather than extrapolated.
<!-- Thermal numbers end. -->

## Effort presets in the heat

Heat never lengthens a pace or a finish time you set: the engine still meets it, and the heat shows as a faster first half and a slower finish instead. The Easy, Steady, Tempo and Race presets are different. They aim for a share of VO₂ reserve, and an easy run is the same easy run in any weather — what the weather changes is how long it takes.

<!-- Thermal numbers begin. How the presets read the weather. -->
So there is no separate heat rule for presets any more, and no WBGT term. Instead:

1. The preset is solved in a reference atmosphere: 15 °C, 60 % humidity, calm and dry, with no series. That fixes the effort.
2. The route is then covered once more at that same effort, in the weather the day actually has.
3. The time that second pass takes is what the preset reports.

Heat, wind, rain and a wet, snowy or icy surface therefore lengthen the activity, as they do in the field, rather than being compensated away to hold a time nobody chose. Wet ground, snow and wind never needed a rule of their own, and now heat doesn't either: they all make the same effort slower through the same pass.
<!-- Thermal numbers end. -->

## The barometer

A barometric altimeter can't tell a climb from a change in the weather. A pressure fall of 1 hPa reads as about 8 m of climb near sea level and about 11 m at 3000 m.

Without weather, the altitude stream carries a slow random drift for this: the drift rate wanders by 1.5 m per hour over about three hours. With a weather series, it follows the real pressure:

```
weather part = −H × ln( p(here, now) / p(here, start) )        H = R·T/g, about 8 km
```

p is the series' surface pressure at the athlete's current place, compared with the same place at the start. Climbing doesn't count as weather; only the change over time does, as if the watch had been calibrated at that spot. Pressure is interpolated between hours with a monotone cubic (Fritsch & Carlson 1980), so the recorded altitude doesn't kink on every hour.

The rest of the altimeter model is unchanged:

- height gained stretched by 0–4 %;
- slow wander;
- fast noise;
- 0.2 m steps.

A test checks that a 3 hPa pressure fall over three hours on a flat loop adds 21–28 m to the recorded altitude.

## The wrist sensor

Watches measure temperature inside the case, so the reading sits between air and skin. The Garmin fēnix 8 manual puts it plainly: "Your body temperature affects the temperature reading." The engine starts from the air temperature at the athlete, second by second:

- **On foot**, the reading settles at air + k·(wrist − air), where:
  - k = 0.55 / (1 + 0.22·air speed);
  - the wrist is the heat balance's own skin temperature, minus a tenth of the gap between skin and air, because hands and wrists vasoconstrict first in the cold;
  - the airflow is the air the athlete actually meets, their speed plus the headwind, not their speed over the ground;
  - rain wets the strap and cools it, taking up to 30 % off the coupling at 1 mm/h and above;
  - a sleeve — anything from 0.9 clo — cuts that airflow to a quarter and halves the limb's cooling.

  That's about 5 °C above the air when running at 15 °C, and more when walking or standing still.
- **On a bike**, a unit on the handlebar reads the air plus up to 1.5 °C from its electronics and the sun, less as airflow rises.
- **Response.**
  - The reading follows with a 10-minute time constant on the wrist, 5 minutes on the bar.
  - It starts up to 1.5 °C above the air and wanders by about 0.4 °C.
  - It's written in whole degrees and changes only once the value is 0.6 °C away from the shown one.

So a hiker on a windy, frozen summit reads colder than one standing in still air at the same temperature, and a soaked runner reads colder than a dry one. Cardiac drift and the heat balance still never read this stream; it is an output, not an input.

## Manual mode and pins

**Manual mode** replaces the series with constant conditions:

- temperature;
- humidity;
- wind speed, from one of eight directions;
- rain: none, light (1 mm/h), moderate (4 mm/h) or heavy (10 mm/h).

These go through the same models as a series, with three differences:

- There's no sunshine.
- Air pressure is the standard atmosphere at the route's height, so the barometer keeps its random drift.
- Manual rain starts when the activity starts. It is a statement about the hours you are out, not about the two days before, so the ground begins dry and wets as you go.

Manual conditions of 60 % humidity, no wind and no rain are the reference the whole model is calibrated against. They no longer reproduce the pre-weather engine byte for byte — one heat balance now runs in every mode — but they reproduce it closely: average heart rate within 2 bpm and average speed within 1 % on a marathon, a 10 km, a hilly run, a ride and a hike. A test holds that.

**In automatic mode** the same fields are the fallback when the weather can't be fetched. They can also be pinned. A pinned temperature (which pins humidity too), wind or rain stays at its manual value for the whole activity, while the rest of the weather keeps changing. That's how to ask "what if it hadn't rained?" about the same morning.

## Reproducibility

The engine never fetches anything. It receives the series as input, and the same route, athlete, session, seed and series produce an identical file, also after the series has been through storage.

**Storage.** Fetched series are kept in memory and in the browser's storage: the last 8 series, up to 400,000 characters. They are keyed by the rounded points, the days and the sources. Reloading a stored route and start reproduces the file even after the forecast has changed. **Update forecast** fetches a fresh one.

**When the start time matters.** With a series in use, the start time (to the minute) and its UTC offset decide whether the simulation runs again. Without one, the start time only labels the file.

**Share links.** A start time you set is saved with your preferences and carried by share links, together with its offset. Links also carry the weather mode, the manual values and the pins, so a link made in manual mode with a hand-set wind opens as that. The keys are written only when they leave the automatic, neutral default, so an ordinary link is no longer than before. What a link never carries is the series itself: whoever opens it fetches the weather again, and for a forecast that may no longer be the same weather.

## A morning in the mountains

To see everything together, we ran a mountain hike through the engine.

**The route** is synthetic, shaped like the path from Zermatt up to the Hörnli hut and down to Schwarzsee; it isn't the real trail. It starts at 1620 m near 46.02° N, 7.75° E:

- 2 km of paved lane heading south-west, +140 m;
- 3.5 km of forest path heading west, +540 m (earth, technicality 0.2);
- 2 km of open path, +283 m (earth, 0.3);
- 3 km of rocky ridge heading west-south-west, up to 3260 m (rough path, 0.4);
- a 150 m traverse, then 2.85 km down the same kind of rock, heading east-north-east, to 2583 m.

In all: 13.5 km, +1637 m and −669 m, from 1621 m to 3260 m and down to about 2590 m.

**The athlete** is the default profile: a 35-year-old man, 70 kg, 175 cm, resting heart rate 55, recreational, with a chest strap and no stops.

**The start** is 06:00 local time on 15 August 2026. The target comes from the Steady preset, as the app would set it.

**The weather** is a series with exactly the shape Open-Meteo returns. It covers the 9 points the app picks for this route (the start, every 2 km, the summit and the finish, each at its own height), hourly over four days. We wrote the values by hand:

- a clear night and warming after sunrise;
- a front with one hour of heavy rain;
- wind swinging from south-south-west to north-west.

The nine points the app picks for this route, each at its own height:

| km | 0.00 | 2.00 | 4.00 | 6.00 | 8.00 | 10.00 | 10.56 | 12.00 | 13.50 |
|---|---|---|---|---|---|---|---|---|---|
| Longitude °E | 7.7500 | 7.7300 | 7.7100 | 7.6800 | 7.6500 | 7.6300 | 7.6200 | 7.6400 | 7.6600 |
| Latitude °N | 46.0200 | 46.0100 | 46.0100 | 46.0100 | 46.0100 | 46.0000 | 46.0000 | 46.0000 | 46.0100 |
| Height, m | 1620 | 1760 | 2070 | 2370 | 2700 | 3150 | 3260 | 2940 | 2590 |

We wrote the hourly values at the lowest and the highest point and put every other point between them by height, which is what a real series looks like on a slope. Hours before 06:00 and after 12:00 hold the nearest column.

At the lowest and highest points:

| Hour ending (local) | 06 | 07 | 08 | 09 | 10 | 11 | 12 |
|---|---|---|---|---|---|---|---|
| Temperature at 1620 m, °C | 6.8 | 9.0 | 11.0 | 8.5 | 9.0 | 11.5 | 13.5 |
| Dew point at 1620 m, °C | 1.3 | 3.5 | 9.0 | 8.1 | 8.4 | 9.0 | 8.0 |
| Temperature at 3260 m, °C | −0.6 | 0.5 | 1.4 | −2.2 | −1.7 | 0.8 | 2.8 |
| Dew point at 3260 m, °C | −3.0 | −2.0 | 0.6 | −2.6 | −2.3 | −0.5 | 0.4 |
| Precipitation at 1620 / 3260 m, mm | 0 | 0 | 0.2 | 4.5 / 5.2 | 0.3 | 0 | 0 |
| Wind at 10 m at 1620 m, m/s from | 2.5 from 200° | 2.5 from 215° | 4.5 from 230° | 7 from 255° | 8 from 290° | 7 from 315° | 6 from 320° |
| Wind at 10 m at 3260 m, m/s from | 5 from 200° | 5 from 215° | 7 from 230° | 9.5 from 255° | 10.5 from 290° | 9.5 from 315° | 8.5 from 320° |
| Sunshine, W/m² | 0 | 16 | 142 | 85 | 238 | 557 | 726 |
| Cloud, % | 20 | 20 | 60 | 100 | 90 | 60 | 40 |
| Surface pressure at 3260 m, hPa | 685.6 | 686.3 | 686.6 | 682.7 | 683.4 | 686.1 | 688.3 |

### The ground, place by place

First, what the weather does to the route itself, whether anyone is on it or not. Wetness runs from 0 (dry) to 1 (fully wet) and includes mud. Ice is the share of the water film that has frozen.

| Place | 08:00 | 08:30 | 09:00 | 10:00 | 11:00 | 12:00 | 13:00 |
|---|---|---|---|---|---|---|---|
| Forest path, km 5, about 2220 m | 0.13 | 0.84 | 0.85 | 0.67 | 0.52 | 0.49 | 0.48 |
| Ridge, km 9.5, about 3030 m | 0.27 | 1, snow 0.4 cm | 1, snow 2.1 cm, ice 0.54 | 1, snow 2.3 cm, ice 0.38 | 0.98, snow 2.2 cm | 0.98, snow 1.7 cm | 1, snow 1.2 cm |
| Summit, km 10.5, 3260 m | 0.27 | 1, snow 1.4 cm, ice 0.34 | 1, snow 3.9 cm, ice 1 | 1, snow 4.2 cm, ice 0.96 | 0.81, snow 4.1 cm, ice 0.02 | 0.70, snow 3.9 cm | 0.76, snow 3.4 cm |
| Lower descent, km 13, about 2700 m | 0.27 | 1 | 1, snow 0.1 cm | 1 | 0.92 | 0.42 | 0.34 |

- The drizzle before 08:00 only dampens things.
- The heavy hour soaks every surface within half an hour.
- Above about 2900 m most of it falls as snow, and the wet rock under it freezes while the air sits near zero. The ice comes and goes gradually: a third of the film at 08:30, all of it at 09:00, and none by 12:00 as the air warms.
- After the front, meltwater keeps the summit wet.
- Lower down, the rock dries through the afternoon.
- The forest path loses its surface water quickly but keeps its mud. The 0.48 at 13:00 is soil memory, not a film.

### What the hiker meets

The columns:

- **Along the path:** the wind component at body height, positive from ahead.
- **Wet:** wetness including mud.
- **Surface:** the speed factor from wetness, snow and ice (1 = no effect).
- **Wrist:** the sensor reading.
- **Barometer:** how far the barometer has moved on pressure alone.

| Time | km | Height, m | Air, °C | Precipitation, mm/h (snow share) | Wind at 10 m | Along the path, m/s | Wet | Snow, cm | Surface | Wrist, °C | Barometer, m |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 06:00 | 0.0 | 1621 | 6.8 | — | 2.5 from 200° | +1.3 | 0 | 0 | 1.00 | 8 | 0 |
| 06:30 | 2.4 | 1817 | 6.9 | — | 2.8 from 207° | +0.8 | 0 | 0 | 1.00 | 18 | −4 |
| 07:00 | 4.0 | 2070 | 6.7 | — | 3.2 from 215° | +1.1 | 0 | 0 | 1.00 | 18 | −7 |
| 07:30 | 5.6 | 2317 | 6.1 | 0.2 | 4.5 from 224° | +1.9 | 0.07 | 0 | 1.00 | 18 | −10 |
| 08:00 | 7.1 | 2524 | 5.7 | 0.2 | 5.9 from 230° | +2.7 | 0.13 | 0 | 0.99 | 17 | −12 |
| 08:30 | 8.1 | 2720 | 2.9 | 5.0 (4 %) | 7.3 from 245° | +4.3 | 1 | 0 | 0.96 | 12 | +10 |
| 09:00 | 8.9 | 2891 | 0.2 | 5.0 (75 %) | 8.9 from 255° | +5.2 | 1 | 1.0 | 0.87 | 10 | +30 |
| 09:30 | 9.6 | 3058 | −0.6 | 0.3 (93 %) | 9.2 from 273° | +4.9 | 1 | 2.4 | 0.66 | 10 | +28 |
| 10:00 | 10.2 | 3195 | −1.3 | 0.3 (98 %) | 10.4 from 290° | +4.5 | 1 | 3.7 | 0.53 | 10 | +25 |
| 10:30 | 10.9 | 3203 | −0.1 | — | 9.7 from 302° | −3.3 | 1 | 3.8 | 0.50 | 11 | +9 |
| 11:00 | 11.8 | 2992 | 2.6 | — | 9.1 from 315° | −2.1 | 1 | 1.8 | 0.69 | 12 | −7 |
| 11:30 | 12.8 | 2742 | 5.2 | — | 8.2 from 317° | −1.7 | 0.80 | 0 | 0.80 | 13 | −19 |

- **Air.**
  - The sun rises at 06:34, when the hiker is a little over 2 km in.
  - For the first hour the warming valley keeps pace with the climb: nearly 450 m of height gained, and the air still reads 6.7–6.9 °C.
  - After that the height wins and the front arrives. The air falls to −1.3 °C at 3195 m at 10:00, with the wind at 10.4 m/s.
  - Coming down in the afternoon it is back above 5 °C.
- **Rain.** It reaches the hiker as drizzle at 07:30 and becomes the downpour at 08:30, at 2720 m. Over the next ninety minutes the snow share grows from 4 % to 98 %. The summary reads rain 07:00–10:00 with 5.5 mm, and the engine warns: “Rain made 6.3 km of the route wet, and the wet descents were about 29 % slower.”
- **Wind.** A headwind of up to 5.2 m/s along the path on the way up. After the shift to north-west it is a tailwind of 1.7–3.3 m/s on the way down.
- **Barometer.**
  - Before the front the air column warms and the pressure at height rises, so the barometer reads about 12 m low at 08:00.
  - The front then drops the pressure and the reading swings to 30 m high by 09:00.
  - As the sky clears it is 19 m low by the finish.
- **Wrist sensor.** 8 °C at the start, 17–18 °C on the lower climb, 10 °C in the snow and wind near the summit, and 11–13 °C coming down. The cold, wet, windy hour is the lowest reading of the day, which the old fixed curve could not show.

<!-- Thermal numbers begin. The example's pace, heart rate and heat balance. -->
- **Target.** The Steady preset solves an average of 0.65 m/s: 5 h 47 min of moving time. The same hike in dry, calm air at 15 °C solves 0.74 m/s and 5 h 03 min, so the weather costs three quarters of an hour. The hiker reaches the top at 10:18 and finishes at 11:46.
- **Hour by hour:**

  | Hours | Conditions | Pace | Heart rate |
  |---|---|---|---|
  | 06–07 | | 14:57/km | 127 bpm |
  | 07–08 | | 19:33/km | 132 bpm |
  | 08–09 | rain on the ridge, into the wind | 33:37/km | 129 bpm |
  | 09–10 | snow and ice | 44:41/km | 134 bpm |
  | 10–11 | over the top | 38:08/km | 105 bpm |
  | 11–finish | | 27:18/km | 95 bpm |

- **The climb** takes 259 minutes at 24:18/km and 130 bpm, against 280 minutes at 26:15/km in the dry. It is the descent that loses the time, and the preset holds the average effort over moving time: a slow, careful descent adds low-effort minutes, so the solver climbs a little harder to pay for them.
- **The descent** takes 88 minutes at 30:52/km, instead of 67 minutes at 23:35/km.
  - The first 1.35 km, icy and under fresh snow, is 51 % slower than dry: 35:28 against 23:25/km.
  - The last 1.5 km, where the rock is drying, is 13 % slower: 26:43 against 23:44/km.
  - Heart rate on the descent is 95 bpm.
- **Cadence** is 88 steps per minute on the climb against 86 in the dry, and 85 on the descent against 90.
- **Heat balance.** The core peaks at 37.6 °C and net fluid loss is 0.32 L. The highest WBGT is 7.5 °C. Nothing here is hot; what the cold does is hold the pace down through the muscles on the exposed ridge.
- **Pins** show where the time went:
  - Rain pinned to none: the climb takes 281 minutes and the descent 66 at 23:12/km — the dry day almost exactly. Rain is what this day costs.
  - Wind pinned calm: the climb takes 255 minutes but the descent 92. Drag hardly matters at hiking speed; the core ends up much the same, but without the cooling wind fluid loss rises from 0.32 to 0.41 L.
  - Temperature pinned at 15 °C: every drop falls as rain, there is no snow and no ice, and the descent takes 77 minutes at 26:52/km instead of 88 at 30:52.
<!-- Thermal numbers end. -->

## How it's tested

The weather tests check behaviour, like the rest of the engine:

**Without weather**
- The manual path, an automatic fetch that failed and a series that a manual session ignores all produce the same file, byte for byte, on five reference activities (run, ride, walk, trail run with a heart-rate target, hike). Each one's moving time, elapsed time, distance, average heart rate and ascent are pinned to measured values, so changing the engine has to be deliberate. We pin numbers rather than a hash of the output: an engine that integrates for thousands of seconds amplifies the last-bit differences between JavaScript engine versions, so a recorded hash ends up testing which version of Node is running it.
- In the reference air, those activities stay within 2 bpm of average heart rate and 1 % of average speed of the engine from before the thermal model.
- The same seed and series give identical files, also after the series has been through storage.

**Stability**
- Moving time stays within ±0.5 % of the target in rain and wind, on a 40 km ride, and through a sharp 12 mm/h shower on a 3 km run.
- Matching an average heart rate under weather leaves the distance, speed, cadence, position, altitude and temperature streams untouched.

**Wet ground**
- On repeated rocky climbs and descents with rain in the second hour:
  - descents before the rain are unchanged;
  - wet descents are more than 15 % slower;
  - the slowdown shrinks, but lasts while the rock dries.
- A road still wet from rain before the start lowers a ride's top descent speed below 95 % of dry, while the average speed holds.
- Surface state on its own:
  - 4 mm/h wets pavement fully within 10 minutes;
  - after an hour of rain a road dries in about an hour in sun, over several hours when overcast, and not at all on a humid night;
  - a trail keeps its mud after the film has dried;
  - 4 mm of water at −4 °C gives 4–6.5 cm of snow;
  - a wet film freezes gradually: nothing at +1 °C, a fifth to a half at 0 °C, and more as it cools further.

**Wind, pressure and air**
- On an out-and-back run with an 8 m/s easterly at 10 m, the tailwind half is 5–25 % faster than the headwind half.
- A 3 hPa pressure fall over three hours adds 21–28 m of recorded altitude.
- On a 6 km climb at 15 %, the air at the athlete cools by more than 5.5 °C over the 900 m of height.
- An activity that outlasts its series says so.

**Heat and cold**
- A marathon that warms from 10 to 30 °C, against the same run in constant 10 °C air: the heart-rate gap is small at 45 minutes (2.3 bpm), grows through the run (2.5 bpm at 1.25 h against 3.4 bpm at 3.5 h) and shows over the whole run (2.2 bpm on the average). The pace eases with it, the finish is slower relative to the start, and fluid loss is 2.1 L against 1.5 L. Peak core is not asserted, because the warmer day peaks no higher.
- Ninety minutes at a steady 3 m/s drifts more in warm air than in cool, by more than 3 bpm: 14.1 bpm at 25 °C against 9.8 at 10 °C.
- A 10 km at 25 °C is 2.4 % slower than the same race in the reference air, inside the 2–4 % that marathon and shorter-race field data put on a half-hour effort.

**Sensor and manual mode**
- In warming air, the wrist sensor reads more than 12 °C higher at the end than early on.
- Manual wind and rain run through the same models as a series.

## What's still a guess

These numbers need real data the most:

- **Wet, muddy, snowy and icy ground.**
  - How much it slows people: the level and descent losses, the ice factors, and how snow's cost splits between speed and oxygen. Grip on wet surfaces has measurements behind it; speed losses on real trails don't.
  - The ice rule: any film of 0.05 mm at or below 0 °C air is ice, and it thaws the moment the air goes above zero.
- **Drying.** Penman evaporation with net radiation taken as 0.92 × sunshine − 40 W/m², and soil memory times of 6–36 hours.
- **Wind.**
  - The tailwind share of 0.6, between Davies (about a third) and Yamashita et al. (more than the headwind cost).
  - One wind reduction for everywhere: forests, streets and exposed ridges all get 59 % of the 10 m wind.
- **Riding.** A rider's extra power into a headwind, and descent speeds 20 % lower on wet roads.
<!-- Thermal numbers begin. Guesses in the heat balance. -->
- **Heat balance.**
  - Clothing, chosen once from the planned effort and the start, and never changed. Nobody puts a jacket on halfway.
  - The sweating set point at half the ISO 7933 slope, and the 15 % of muscle and shivering heat released in the shell.
  - **The cold core trajectory.** Thompson & Hayward (1996) walked people in 5 °C rain and wind and watched core temperature fall from 38.1 °C to 36.4 °C over six hours, with heat production up 40 %. Ours holds the core near 37 °C and reaches 32 %. The skin, the shivering and the slowing are right in direction and size; the slow drain of the core is not there yet, so a really long, cold, wet day is gentler in Runsketch than in the field.
  - **Riding in the heat.** Time trials lose 13–16 % of their power in the heat (Périard et al. 2011; Racinais et al. 2015). Ours loses less than that, and the ride slope has not been re-fitted since skin started answering the air.
  - **The heat→heart-rate coupling.** It rests almost entirely on the fluid deficit against the neutral reference, and 9 % of heart rate per 1 % of body mass sits above the 5–8 bpm measured directly. It is set there because the reference sweats too, which shrinks the difference a warm day shows. Whether one coefficient on the fluid deficit should carry the whole coupling is the open question; core temperature and skin blood flow both move now, and either could take a share of it.
<!-- Thermal numbers end. -->
- **Wrist sensor.** Its coupling and time constants, how far the wrist runs below mean skin, and how much a wet strap and a sleeve change the reading.
- **Air near the ground.** Constant lapse rates, so no cold pools in valleys at dawn and no inversions beyond what the weather model itself contains.
- **Timing and far dates.** Rain spread evenly over its hour, and one past year standing in for a far date.

The best check would be recordings from hilly routes on days with changing weather: the same trail wet and dry, a descent before and after a shower, and a watch's temperature and altitude through a front. Comparing them with what Runsketch produces for the same route, date and pace would show which of these guesses matter.

## References

Weather data

- Open-Meteo. Free weather API. https://open-meteo.com. Terms: https://open-meteo.com/en/terms. Licence: https://open-meteo.com/en/license (CC BY 4.0, https://creativecommons.org/licenses/by/4.0/).
- Hersbach H, Bell B, Berrisford P et al. The ERA5 global reanalysis. *Q J R Meteorol Soc* 146:1999–2049, 2020. https://doi.org/10.1002/qj.3803
- Muñoz-Sabater J et al. ERA5-Land: a state-of-the-art global reanalysis dataset for land applications. *Earth Syst Sci Data* 13:4349–4383, 2021. https://doi.org/10.5194/essd-13-4349-2021
- Copernicus Climate Change Service (C3S), Climate Data Store. https://cds.climate.copernicus.eu

Time, sun and the field

- NOAA Global Monitoring Laboratory. Solar calculation details. https://gml.noaa.gov/grad/solcalc/calcdetails.html
- Meeus J. *Astronomical Algorithms*. Willmann-Bell, 1991.
- Fritsch FN, Carlson RE. Monotone piecewise cubic interpolation. *SIAM J Numer Anal* 17:238–246, 1980. https://doi.org/10.1137/0717021
- World Meteorological Organization. *Guide to Instruments and Methods of Observation* (WMO-No. 8), 2018.
- Stull R. Wet-bulb temperature from relative humidity and air temperature. *J Appl Meteorol Climatol* 50:2267–2269, 2011. https://doi.org/10.1175/JAMC-D-11-0143.1
- Jennings KS, Winchell TS, Livneh B, Molotch NP. Spatial variation of the rain–snow temperature threshold across the Northern Hemisphere. *Nat Commun* 9:1148, 2018. https://doi.org/10.1038/s41467-018-03629-7

Wind

- Harper BA, Kepert JD, Ginger JD. Guidelines for converting between various wind averaging periods in tropical cyclone conditions. WMO/TD-1555, 2010. https://www.systemsengineeringaustralia.com.au/download/WMO_TC_Wind_Averaging_27_Aug_2010.pdf
- da Silva ES, Kram R, Hoogkamer W. *J Appl Physiol*, 2022. https://doi.org/10.1152/japplphysiol.00086.2022
- Davies CTM. Effects of wind assistance and resistance on the forward motion of a runner. *J Appl Physiol* 48:702–709, 1980. https://doi.org/10.1152/jappl.1980.48.4.702
- Yamashita S, Ly A, Smallcombe J, Hodder S, Havenith G. *J Appl Physiol*, 2024. https://doi.org/10.1152/japplphysiol.00159.2024
- di Prampero PE. The energy cost of human locomotion on land and in water. *Int J Sports Med* 7:55–72, 1986.
- Martin JC, Milliken DL, Cobb JE, McFadden KL, Coggan AR. Validation of a mathematical model for road cycling power. *J Appl Biomech* 14:276–291, 1998. https://journals.humankinetics.com/view/journals/jab/14/3/article-p276.xml

Surfaces, snow and ice

- Crevier LP, Delage Y. METRo: a new model for road-condition forecasting in Canada. *J Appl Meteorol* 40:2026–2037, 2001. https://doi.org/10.1175/1520-0450(2001)040<2026:MANMFR>2.0.CO;2
- RoadSurf road weather model, version 1.1. *Geosci Model Dev* 17:4837, 2024. https://gmd.copernicus.org/articles/17/4837/2024/
- Penman HL. Natural evaporation from open water, bare soil and grass. *Proc R Soc Lond A* 193:120–145, 1948. https://doi.org/10.1098/rspa.1948.0037
- Allen RG, Pereira LS, Raes D, Smith M. *Crop evapotranspiration*. FAO Irrigation and Drainage Paper 56, 1998. https://www.fao.org/4/x0490e/x0490e00.htm
- Hedstrom NR, Pomeroy JW. Measurements and modelling of snow interception in the boreal forest. *Hydrol Process* 12:1611–1625, 1998. https://doi.org/10.1002/(SICI)1099-1085(199808/09)12:10/11<1611::AID-HYP684>3.0.CO;2-4
- Hock R. Temperature index melt modelling in mountain areas. *J Hydrol* 282:104–115, 2003. https://doi.org/10.1016/S0022-1694(03)00257-9
- Pandolf KB, Haisman MF, Goldman RF. Metabolic energy expenditure and terrain coefficients for walking on snow. *Ergonomics* 19:683–690, 1976. https://doi.org/10.1080/00140137608931583
- Cham R, Redfern MS. Changes in gait when anticipating slippery floors. *Gait Posture* 15:159–171, 2002. https://doi.org/10.1016/S0966-6362(01)00150-3
- Manning DP, Jones C. *Appl Ergon* 32, 2001. https://doi.org/10.1016/S0003-6870(00)00055-7
- Rene Herse Cycles. The science of tire tread. https://www.renehersecycles.com/the-science-of-tire-tread/

Heat balance and heart rate

- Gagge AP, Fobelets AP, Berglund LG. A standard predictive index of human response to the thermal environment. *ASHRAE Trans* 92(2B), 1986.
- Malchaire J et al. Development and validation of the predicted heat strain model. *Ann Occup Hyg* 45:123–135, 2001. https://doi.org/10.1093/annhyg/45.2.123
- ISO 7933:2023. Ergonomics of the thermal environment: analytical determination and interpretation of heat stress using calculation of the predicted heat strain.
- Arens E, Hoyt T, Zhou X, Huang L, Zhang H, Schiavon S. Modeling the comfort effects of short-wave solar radiation indoors. *Build Environ* 88:3–9, 2015. https://doi.org/10.1016/j.buildenv.2014.09.004
- Brimicombe C et al. thermofeel: a python thermal comfort indices library. *SoftwareX* 18:101005, 2022. https://doi.org/10.1016/j.softx.2022.101005
- González-Alonso J et al. *J Appl Physiol* 82:1229–1236, 1997. https://doi.org/10.1152/jappl.1997.82.4.1229
- González-Alonso J et al. *Am J Physiol Heart Circ Physiol* 278:H321–H330, 2000. https://doi.org/10.1152/ajpheart.2000.278.2.H321
- Noakes TD et al. *Med Sci Sports Exerc* 23:443–449, 1991. https://doi.org/10.1249/00005768-199104000-00009
- Byrne C et al. *Med Sci Sports Exerc* 38:803–810, 2006. https://doi.org/10.1249/01.mss.0000218134.74238.6a
- Barnes KA et al. *J Sports Sci*, 2019. https://doi.org/10.1080/02640414.2019.1633159
- Wingo JE, Lafrenz AJ, Ganio MS, Edwards GL, Cureton KJ. *Med Sci Sports Exerc* 37:248–255, 2005. https://pubmed.ncbi.nlm.nih.gov/15692320/

Effort presets

- Ely MR, Cheuvront SN, Roberts WO, Montain SJ. Impact of weather on marathon-running performance. *Med Sci Sports Exerc* 39:487–493, 2007. https://doi.org/10.1249/mss.0b013e31802d3aba
- Mantzios K et al. *Med Sci Sports Exerc* 54:153–161, 2022. https://doi.org/10.1249/MSS.0000000000002769

Barometer and wrist sensor

- Sánchez & Villena. Barometric and GPS altitude in mountain efforts. *Proc Inst Mech Eng P*, 2020. https://doi.org/10.1177/1754337120918975
- Garmin. fēnix 8 owner's manual: temperature sensor. https://www8.garmin.com/manuals/webhelp/GUID-EECCAC99-90D6-4AB1-9A3A-EC433D3365E2/EN-US/GUID-6E06604B-869D-4F27-9BD0-4916C177E215.html
