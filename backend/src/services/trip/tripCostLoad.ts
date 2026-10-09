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
import type { DomainKey } from "../../shared/domains";
import { rowsIfVisible, type VisibleDomains } from "../domainVisibility";

const PRICE = { price: true, currency: true, priceBase: true, fxBaseCurrency: true } as const;
const BOOKING_PRICE = { select: PRICE } as const;
const AMOUNT = { select: { amount: true, currency: true } } as const;
/**
 * The two amounts `rentalCounting.rentalCost` chooses between, each with its
 * own snapshot. Named columns only, never a spread of the model: a deposit
 * is not a cost (rental spec §4.6) and must not be selectable from here.
 */
const RENTAL_PRICE = {
  status: true,
  ...PRICE,
  finalAmount: true,
  finalCurrency: true,
  finalAmountBase: true,
  finalFxBaseCurrency: true,
} as const;

export const TRIP_COST_SELECT = {
  bookings: {
    select: {
      ...PRICE,
      // Every domain that can be sold on a booking: one with no segment at
      // all is the only kind the trip's own booking list is read for.
      _count: {
        select: {
          flights: true,
          cruises: true,
          lodgingStays: true,
          railJourneys: true,
          busJourneys: true,
        },
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
  // Train rides price like any segment: their own price, or the booking a
  // connection shares (forgejo#275).
  railJourneys: { select: { status: true, ...PRICE, bookingId: true, booking: BOOKING_PRICE } },
  // Bus rides price like train rides (forgejo#263): their own price, or their booking's.
  busJourneys: { select: { status: true, ...PRICE, bookingId: true, booking: BOOKING_PRICE } },
  rentalBookings: { select: RENTAL_PRICE },
  // Trip-wide expenses, and those of its sections — a section's is stored on
  // the section (exactly one of the two is set, a CHECK), so it follows a
  // roadtrip that changes trip and is never read twice.
  expenses: AMOUNT,
  routes: {
    select: {
      expenses: AMOUNT,
      // A rental driven on this trip's roadtrip but filed under no trip of
      // its own costs here. One filed under a trip is read there, through
      // `rentalBookings` — never through its roadtrip as well (spec §7.3).
      rentals: { where: { tripId: null }, select: RENTAL_PRICE },
    },
  },
} satisfies Prisma.TripSelect;

export type TripCostRow = Prisma.TripGetPayload<{ select: typeof TRIP_COST_SELECT }>;

/** An expense amount as the rule sums it; the column is an exact decimal. */
export const expenseMoney = (e: { amount: Prisma.Decimal; currency: string }) => ({
  amount: e.amount.toNumber(),
  currency: e.currency,
});

/**
 * The rule's input for one trip, behind the user's domain gate
 * (`domainVisibility.rowsIfVisible`): the rows of a domain the user does not
 * see are dropped BEFORE the rule runs, so a booking reached only through a
 * hidden segment goes with it. Every surface that shows a trip's cost passes
 * the same set — the trips page and `/stats/travel-account` alike — so one
 * trip never has two totals and a beta-gated domain's money never shows.
 * A segment-less booking and a trip-wide expense belong to no domain and stay.
 */
export function toTripCostInput(row: TripCostRow, visible: VisibleDomains): TripCostInput {
  const when = <T>(domain: DomainKey, rows: T[]): T[] => rowsIfVisible(visible, domain, rows);
  return {
    bookings: row.bookings.map(({ _count, ...booking }) => ({
      ...booking,
      segmentCount:
        _count.flights +
        _count.cruises +
        _count.lodgingStays +
        _count.railJourneys +
        _count.busJourneys,
    })),
    flights: when("flight", row.flights),
    cruises: when("cruise", row.cruises),
    stays: when("lodging", row.lodgingStays),
    rail: when("rail", row.railJourneys),
    bus: when("bus", row.busJourneys),
    rentals: [
      ...when("rental", row.rentalBookings),
      // Reached only through a roadtrip: shown only where both are.
      ...when(
        "rental",
        when(
          "roadtrip",
          row.routes.flatMap((route) => route.rentals)
        )
      ),
    ],
    // A section's expenses are shown on its roadtrip page, behind that gate.
    expenses: [
      ...row.expenses,
      ...when(
        "roadtrip",
        row.routes.flatMap((route) => route.expenses)
      ),
    ].map(expenseMoney),
  };
}
