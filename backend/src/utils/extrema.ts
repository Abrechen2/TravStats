/**
 * The least and greatest of a list of numbers, iteratively. Never
 * `Math.min(...values)`: a spread passes every element as an argument and
 * throws a RangeError past the engine's ceiling (around 100k–200k values) —
 * a TravTrack history or a recording passes it (Codex review of TravTrack;
 * `parseGpx.ts` met the same). Null for an empty list, never ±Infinity.
 */
export function extentOf(values: Iterable<number>): { min: number; max: number } | null {
  let min = Infinity;
  let max = -Infinity;
  for (const v of values) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return min <= max ? { min, max } : null;
}

export const minOf = (values: Iterable<number>): number | null => extentOf(values)?.min ?? null;
export const maxOf = (values: Iterable<number>): number | null => extentOf(values)?.max ?? null;
