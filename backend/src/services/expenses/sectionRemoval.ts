import { prisma, type DbTransaction } from "../../db";

/**
 * What happens to a section's costs when the section is removed (owner,
 * 2026-10-01, forgejo#140). Every path that removes a roadtrip or tour — its
 * delete endpoint, the rail conversion, a spreadsheet `replace` — goes
 * through these two functions, so none of them can lose money in silence.
 *
 * - On a trip: the costs become the trip's trip-wide costs. Their station and
 *   leg pins are cleared, because the stops go with the section; amount,
 *   currency, day, kind and note stay.
 * - Without a trip: there is nowhere to hand them. The caller must refuse,
 *   or delete them only on an explicit opt-in.
 */

/** How many costs sit on those of `routeIds` that belong to no trip. */
export async function standaloneExpenseCount(routeIds: readonly string[]): Promise<number> {
  if (routeIds.length === 0) return 0;
  return prisma.tripExpense.count({
    where: { routeId: { in: [...routeIds] }, route: { tripId: null } },
  });
}

/** Re-file the costs of each section that has a trip onto that trip. Call inside the delete's transaction. */
export async function handExpensesToTrips(
  tx: DbTransaction,
  routeIds: readonly string[]
): Promise<void> {
  if (routeIds.length === 0) return;
  const routes = await tx.tripRoute.findMany({
    where: { id: { in: [...routeIds] }, tripId: { not: null } },
    select: { id: true, tripId: true },
  });
  for (const route of routes) {
    await tx.tripExpense.updateMany({
      where: { routeId: route.id },
      data: {
        routeId: null,
        tripId: route.tripId,
        stopId: null,
        legFromStopId: null,
        legToStopId: null,
      },
    });
  }
}
