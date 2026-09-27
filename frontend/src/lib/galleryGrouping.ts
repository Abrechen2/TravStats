import { localDay } from "../shared/time";
import { todayZoneNow } from "../hooks/useTodayZone";

/** Minimal shape this module needs — anything carrying a capture timestamp. */
export interface DatedAsset {
  readonly takenAt: string | null;
}

/** An asset plus its position in the ORIGINAL flat list. */
export type IndexedAsset<T> = T & { readonly index: number };

export interface DayGroup<T> {
  /** Calendar day in the profile zone as YYYY-MM-DD, or null for photos without a date. */
  readonly day: string | null;
  readonly assets: readonly IndexedAsset<T>[];
}

/**
 * Calendar day of an instant in `zone`, as YYYY-MM-DD.
 *
 * An Immich asset carries no zone of its own, so the day is read in the
 * user's PROFILE zone (ADR 0002 Q1) — the same answer on every device —
 * rather than in whatever zone the browser happens to be set to, which split
 * one evening's photos across two days for a reader abroad.
 */
function dayIn(iso: string, zone: string): string | null {
  if (Number.isNaN(Date.parse(iso))) return null;
  return localDay(iso, zone);
}

/**
 * Split an album into consecutive day groups, preserving the incoming order.
 *
 * The caller is expected to hand these over already sorted chronologically —
 * the backend does that — so this only walks the list and cuts where the day
 * changes. Photos without a usable date cannot be placed on the timeline, so
 * they collect in a single trailing group instead of being dropped or sorted
 * to the front.
 */
export function groupByDay<T extends DatedAsset>(
  assets: readonly T[],
  zone: string = todayZoneNow()
): DayGroup<T>[] {
  const groups: DayGroup<T>[] = [];
  const undated: IndexedAsset<T>[] = [];

  assets.forEach((asset, index) => {
    const indexed = { ...asset, index } as IndexedAsset<T>;
    const day = asset.takenAt ? dayIn(asset.takenAt, zone) : null;

    if (day === null) {
      undated.push(indexed);
      return;
    }

    const last = groups[groups.length - 1];
    if (last && last.day === day) {
      (last.assets as IndexedAsset<T>[]).push(indexed);
    } else {
      groups.push({ day, assets: [indexed] });
    }
  });

  if (undated.length > 0) groups.push({ day: null, assets: undated });
  return groups;
}
