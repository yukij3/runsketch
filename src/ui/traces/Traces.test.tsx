// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { syntheticResult, TEST_ZONES } from './__fixtures__/synthetic';
import type { TracesProps } from './contract';
import { Traces } from './Traces';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const RESULT = syntheticResult();

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function render(overrides: Partial<TracesProps> = {}): TracesProps {
  const props: TracesProps = {
    result: RESULT,
    activity: 'run',
    units: 'metric',
    lang: 'en',
    zones: TEST_ZONES,
    playhead: null,
    onPlayhead: vi.fn(),
    busy: false,
    ...overrides,
  };
  act(() => root.render(<Traces {...props} />));
  return props;
}

const $ = <T extends Element = Element>(sel: string) => container.querySelector<T>(sel);
const $$ = (sel: string) => [...container.querySelectorAll(sel)];

function press(key: string, shiftKey = false) {
  const group = $<HTMLElement>('section[role="group"]')!;
  act(() => {
    group.dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true }));
  });
}

function stubRect(el: Element, width: number) {
  Object.defineProperty(el, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ left: 0, top: 0, right: width, bottom: 200, width, height: 200, x: 0, y: 0, toJSON: () => ({}) }),
  });
}

describe('Traces', () => {
  it('renders four panels with data paths for a 600 s run with a climb', () => {
    render();
    const ink = $('.traces__ink')!;
    expect(ink).not.toBeNull();
    expect([...ink.querySelectorAll('[data-panel]')].map((g) => g.getAttribute('data-panel'))).toEqual([
      'elevation',
      'pace',
      'hr',
      'cadence',
    ]);
    for (const series of ['elevation', 'speed-raw', 'speed', 'hr-demand', 'hr', 'hr-lag', 'cadence']) {
      const path = ink.querySelector(`[data-series="${series}"]`);
      expect(path, series).not.toBeNull();
      expect(path!.getAttribute('d')!.length, series).toBeGreaterThan(10);
      expect(path!.getAttribute('d'), series).not.toContain('NaN');
    }
    expect($$('.traces__zone')).toHaveLength(5);
    expect($$('.traces__zone-label').map((t) => t.textContent)).toContain('Z4');
    expect($('section')!.getAttribute('aria-label')).toBe('Activity traces');
    expect($('.traces__legend')!.textContent).toContain('Dashed — what the effort demands.');
  });

  it('moves the playhead with the keyboard', () => {
    const onPlayhead = vi.fn();
    render({ onPlayhead });
    press('ArrowRight');
    expect(onPlayhead).toHaveBeenLastCalledWith(0);

    render({ onPlayhead, playhead: 100 });
    press('ArrowRight');
    expect(onPlayhead).toHaveBeenLastCalledWith(110);
    press('ArrowRight', true);
    expect(onPlayhead).toHaveBeenLastCalledWith(160);
    press('ArrowLeft');
    expect(onPlayhead).toHaveBeenLastCalledWith(90);
    press('End');
    expect(onPlayhead).toHaveBeenLastCalledWith(599);
    press('Home');
    expect(onPlayhead).toHaveBeenLastCalledWith(0);
    press('Escape');
    expect(onPlayhead).toHaveBeenLastCalledWith(null);
    expect($('[aria-live="polite"]')!.textContent).toBe('Playhead cleared');

    render({ onPlayhead, playhead: 590 });
    press('ArrowRight', true);
    expect(onPlayhead).toHaveBeenLastCalledWith(599);
    expect($('[aria-live="polite"]')!.textContent).toMatch(/^Elapsed 9:59, Distance/);
  });

  it('shows readouts and the playhead line at the playhead', () => {
    render({ playhead: 300 });
    expect($('[data-playhead]')!.getAttribute('data-playhead')).toBe('300');
    expect($('.traces__value[data-key="elapsed"]')!.textContent).toBe('5:00');
    expect($('.traces__value[data-key="grade"]')!.textContent).toBe('8.0');
    render({ playhead: null });
    expect($('[data-playhead]')).toBeNull();
    expect($('.traces__value[data-key="elapsed"]')!.textContent).toBe('9:59');
  });

  it('renders ruled empty panels and a caption when there is no result', () => {
    render({ result: null });
    expect($$('[data-panel-frame]')).toHaveLength(4);
    expect($('.traces__ink')).toBeNull();
    expect($('.traces__caption')!.textContent).toBe('Traces appear once the route has two points');
    expect($('.traces__value[data-key="elapsed"]')!.textContent).toBe('–');

    render({ result: null, lang: 'ru' });
    expect($('.traces__caption')!.textContent).toBe('Графики появятся, когда на маршруте будет две точки');

    render({ result: null, busy: true });
    expect($('.traces__caption')!.textContent).toBe('Computing traces…');
  });

  it('keeps the last traces while recomputing', () => {
    render({ busy: true });
    expect($('section')!.classList.contains('traces--busy')).toBe(true);
    expect($('section')!.getAttribute('aria-busy')).toBe('true');
    expect($('.traces__ink')).not.toBeNull();
    expect($('[role="status"]')!.textContent).toBe('Recomputing…');
  });

  it('handles a result shorter than 10 s', () => {
    render({ result: syntheticResult({ seconds: 5, stop: null }) });
    for (const path of $$('.traces__ink path')) expect(path.getAttribute('d')).not.toContain('NaN');
    render({ result: syntheticResult({ seconds: 1, stop: null }), playhead: 0 });
    expect($('section')!.getAttribute('data-axis')).toBe('time');
    expect($('[data-playhead]')!.getAttribute('data-playhead')).toBe('0');
  });

  it('scrubbing leaves the ink untouched; a new result remounts it for the reveal', () => {
    render({ playhead: 100 });
    const ink = $('.traces__ink')!;
    const hr = ink.querySelector('[data-series="hr"]')!;
    const d = hr.getAttribute('d');
    render({ playhead: 250 });
    expect($('.traces__ink')).toBe(ink);
    expect(ink.querySelector('[data-series="hr"]')).toBe(hr);
    expect(hr.getAttribute('d')).toBe(d);

    render({ playhead: 250, result: syntheticResult() });
    expect($('.traces__ink')).not.toBe(ink);
  });

  it('maps pointer x to the nearest sample, pins on click and clears from the button', () => {
    const onPlayhead = vi.fn();
    render({ onPlayhead });
    act(() => ($$('.traces__seg button')[1] as HTMLButtonElement).click());
    expect($('section')!.getAttribute('data-axis')).toBe('time');

    const hit = $<HTMLDivElement>('.traces__hit')!;
    stubRect(hit, 400);
    act(() => {
      hit.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 100, pointerType: 'mouse' }));
    });
    expect(onPlayhead).toHaveBeenLastCalledWith(150);

    render({ onPlayhead, playhead: 150 });
    act(() => {
      hit.dispatchEvent(new PointerEvent('pointerout', { bubbles: true, relatedTarget: document.body, pointerType: 'mouse' }));
    });
    expect(onPlayhead).toHaveBeenLastCalledWith(null);

    act(() => {
      hit.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 200 }));
    });
    expect(onPlayhead).toHaveBeenLastCalledWith(299);
    render({ onPlayhead, playhead: 299 });
    const calls = onPlayhead.mock.calls.length;
    act(() => {
      hit.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 20, pointerType: 'mouse' }));
      hit.dispatchEvent(new PointerEvent('pointerout', { bubbles: true, relatedTarget: document.body, pointerType: 'mouse' }));
    });
    expect(onPlayhead.mock.calls.length).toBe(calls);
    expect($('.traces__pin')).not.toBeNull();

    const clear = $$('button').find((b) => b.textContent === 'Clear playhead') as HTMLButtonElement;
    act(() => clear.click());
    expect(onPlayhead).toHaveBeenLastCalledWith(null);
  });

  it('follows the container size and switches to the compact layout', () => {
    let callback: ResizeObserverCallback = () => {};
    class FakeResizeObserver {
      constructor(cb: ResizeObserverCallback) {
        callback = cb;
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    render();
    expect($('.traces__labels')).toBeNull();
    act(() => {
      callback([{ contentRect: { width: 400, height: 220 } } as ResizeObserverEntry], {} as ResizeObserver);
    });
    expect($('.traces__labels')).not.toBeNull();
    expect($('.traces__ink')!.getAttribute('width')).toBe(String(400 - 40 - 22));
  });
});
