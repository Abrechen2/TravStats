import type { DbTransaction } from "../../db";
import { AppError } from "../../middleware/errorHandler";

/**
 * "Add a connecting train" (spec 2026-09-25-rail-domain, phase 2b).
 *
 * A connection is several rows bound by the existing `Booking`, as a flight's
 * legs are — no table of its own and no state to keep consistent beside it.
 * The server, not the client, makes that binding: the previous leg gets a
 * booking if it has none (named by its own booking reference, in its trip),
 * and the new leg joins it. A client that had to create the booking and patch
 * the old leg itself would leave a half-bound pair behind whenever the second
 * request failed.
 */
export interface ConnectionLink {
  bookingId: string;
  /** The previous leg's trip — the new leg's default, not an override. */
  tripId: string | null;
}

export async function bindConnection(
  tx: DbTransaction,
  userId: string,
  previousId: string
): Promise<ConnectionLink> {
  const previous = await tx.railJourney.findFirst({
    where: { id: previousId, userId },
    select: { id: true, bookingId: true, tripId: true, bookingReference: true },
  });
  // A stranger's journey is not a journey: the same 404 as a missing one.
  if (!previous) throw new AppError("Previous rail journey not found", 404);
  if (previous.bookingId) return { bookingId: previous.bookingId, tripId: previous.tripId };

  const booking = await tx.booking.create({
    data: { userId, tripId: previous.tripId, pnr: previous.bookingReference },
  });
  await tx.railJourney.update({ where: { id: previous.id }, data: { bookingId: booking.id } });
  return { bookingId: booking.id, tripId: previous.tripId };
}
