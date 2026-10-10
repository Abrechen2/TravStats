/**
 * Evidence measures — the year in review's chapter cards and the overview's
 * travel records (forgejo#265). A chapter lists the rows its card counted, as
 * the loader filed them (`services/stats/wrappedDomains.ts`); a record lists
 * its one witness, the entry that holds it (a one-row sum — release 1 serves
 * no extremum).
 *
 * MIRRORED at `backend/src/shared/evidenceMeasuresOverview.ts`.
 */
import type { MeasureSpec } from "./evidenceMeasures";

const chapter = (unit: string): MeasureSpec => ({
  aggregation: "sum",
  unit,
  scopes: ["year"],
  surface: "WrappedChapterCards",
  calculator: "services/evidence/metricEvidenceWrapped.ts over services/stats/wrappedChapters.ts",
  servedIn: 1,
});

const record = (unit: string): MeasureSpec => ({
  aggregation: "sum",
  unit,
  scopes: ["allTime"],
  surface: "DomainRecordsSection",
  calculator:
    "services/evidence/metricEvidenceDomainRecords.ts over services/stats/domainRecords.ts",
  servedIn: 1,
});

export const OVERVIEW_MEASURES: Record<string, MeasureSpec> = {
  wrappedStayCount: chapter("stays"),
  wrappedPlaceVisitCount: chapter("visits"),
  wrappedRoadtripCount: chapter("roadtrips"),
  wrappedTourCount: chapter("tours"),
  wrappedRentalCount: chapter("rentals"),
  wrappedBusRideCount: chapter("rides"),
  recordLongestCruise: record("days"),
  recordLongestStay: record("nights"),
  recordMostVisitedPlace: record("visits"),
  recordLongestRoadtrip: record("days"),
  recordLongestRailRide: record("km"),
  recordLongestRental: record("days"),
  recordLongestBusRide: record("km"),
};
