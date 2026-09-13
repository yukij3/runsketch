import { Dices } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { routeCoords } from '../../app/pipeline';
import { useActions, useApp, useT } from '../../app/runtime';
import { ACTIVITIES, stopsLevels } from '../../app/state';
import { FEET_PER_METER, formatDecimal, parseClock } from '../../lib/format';
import { polylineLength } from '../../lib/geo';
import { EFFORT_PRESETS, PRESET_GOALS, defaultSession, defaultSnowline, type EffortPreset } from '../../lib/sim';
import type { Acclimatisation, ActivityType, Footwear, GpsNoiseLevel, PacingStrategy, SnowCondition, TargetSpec } from '../../lib/types';
import { startFromWallClock } from '../../app/zone';
import { FieldRow, IconButton, NumberField, Section, Segmented, ValueField } from '../controls';
import { KG_PER_LB, KM_PER_MI, formatHms, formatMss, parseDateTimeLocal, toDateTimeLocal, unitLabels } from '../units';
import { WeatherRows } from './WeatherRows';

const PACING: PacingStrategy[] = ['even', 'negative', 'positive'];
const GPS: GpsNoiseLevel[] = ['off', 'low', 'normal', 'high'];
const ACCLIMATISATION: Acclimatisation[] = ['none', 'partial', 'full'];
const FOOTWEAR: Footwear[] = ['trail-shoes', 'mountain-boots', 'double-boots'];
const SNOW: SnowCondition[] = ['firm', 'soft', 'deep'];

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
  // A pace per km says little on a summit day: mountaineering targets a finish time (or an effort preset).
  const kinds: Array<TargetSpec['kind']> = ride ? ['speed', 'duration'] : session.type === 'alpine' ? ['duration'] : ['pace', 'duration'];
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

/** "UTC+05:45" for an offset in minutes east of UTC. */
function utcLabel(offsetMin: number): string {
  const abs = Math.abs(offsetMin);
  return `UTC${offsetMin < 0 ? '−' : '+'}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
}

// The start is a wall-clock time at the route: shown at the offset it was set with and typed in the route's zone once a
// weather response has named it (until then at the same fixed offset).
function StartRow() {
  const t = useT();
  const actions = useActions();
  const startTime = useApp((s) => s.session.startTime);
  const utcOffsetMin = useApp((s) => s.session.utcOffsetMin);
  const routeZone = useApp((s) => s.routeZone);
  const browserOffset = -new Date(startTime).getTimezoneOffset();
  const zone = routeZone || (utcOffsetMin !== browserOffset ? utcLabel(utcOffsetMin) : '');
  return (
    <FieldRow label={t('start')} htmlFor="rs-start" hint={zone ? t('startZone', { zone }) : undefined}>
      <input
        id="rs-start"
        className="input input--datetime num"
        type="datetime-local"
        value={toDateTimeLocal(startTime, utcOffsetMin)}
        onChange={(e) => {
          const wall = parseDateTimeLocal(e.target.value);
          if (!wall) return;
          const next = startFromWallClock(routeZone, wall, utcOffsetMin);
          if (Number.isFinite(next.startTime)) actions.setStart(next.startTime, next.utcOffsetMin);
        }}
      />
    </FieldRow>
  );
}

function PackRow() {
  const t = useT();
  const actions = useActions();
  const packKg = useApp((s) => s.session.packKg ?? 0);
  const units = useApp((s) => s.units);
  const u = unitLabels(units, t);
  const range = (min: number, max: number) => t('invalidNumber', { min, max });
  return (
    <FieldRow label={t('pack')} htmlFor="rs-pack">
      {units === 'metric' ? (
        <NumberField id="rs-pack" value={Math.round(packKg)} min={0} max={60} width="xs" unit={u.weight} invalidText={range(0, 60)} onCommit={(kg) => actions.updateSession({ packKg: kg })} />
      ) : (
        <NumberField
          id="rs-pack"
          value={Math.round(packKg / KG_PER_LB)}
          min={0}
          max={132}
          width="xs"
          unit={u.weight}
          invalidText={range(0, 132)}
          onCommit={(lb) => actions.updateSession({ packKg: lb * KG_PER_LB })}
        />
      )}
    </FieldRow>
  );
}

// Snow counts from this altitude where the ground is unknown; it follows the route's latitude until edited.
function SnowlineRow() {
  const t = useT();
  const actions = useActions();
  const snowlineM = useApp((s) => s.session.snowlineM ?? null);
  const lat = useApp((s) => s.terrain.profile?.points[0]?.lat ?? s.waypoints[0]?.lat ?? Number.NaN);
  const units = useApp((s) => s.units);
  const u = unitLabels(units, t);
  const auto = snowlineM === null;
  const metres = auto ? Math.round(defaultSnowline(lat) / 10) * 10 : snowlineM;
  const metric = units === 'metric';
  const max = metric ? 9000 : 29500;
  return (
    <FieldRow label={t('snowline')} htmlFor="rs-snowline" hint={auto ? t('snowlineAuto') : undefined}>
      {!auto ? (
        <button type="button" className="link-btn row__inline-action" onClick={() => actions.updateSession({ snowlineM: null })}>
          {t('snowlineUseAuto')}
        </button>
      ) : null}
      <NumberField
        id="rs-snowline"
        value={metric ? metres : Math.round(metres * FEET_PER_METER)}
        min={0}
        max={max}
        step={100}
        unit={u.elevation}
        invalidText={t('invalidNumber', { min: 0, max })}
        onCommit={(value) => actions.updateSession({ snowlineM: Math.round(metric ? value : value / FEET_PER_METER) })}
      />
    </FieldRow>
  );
}

/** How long the athlete has been at altitude: it sets both VO2max and what stays sustainable for hours up high. */
function AcclimatisationRow({ fallback }: { fallback: Acclimatisation }) {
  const t = useT();
  const actions = useActions();
  const session = useApp((s) => s.session);
  return (
    <FieldRow label={t('acclimatisation')} labelId="rs-acclimatisation-label" stacked>
      <Segmented<Acclimatisation>
        fill
        labelledBy="rs-acclimatisation-label"
        value={session.acclimatisation ?? fallback}
        onChange={(acclimatisation) => actions.updateSession({ acclimatisation })}
        options={ACCLIMATISATION.map((a) => ({ value: a, label: t(`acclimatisation_${a}`), title: t(`acclimatisationTitle_${a}`) }))}
      />
    </FieldRow>
  );
}

/** A trek is not a climb, but its climbs are still capped by the air up high, so a hike asks about acclimatisation too. */
function AltitudeGroup() {
  const t = useT();
  return (
    <>
      <h3 className="subhead">{t('mountain')}</h3>
      <div className="table">
        <AcclimatisationRow fallback="none" />
      </div>
    </>
  );
}

/** Mountaineering settings: acclimatisation, pack, footwear, crampons, snow and the snowline. */
function MountainGroup() {
  const t = useT();
  const actions = useActions();
  const session = useApp((s) => s.session);
  return (
    <>
      <h3 className="subhead">{t('mountain')}</h3>
      <div className="table">
        <AcclimatisationRow fallback="partial" />
        <PackRow />
        <FieldRow label={t('footwear')} labelId="rs-footwear-label" stacked>
          <Segmented<Footwear>
            fill
            labelledBy="rs-footwear-label"
            value={session.footwear ?? 'mountain-boots'}
            onChange={(footwear) => actions.updateSession({ footwear })}
            options={FOOTWEAR.map((f) => ({ value: f, label: t(`footwear_${f}`) }))}
          />
        </FieldRow>
        <FieldRow label={t('crampons')} labelId="rs-crampons-label" stacked>
          <Segmented<'on' | 'off'>
            fill
            labelledBy="rs-crampons-label"
            value={session.crampons === false ? 'off' : 'on'}
            onChange={(v) => actions.updateSession({ crampons: v === 'on' })}
            options={[
              { value: 'on', label: t('crampons_on') },
              { value: 'off', label: t('crampons_off') },
            ]}
          />
        </FieldRow>
        <FieldRow label={t('snow')} labelId="rs-snow-label" stacked>
          <Segmented<SnowCondition>
            fill
            labelledBy="rs-snow-label"
            value={session.snow ?? 'firm'}
            onChange={(snow) => actions.updateSession({ snow })}
            options={SNOW.map((v) => ({ value: v, label: t(`snow_${v}`) }))}
          />
        </FieldRow>
        <SnowlineRow />
      </div>
    </>
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
  const variabilityWord = session.variability < 0.2 ? 'steady' : session.variability < 0.55 ? 'natural' : 'uneven';
  const range = (min: number, max: number) => t('invalidNumber', { min, max });

  return (
    <Section id="session" title={t('sectionSession')}>
      <div className="table">
        <FieldRow label={t('activity')} labelId="rs-activity-label" stacked>
          <Segmented
            fill
            proportional
            labelledBy="rs-activity-label"
            value={session.type}
            onChange={(type) => actions.updateSession({ type })}
            options={ACTIVITIES.map((a) => ({ value: a, label: t(`activity_${a}`) }))}
          />
        </FieldRow>
        <FieldRow label={t('name')} htmlFor="rs-name" stacked>
          <NameField />
        </FieldRow>
        <StartRow />
        <WeatherRows />
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
            options={stopsLevels(session.type).map((v) => ({ value: v, label: t(`stops_${v}`) }))}
          />
        </FieldRow>
        {session.type === 'hike' ? <PackRow /> : null}
        <FieldRow label={t('gpsNoise')} labelId="rs-gps-label" stacked>
          <Segmented
            fill
            labelledBy="rs-gps-label"
            value={session.gpsNoise}
            onChange={(gpsNoise) => actions.updateSession({ gpsNoise })}
            options={GPS.map((v) => ({ value: v, label: t(`gps_${v}`) }))}
          />
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
      {session.type === 'alpine' ? <MountainGroup /> : session.type === 'hike' ? <AltitudeGroup /> : null}
    </Section>
  );
}
