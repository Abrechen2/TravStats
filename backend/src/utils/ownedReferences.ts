import { prisma } from "../db";
import { AppError } from "../middleware/errorHandler";

/**
 * A reference the client sends must point at something the client owns.
 *
 * Every write path that links one record to another checked the record it was
 * nested under and then passed the foreign keys from the body straight into
 * Prisma. Prisma enforces that the row EXISTS, never whose it is — so account
 * A could create a hotel stay carrying account B's `tripId`, and B's trip GET
 * then returned A's stay, complete with its price and dates. The same holds for
 * `bookingId` and for the loyalty `membershipId` (audit finding AUD-038), and
 * for a cruise's trip and booking, which had no check at all.
 *
 * `places.ts` already did this correctly for its own visits; that local helper
 * now lives here so the rule has one home rather than one copy per domain.
 *
 * The answer for a foreign id is 404, not 403: a stranger's trip is not a trip
 * this account is forbidden to use, it is a trip this account cannot see, and
 * distinguishing the two would confirm the id exists.
 */
export interface OwnedReferences {
  tripId?: string | null;
  bookingId?: string | null;
  membershipId?: string | null;
}

/**
 * `undefined` means the field was not mentioned and `null` means it is being
 * cleared. Neither names a row, so neither is checked — only an actual id is.
 */
export async function assertTripOwned(
  tripId: string | null | undefined,
  userId: string,
): Promise<void> {
  if (!tripId) return;
  const trip = await prisma.trip.findFirst({ where: { id: tripId, userId }, select: { id: true } });
  if (!trip) throw new AppError("Trip not found", 404);
}

export async function assertBookingOwned(
  bookingId: string | null | undefined,
  userId: string,
): Promise<void> {
  if (!bookingId) return;
  const booking = await prisma.booking.findFirst({
    where: { id: bookingId, userId },
    select: { id: true },
  });
  if (!booking) throw new AppError("Booking not found", 404);
}

export async function assertMembershipOwned(
  membershipId: string | null | undefined,
  userId: string,
): Promise<void> {
  if (!membershipId) return;
  const membership = await prisma.lodgingMembership.findFirst({
    where: { id: membershipId, userId },
    select: { id: true },
  });
  if (!membership) throw new AppError("Membership not found", 404);
}

/** All three at once, for a write path that accepts all three. */
export async function assertReferencesOwned(
  userId: string,
  refs: OwnedReferences,
): Promise<void> {
  await Promise.all([
    assertTripOwned(refs.tripId, userId),
    assertBookingOwned(refs.bookingId, userId),
    assertMembershipOwned(refs.membershipId, userId),
  ]);
}
