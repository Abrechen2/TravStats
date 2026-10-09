import { prisma } from "../../db";
import { PERSON_SELECT, toPerson, type SharePerson } from "./people";

/**
 * Decision 2: a booking's total price is not copied — it is the booker's —
 * but the other members may SEE it, read-only. Read through the group: only a
 * caller whose own trip is in the group gets here (`tripSharingView` checks
 * the trip is theirs), and only the other members' totals for their trip of
 * this group are read. No booking row and no per-person price share crosses.
 */
export interface MemberBookingTotal {
  member: SharePerson;
  /** One sum per currency — prices in two currencies are never added. */
  totals: { currency: string; amount: number }[];
}

export async function groupBookingTotals(
  groupId: string,
  callerId: string
): Promise<MemberBookingTotal[]> {
  const trips = await prisma.trip.findMany({
    where: { shareGroupId: groupId, NOT: { userId: callerId } },
    select: { id: true, userId: true, user: { select: PERSON_SELECT } },
    orderBy: { createdAt: "asc" },
  });
  const out: MemberBookingTotal[] = [];
  for (const trip of trips) {
    const onTrip = { tripId: trip.id };
    const bookings = await prisma.booking.findMany({
      where: {
        userId: trip.userId,
        price: { not: null },
        OR: [
          onTrip,
          { flights: { some: onTrip } },
          { cruises: { some: onTrip } },
          { railJourneys: { some: onTrip } },
          { lodgingStays: { some: onTrip } },
        ],
      },
      select: { price: true, currency: true },
    });
    if (bookings.length === 0) continue;
    const sums = new Map<string, number>();
    for (const b of bookings) {
      const currency = b.currency ?? "EUR";
      sums.set(currency, (sums.get(currency) ?? 0) + (b.price ?? 0));
    }
    out.push({
      member: toPerson(trip.user),
      totals: [...sums].map(([currency, amount]) => ({
        currency,
        amount: Math.round(amount * 100) / 100,
      })),
    });
  }
  return out;
}
