import type { Prisma, TripStop } from "../../../prisma";
import { pickFacts } from "./pick";

/**
 * A timeline stop's facts: what and where it is, and when, as stored with
 * its zone (ADR 0002). Private: notes. Not copied at all: the roadtrip
 * membership (`routeId`, `routeOrderIdx`, `overnight`, `viaPoint`) — a
 * roadtrip is not part of S1 — and `placeId`, which names a place of the
 * sharer's own. `sourceId`/`lodgingStayId` point at the sharer's rows and are
 * re-pointed by the caller at the recipient's copies.
 */
export const STOP_FACT_FIELDS = [
  "orderIdx",
  "domain",
  "title",
  "description",
  "startDate",
  "endDate",
  "lat",
  "lon",
  "startUtc",
  "endUtc",
  "stopZone",
  "precision",
] as const satisfies readonly (keyof TripStop)[];

export type StopFactField = (typeof STOP_FACT_FIELDS)[number];

export function stopFacts(row: Pick<TripStop, StopFactField>) {
  return pickFacts(row, STOP_FACT_FIELDS) satisfies Partial<Prisma.TripStopUncheckedCreateInput>;
}
