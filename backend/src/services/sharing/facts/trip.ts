import type { Prisma, Trip } from "../../../prisma";
import { pickFacts } from "./pick";

/**
 * The trip's own facts: its name, span (as stored, with zones — ADR 0002),
 * status and where it goes. Private: notes, summary, tags, companions, cover
 * image (a file of the sharer's), category.
 */
export const TRIP_FACT_FIELDS = [
  "name",
  "description",
  "color",
  "icon",
  "startDate",
  "endDate",
  "startDay",
  "endDay",
  "startZone",
  "endZone",
  "status",
  "originLabel",
  "destinationLabel",
  "countries",
] as const satisfies readonly (keyof Trip)[];

export type TripFactField = (typeof TRIP_FACT_FIELDS)[number];

export function tripFacts(row: Pick<Trip, TripFactField>) {
  return pickFacts(row, TRIP_FACT_FIELDS) satisfies Partial<Prisma.TripUncheckedCreateInput>;
}
