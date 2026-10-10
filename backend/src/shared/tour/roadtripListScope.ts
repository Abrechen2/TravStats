/**
 * Which roadtrips the statistics tab's list tiles count for a period
 * (forgejo#260): count, distance, nights and countries, and the two record
 * lists and the vehicles beside them.
 *
 * A roadtrip that has not STARTED is planned and counts nowhere; one that has
 * belongs to the year it started — the rule cruises follow. `startDate` is the
 * span start the roadtrip list answers (`spanOf`: the earliest station day,
 * else a linked stay's check-in), an ISO instant at UTC midnight of the day
 * the user typed, so its UTC date IS that day. An undated roadtrip counts in
 * the lifetime view and in no year.
 *
 * The browser folds the tiles with it and the evidence panel lists the
 * roadtrips with it (`services/evidence/metricEvidenceRoadtrip.ts`), so the
 * panel names exactly the roadtrips the tile counted.
 *
 * MIRRORED at `frontend/src/shared/tour/roadtripListScope.ts`; change both together.
 */
export function roadtripCountsIn(
  startDate: string | null,
  year: number | null,
  now: Date
): boolean {
  if (startDate !== null && Date.parse(startDate) > now.getTime()) return false;
  if (year === null) return true;
  return startDate !== null && Number(startDate.slice(0, 4)) === year;
}
