// Weather in the session sheet: automatic or manual, what the fetched weather gave the athlete, the fallback and pins,
// and the manual conditions.
import { useActions, useApp, useT } from '../../app/runtime';
import { defaultWeatherSettings } from '../../app/state';
import { COMPASS, compassDegrees, compassPoint, weatherSourceText, weatherSummaryText, type CompassPoint } from '../../app/weatherText';
import type { WeatherPin, WeatherSettings } from '../../lib/types';
import { FieldRow, NumberField, Segmented, cx } from '../controls';
import { cToF, fToC, unitLabels, windFromDisplay, windToDisplay } from '../units';

const DEFAULT_WEATHER: WeatherSettings = defaultWeatherSettings();
const PINS: readonly WeatherPin[] = ['temperature', 'wind', 'precipitation'];
/** Manual rain choices, mm/h. */
const RAIN_LEVELS = [
  ['none', 0],
  ['light', 1],
  ['moderate', 4],
  ['heavy', 10],
] as const;

type RainLevel = (typeof RAIN_LEVELS)[number][0];

function nearestRain(mmH: number): RainLevel {
  let best: (typeof RAIN_LEVELS)[number] = RAIN_LEVELS[0];
  for (const level of RAIN_LEVELS) if (Math.abs(level[1] - mmH) < Math.abs(best[1] - mmH)) best = level;
  return best[0];
}

export function WeatherRows() {
  const t = useT();
  const actions = useActions();
  const settings = useApp((s) => s.session.weather) ?? DEFAULT_WEATHER;
  const failed = useApp((s) => s.weather.state === 'error');
  const auto = settings.mode === 'auto';
  // Manual values show in manual mode, when automatic weather fell back to them, and for pinned quantities.
  const shows = (pin: WeatherPin) => !auto || failed || settings.pinned.includes(pin);

  return (
    <>
      <FieldRow label={t('weather')} labelId="rs-weather-label" stacked>
        <Segmented
          fill
          labelledBy="rs-weather-label"
          value={settings.mode}
          onChange={(mode) => actions.setWeatherMode(mode)}
          options={[
            { value: 'auto', label: t('weather_auto') },
            { value: 'manual', label: t('weather_manual') },
          ]}
        />
        {auto ? <WeatherStatusLine /> : null}
        {auto ? <PinToggles pinned={settings.pinned} /> : null}
      </FieldRow>
      {shows('temperature') ? <TemperatureRows /> : null}
      {shows('wind') ? <WindRow /> : null}
      {shows('precipitation') ? <RainRow /> : null}
    </>
  );
}

function fetchedClock(fetchedAt: number): string {
  const d = new Date(fetchedAt);
  const today = new Date().toDateString() === d.toDateString();
  return today
    ? d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function WeatherStatusLine() {
  const t = useT();
  const actions = useActions();
  const status = useApp((s) => s.weather);
  const summary = useApp((s) => s.sim.result?.weather);
  const stale = useApp((s) => s.sim.state === 'busy');
  const startTime = useApp((s) => s.session.startTime);
  const utcOffsetMin = useApp((s) => s.session.utcOffsetMin);
  const units = useApp((s) => s.units);

  if (status.state === 'busy') {
    return (
      <p className="weather-status" role="status">
        {t('weatherLoading')}
      </p>
    );
  }
  if (status.state === 'error') {
    const key = status.error === 'offline' ? 'weatherOffline' : status.error === 'rate-limit' ? 'weatherRateLimited' : 'weatherFailed';
    return (
      <p className="weather-status is-error" role="status">
        {t(key)}{' '}
        <button type="button" className="link-btn" onClick={actions.retryWeather}>
          {t('retry')}
        </button>
      </p>
    );
  }
  const series = status.state === 'done' ? status.series : null;
  if (!series) {
    return <p className="weather-status">{t('weatherIdle')}</p>;
  }
  return (
    <div className="weather-status" role="status">
      <p className={cx('weather-status__summary', stale && 'is-stale-text')}>
        {summary?.source ? weatherSummaryText(units, summary, startTime, utcOffsetMin) : t('resultPending')}
      </p>
      <p className="weather-status__source">
        {weatherSourceText(series.source, series.analogYear)}
        {series.source === 'forecast' ? (
          <>
            {' · '}
            {t('weatherFetched', { time: fetchedClock(series.fetchedAt) })}{' '}
            <button type="button" className="link-btn" onClick={actions.refreshWeather}>
              {t('weatherUpdate')}
            </button>
          </>
        ) : null}
      </p>
    </div>
  );
}

function PinToggles({ pinned }: { pinned: readonly WeatherPin[] }) {
  const t = useT();
  const actions = useActions();
  return (
    <div className="weather-pins">
      <span className="weather-pins__label" id="rs-weather-pins">
        {t('weatherPins')}
      </span>
      <div className="pin-group" role="group" aria-labelledby="rs-weather-pins">
        {PINS.map((pin) => (
          <button
            key={pin}
            type="button"
            className="pin-group__btn"
            aria-pressed={pinned.includes(pin)}
            title={t('weatherPinTitle')}
            onClick={() => actions.toggleWeatherPin(pin)}
          >
            {t(`pin_${pin}`)}
          </button>
        ))}
      </div>
    </div>
  );
}

function TemperatureRows() {
  const t = useT();
  const actions = useActions();
  const temperatureC = useApp((s) => s.session.temperatureC);
  const humidity = useApp((s) => (s.session.weather ?? DEFAULT_WEATHER).manual.humidityPct);
  const units = useApp((s) => s.units);
  const u = unitLabels(units, t);
  const range = (min: number, max: number) => t('invalidNumber', { min, max });
  return (
    <>
      <FieldRow label={t('temperature')} htmlFor="rs-temperature">
        {units === 'metric' ? (
          <NumberField
            id="rs-temperature"
            value={Math.round(temperatureC)}
            min={-30}
            max={45}
            unit={u.temperature}
            invalidText={range(-30, 45)}
            onCommit={(value) => actions.updateSession({ temperatureC: value })}
          />
        ) : (
          <NumberField
            id="rs-temperature"
            value={Math.round(cToF(temperatureC))}
            min={-22}
            max={113}
            unit={u.temperature}
            invalidText={range(-22, 113)}
            onCommit={(f) => actions.updateSession({ temperatureC: fToC(f) })}
          />
        )}
      </FieldRow>
      <FieldRow label={t('humidity')} htmlFor="rs-humidity">
        <NumberField
          id="rs-humidity"
          value={Math.round(humidity)}
          min={1}
          max={100}
          unit={t('unit_pct')}
          invalidText={range(1, 100)}
          onCommit={(humidityPct) => actions.updateManualWeather({ humidityPct })}
        />
      </FieldRow>
    </>
  );
}

function WindRow() {
  const t = useT();
  const actions = useActions();
  const manual = useApp((s) => (s.session.weather ?? DEFAULT_WEATHER).manual);
  const units = useApp((s) => s.units);
  const u = unitLabels(units, t);
  const max = units === 'metric' ? 200 : 125;
  return (
    <FieldRow label={t('wind')} htmlFor="rs-wind">
      <select
        className="select select--compact"
        aria-label={t('windFrom')}
        value={compassPoint(manual.windFromDeg)}
        onChange={(e) => actions.updateManualWeather({ windFromDeg: compassDegrees(e.target.value as CompassPoint) })}
      >
        {COMPASS.map((point) => (
          <option key={point} value={point}>
            {t(`dir_${point}`)}
          </option>
        ))}
      </select>
      <NumberField
        id="rs-wind"
        value={Math.round(windToDisplay(manual.windMps, units))}
        min={0}
        max={max}
        unit={u.speed}
        invalidText={t('invalidNumber', { min: 0, max })}
        onCommit={(value) => actions.updateManualWeather({ windMps: windFromDisplay(value, units) })}
      />
    </FieldRow>
  );
}

function RainRow() {
  const t = useT();
  const actions = useActions();
  const rain = useApp((s) => (s.session.weather ?? DEFAULT_WEATHER).manual.rainMmH);
  return (
    <FieldRow label={t('rain')} htmlFor="rs-rain">
      <select
        id="rs-rain"
        className="select select--compact"
        value={nearestRain(rain)}
        onChange={(e) => {
          const level = RAIN_LEVELS.find(([name]) => name === e.target.value);
          if (level) actions.updateManualWeather({ rainMmH: level[1] });
        }}
      >
        {RAIN_LEVELS.map(([name, mmH]) => (
          <option key={name} value={name}>
            {mmH > 0 ? `${t(`rain_${name}`)} · ${mmH} ${t('unit_mmh')}` : t(`rain_${name}`)}
          </option>
        ))}
      </select>
    </FieldRow>
  );
}
