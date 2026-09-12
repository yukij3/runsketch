// Keyboard scrubbing. Sample index i is second i, so steps in seconds are steps in indices.

export const STEP_S = 10;
export const BIG_STEP_S = 60;

/**
 * Next playhead for a key press, or `undefined` when the key is not handled.
 * From no playhead, Right enters at the start and Left enters at the finish.
 */
export function playheadForKey(key: string, shiftKey: boolean, current: number | null, n: number): number | null | undefined {
  if (n <= 0) return key === 'Escape' ? null : undefined;
  const lastIndex = n - 1;
  const clamp = (i: number) => Math.min(lastIndex, Math.max(0, Math.round(i)));
  const step = shiftKey ? BIG_STEP_S : STEP_S;
  switch (key) {
    case 'ArrowRight':
      return current === null ? 0 : clamp(current + step);
    case 'ArrowLeft':
      return current === null ? lastIndex : clamp(current - step);
    case 'Home':
      return 0;
    case 'End':
      return lastIndex;
    case 'Escape':
      return null;
    default:
      return undefined;
  }
}
