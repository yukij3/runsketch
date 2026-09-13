import { TriangleAlert } from 'lucide-react';
import { useActions, useApp, useT } from '../../app/runtime';
import { localizeWarning } from '../../app/warnings';
import { precipitationText, temperatureIn } from '../../app/weatherText';
import { formatDecimal, formatDistance, formatDuration, formatElevation, formatPace, formatSpeed } from '../../lib/format';
import { DataRow, Section, cx } from '../controls';
import { unitLabels } from '../units';

const whole = (v: number) => (Number.isFinite(v) && v > 0 ? String(Math.round(v)) : '–');

function useBusy() {
  return useApp((s) => s.routing.state === 'busy' || s.terrain.state === 'busy' || s.sim.state === 'busy');
}

export function ResultSection() {
  const t = useT();
  const lang = useApp((s) => s.lang);
  const units = useApp((s) => s.units);
  const sim = useApp((s) => s.sim);
  const count = useApp((s) => s.waypoints.length);
  const busy = useBusy();
  const u = unitLabels(units, t);
  const summary = sim.result?.summary;
  const ride = sim.activity === 'ride';
  // Mountaineering is too slow for a pace per km to read; it shows speed like a ride.
  const speed = ride || sim.activity === 'alpine';
  const warnings = sim.result?.warnings ?? [];
  const weather = sim.result?.weather;

  let note = '';
  if (!summary) note = count < 2 ? t('resultEmpty') : sim.state === 'error' ? t('statusSimFailed', { message: sim.error ?? '' }) : t('resultPending');

  return (
    <Section id="result" title={t('sectionResult')} busy={busy}>
      {!summary ? (
        <p className="sheet-note">{note}</p>
      ) : (
        <dl className={cx('table', busy && 'is-stale')}>
          <DataRow label={t('movingTime')} value={formatDuration(summary.moving)} />
          <DataRow label={t('elapsedTime')} value={formatDuration(summary.elapsed)} />
          {speed ? (
            <DataRow label={t('avgSpeed')} value={formatSpeed(summary.avgSpeed, units, 1, lang)} unit={u.speed} />
          ) : (
            <DataRow label={t('avgPace')} value={formatPace(summary.avgSpeed, units)} unit={u.pace} />
          )}
          <DataRow label={t('avgHr')} value={whole(summary.avgHr)} unit={t('unit_bpm')} />
          <DataRow label={t('peakHr')} value={whole(summary.maxHr)} unit={t('unit_bpm')} />
          {sim.result?.impliedVo2max !== undefined ? (
            <DataRow label={t('impliedVo2max')} value={formatDecimal(sim.result.impliedVo2max, 1, lang)} unit={t('unit_vo2')} />
          ) : null}
          <DataRow label={t('avgCadence')} value={whole(summary.avgCadence)} unit={t(ride ? 'unit_rpm' : 'unit_spm')} />
          {ride ? <DataRow label={t('avgPower')} value={whole(summary.avgPower)} unit={t('unit_w')} /> : null}
          <DataRow label={t('recordedAscent')} value={formatElevation(summary.ascent, units)} unit={u.elevation} />
          {!ride && summary.maxEle !== undefined ? <DataRow label={t('maxAltitude')} value={formatElevation(summary.maxEle, units)} unit={u.elevation} /> : null}
          {!ride && (summary.climbRate ?? 0) > 0 ? (
            <DataRow label={t('climbRate')} value={formatElevation(summary.climbRate ?? 0, units)} unit={t(units === 'metric' ? 'unit_mh' : 'unit_fth')} />
          ) : null}
          <DataRow label={t('calories')} value={whole(summary.calories)} unit={t('unit_kcal')} />
          {weather ? <WeatherResultRows /> : null}
        </dl>
      )}
      {warnings.length > 0 ? (
        <div className="notes">
          <h3 className="subhead">{t('modelNotes')}</h3>
          <ul>
            {warnings.map((w) => (
              <li key={w} className="notes__item">
                <TriangleAlert size={14} strokeWidth={1.75} aria-hidden="true" />
                <span>{localizeWarning(lang, w)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Section>
  );
}

/** What the weather gave the athlete: air temperature range, precipitation and the peak core temperature. */
function WeatherResultRows() {
  const t = useT();
  const lang = useApp((s) => s.lang);
  const units = useApp((s) => s.units);
  const weather = useApp((s) => s.sim.result?.weather);
  if (!weather) return null;
  const u = unitLabels(units, t);
  const degrees = (c: number) => String(Math.round(temperatureIn(c, units))).replace('-', '−');
  const lo = degrees(weather.airTempMin);
  const hi = degrees(weather.airTempMax);
  const wet = weather.rainMm >= 0.05;
  return (
    <>
      <DataRow label={t('result_airTemp')}>
        <span className="num">{lo === hi ? hi : `${lo}…${hi}`}</span>
        <span className="unit">{u.temperature}</span>
      </DataRow>
      {wet ? (
        <DataRow label={t('result_rain')} value={precipitationText(weather.rainMm, lang)} unit={t('unit_mm')} />
      ) : (
        <DataRow label={t('result_rain')} value={t('weatherDry')} text />
      )}
      {Number.isFinite(weather.coreTempMax) ? (
        <DataRow label={t('result_coreTemp')} value={formatDecimal(temperatureIn(weather.coreTempMax, units), 1, lang)} unit={u.temperature} />
      ) : null}
    </>
  );
}

export function SplitsSection() {
  const t = useT();
  const actions = useActions();
  const units = useApp((s) => s.units);
  const lang = useApp((s) => s.lang);
  const result = useApp((s) => s.sim.result);
  const activity = useApp((s) => s.sim.activity);
  const lapDistance = useApp((s) => s.session.lapDistance);
  const busy = useBusy();
  const u = unitLabels(units, t);
  const laps = result?.summary.laps ?? [];
  const ride = activity === 'ride' || activity === 'alpine';

  return (
    <Section id="splits" title={t('sectionSplits')} busy={busy}>
      {laps.length === 0 ? (
        <p className="sheet-note">{t('splitsEmpty')}</p>
      ) : (
        <table className={cx('splits', busy && 'is-stale')} onMouseLeave={() => actions.setPlayhead(null)}>
          <caption className="sr-only">{t('splitsCaption', { unit: u.distance })}</caption>
          <thead>
            <tr>
              <th scope="col">{t('col_lap')}</th>
              <th scope="col">
                {ride ? t('col_speed') : t('col_pace')} <span className="unit">{ride ? u.speed : u.pace}</span>
              </th>
              <th scope="col">
                {t('col_hr')} <span className="unit">{t('unit_bpm')}</span>
              </th>
              <th scope="col">
                {t('col_elev')} <span className="unit">{u.elevation}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {laps.map((lap, i) => {
              const partial = Math.abs(lap.distance - lapDistance) > 10;
              return (
                <tr key={lap.startIndex} onMouseEnter={() => actions.setPlayhead(lap.startIndex)}>
                  <th scope="row" className="num">
                    {i + 1}
                    {partial ? <span className="splits__part"> · {formatDistance(lap.distance, units, 2, lang)}</span> : null}
                  </th>
                  <td className="num">{ride ? formatSpeed(lap.avgSpeed, units, 1, lang) : formatPace(lap.avgSpeed, units)}</td>
                  <td className="num">{whole(lap.avgHr)}</td>
                  <td className="num">
                    +{formatElevation(lap.ascent, units)} −{formatElevation(lap.descent, units)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </Section>
  );
}
