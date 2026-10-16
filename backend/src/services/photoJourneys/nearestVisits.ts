import { prisma } from "../../db";
import { haversineKm } from "../../shared/geo/haversine";
import { VISIT_STOP_EXPLAINED_M } from "./visitStops";
import { visitDay } from "../places/visitTrip";

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

/**
 * The instants that can hold a visit on these local days. A day at the place
 * starts up to 14 h before and ends up to 12 h after the same UTC date, so one
 * day of margin on each side; the exact day is decided by `visitDay` below.
 */
function dayWindow(first: string, last: string): { gte: Date; lt: Date } {
  return {
    gte: new Date(Date.parse(`${first}T00:00:00.000Z`) - DAY_MS),
    lt: new Date(Date.parse(`${last}T00:00:00.000Z`) + 2 * DAY_MS),
  };
}

export async function nearestVisits(
  userId: string,
  rows: readonly NearestVisitInput[]
): Promise<Map<string, NearestVisit>> {
  const visitRows = rows.filter((row) => row.kind === "visit");
  const result = new Map<string, NearestVisit>();
  if (visitRows.length === 0) return result;

  const tripIds = [...new Set(visitRows.flatMap((row) => (row.tripId ? [row.tripId] : [])))];
  // One window per finding, not one from the oldest finding to the newest: a
  // January and a December finding loaded every visit of the year between.
  const windows = [
    ...new Map(
      visitRows.flatMap((row) =>
        row.startDay && row.endDay
          ? [[`${row.startDay}|${row.endDay}`, dayWindow(row.startDay, row.endDay)] as const]
          : []
      )
    ).values(),
  ];

  const visits = await prisma.placeVisit.findMany({
    where: {
      userId,
      OR: [
        ...(tripIds.length > 0 ? [{ tripId: { in: tripIds } }] : []),
        ...windows.flatMap((w) => [{ visitedAtUtc: w }, { visitedAtUtc: null, visitedAt: w }]),
      ],
    },
    select: {
      tripId: true,
      visitedAt: true,
      visitedAtUtc: true,
      visitedZone: true,
      visitedPrecision: true,
      place: { select: { id: true, name: true, lat: true, lon: true } },
    },
  });

  for (const row of visitRows) {
    let best: NearestVisit | null = null;
    for (const visit of visits) {
      const day = visitDay(visit);
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
