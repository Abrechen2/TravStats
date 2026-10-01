import { prisma, type DbTransaction } from "../../db";
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

/** The PATCH field that lets a roadtrip move although its stations hold photos. */
export const DETACH_STATION_PHOTOS = "detachStationPhotos";

/**
 * Prepare a roadtrip's move to `nextTripId` (null = off every trip) while its
 * stations may hold photos of another trip.
 *
 * The photo stays with the trip it was uploaded to — its gallery, its journal
 * entries and its file URL all name that trip — so moving the roadtrip would
 * leave the link pointing across trips. By default the move is refused with
 * the count, so the client can ask the user. With the opt-in the photos are
 * taken off their stations (they stay on their trip) in the same transaction
 * as the move — the returned function does both and says how many it took.
 */
export async function planStationPhotoMove(
  routeId: string,
  nextTripId: string | null,
  detach: boolean
): Promise<(tx: DbTransaction) => Promise<number>> {
  const where: Prisma.TripPhotoWhereInput = {
    stop: { routeId },
    ...(nextTripId === null ? {} : { tripId: { not: nextTripId } }),
  };
  const stranded = await prisma.tripPhoto.count({ where });
  if (stranded > 0 && !detach) {
    throw new AppError(
      `${stranded} photo(s) of the trip are filed at this roadtrip's stations; ` +
        `resend with ${DETACH_STATION_PHOTOS}: true to take them off their stations and move`,
      409,
      "ROADTRIP_HAS_TRIP_PHOTOS",
      undefined,
      { stationPhotos: stranded, optIn: DETACH_STATION_PHOTOS }
    );
  }
  return async (tx) => {
    if (stranded === 0) return 0;
    const { count } = await tx.tripPhoto.updateMany({ where, data: { stopId: null } });
    return count;
  };
}
