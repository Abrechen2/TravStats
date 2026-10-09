import type { EvidenceEntry } from "../../../schemas/evidence";

/**
 * The entries behind one insight figure, kept as the figure is COMPUTED rather
 * than re-derived for the evidence panel afterwards.
 *
 * The statistics expansion (forgejo#258/#259/#260/#264) adds a few dozen new
 * figures. Writing each one twice — once for the tile, once for the panel that
 * lists what produced it — is how a panel comes to name a stay the tile never
 * counted. So every insight module emits ITEMS while it counts: the tile's
 * number is folded from them (`totalsOf`) and the panel pages through them
 * (`services/evidence/metricEvidenceInsights.ts`). One pass, two readers.
 *
 * `year` is the year the contribution belongs to under that figure's own time
 * rule (a night's local date, a visit's local day, a tour's date), or null
 * when the record cannot be placed in one. A null-year item counts in the
 * lifetime figure and in no year — the rule every undated record follows.
 */
export type EntryRef = Omit<EvidenceEntry, "contribution" | "credits" | "creditLabels">;

export interface MeasureItem {
  entry: EntryRef;
  year: number | null;
  /** `sum` measures: this entry's share, in the measure's unit. */
  contribution?: number;
  /** `distinct` measures: the units this entry witnesses. */
  credits?: string[];
  creditLabels?: Record<string, string>;
}

export type MeasureItems = Record<string, MeasureItem[]>;

export interface MeasureTotal {
  allTime: number;
  /** Keyed by the year as a string; a year with nothing has no key, never a 0. */
  byYear: Record<string, number>;
}

function isDistinct(items: readonly MeasureItem[]): boolean {
  return items.some((i) => i.credits !== undefined);
}

function foldOne(items: readonly MeasureItem[]): number {
  if (isDistinct(items)) return new Set(items.flatMap((i) => i.credits ?? [])).size;
  return items.reduce((sum, i) => sum + (i.contribution ?? 0), 0);
}

/** The figure per measure, lifetime and per year, folded from its own items. */
export function totalsOf(items: MeasureItems): Record<string, MeasureTotal> {
  const out: Record<string, MeasureTotal> = {};
  for (const [key, list] of Object.entries(items)) {
    const years = new Map<number, MeasureItem[]>();
    for (const item of list) {
      if (item.year === null) continue;
      const bucket = years.get(item.year);
      if (bucket) bucket.push(item);
      else years.set(item.year, [item]);
    }
    const byYear: Record<string, number> = {};
    for (const [year, bucket] of [...years.entries()].sort(([a], [b]) => a - b)) {
      byYear[String(year)] = foldOne(bucket);
    }
    out[key] = { allTime: foldOne(list), byYear };
  }
  return out;
}

/**
 * The items of one measure for a period, merged per entry: a stay whose nights
 * straddle New Year is two items (one per year) and ONE row in a lifetime list.
 */
export function itemsFor(items: readonly MeasureItem[], year: number | undefined): MeasureItem[] {
  const scoped = year === undefined ? items : items.filter((i) => i.year === year);
  const merged = new Map<string, MeasureItem>();
  for (const item of scoped) {
    const seen = merged.get(item.entry.id);
    if (!seen) {
      merged.set(item.entry.id, { ...item });
      continue;
    }
    merged.set(item.entry.id, {
      ...seen,
      contribution:
        seen.contribution === undefined && item.contribution === undefined
          ? undefined
          : (seen.contribution ?? 0) + (item.contribution ?? 0),
      credits:
        seen.credits === undefined && item.credits === undefined
          ? undefined
          : [...new Set([...(seen.credits ?? []), ...(item.credits ?? [])])],
      creditLabels:
        seen.creditLabels || item.creditLabels
          ? { ...seen.creditLabels, ...item.creditLabels }
          : undefined,
    });
  }
  return [...merged.values()];
}
