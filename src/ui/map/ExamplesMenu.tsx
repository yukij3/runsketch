import { Route } from 'lucide-react';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { EXAMPLES } from '../../app/example';
import { useActions, useApp, useT } from '../../app/runtime';
import { formatDecimal, formatElevation } from '../../lib/format';
import { cx } from '../controls';
import { KM_PER_MI, unitLabels } from '../units';

/** Toolbar menu of example routes. Choosing one loads its waypoints, profile and session suggestions (undo restores the route). */
export function ExamplesMenu() {
  const t = useT();
  const actions = useActions();
  const units = useApp((s) => s.units);
  const menuId = useId();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const items = () => Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []);

  useEffect(() => {
    if (!open) return;
    items()[0]?.focus();
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  const close = () => {
    setOpen(false);
    buttonRef.current?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const list = items();
    const at = list.indexOf(document.activeElement as HTMLButtonElement);
    let next = -1;
    if (e.key === 'ArrowDown') next = (at + 1) % list.length;
    else if (e.key === 'ArrowUp') next = at <= 0 ? list.length - 1 : at - 1;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = list.length - 1;
    else if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    } else if (e.key === 'Tab') setOpen(false);
    if (next >= 0) {
      e.preventDefault();
      list[next]?.focus();
    }
  };

  const u = unitLabels(units, t);
  return (
    <div className="examples" ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        className={cx('icon-btn', open && 'is-open')}
        aria-label={t('examples')}
        data-tip={open ? undefined : t('examples')}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((o) => !o)}
      >
        <Route size={16} strokeWidth={1.75} aria-hidden="true" />
      </button>
      {open ? (
        <div ref={menuRef} id={menuId} className="examples__menu" role="menu" aria-label={t('examples')} onKeyDown={onKeyDown}>
          {EXAMPLES.map((example) => (
            <button
              key={example.id}
              type="button"
              role="menuitem"
              tabIndex={-1}
              className="examples__item"
              onClick={() => {
                close();
                actions.loadExample(example.id);
              }}
            >
              <span className="examples__name">{example.name}</span>
              <span className="examples__meta">
                <span className="num">{formatDecimal(units === 'metric' ? example.km : example.km / KM_PER_MI, 1)}</span>
                <span className="unit">{u.distance}</span>
                <span aria-hidden="true"> · </span>
                <span className="num">{formatElevation(example.maxEleM, units)}</span>
                <span className="unit">{u.elevation}</span>
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
