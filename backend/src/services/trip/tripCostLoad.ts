/**
 * The columns `shared/tripCost.ts` reads, as ONE Prisma select.
 *
 * The travel account and the "most expensive trip" superlative each wrote
 * their own select, and the superlative's had no `taxes`/`fees` on a flight —
 * so even a shared rule would have read different rows (forgejo#274). Both
 * now spread this object, and a column the rule needs is added once, here.
 */
import type { Prisma } from "../../prisma";
import type { TripCostInput } from "../../shared/tripCost";

const PRICE = { price: true, currency: true, priceBase: true, fxBaseCurrency: true } as const;
const BOOKING_PRICE = { select: PRICE } as const;
const AMOUNT = { select: { amount: true, currency: true } } as const;

export const TRIP_COST_SELECT = {
  bookings: {
    select: {
      ...PRICE,
      // Every domain that can be sold on a booking: one with no segment at
      // all is the only kind the trip's own booking list is read for.
      _count: {
        select: { flights: true, cruises: true, lodgingStays: true, railJourneys: true },
      },
    },
  },
  flights: {
    select: {
      status: true,
      ...PRICE,
      taxes: true,
      fees: true,
      bookingId: true,
      booking: BOOKING_PRICE,
    },
  },
  cruises: { select: { status: true, ...PRICE, bookingId: true, booking: BOOKING_PRICE } },
  lodgingStays: {
    select: {
      status: true,
      totalPrice: true,
      currency: true,
      totalPriceBase: true,
      fxBaseCurrency: true,
      bookingId: true,
      booking: BOOKING_PRICE,
    },
  },
  // Trip-wide expenses, and those of its sections — a section's is stored on
  // the section (exactly one of the two is set, a CHECK), so it follows a
  // roadtrip that changes trip and is never read twice.
  expenses: AMOUNT,
  routes: { select: { expenses: AMOUNT } },
} satisfies Prisma.TripSelect;

export type TripCostRow = Prisma.TripGetPayload<{ select: typeof TRIP_COST_SELECT }>;

/** An expense amount as the rule sums it; the column is an exact decimal. */
export const expenseMoney = (e: { amount: Prisma.Decimal; currency: string }) => ({
  amount: e.amount.toNumber(),
  currency: e.currency,
});

export function toTripCostInput(row: TripCostRow): TripCostInput {
  return {
    bookings: row.bookings.map(({ _count, ...booking }) => ({
      ...booking,
      segmentCount: _count.flights + _count.cruises + _count.lodgingStays + _count.railJourneys,
    })),
    flights: row.flights,
    cruises: row.cruises,
    stays: row.lodgingStays,
    expenses: [...row.expenses, ...row.routes.flatMap((route) => route.expenses)].map(expenseMoney),
  };
}
