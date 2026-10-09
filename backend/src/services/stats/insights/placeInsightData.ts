import { prisma } from "../../../db";
import type { InsightPlace } from "../../../utils/placeInsights";

/**
 * Every place of a user with its visits, each visit's photo count and trip,
 * for the places insights (forgejo#259). Unfiltered — which places and
 * visits count is `shared/placeCounting.ts`'s decision downstream.
 */
export async function loadPlaceInsightPlaces(userId: string): Promise<InsightPlace[]> {
  const rows = await prisma.place.findMany({
    where: { userId },
    select: {
      id: true,
      name: true,
      category: true,
      city: true,
      isoCountryCode: true,
      lat: true,
      lon: true,
      visited: true,
      visits: {
        select: {
          id: true,
          visitedAt: true,
          visitedAtUtc: true,
          visitedZone: true,
          visitedPrecision: true,
          notes: true,
          rating: true,
          trip: { select: { id: true, name: true } },
          _count: { select: { photos: true } },
        },
      },
    },
  });
  return rows.map((p) => ({
    ...p,
    visits: p.visits.map(({ _count, ...v }) => ({ ...v, photoCount: _count.photos })),
  }));
}
