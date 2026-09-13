// Total ascent and descent of an elevation series. The terrain profile and the activity summary both count
// climbing with this one algorithm, so the route's ascent and the recorded ascent agree.

/** Swings smaller than this are not counted, metres. */
export const ASCENT_THRESHOLD_M = 3;

/**
 * Walks the confirmed legs between turning points: a turn counts once the elevation has come back `threshold`
 * metres from the last extreme, in the spirit of BRouter's "filtered ascend" and barometric watch counters. The
 * final leg counts once it has moved `threshold` from where it started. Calls `leg(from, to, dir)` with the
 * indices of the two extremes (dir 1 climbing, -1 descending), in order and without gaps.
 */
function forEachLeg(ele: ArrayLike<number>, n: number, threshold: number, leg: (from: number, to: number, dir: 1 | -1) => void): void {
  if (n < 2) return;
  let dir: 0 | 1 | -1 = 0;
  let ref = 0;
  let ext = 0;
  let lo = 0;
  let hi = 0;
  for (let i = 1; i < n; i++) {
    const v = ele[i];
    if (dir === 0) {
      if (v < ele[lo]) lo = i;
      if (v > ele[hi]) hi = i;
      if (v - ele[lo] >= threshold) {
        dir = 1;
        ref = lo;
        ext = i;
      } else if (ele[hi] - v >= threshold) {
        dir = -1;
        ref = hi;
        ext = i;
      }
    } else if (dir === 1) {
      if (v > ele[ext]) ext = i;
      else if (ele[ext] - v >= threshold) {
        leg(ref, ext, 1);
        ref = ext;
        ext = i;
        dir = -1;
      }
    } else {
      if (v < ele[ext]) ext = i;
      else if (v - ele[ext] >= threshold) {
        leg(ref, ext, -1);
        ref = ext;
        ext = i;
        dir = 1;
      }
    }
  }
  if (dir !== 0) leg(ref, ext, dir);
}

/** Total ascent and descent over the first `n` samples. */
export function ascentDescent(ele: ArrayLike<number>, threshold = ASCENT_THRESHOLD_M, n = ele.length): { ascent: number; descent: number } {
  let ascent = 0;
  let descent = 0;
  forEachLeg(ele, n, threshold, (from, to, dir) => {
    if (dir === 1) ascent += ele[to] - ele[from];
    else descent += ele[from] - ele[to];
  });
  return { ascent, descent };
}

/**
 * 1 for samples whose interval (i − 1, i] lies inside a confirmed climbing leg. Time spent climbing is counted this way
 * rather than as "elevation rose this second", because a quantised altimeter on a slow climb steps up only every few
 * seconds.
 */
export function climbingSamples(ele: ArrayLike<number>, n = ele.length, threshold = ASCENT_THRESHOLD_M): Uint8Array {
  const out = new Uint8Array(n);
  forEachLeg(ele, n, threshold, (from, to, dir) => {
    if (dir === 1) out.fill(1, from + 1, to + 1);
  });
  return out;
}

/**
 * The same totals per sample: increment i belongs to the interval ending at sample i and sits where the elevation
 * actually reaches a new high (or low) within its leg, so a sum over any sample range (a lap) is that range's share.
 */
export function ascentIncrements(ele: ArrayLike<number>, n = ele.length, threshold = ASCENT_THRESHOLD_M): { up: Float64Array; down: Float64Array } {
  const up = new Float64Array(n);
  const down = new Float64Array(n);
  forEachLeg(ele, n, threshold, (from, to, dir) => {
    let edge = ele[from];
    for (let k = from + 1; k <= to; k++) {
      const v = ele[k];
      if (dir === 1 && v > edge) {
        up[k] = v - edge;
        edge = v;
      } else if (dir === -1 && v < edge) {
        down[k] = edge - v;
        edge = v;
      }
    }
  });
  return { up, down };
}
