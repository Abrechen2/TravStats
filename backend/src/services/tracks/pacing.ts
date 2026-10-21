/**
 * Long track computations written ONCE, run two ways (forgejo#319).
 *
 * The jitter filter is linear — about a microsecond a fix, ~100 ms for
 * 100 000 — but the trip recording's map reruns it on EVERY read over the
 * whole recording, which has no upper size: a phone recording a long trip
 * keeps adding batches. Run straight through, a recording of a few hundred
 * thousand fixes held the server's single event loop for a third of a
 * second per page view, and every other request waited behind it.
 *
 * So the filter is a generator that yields at checkpoints, one every
 * `CHECKPOINT_EVERY` loop steps. `runPaced` runs it straight through, for the
 * callers whose input is already bounded by the request that brought it (an
 * upload's point cap or body limit), and where the parse and the
 * simplification of the same points cost as much again without yielding.
 * `runPacedYielding` hands the event loop back whenever a slice has run
 * `sliceMs`, for the reads that are not bounded. Both produce the same
 * result: the yields carry no values and change nothing.
 */
export type Paced<T> = Generator<void, T, void>;

/** Loop steps between checkpoints: ~1 ms of filter work, so a yield costs nothing measurable. */
export const CHECKPOINT_EVERY = 1024;

/** Whether loop step `k` is a checkpoint. */
export function isCheckpoint(k: number): boolean {
  return k % CHECKPOINT_EVERY === CHECKPOINT_EVERY - 1;
}

/** Runs paced work to its end without ever yielding. */
export function runPaced<T>(work: Paced<T>): T {
  let step = work.next();
  while (!step.done) step = work.next();
  return step.value;
}

/** The longest the event loop is held between two yields, by default. */
export const DEFAULT_SLICE_MS = 10;

/** Runs paced work, handing the event loop back after every `sliceMs` of it. */
export async function runPacedYielding<T>(work: Paced<T>, sliceMs = DEFAULT_SLICE_MS): Promise<T> {
  let sliceStarted = performance.now();
  let step = work.next();
  while (!step.done) {
    if (performance.now() - sliceStarted >= sliceMs) {
      await new Promise<void>((resolve) => setImmediate(resolve));
      sliceStarted = performance.now();
    }
    step = work.next();
  }
  return step.value;
}

/**
 * The median of `values`, by selection rather than a sort, with checkpoints:
 * a stay of a million fixes has a million accuracies, and sorting them held
 * the loop for half a second (final review of forgejo#319). Reorders
 * `values`. The mean of the two middle values when their number is even.
 */
export function* medianPaced(values: Float64Array): Paced<number> {
  const n = values.length;
  if (n === 0) return NaN;
  const mid = n >> 1;
  const upper = yield* selectPaced(values, mid);
  if (n % 2 === 1) return upper;
  // Everything left of `mid` is now <= the upper middle; the lower middle is their largest.
  let lower = -Infinity;
  for (let k = 0; k < mid; k++) {
    if (values[k] > lower) lower = values[k];
    if (isCheckpoint(k)) yield;
  }
  return (lower + upper) / 2;
}

/**
 * Hoare's selection: puts the `k`-th smallest at `k`, smaller left, larger
 * right. Median of three keeps sorted and reversed input linear, but a
 * crafted "median-of-3 killer" order shrinks the range by two per round and
 * makes it quadratic — and the values are an upload's fixes. So, as in
 * introselect: after `2 · log2(n)` rounds the remaining range is sorted
 * instead, which bounds the whole selection at O(n log n) whatever the order.
 */
function* selectPaced(values: Float64Array, k: number): Paced<number> {
  let lo = 0;
  let hi = values.length - 1;
  let steps = 0;
  const maxRounds = 2 * Math.ceil(Math.log2(values.length + 1));
  for (let round = 0; lo < hi; round++) {
    if (round >= maxRounds) {
      // A typed sort is numeric and in place: the range ends ordered, so
      // everything left of `k` stays <= it, as the median's even case needs.
      values.subarray(lo, hi + 1).sort();
      break;
    }
    const m = (lo + hi) >> 1;
    if (values[m] < values[lo]) swap(values, m, lo);
    if (values[hi] < values[lo]) swap(values, hi, lo);
    if (values[hi] < values[m]) swap(values, hi, m);
    const pivot = values[m];
    let i = lo;
    let j = hi;
    while (i <= j) {
      while (values[i] < pivot) i++;
      while (values[j] > pivot) j--;
      if (i <= j) {
        swap(values, i, j);
        i++;
        j--;
      }
      if (isCheckpoint(steps++)) yield;
    }
    if (k <= j) hi = j;
    else if (k >= i) lo = i;
    else break;
  }
  return values[k];
}

function swap(values: Float64Array, a: number, b: number): void {
  const t = values[a];
  values[a] = values[b];
  values[b] = t;
}
