import { prisma } from "../../../db";
import type { AuthRequest } from "../../../middleware/auth";
import { tripStopTimes } from "../../../routes/trips/stopTime";
import { propagateWrite } from "../../sharing/propagate";
import type { PlaceImportCandidate } from "../../../schemas/placeImport";

/**
 * The two non-place treatments of a Takeout row (#358, point 4), written by
 * `commitPlaceImport` when the user picked them in the preview.
 *
 * Each answers `"ok"` or `"invalid_target"`: a trip or stay that is not the
 * caller's must look exactly like one that does not exist, and the commit
 * reports it per row rather than failing the batch.
 */

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The caller's trip, or null. */
async function ownTrip(userId: string, tripId: string | null | undefined) {
  if (!tripId) return null;
  return prisma.trip.findFirst({ where: { id: tripId, userId }, select: { id: true } });
}

/**
 * A stop on the row's trip, at the row's position, appended after the trip's
 * existing stops. Its day is the visit day the preview offered, read on the
 * stop's own clock exactly as the stop form's day is (`tripStopTimes`).
 */
export async function writeTripStop(
  userId: string,
  row: PlaceImportCandidate & { lat: number; lon: number }
): Promise<"ok" | "invalid_target"> {
  const trip = await ownTrip(userId, row.tripId);
  if (!trip) return "invalid_target";

  const day = row.visitedAt?.trim();
  const datedDay = day && DAY.test(day) ? day : null;
  // `tripStopTimes` reads only the caller's id and whether a token sent the
  // value — the import is a browser session, so no token.
  const caller = { userId } as AuthRequest;
  const times = await tripStopTimes(
    datedDay ? { startDate: { kind: "date", date: datedDay } } : {},
    { lat: row.lat, lon: row.lon, domain: null, sourceId: null },
    null,
    caller
  );
  const last = await prisma.tripStop.aggregate({
    where: { tripId: trip.id },
    _max: { orderIdx: true },
  });
  const stop = await prisma.tripStop.create({
    data: {
      tripId: trip.id,
      title: row.name.trim(),
      lat: row.lat,
      lon: row.lon,
      notes: row.notes?.trim() || null,
      startDate: times.startDate ?? null,
      ...times.timeColumns,
      orderIdx: (last._max.orderIdx ?? -1) + 1,
    },
  });
  await propagateWrite(prisma, userId, "stop", stop.id);
  return "ok";
}

/** "This row is my stay" — confirmed as the caller's, nothing written. */
export async function confirmOwnStay(
  userId: string,
  row: PlaceImportCandidate
): Promise<"ok" | "invalid_target"> {
  if (!row.lodgingStayId) return "invalid_target";
  const stay = await prisma.lodgingStay.findFirst({
    where: { id: row.lodgingStayId, userId },
    select: { id: true },
  });
  return stay ? "ok" : "invalid_target";
}

/** The trip a place's dated visit joins — only the caller's own. */
export async function visitTripId(
  userId: string,
  tripId: string | null | undefined
): Promise<string | null> {
  return (await ownTrip(userId, tripId))?.id ?? null;
}
