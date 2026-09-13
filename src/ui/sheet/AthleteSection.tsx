import { useActions, useApp, useT } from '../../app/runtime';
import type { FitnessLevel, HrSensor } from '../../lib/types';
import { FieldRow, NumberField, Section, Segmented } from '../controls';
import { CM_PER_IN, KG_PER_LB, unitLabels } from '../units';

const FITNESS: FitnessLevel[] = ['beginner', 'recreational', 'trained', 'elite'];
const SENSORS: HrSensor[] = ['strap', 'optical'];

export function AthleteSection() {
  const t = useT();
  const actions = useActions();
  const athlete = useApp((s) => s.athlete);
  const maxHrAuto = useApp((s) => s.maxHrAuto);
  const units = useApp((s) => s.units);
  const u = unitLabels(units, t);
  const metric = units === 'metric';
  const range = (min: number, max: number) => t('invalidNumber', { min, max });

  return (
    <Section id="athlete" title={t('sectionAthlete')}>
      <div className="table">
        <FieldRow label={t('age')} htmlFor="rs-age">
          <NumberField id="rs-age" value={athlete.age} min={10} max={99} width="xs" invalidText={range(10, 99)} onCommit={(age) => actions.updateAthlete({ age })} />
        </FieldRow>
        <FieldRow label={t('sex')} labelId="rs-sex-label">
          <Segmented
            labelledBy="rs-sex-label"
            value={athlete.sex}
            onChange={(sex) => actions.updateAthlete({ sex })}
            options={[
              { value: 'male', label: t('sex_male') },
              { value: 'female', label: t('sex_female') },
            ]}
          />
        </FieldRow>
        <FieldRow label={t('weight')} htmlFor="rs-weight">
          {metric ? (
            <NumberField id="rs-weight" value={Math.round(athlete.weightKg)} min={25} max={250} unit={u.weight} invalidText={range(25, 250)} onCommit={(weightKg) => actions.updateAthlete({ weightKg })} />
          ) : (
            <NumberField
              id="rs-weight"
              value={Math.round(athlete.weightKg / KG_PER_LB)}
              min={55}
              max={550}
              unit={u.weight}
              invalidText={range(55, 550)}
              onCommit={(lb) => actions.updateAthlete({ weightKg: lb * KG_PER_LB })}
            />
          )}
        </FieldRow>
        <FieldRow label={t('height')} htmlFor="rs-height">
          {metric ? (
            <NumberField id="rs-height" value={Math.round(athlete.heightCm)} min={110} max={230} unit={u.height} invalidText={range(110, 230)} onCommit={(heightCm) => actions.updateAthlete({ heightCm })} />
          ) : (
            <NumberField
              id="rs-height"
              value={Math.round(athlete.heightCm / CM_PER_IN)}
              min={43}
              max={91}
              unit={u.height}
              invalidText={range(43, 91)}
              onCommit={(inches) => actions.updateAthlete({ heightCm: inches * CM_PER_IN })}
            />
          )}
        </FieldRow>
        <FieldRow label={t('restHr')} htmlFor="rs-rest-hr">
          <NumberField id="rs-rest-hr" value={athlete.restHr} min={30} max={110} unit={t('unit_bpm')} invalidText={range(30, 110)} onCommit={(restHr) => actions.updateAthlete({ restHr })} />
        </FieldRow>
        <FieldRow label={t('maxHr')} htmlFor="rs-max-hr" hint={maxHrAuto ? t('maxHrAuto') : undefined}>
          {!maxHrAuto ? (
            <button type="button" className="link-btn row__inline-action" onClick={actions.useAutoMaxHr}>
              {t('maxHrUseAuto')}
            </button>
          ) : null}
          <NumberField id="rs-max-hr" value={athlete.maxHr} min={100} max={230} unit={t('unit_bpm')} invalidText={range(100, 230)} onCommit={(maxHr) => actions.updateAthlete({ maxHr })} />
        </FieldRow>
        <FieldRow label={t('fitness')} labelId="rs-fitness-label" stacked>
          <Segmented
            fill
            proportional
            labelledBy="rs-fitness-label"
            value={athlete.fitness}
            onChange={(fitness) => actions.updateAthlete({ fitness })}
            options={FITNESS.map((f) => ({ value: f, label: t(`fitness_${f}`) }))}
          />
        </FieldRow>
        <HeartRateMode />
        <FieldRow label={t('hrSensor')} labelId="rs-sensor-label">
          <SensorControl labelledBy="rs-sensor-label" />
        </FieldRow>
      </div>
    </Section>
  );
}

type HrMode = 'profile' | 'match';

// Heart rate from the profile (fitness → VO2max), or matched to an average: the engine then solves the VO2max.
function HeartRateMode() {
  const t = useT();
  const actions = useActions();
  const hrTarget = useApp((s) => s.session.hrTarget ?? null);
  const athlete = useApp((s) => s.athlete);
  const lastAvgHr = useApp((s) => s.sim.result?.summary.avgHr ?? 0);
  const mode: HrMode = hrTarget === null ? 'profile' : 'match';
  const lo = 40;
  const hi = 230;
  const start = () => {
    const guess = lastAvgHr > 0 ? lastAvgHr : athlete.restHr + 0.65 * (athlete.maxHr - athlete.restHr);
    return Math.min(hi, Math.max(lo, Math.round(guess)));
  };
  return (
    <>
      <FieldRow label={t('hrMode')} labelId="rs-hr-mode-label" stacked>
        <Segmented<HrMode>
          fill
          labelledBy="rs-hr-mode-label"
          value={mode}
          onChange={(next) => actions.setHrTarget(next === 'match' ? start() : null)}
          options={[
            { value: 'profile', label: t('hrMode_profile') },
            { value: 'match', label: t('hrMode_match') },
          ]}
        />
      </FieldRow>
      {hrTarget !== null ? (
        <FieldRow label={t('hrTarget')} htmlFor="rs-hr-target">
          <NumberField
            id="rs-hr-target"
            value={hrTarget}
            min={lo}
            max={hi}
            unit={t('unit_bpm')}
            invalidText={t('invalidNumber', { min: lo, max: hi })}
            onCommit={(bpm) => actions.setHrTarget(bpm)}
          />
        </FieldRow>
      ) : null}
    </>
  );
}

// The sensor lives in SessionSettings (it shapes recorded noise) but reads as an athlete property.
function SensorControl({ labelledBy }: { labelledBy: string }) {
  const t = useT();
  const actions = useActions();
  const sensor = useApp((s) => s.session.hrSensor);
  return (
    <Segmented
      labelledBy={labelledBy}
      value={sensor}
      onChange={(hrSensor) => actions.updateSession({ hrSensor })}
      options={SENSORS.map((v) => ({ value: v, label: t(`sensor_${v}`) }))}
    />
  );
}
