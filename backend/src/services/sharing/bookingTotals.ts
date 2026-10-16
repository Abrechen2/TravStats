import { prisma } from "../../db";
import { Prisma } from "../../prisma";
import { minorUnits } from "../../shared/currencies";
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
          { busJourneys: { some: onTrip } },
          { ferryJourneys: { some: onTrip } },
          { lodgingStays: { some: onTrip } },
        ],
      },
      select: { price: true, currency: true },
    });
    const sums = new Map<string, Prisma.Decimal>();
    for (const b of bookings) {
      // A price without a currency is no amount anyone can read: it is left
      // out, not presented as euros (abstention, not a guess).
      if (b.price === null || !b.currency) continue;
      const sum = sums.get(b.currency) ?? new Prisma.Decimal(0);
      sums.set(b.currency, sum.plus(new Prisma.Decimal(b.price)));
    }
    if (sums.size === 0) continue;
    out.push({
      member: toPerson(trip.user),
      totals: [...sums].map(([currency, amount]) => ({
        currency,
        // Yen have no cents and dinars have three decimals: a fixed two was wrong for both.
        amount: amount
          .toDecimalPlaces(minorUnits(currency), Prisma.Decimal.ROUND_HALF_UP)
          .toNumber(),
      })),
    });
  }
  return out;
}
