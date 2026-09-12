// The traces strip: stacked elevation, pace/speed, heart rate (demand vs response) and cadence
// panels on one x scale, with a single shared playhead.
import { X } from 'lucide-react';
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { elevationUnit, paceUnit, speedUnit } from '../../lib/format';
import { buildAxes } from './axes';
import type { TracesProps } from './contract';
import { buildInk, panelYMaps } from './ink';
import { InkLayer } from './InkLayer';
import { playheadForKey } from './keyboard';
import { layoutStrip } from './layout';
import { PlayheadLayer } from './PlayheadLayer';
import { clampIndex, emptyCells, liveText, panelReadouts, readoutCells } from './readout';
import { Legend, ReadoutRow } from './ReadoutBar';
import { indexAtPx, makeXScale, type XAxis } from './scale';
import { buildTraceModel, isFootSport } from './series';
import { LabelLayer, StaticLayer, type PanelNames } from './StaticLayer';
import { stringsFor, unitText } from './strings';
import { useElementSize } from './useElementSize';
import './traces.css';

/** A result shorter than this still spreads over a readable time axis instead of filling the width. */
export const MIN_TIME_SPAN_S = 10;

let revealSerial = 0;

export function Traces(props: TracesProps) {
  const { result, activity, units, lang, zones, playhead, onPlayhead, busy } = props;
  const s = stringsFor(lang);
  const [axisPref, setAxisPref] = useState<XAxis>('distance');
  const [pinnedState, setPinned] = useState(false);
  const [live, setLive] = useState('');
  const [bodyRef, size] = useElementSize<HTMLDivElement>();
  const hintId = useId();
  const dragging = useRef(false);
  const lastPointerType = useRef('mouse');

  const usable = result && result.streams.t.length > 0 ? result : null;
  const model = useMemo(() => (usable ? buildTraceModel(usable, activity, units) : null), [usable, activity, units]);
  const canUseDistance = model !== null && model.totalDistance >= 1;
  const axis: XAxis = model !== null && !canUseDistance ? 'time' : axisPref;

  // Zones compared by value: the shell may rebuild the array every render, which must not rebuild axes.
  const zonesKey = zones.map((z) => `${z.id}:${z.min}:${z.max}`).join('|');
  const stableZones = useMemo(() => zones, [zonesKey]);

  const layout = useMemo(() => layoutStrip(size.width, size.height), [size.width, size.height]);
  const scale = useMemo(
    () =>
      model
        ? makeXScale(axis === 'time' ? model.streams.t : model.streams.dist, axis, layout.plotW, axis === 'time' ? MIN_TIME_SPAN_S : 1)
        : null,
    [model, axis, layout.plotW],
  );
  const yMaps = useMemo(() => (model ? panelYMaps(model, layout) : null), [model, layout]);
  const ink = useMemo(() => (model && scale ? buildInk(model, scale, layout) : null), [model, scale, layout]);
  const axes = useMemo(
    () => (model && scale && yMaps ? buildAxes(model, scale, layout, yMaps, stableZones) : null),
    [model, scale, layout, yMaps, stableZones],
  );
  // A new result object gets a new key, remounting the ink layer and replaying the pen reveal.
  const revealKey = useMemo(() => ++revealSerial, [usable]);

  const foot = isFootSport(activity);
  const names = useMemo<PanelNames>(
    () => ({
      elevation: { name: s.panel.elevation, unit: unitText(s, elevationUnit(units)) },
      pace: foot
        ? { name: s.panel.pace, unit: unitText(s, paceUnit(units)) }
        : { name: s.panel.speed, unit: unitText(s, speedUnit(units)) },
      hr: { name: s.panel.hr, unit: unitText(s, 'bpm') },
      cadence: { name: s.panel.cadence, unit: unitText(s, foot ? 'spm' : 'rpm') },
    }),
    [s, units, foot],
  );

  const index = model ? clampIndex(model, playhead) : null;
  const pinned = pinnedState && index !== null;

  useEffect(() => {
    if (index === null) setPinned(false);
  }, [index]);

  useEffect(() => setLive(''), [lang]);

  const emit = (next: number | null) => {
    if (next !== index) onPlayhead(next);
  };

  const indexFromPointer = (e: ReactPointerEvent<HTMLDivElement> | ReactMouseEvent<HTMLDivElement>): number | null => {
    if (!scale) return null;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    return indexAtPx(scale, rect.width > 0 ? (x * scale.width) / rect.width : x);
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    lastPointerType.current = e.pointerType;
    if (e.pointerType === 'mouse') return;
    dragging.current = true;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Capture is best-effort (unsupported in some environments).
    }
    emit(indexFromPointer(e));
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' ? pinned : !dragging.current) return;
    emit(indexFromPointer(e));
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' || !dragging.current) return;
    dragging.current = false;
    setPinned(true);
  };
  const onPointerCancel = () => {
    dragging.current = false;
  };
  const onPointerLeave = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' && !pinned) emit(null);
  };
  const onClick = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (lastPointerType.current !== 'mouse') return;
    setPinned(!pinned);
    emit(indexFromPointer(e));
  };

  const clear = () => {
    setPinned(false);
    emit(null);
    setLive(s.cleared);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.target !== e.currentTarget || !model) return;
    const next = playheadForKey(e.key, e.shiftKey, index, model.n);
    if (next === undefined) return;
    e.preventDefault();
    setPinned(next !== null);
    emit(next);
    setLive(next === null ? s.cleared : liveText(readoutCells(model, next, s)));
  };

  const cells = model ? readoutCells(model, index, s) : emptyCells(s, activity, units);
  const className = ['traces', busy ? 'traces--busy' : '', model ? '' : 'traces--empty'].filter(Boolean).join(' ');

  return (
    <section
      className={className}
      role="group"
      aria-label={s.groupLabel}
      aria-describedby={hintId}
      aria-busy={busy || undefined}
      tabIndex={0}
      onKeyDown={onKeyDown}
      data-axis={axis}
    >
      <div className="traces__bar">
        <ReadoutRow cells={cells} />
      </div>

      <div className="traces__body" ref={bodyRef}>
        <StaticLayer layout={layout} axes={axes} names={names} />
        {ink && <InkLayer key={revealKey} layout={layout} ink={ink} stoppedLabel={s.stopped} />}
        <LabelLayer layout={layout} names={names} />
        {model && scale && yMaps && (
          <PlayheadLayer
            layout={layout}
            model={model}
            scale={scale}
            y={yMaps}
            index={index}
            pinned={pinned}
            readouts={panelReadouts(model, index, s)}
          />
        )}
        {model && scale && (
          <div
            className="traces__hit"
            style={{ left: layout.plotX, width: layout.plotW, height: layout.axisTop + layout.axisH }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerCancel}
            onPointerLeave={onPointerLeave}
            onClick={onClick}
          />
        )}
        {!model && (
          <p className="traces__caption" style={{ left: layout.plotX, width: layout.plotW }}>
            {busy ? s.computing : s.empty}
          </p>
        )}
      </div>

      <div className="traces__foot">
        <Legend s={s} showStops={model !== null && model.stops.length > 0} />
        <span className="traces__status" role="status">
          {busy && model ? s.recomputing : ''}
        </span>
        <div className="traces__tools">
          {pinned && (
            <button type="button" className="traces__button" onClick={clear}>
              <X size={14} strokeWidth={1.75} aria-hidden="true" />
              <span>{s.clearPlayhead}</span>
            </button>
          )}
          <div className="traces__seg" role="group" aria-label={s.axisLabel}>
            <button
              type="button"
              aria-pressed={axis === 'distance'}
              disabled={model !== null && !canUseDistance}
              onClick={() => setAxisPref('distance')}
            >
              {s.axisDistance}
            </button>
            <button type="button" aria-pressed={axis === 'time'} onClick={() => setAxisPref('time')}>
              {s.axisTime}
            </button>
          </div>
        </div>
      </div>

      <p id={hintId} className="traces__sr">
        {s.keyboardHint}
      </p>
      <p className="traces__sr" aria-live="polite">
        {live}
      </p>
    </section>
  );
}
