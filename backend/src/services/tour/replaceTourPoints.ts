import { prisma } from "../../db";
import { AppError } from "../../middleware/errorHandler";
import type { TourPointsInput } from "../../schemas/tour";
import { recomputeLegs, type StopCoords } from "./legRecompute";
import { autoRouteNewLegs } from "./routing/autoRouteLegs";
import logger from "../../utils/logger";
import { readRouteAndLegs, ROUTE_SELECT } from "../../routes/trips/tourRoutes";

/**
 * A point as the writer takes it. `notes` is absent from the editor's body
 * (`tourPointsSchema`) and present in the spreadsheet: absent leaves a point's
 * note as it is, so the editor saving an order cannot wipe what a file wrote.
 */
export type TourPoint = TourPointsInput["points"][number] & { notes?: string | null };

/** The columns every response that lists a tour's points carries. */
export const TOUR_POINT_SELECT = {
  id: true,
  title: true,
  lat: true,
  lon: true,
  notes: true,
  routeOrderIdx: true,
} as const;

/**
 * The point list of a STANDALONE tour — the ONE writer of it. The editor
 * (`PUT /tours/:routeId/points`) and the spreadsheet import both come here, so
 * a rule about a tour's points cannot hold on one path and not the other.
 *
 * The list is complete and ordered and replaces what the tour had — added,
 * moved, removed and renumbered in one write. All-or-nothing, like the assign
 * endpoint, and for the same reason: a half-applied list leaves legs pointing
 * at points that are no longer in the tour.
 *
 * It refuses a tour that HAS a trip, rather than quietly doing something
 * reasonable. Those points are the trip's timeline stops, edited at the trip;
 * silently writing a second, trip-less copy of one is exactly the duplicate
 * this split avoids.
 *
 * `routeId` must already be resolved as the caller's tour.
 */
export async function replaceTourPoints(
  userId: string,
  routeId: string,
  points: readonly TourPoint[]
) {
  const section = await prisma.tripRoute.findUniqueOrThrow({
    where: { id: routeId },
    select: { tripId: true, mode: true },
  });
  if (section.tripId !== null) {
    throw new AppError(
      "This tour belongs to a trip — assign its stops through the trip instead",
      409
    );
  }

  const givenIds = points.flatMap((p) => (p.id === undefined ? [] : [p.id]));
  if (new Set(givenIds).size !== givenIds.length) {
    throw new AppError("A point may appear once — a loop is two points at one place", 400);
  }

  const saved = await prisma.$transaction(
    async (tx) => {
      // Every id the body names must already be a point of THIS tour.
      // Without this an id from a stranger's tour would be adopted by the
      // update below, which filters on the id alone.
      const existing = await tx.tripStop.findMany({ where: { routeId }, select: { id: true } });
      const known = new Set(existing.map((s) => s.id));
      const unknown = givenIds.find((id) => !known.has(id));
      if (unknown !== undefined) {
        throw new AppError("A point id does not belong to this tour", 400);
      }

      // Clear the NUMBERING before writing the new one, or
      // `@@unique([routeId, routeOrderIdx])` collides with the old positions.
      // Only the index: Postgres skips that unique where either column is
      // null, so clearing one is enough — and clearing `routeId` too would
      // momentarily leave these points attached to nothing, which
      // `trip_stops_trip_or_route` refuses outright.
      await tx.tripStop.updateMany({ where: { routeId }, data: { routeOrderIdx: null } });

      const ordered: StopCoords[] = [];
      for (const [index, point] of points.entries()) {
        const data = {
          title: point.title,
          lat: point.lat,
          lon: point.lon,
          ...(point.notes !== undefined ? { notes: point.notes } : {}),
          routeId,
          routeOrderIdx: index,
        };
        const row =
          point.id === undefined
            ? // No trip: this point exists only as a vertex of this tour,
              // which is what `trip_stops_trip_or_route` allows and what the
              // tour's own owner accounts for.
              await tx.tripStop.create({
                data: { ...data, tripId: null },
                select: { id: true, lat: true, lon: true },
              })
            : await tx.tripStop.update({
                where: { id: point.id },
                data,
                select: { id: true, lat: true, lon: true },
              });
        ordered.push(row);
      }

      // Whatever the new list left behind: still on this tour, but with no
      // position, because every point the list DID name was renumbered
      // above. A point nobody placed is a point the reader removed.
      await tx.tripStop.deleteMany({ where: { routeId, routeOrderIdx: null } });

      const createdLegs = await recomputeLegs(tx, routeId, section.mode, ordered);

      return {
        createdLegs,
        route: await tx.tripRoute.findUniqueOrThrow({
          where: { id: routeId },
          include: ROUTE_SELECT,
        }),
        stops: await tx.tripStop.findMany({
          where: { routeId },
          orderBy: { routeOrderIdx: "asc" },
          select: TOUR_POINT_SELECT,
        }),
        legs: await tx.tripRouteLeg.findMany({
          where: { routeId },
          orderBy: { fromStop: { routeOrderIdx: "asc" } },
        }),
      };
    },
    // The assign endpoint raises this for the same reason: a long list is
    // one round trip per point, and the default 5000ms is not a budget
    // anyone measured.
    { timeout: 20_000 }
  );

  logger.info({ operation: "tour.points.replace", routeId, count: points.length });
  const routedCount = await autoRouteNewLegs(userId, routeId, saved.createdLegs);
  const { route, legs } = routedCount > 0 ? await readRouteAndLegs(routeId) : saved;
  return { route, legs, stops: saved.stops };
}
