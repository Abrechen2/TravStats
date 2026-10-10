import { prisma } from "../../db";
import { haversineKm } from "../../shared/geo/haversine";
import { VISIT_STOP_EXPLAINED_M } from "./visitStops";

/**
 * The nearest logged visit to each `visit` finding — part of the reasoning a
 * suggestion shows beside its photographs (forgejo#211, O5: "Yongsan Station,
 * 1.3 km" is why the War Memorial is a question at all).
 *
 * Candidates are the caller's visits in the finding's trip and their visits on
 * the finding's days in any trip, the set the scan itself measured against.
 * `sameDay` and `withinReach` together mean the scan's rule would now drop the
 * finding: a visit was logged there after the scan ran, and the reader is
 * told so instead of being offered a duplicate in silence.
 */

export interface NearestVisit {
  placeId: string;
  placeName: string;
  distanceKm: number;
  sameDay: boolean;
  /** Within the scan's 200 m "already explained" radius. */
  withinReach: boolean;
}

export interface NearestVisitInput {
  id: string;
  kind: string;
  tripId: string | null;
  lat: number;
  lon: number;
  /** The finding's first and last local day (YYYY-MM-DD), null without a zone. */
  startDay: string | null;
  endDay: string | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** A visit's local day: `visitedAt` holds the place's wall clock as fake UTC. */
const dayOf = (visitedAt: Date | null): string | null =>
  visitedAt ? visitedAt.toISOString().slice(0, 10) : null;

export async function nearestVisits(
  userId: string,
  rows: readonly NearestVisitInput[]
): Promise<Map<string, NearestVisit>> {
  const visitRows = rows.filter((row) => row.kind === "visit");
  const result = new Map<string, NearestVisit>();
  if (visitRows.length === 0) return result;

  const tripIds = [...new Set(visitRows.flatMap((row) => (row.tripId ? [row.tripId] : [])))];
  const days = visitRows.flatMap((row) => [row.startDay, row.endDay]).filter(Boolean) as string[];
  const dayRange =
    days.length > 0
      ? {
          gte: new Date(`${days.reduce((a, b) => (a < b ? a : b))}T00:00:00.000Z`),
          lt: new Date(
            Date.parse(`${days.reduce((a, b) => (a > b ? a : b))}T00:00:00.000Z`) + DAY_MS
          ),
        }
      : null;

  const visits = await prisma.placeVisit.findMany({
    where: {
      userId,
      OR: [
        ...(tripIds.length > 0 ? [{ tripId: { in: tripIds } }] : []),
        ...(dayRange ? [{ visitedAt: dayRange }] : []),
      ],
    },
    select: {
      tripId: true,
      visitedAt: true,
      place: { select: { id: true, name: true, lat: true, lon: true } },
    },
  });

  for (const row of visitRows) {
    let best: NearestVisit | null = null;
    for (const visit of visits) {
      const day = dayOf(visit.visitedAt);
      const sameDay =
        day !== null && row.startDay !== null && row.endDay !== null
          ? day >= row.startDay && day <= row.endDay
          : false;
      if (!sameDay && (row.tripId === null || visit.tripId !== row.tripId)) continue;
      const km = haversineKm(row, visit.place);
      if (best === null || km < best.distanceKm) {
        best = {
          placeId: visit.place.id,
          placeName: visit.place.name,
          distanceKm: Math.round(km * 100) / 100,
          sameDay,
          withinReach: sameDay && km * 1000 <= VISIT_STOP_EXPLAINED_M,
        };
      }
    }
    if (best) result.set(row.id, best);
  }
  return result;
}
