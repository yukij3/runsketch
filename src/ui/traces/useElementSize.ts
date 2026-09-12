import { useLayoutEffect, useRef, useState } from 'react';

export interface Size {
  width: number;
  height: number;
}

/** Used before the first measurement and where layout is unavailable (hidden container, jsdom). */
export const FALLBACK_SIZE: Size = { width: 760, height: 250 };

/** Whole-pixel content size of an element, tracked with ResizeObserver. */
export function useElementSize<T extends HTMLElement>(fallback: Size = FALLBACK_SIZE) {
  const ref = useRef<T>(null);
  const [size, setSize] = useState<Size>(fallback);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const apply = (w: number, h: number) => {
      const width = Math.floor(w);
      const height = Math.floor(h);
      if (width <= 0 || height <= 0) return;
      setSize((prev) => (prev.width === width && prev.height === height ? prev : { width, height }));
    };
    const rect = el.getBoundingClientRect();
    apply(rect.width, rect.height);
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[entries.length - 1];
      if (entry) apply(entry.contentRect.width, entry.contentRect.height);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return [ref, size] as const;
}
