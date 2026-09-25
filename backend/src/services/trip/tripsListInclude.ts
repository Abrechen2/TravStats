/**
 * The nested `include` for `GET /trips` — pulled out of `routes/trips.ts`
 * (which was pushing the 800-line file-size ratchet) so the route stays a
 * handler, not a hand-drawn Prisma query.
 *
 * Every domain's select carries its own FX base-currency pair (`priceBase`/
 * `fxBaseCurrency`, or `totalPriceBase` for a stay) alongside the raw price —
 * the base amount is what a cross-currency comparison (the trip cost
 * superlative) must rank on, never the raw number in whatever currency was
 * typed. See `services/trip/tripCostSuperlative.ts`.
 */

import { Prisma } from "../../prisma";

/**
 * A trip's train rides as `GET /trips/:id` sends them: what a timeline entry
 * and a logistics row show. Not the frozen `geometry` — one traced ICE line is
 * ~10 000 points, and the trip page does not draw it.
 */
export const TRIP_RAIL_SELECT = {
  id: true,
  operator: true,
  trainCategory: true,
  trainNumber: true,
  depStationName: true,
  arrStationName: true,
  depTimezone: true,
  arrTimezone: true,
  departureTime: true,
  arrivalTime: true,
  distanceKm: true,
  distanceSource: true,
  status: true,
  delayMinutes: true,
  price: true,
  currency: true,
  bookingId: true,
} satisfies Prisma.RailJourneySelect;

export const TRIPS_LIST_INCLUDE = {
  _count: {
    select: {
      flights: true,
      cruises: true,
      lodgingStays: true,
      routes: true,
      photos: true,
    },
  },
  bookings: {
    select: {
      id: true,
      pnr: true,
      price: true,
      currency: true,
      priceBase: true,
      fxBaseCurrency: true,
    },
  },
  flights: {
    select: {
      id: true,
      depIata: true,
      arrIata: true,
      departureTime: true,
      arrivalTime: true,
      depLat: true,
      depLon: true,
      arrLat: true,
      arrLon: true,
      // Each end must render in ITS airport's zone; without these the
      // trip timeline fell back to the viewer's clock and disagreed
      // with the flights table by the whole UTC offset.
      depTimeSemantics: true,
      arrTimeSemantics: true,
      // A flight that carries its own price (no booking) belongs in the
      // trip total — a hand-entered price used to vanish from it.
      price: true,
      currency: true,
      // FX snapshot (#267/evidence spec) — the base-currency amount a
      // cross-currency comparison must rank on instead of the raw
      // number in whatever currency happened to be typed.
      priceBase: true,
      fxBaseCurrency: true,
      bookingId: true,
    },
    orderBy: { departureTime: "asc" },
    take: 200, // cap nested flights per trip — use GET /trips/:id for full flight list
  },
  cruises: {
    select: {
      id: true,
      cruiseLine: true,
      startDate: true,
      endDate: true,
      status: true,
      shipId: true,
      // A cruise carrying its own price belongs in the trip total, on
      // the same rule that applies to flights — without these a
      // cruise-only trip read "— Gesamtkosten" while its cruises had
      // prices on file.
      price: true,
      currency: true,
      priceBase: true,
      fxBaseCurrency: true,
      bookingId: true,
    },
    orderBy: { startDate: "asc" },
    take: 200,
  },
  // Same rule, third domain: a stay carrying its own price belongs in
  // the trip total. Without this the CARD excluded lodging from the
  // sum while the detail page (full include below) counted it — the
  // exact split the cruise select above was added to close.
  lodgingStays: {
    select: {
      id: true,
      checkIn: true,
      checkOut: true,
      status: true,
      totalPrice: true,
      // Fallback for the total when no totalPrice was typed:
      // per-night × nights, derived on the card.
      pricePerNight: true,
      currency: true,
      totalPriceBase: true,
      fxBaseCurrency: true,
      bookingId: true,
    },
    orderBy: { checkIn: "asc" },
    take: 200,
  },
} satisfies Prisma.TripInclude;
