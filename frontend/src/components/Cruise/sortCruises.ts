import type { Cruise, CruiseStatus } from "../../types";
import { countUniquePorts } from "./cruisePorts";

export type CruiseSortKey = "date" | "ship" | "line" | "ports" | "status" | "price";
export type SortOrder = "asc" | "desc";

// Upcoming-first rank when ascending; unknown → end (see `?? 99` fallback
// below). in_progress (#status-from-dates) sits between scheduled and flown —
// it mirrors the cruise's actual lifecycle (scheduled → in_progress → flown).
const STATUS_RANK: Record<CruiseStatus, number> = {
  scheduled: 0,
  in_progress: 1,
  flown: 2,
  historical: 3,
  cancelled: 4,
};

const shipName = (c: Cruise): string => (c.ship?.name ?? c.shipNameOverride ?? "").trim();
const lineName = (c: Cruise): string => (c.cruiseLine ?? c.ship?.cruiseLine ?? "").trim();

// Comparator returning [isNull, value] so null/blank entries always land last
// regardless of sort direction.
function keyOf(c: Cruise, sortBy: CruiseSortKey): { nul: boolean; num?: number; str?: string } {
  switch (sortBy) {
    case "date": {
      const v = c.startDate ? Date.parse(c.startDate) : NaN;
      return { nul: Number.isNaN(v), num: v };
    }
    case "price":
      return { nul: c.price === null || c.price === undefined, num: c.price ?? NaN };
    case "ports":
      return { nul: false, num: countUniquePorts(c) };
    case "status":
      return { nul: false, num: STATUS_RANK[c.status] ?? 99 };
    case "ship": {
      const s = shipName(c);
      return { nul: s === "", str: s };
    }
    case "line": {
      const s = lineName(c);
      return { nul: s === "", str: s };
    }
  }
}

export function sortCruises(list: Cruise[], sortBy: CruiseSortKey, order: SortOrder): Cruise[] {
  const dir = order === "asc" ? 1 : -1;
  return [...list].sort((a, b) => {
    const ka = keyOf(a, sortBy);
    const kb = keyOf(b, sortBy);
    if (ka.nul !== kb.nul) return ka.nul ? 1 : -1; // nulls always last
    if (ka.nul && kb.nul) return 0;
    if (ka.str !== undefined && kb.str !== undefined) {
      return ka.str.localeCompare(kb.str, undefined, { sensitivity: "base" }) * dir;
    }
    return ((ka.num as number) - (kb.num as number)) * dir;
  });
}
