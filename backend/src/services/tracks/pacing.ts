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
