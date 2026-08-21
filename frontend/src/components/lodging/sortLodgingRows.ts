import type { Lodging } from "../../types/lodging";
import { LIFECYCLE_SORT_RANK, lodgingLifecycleStatus } from "./lodgingLifecycle";

/**
 * Client-side comparator for the lodging list table — the extract-the-
 * comparator pattern the cruises page uses (`sortCruises.ts`). Safe to run
 * client-side because `listLodgings` walks EVERY page into memory before the
 * caller sees it, so the sort always covers the complete set, never one
 * paginated slice (the trap the old server-side-only comment warned about).
 */
export type LodgingSortKey =
  | "name"
  | "chain"
  | "location"
  | "status"
  | "stays"
  | "nights"
  | "rating"
  | "spend";

/** Columns that read naturally ascending on first click; the rest start descending. */
export const LODGING_SORT_DEFAULT_ASC: readonly LodgingSortKey[] = [
  "name",
  "chain",
  "location",
  "status",
];

export function sortLodgingRows(
  rows: readonly Lodging[],
  sortBy: LodgingSortKey,
  sortOrder: "asc" | "desc"
): Lodging[] {
  const compare = (a: Lodging, b: Lodging): number => {
    switch (sortBy) {
      case "name":
        return a.name.localeCompare(b.name);
      case "chain":
        // Independent houses sort after every named chain, not between them.
        return (a.chain?.name ?? "￿").localeCompare(b.chain?.name ?? "￿");
      case "location":
        return (a.city || a.country || "￿").localeCompare(b.city || b.country || "￿");
      case "status": {
        // Running first, then booked, then past, then cancelled-only;
        // stayless (bookmarked) houses last.
        const ra = rankOf(a);
        const rb = rankOf(b);
        return ra - rb;
      }
      case "stays":
        return a.stayCount - b.stayCount;
      case "nights":
        return a.nights - b.nights;
      case "rating":
        return (a.overallRating ?? -1) - (b.overallRating ?? -1);
      case "spend":
        return a.totalSpendBase - b.totalSpendBase;
    }
  };
  return [...rows].sort((a, b) => {
    const comparison = compare(a, b);
    return sortOrder === "asc" ? comparison : -comparison;
  });
}

function rankOf(l: Lodging): number {
  const status = lodgingLifecycleStatus(l.stays);
  return status === null ? 4 : LIFECYCLE_SORT_RANK[status];
}
