import { roadtripCountsIn } from "../../../shared/tour/roadtripListScope";
import { loadRoadtripListFacts } from "../../roadtrip/roadtripList";
import type { MeasureTotal } from "./measureItems";

/**
 * `totals.roadtripsCount` of the roadtrip insights (companion#85): how many
 * roadtrips there are, by the one rule the statistics tab's "roadtrips" tile
 * and its evidence panel already use (`roadtripCountsIn`) — a roadtrip that has
 * not started counts nowhere, one that has belongs to the year it started, an
 * undated one counts in the lifetime figure and in no year. Kept beside the
 * measure totals rather than inside them: it is a count of rows the list
 * reads, not a fold of insight items.
 */
export function roadtripsCountTotal(
  roadtrips: ReadonlyArray<{ startDate: string | null }>,
  at: Date
): MeasureTotal {
  const byYear: Record<string, number> = {};
  for (const r of roadtrips) {
    if (r.startDate === null) continue;
    const year = Number(r.startDate.slice(0, 4));
    if (!roadtripCountsIn(r.startDate, year, at)) continue;
    byYear[String(year)] = (byYear[String(year)] ?? 0) + 1;
  }
  return {
    allTime: roadtrips.filter((r) => roadtripCountsIn(r.startDate, null, at)).length,
    byYear: Object.fromEntries(Object.entries(byYear).sort(([a], [b]) => Number(a) - Number(b))),
  };
}

export async function loadRoadtripsCount(userId: string, at: Date): Promise<MeasureTotal> {
  return roadtripsCountTotal(await loadRoadtripListFacts(userId), at);
}
