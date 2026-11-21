/**
 * Which few photos of a visit or entry the matcher links on its own (owner,
 * 2026-11-21, after the first prod run linked 9,182 photos: "5–10 max pro
 * Aufenthalt … es muss Auswahlmöglichkeit geben"). The rest stay candidates
 * the user can choose from, or open in the photo source.
 *
 * The rule, one home for visits and entries:
 *  1. a photo within {@link NEAR_DUPLICATE_MS} of one already kept is the same
 *     moment (a burst) and is dropped;
 *  2. the survivors' time span is cut into `cap` equal slots and each slot
 *     contributes its closest photo to the place, so the picks spread over the
 *     whole window instead of being `cap` frames of one minute;
 *  3. slots that held nothing are filled with the closest remaining photos.
 *
 * Pure: no I/O, deterministic (ties fall back to time, then key).
 */

export const NEAR_DUPLICATE_MS = 5_000;

export interface SpreadItem {
  key: string;
  /** Capture instant, ms. */
  at: number;
  /** Distance to the place in km; null when unknown (ranks after any known one). */
  distanceKm: number | null;
}

const byDistance = (a: SpreadItem, b: SpreadItem): number =>
  (a.distanceKm ?? Number.POSITIVE_INFINITY) - (b.distanceKm ?? Number.POSITIVE_INFINITY) ||
  a.at - b.at ||
  a.key.localeCompare(b.key);

/** Drops photos within `gapMs` of the previous kept one, in time order. */
export function dropNearDuplicates(items: readonly SpreadItem[], gapMs = NEAR_DUPLICATE_MS) {
  const sorted = [...items].sort((a, b) => a.at - b.at || a.key.localeCompare(b.key));
  const kept: SpreadItem[] = [];
  for (const item of sorted) {
    const last = kept[kept.length - 1];
    if (last === undefined || item.at - last.at >= gapMs) {
      kept.push(item);
    } else if (byDistance(item, last) < 0) {
      // Same moment: the closer one stands for it.
      kept[kept.length - 1] = item;
    }
  }
  return kept;
}

/** The keys to keep, at most `cap`, in time order. */
export function pickSpread(items: readonly SpreadItem[], cap: number): SpreadItem[] {
  if (cap <= 0) return [];
  const pool = dropNearDuplicates(items);
  if (pool.length <= cap) return pool;
  const first = pool[0]!.at;
  const span = pool[pool.length - 1]!.at - first;
  const slots: SpreadItem[][] = Array.from({ length: cap }, () => []);
  for (const item of pool) {
    const slot = span === 0 ? 0 : Math.min(cap - 1, Math.floor(((item.at - first) / span) * cap));
    slots[slot]!.push(item);
  }
  const chosen: SpreadItem[] = [];
  const rest: SpreadItem[] = [];
  for (const slot of slots) {
    const ranked = [...slot].sort(byDistance);
    if (ranked.length > 0) chosen.push(ranked[0]!);
    rest.push(...ranked.slice(1));
  }
  rest.sort(byDistance);
  chosen.push(...rest.slice(0, cap - chosen.length));
  return chosen.sort((a, b) => a.at - b.at || a.key.localeCompare(b.key));
}
