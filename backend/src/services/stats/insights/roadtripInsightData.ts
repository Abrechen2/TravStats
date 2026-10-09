import { prisma } from "../../../db";
import type { InsightRoadtrip } from "../../../utils/roadtripInsights";

/**
 * Every roadtrip of a user with its stations (route corrections included —
 * legs run through them) and legs, for the roadtrip insights (forgejo#260).
 */
export async function loadInsightRoadtrips(userId: string): Promise<InsightRoadtrip[]> {
  const rows = await prisma.tripRoute.findMany({
    where: { userId, kind: "roadtrip" },
    select: {
      id: true,
      name: true,
      vehicle: true,
      legs: {
        select: { fromStopId: true, toStopId: true, mode: true, source: true, distanceKm: true },
      },
      stops: {
        orderBy: { routeOrderIdx: "asc" },
        select: {
          id: true,
          title: true,
          lat: true,
          lon: true,
          startDate: true,
          endDate: true,
          stopZone: true,
          overnight: true,
          viaPoint: true,
          lodgingStayId: true,
          lodgingStay: {
            select: {
              id: true,
              checkIn: true,
              checkOut: true,
              datePrecision: true,
              nights: true,
              status: true,
              lodging: { select: { type: true, isoCountryCode: true } },
            },
          },
        },
      },
    },
  });
  return rows.map(({ stops, ...r }) => ({ ...r, stations: stops }));
}
