// Ruled-table form primitives shared by the protocol sheet and the toolbar.
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

export const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(' ');

export function Section({ id, title, busy, children }: { id: string; title: string; busy?: boolean; children: ReactNode }) {
  return (
    <section className="sheet-section" aria-labelledby={`${id}-title`} aria-busy={busy || undefined}>
      <h2 className="sheet-section__title" id={`${id}-title`}>
        {title}
      </h2>
      {children}
    </section>
  );
}

interface FieldRowProps {
  label: string;
  /** Id of the control for <label for>; omit for groups and read only values. */
  htmlFor?: string;
  labelId?: string;
  hint?: ReactNode;
  stacked?: boolean;
  children: ReactNode;
}

export function FieldRow({ label, htmlFor, labelId, hint, stacked, children }: FieldRowProps) {
  const labelContent = (
    <>
      <span>{label}</span>
      {hint ? <span className="row__hint">{hint}</span> : null}
    </>
  );
  return (
    <div className={cx('row', stacked && 'row--stacked')}>
      {htmlFor ? (
        <label className="row__label" htmlFor={htmlFor} id={labelId}>
          {labelContent}
        </label>
      ) : (
        <span className="row__label" id={labelId}>
          {labelContent}
        </span>
      )}
      <div className="row__value">{children}</div>
    </div>
  );
}

export function DataRow({ label, value, unit, text, children }: { label: string; value?: string; unit?: string; text?: boolean; children?: ReactNode }) {
  return (
    <div className="row row--data">
      <dt className="row__label">{label}</dt>
      <dd className="row__value">
        {children ?? (
          <>
            <span className={text ? 'row__text' : 'num'}>{value ?? '–'}</span>
            {unit && value && value !== '–' ? <span className="unit">{unit}</span> : null}
          </>
        )}
      </dd>
    </div>
  );
}

export interface Option<T extends string> {
  value: T;
  label: string;
  title?: string;
}

interface SegmentedProps<T extends string> {
  value: T;
  options: ReadonlyArray<Option<T>>;
  onChange: (value: T) => void;
  labelledBy?: string;
  label?: string;
  size?: 'sm' | 'md';
  fill?: boolean;
}

export function Segmented<T extends string>({ value, options, onChange, labelledBy, label, size = 'md', fill }: SegmentedProps<T>) {
  const name = useId();
  return (
    <div className={cx('seg', size === 'sm' && 'seg--sm', fill && 'seg--fill')} role="radiogroup" aria-labelledby={labelledBy} aria-label={labelledBy ? undefined : label}>
      {options.map((o) => (
        <label key={o.value} className={cx('seg__opt', o.value === value && 'is-on')} title={o.title}>
          <input className="seg__input" type="radio" name={name} value={o.value} checked={o.value === value} onChange={() => onChange(o.value)} />
          <span>{o.label}</span>
        </label>
      ))}
    </div>
  );
}

interface ValueFieldProps<V> {
  id: string;
  value: V;
  format: (value: V) => string;
  /** Null when the text is not a valid value. */
  parse: (text: string) => V | null;
  onCommit: (value: V) => void;
  invalidText: string;
  unit?: string;
  inputMode?: 'numeric' | 'decimal' | 'text';
  /** Arrow-key stepping (Shift = ×10). */
  step?: (value: V, direction: 1 | -1, big: boolean) => V;
  width?: 'xs' | 'sm' | 'md';
  ariaLabel?: string;
}

/** Text input that commits valid values while typing and flags invalid text on blur. */
export function ValueField<V>({ id, value, format, parse, onCommit, invalidText, unit, inputMode = 'text', step, width = 'sm', ariaLabel }: ValueFieldProps<V>) {
  const [text, setText] = useState(() => format(value));
  const [invalid, setInvalid] = useState(false);
  const focused = useRef(false);
  const formatted = format(value);

  useEffect(() => {
    if (!focused.current) {
      setText(formatted);
      setInvalid(false);
    }
  }, [formatted]);

  const change = (next: string) => {
    setText(next);
    const v = parse(next);
    if (v !== null) {
      setInvalid(false);
      if (format(v) !== formatted) onCommit(v);
    }
  };

  const settle = () => {
    const v = parse(text);
    if (v === null) setInvalid(true);
    else setText(format(v));
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (step && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      const next = step(parse(text) ?? value, e.key === 'ArrowUp' ? 1 : -1, e.shiftKey);
      setText(format(next));
      setInvalid(false);
      onCommit(next);
    } else if (e.key === 'Enter') {
      settle();
    } else if (e.key === 'Escape') {
      setText(formatted);
      setInvalid(false);
    }
  };

  const errorId = `${id}-error`;
  return (
    <span className={cx('field', `field--${width}`, invalid && 'is-invalid')}>
      <span className="field__box">
        <input
          id={id}
          className="input input--num"
          type="text"
          inputMode={inputMode}
          value={text}
          aria-label={ariaLabel}
          aria-invalid={invalid || undefined}
          aria-describedby={invalid ? errorId : undefined}
          autoComplete="off"
          spellCheck={false}
          onFocus={() => {
            focused.current = true;
          }}
          onBlur={() => {
            focused.current = false;
            settle();
          }}
          onChange={(e) => change(e.target.value)}
          onKeyDown={onKeyDown}
        />
        {unit ? <span className="unit">{unit}</span> : null}
      </span>
      {invalid ? (
        <span className="field__error" id={errorId} role="alert">
          {invalidText}
        </span>
      ) : null}
    </span>
  );
}

interface NumberFieldProps {
  id: string;
  value: number;
  onCommit: (value: number) => void;
  min: number;
  max: number;
  step?: number;
  decimals?: number;
  unit?: string;
  invalidText: string;
  width?: 'xs' | 'sm' | 'md';
  ariaLabel?: string;
}

export function NumberField({ min, max, step = 1, decimals = 0, ...rest }: NumberFieldProps) {
  const factor = 10 ** decimals;
  const round = (v: number) => Math.round(v * factor) / factor;
  return (
    <ValueField<number>
      {...rest}
      inputMode={decimals > 0 || min < 0 ? 'decimal' : 'numeric'}
      format={(v) => (Number.isFinite(v) ? v.toFixed(decimals) : '')}
      parse={(text) => {
        const trimmed = text.trim().replace(',', '.').replace('−', '-');
        if (!/^-?\d*(\.\d*)?$/.test(trimmed) || trimmed === '' || trimmed === '-' || trimmed === '.') return null;
        const v = round(Number(trimmed));
        return v >= min && v <= max ? v : null;
      }}
      step={(v, dir, big) => Math.min(max, Math.max(min, round(v + dir * step * (big ? 10 : 1))))}
    />
  );
}

interface IconButtonProps {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  tipSide?: 'top' | 'bottom' | 'left';
  className?: string;
  size?: number;
}

export function IconButton({ icon: Icon, label, onClick, disabled, tipSide = 'bottom', className, size = 16 }: IconButtonProps) {
  return (
    <button type="button" className={cx('icon-btn', className)} aria-label={label} data-tip={label} data-tip-side={tipSide} onClick={onClick} disabled={disabled}>
      <Icon size={size} strokeWidth={1.75} aria-hidden="true" />
    </button>
  );
}
