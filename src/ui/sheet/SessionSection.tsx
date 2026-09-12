import { Dices } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { routeCoords } from '../../app/pipeline';
import { useActions, useApp, useT } from '../../app/runtime';
import { ACTIVITIES } from '../../app/state';
import { formatDecimal, parseClock } from '../../lib/format';
import { polylineLength } from '../../lib/geo';
import { EFFORT_PRESETS, PRESET_GOALS, defaultSession, type EffortPreset } from '../../lib/sim';
import type { ActivityType, GpsNoiseLevel, PacingStrategy, StopsLevel, TargetSpec } from '../../lib/types';
import { FieldRow, IconButton, NumberField, Section, Segmented, ValueField } from '../controls';
import { KM_PER_MI, cToF, fToC, formatHms, formatMss, toDateTimeLocal, unitLabels } from '../units';

const PACING: PacingStrategy[] = ['even', 'negative', 'positive'];
const STOPS: StopsLevel[] = ['none', 'few', 'urban'];
const GPS: GpsNoiseLevel[] = ['off', 'low', 'normal', 'high'];

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function movingSeconds(target: TargetSpec, distance: number): number | null {
  if (target.kind === 'duration') return target.seconds;
  if (!(distance > 0)) return null;
  return target.kind === 'pace' ? (distance * target.secPerKm) / 1000 : distance / target.mps;
}

/** Converts the target to another kind, keeping the implied moving time when the route length is known. */
export function convertTarget(target: TargetSpec, kind: TargetSpec['kind'], distance: number, type: ActivityType): TargetSpec {
  if (target.kind === kind) return target;
  const moving = movingSeconds(target, distance);
  if (kind === 'duration') return { kind, seconds: Math.round(moving ?? 3600) };
  const mps =
    target.kind === 'speed' ? target.mps : target.kind === 'pace' ? 1000 / target.secPerKm : moving && distance > 0 ? distance / moving : null;
  const fallback = defaultSession(type, 0).target;
  if (kind === 'pace') {
    if (mps) return { kind, secPerKm: clamp(Math.round(1000 / mps), 60, 3600) };
    return fallback.kind === 'pace' ? fallback : { kind, secPerKm: 330 };
  }
  if (mps) return { kind, mps: clamp(mps, 0.5, 25) };
  return fallback.kind === 'speed' ? fallback : { kind, mps: 25 / 3.6 };
}

function TargetRow() {
  const t = useT();
  const actions = useActions();
  const session = useApp((s) => s.session);
  const units = useApp((s) => s.units);
  const lang = useApp((s) => s.lang);
  const terrainDistance = useApp((s) => s.terrain.profile?.totalDistance);
  const waypoints = useApp((s) => s.waypoints);
  const legs = useApp((s) => s.legs);
  const profile = useApp((s) => s.profile);
  const drawnDistance = useMemo(() => {
    const coords = routeCoords({ waypoints, profile, legs });
    return coords ? polylineLength(coords) : 0;
  }, [waypoints, profile, legs]);
  const distance = terrainDistance ?? drawnDistance;

  const u = unitLabels(units, t);
  const ride = session.type === 'ride';
  const target = session.target;
  const kinds: Array<TargetSpec['kind']> = ride ? ['speed', 'duration'] : ['pace', 'duration'];
  if (!kinds.includes(target.kind)) kinds.unshift(target.kind);
  const perUnit = units === 'metric' ? 1 : KM_PER_MI;
  const speedFactor = units === 'metric' ? 3.6 : 3600 / 1609.344;
  const set = (next: TargetSpec) => actions.updateSession({ target: next });

  let field;
  if (target.kind === 'pace') {
    field = (
      <ValueField<number>
        id="rs-target-value"
        ariaLabel={t('target_pace')}
        value={target.secPerKm}
        format={(v) => formatMss(v * perUnit)}
        parse={(text) => {
          const s = parseClock(text);
          return s !== null && s >= 90 && s <= 3600 ? s / perUnit : null;
        }}
        step={(v, dir, big) => clamp(v + (dir * (big ? 60 : 5)) / perUnit, 90 / perUnit, 3600 / perUnit)}
        onCommit={(secPerKm) => set({ kind: 'pace', secPerKm })}
        invalidText={t('invalidPace')}
        unit={u.pace}
        inputMode="text"
      />
    );
  } else if (target.kind === 'speed') {
    field = (
      <ValueField<number>
        id="rs-target-value"
        ariaLabel={t('target_speed')}
        value={target.mps}
        format={(v) => formatDecimal(v * speedFactor, 1, lang)}
        parse={(text) => {
          const v = Number(text.trim().replace(',', '.'));
          return text.trim() !== '' && Number.isFinite(v) && v >= 1 && v <= 90 ? v / speedFactor : null;
        }}
        step={(v, dir, big) => clamp(v + (dir * (big ? 5 : 0.5)) / speedFactor, 1 / speedFactor, 90 / speedFactor)}
        onCommit={(mps) => set({ kind: 'speed', mps })}
        invalidText={t('invalidSpeed')}
        unit={u.speed}
        inputMode="decimal"
      />
    );
  } else {
    field = (
      <ValueField<number>
        id="rs-target-value"
        ariaLabel={t('target_duration')}
        value={target.seconds}
        format={formatHms}
        parse={(text) => {
          const s = parseClock(text);
          return s !== null && s >= 10 && s <= 7 * 86400 ? s : null;
        }}
        step={(v, dir, big) => clamp(v + dir * (big ? 600 : 60), 60, 7 * 86400)}
        onCommit={(seconds) => set({ kind: 'duration', seconds })}
        invalidText={t('invalidDuration')}
        width="md"
        inputMode="text"
      />
    );
  }

  return (
    <FieldRow label={t('target')} htmlFor="rs-target-kind" stacked>
      <div className="target">
        <select
          id="rs-target-kind"
          className="select"
          value={target.kind}
          onChange={(e) => set(convertTarget(target, e.target.value as TargetSpec['kind'], distance, session.type))}
        >
          {kinds.map((k) => (
            <option key={k} value={k}>
              {t(`target_${k}`)}
            </option>
          ))}
        </select>
        {field}
      </div>
    </FieldRow>
  );
}

// Effort presets solve the target for this route and athlete (the pipeline applies the solved value).
function PresetRow() {
  const t = useT();
  const actions = useActions();
  const preset = useApp((s) => s.effortPreset);
  const type = useApp((s) => s.session.type);
  const goals = PRESET_GOALS[type];
  return (
    <FieldRow label={t('effortPreset')} labelId="rs-preset-label" stacked>
      <Segmented<EffortPreset>
        fill
        size="sm"
        labelledBy="rs-preset-label"
        value={preset ?? ('' as EffortPreset)}
        onChange={(next) => actions.setEffortPreset(next)}
        options={EFFORT_PRESETS.map((p) => ({ value: p, label: t(`preset_${p}`), title: t('presetTitle', { pct: Math.round(goals[p] * 100) }) }))}
      />
    </FieldRow>
  );
}

function NameField() {
  const t = useT();
  const actions = useActions();
  const name = useApp((s) => s.session.name);
  const [text, setText] = useState(name);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(name);
  }, [name]);
  return (
    <input
      id="rs-name"
      className="input input--wide"
      type="text"
      value={text}
      maxLength={120}
      onFocus={() => {
        focused.current = true;
      }}
      onChange={(e) => {
        setText(e.target.value);
        if (e.target.value.trim()) actions.setName(e.target.value);
      }}
      onBlur={() => {
        focused.current = false;
        if (!text.trim()) actions.setName('');
      }}
      aria-describedby={undefined}
      placeholder={t('name')}
    />
  );
}

export function SessionSection() {
  const t = useT();
  const actions = useActions();
  const session = useApp((s) => s.session);
  const units = useApp((s) => s.units);
  const u = unitLabels(units, t);
  const metric = units === 'metric';
  const variabilityWord = session.variability < 0.2 ? 'steady' : session.variability < 0.55 ? 'natural' : 'uneven';
  const range = (min: number, max: number) => t('invalidNumber', { min, max });

  return (
    <Section id="session" title={t('sectionSession')}>
      <div className="table">
        <FieldRow label={t('activity')} labelId="rs-activity-label" stacked>
          <Segmented
            fill
            labelledBy="rs-activity-label"
            value={session.type}
            onChange={(type) => actions.updateSession({ type })}
            options={ACTIVITIES.map((a) => ({ value: a, label: t(`activity_${a}`) }))}
          />
        </FieldRow>
        <FieldRow label={t('name')} htmlFor="rs-name" stacked>
          <NameField />
        </FieldRow>
        <FieldRow label={t('start')} htmlFor="rs-start">
          <input
            id="rs-start"
            className="input input--datetime num"
            type="datetime-local"
            value={toDateTimeLocal(session.startTime)}
            onChange={(e) => {
              const d = new Date(e.target.value);
              if (!Number.isNaN(d.getTime())) actions.updateSession({ startTime: d.getTime(), utcOffsetMin: -d.getTimezoneOffset() });
            }}
          />
        </FieldRow>
        <TargetRow />
        <PresetRow />
        <FieldRow label={t('pacing')} labelId="rs-pacing-label" stacked>
          <Segmented
            fill
            labelledBy="rs-pacing-label"
            value={session.pacing}
            onChange={(pacing) => actions.updateSession({ pacing })}
            options={PACING.map((p) => ({ value: p, label: t(`pacing_${p}`) }))}
          />
        </FieldRow>
        <FieldRow label={t('variability')} htmlFor="rs-variability">
          <span className="range">
            <input
              id="rs-variability"
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={session.variability}
              aria-valuetext={`${t(`variability_${variabilityWord}`)}, ${Math.round(session.variability * 100)} %`}
              onChange={(e) => actions.updateSession({ variability: Number(e.target.value) })}
            />
            <output className="range__word" htmlFor="rs-variability">
              {t(`variability_${variabilityWord}`)}
            </output>
          </span>
        </FieldRow>
        <FieldRow label={t('stops')} labelId="rs-stops-label" stacked>
          <Segmented
            fill
            labelledBy="rs-stops-label"
            value={session.stops}
            onChange={(stops) => actions.updateSession({ stops })}
            options={STOPS.map((v) => ({ value: v, label: t(`stops_${v}`) }))}
          />
        </FieldRow>
        <FieldRow label={t('gpsNoise')} labelId="rs-gps-label" stacked>
          <Segmented
            fill
            labelledBy="rs-gps-label"
            value={session.gpsNoise}
            onChange={(gpsNoise) => actions.updateSession({ gpsNoise })}
            options={GPS.map((v) => ({ value: v, label: t(`gps_${v}`) }))}
          />
        </FieldRow>
        <FieldRow label={t('temperature')} htmlFor="rs-temperature">
          {metric ? (
            <NumberField
              id="rs-temperature"
              value={Math.round(session.temperatureC)}
              min={-30}
              max={45}
              unit={u.temperature}
              invalidText={range(-30, 45)}
              onCommit={(temperatureC) => actions.updateSession({ temperatureC })}
            />
          ) : (
            <NumberField
              id="rs-temperature"
              value={Math.round(cToF(session.temperatureC))}
              min={-22}
              max={113}
              unit={u.temperature}
              invalidText={range(-22, 113)}
              onCommit={(f) => actions.updateSession({ temperatureC: fToC(f) })}
            />
          )}
        </FieldRow>
        <FieldRow label={t('seed')} htmlFor="rs-seed">
          <NumberField id="rs-seed" value={session.seed} min={0} max={4294967295} width="md" invalidText={range(0, 4294967295)} onCommit={(seed) => actions.updateSession({ seed })} />
          <IconButton icon={Dices} label={t('newSeed')} onClick={actions.rerollSeed} tipSide="left" />
        </FieldRow>
        <FieldRow label={t('laps')}>
          <span className="row__text">{t('lapsAuto', { unit: u.distance })}</span>
        </FieldRow>
        <FieldRow label={t('description')} htmlFor="rs-description" stacked>
          <textarea
            id="rs-description"
            className="textarea"
            rows={3}
            maxLength={2000}
            placeholder={t('optional')}
            value={session.description}
            onChange={(e) => actions.updateSession({ description: e.target.value })}
          />
        </FieldRow>
      </div>
    </Section>
  );
}
