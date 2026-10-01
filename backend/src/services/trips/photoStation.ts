import { prisma } from "../../db";
import type { Prisma } from "../../prisma";
import { AppError } from "../../middleware/errorHandler";

/**
 * Which stop a trip photo is filed at (forgejo#139).
 *
 * A photo belongs to its trip; a stop it is filed at must therefore be on that
 * trip. Two shapes count, and only these two:
 *
 *  - a stop of the trip's own timeline (`TripStop.tripId`), and
 *  - a station of a roadtrip filed on the trip (`TripStop.route.tripId`). A
 *    station the roadtrip created itself carries `tripId = null`
 *    (`replaceStations`), so checking the stop's own column alone would refuse
 *    nearly every roadtrip station.
 *
 * The foreign key proves the stop exists, not that it is on this trip or the
 * caller's. The caller has already proved the trip is theirs (`resolveTrip`);
 * the route's owner is named as well, so a route can never lend its stations
 * to a trip of another account.
 *
 * A stop that does not exist answers the same 400 as a foreign one: a probe
 * must not learn which ids are someone else's.
 */

/** The cover is a pseudo-photo row, never a gallery photo — every gallery read leaves it out. */
export const NOT_A_COVER = {
  OR: [{ caption: null }, { caption: { not: "__cover__" } }],
} satisfies Prisma.TripPhotoWhereInput;

export async function assertStopOnTrip(
  userId: string,
  tripId: string,
  stopId: string
): Promise<void> {
  const stop = await prisma.tripStop.findFirst({
    where: { id: stopId, OR: [{ tripId }, { route: { tripId, userId } }] },
    select: { id: true },
  });
  if (!stop) {
    throw new AppError("This stop is not on the trip", 400, "STOP_NOT_ON_TRIP", "stopId");
  }
}

/**
 * Refuse to move a roadtrip to `nextTripId` (null = off every trip) while one
 * of its stations holds a photo of another trip.
 *
 * The photo stays with the trip it was uploaded to — its gallery, its journal
 * entries and its file URL all name that trip — so moving the roadtrip would
 * leave the link pointing across trips. Unlinking the photos quietly instead
 * would drop what the user filed; the refusal says why and changes nothing.
 */
export async function assertNoStationPhotosLeftBehind(
  routeId: string,
  nextTripId: string | null
): Promise<void> {
  const stranded = await prisma.tripPhoto.count({
    where: {
      stop: { routeId },
      ...(nextTripId === null ? {} : { tripId: { not: nextTripId } }),
    },
  });
  if (stranded > 0) {
    throw new AppError(
      `${stranded} photo(s) of the trip are filed at this roadtrip's stations; move them off the stations first`,
      409,
      "ROADTRIP_HAS_TRIP_PHOTOS"
    );
  }
}
