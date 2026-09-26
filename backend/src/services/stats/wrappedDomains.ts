import { prisma } from "../../db";
import { countableFlightWhere } from "../../shared/flightCounting";
import { countableRailWhere, railYear } from "../../shared/railCounting";
import type { WrappedCruise, WrappedRail } from "./wrapped";

/**
 * The non-flight rows the year in review reads — loaded here so the stats
 * router, frozen at its size by the file-size ratchet, names one call instead
 * of a query per domain.
 *
 * Rail (2.7): the counted rides only (`shared/railCounting.ts`), each filed
 * under the year it LEFT on its departure station's calendar — the rule the
 * rail tab and the overview already follow.
 */
export async function loadWrappedDomains(
  userId: string
): Promise<{ cruises: WrappedCruise[]; rail: WrappedRail[] }> {
  const [cruises, rides] = await Promise.all([
    prisma.cruise.findMany({
      where: { userId, ...countableFlightWhere() },
      select: { startDate: true, status: true },
    }),
    prisma.railJourney.findMany({
      where: { userId, ...countableRailWhere() },
      select: {
        departureTime: true,
        arrivalTime: true,
        depTimezone: true,
        arrTimezone: true,
        distanceKm: true,
        distanceSource: true,
      },
    }),
  ]);
  return {
    cruises,
    rail: rides.map((r) => ({
      year: railYear(r),
      distanceKm: r.distanceKm,
      distanceSource: r.distanceSource,
    })),
  };
}
