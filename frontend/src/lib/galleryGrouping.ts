/** Minimal shape this module needs — anything carrying a capture timestamp. */
export interface DatedAsset {
  readonly takenAt: string | null;
}

/** An asset plus its position in the ORIGINAL flat list. */
export type IndexedAsset<T> = T & { readonly index: number };

export interface DayGroup<T> {
  /** Local calendar day as YYYY-MM-DD, or null for photos without a date. */
  readonly day: string | null;
  readonly assets: readonly IndexedAsset<T>[];
}

/**
 * Local calendar day of an instant, as YYYY-MM-DD.
 *
 * Deliberately the VIEWER's day rather than the day where the picture was
 * taken: an asset carries no timezone of its own, and every other rendering of
 * `takenAt` in the app is viewer-local too. Inventing a second convention here
 * would put two different dates on the same photo.
 */
function localDay(iso: string): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
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
export function groupByDay<T extends DatedAsset>(assets: readonly T[]): DayGroup<T>[] {
  const groups: DayGroup<T>[] = [];
  const undated: IndexedAsset<T>[] = [];

  assets.forEach((asset, index) => {
    const indexed = { ...asset, index } as IndexedAsset<T>;
    const day = asset.takenAt ? localDay(asset.takenAt) : null;

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
