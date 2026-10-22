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
  // What the ride's `times` are built from (ADR 0002 phase 4).
  depPrecision: true,
  arrPrecision: true,
  actualDepartureTime: true,
  actualArrivalTime: true,
  distanceKm: true,
  distanceSource: true,
  status: true,
  delayMinutes: true,
  price: true,
  currency: true,
  bookingId: true,
  // What the trip map draws (beta.22 UAT): the two stations and the stored
  // line, read by the dashboard's own rail layer builder.
  depLat: true,
  depLon: true,
  arrLat: true,
  arrLon: true,
  geometry: true,
  geometrySource: true,
} satisfies Prisma.RailJourneySelect;

/**
 * A trip's bus rides as `GET /trips/:id` sends them (forgejo#180): what the
 * timeline card shows, the two terminals' coordinates and the frozen road
 * line (null = the chord between the terminals) for the trip map, and what
 * the ride's `times` are built from (ADR 0002).
 */
export const TRIP_BUS_SELECT = {
  id: true,
  operator: true,
  lineName: true,
  rideKind: true,
  depStationName: true,
  arrStationName: true,
  depLat: true,
  depLon: true,
  arrLat: true,
  arrLon: true,
  depTimezone: true,
  arrTimezone: true,
  departureTime: true,
  arrivalTime: true,
  depPrecision: true,
  arrPrecision: true,
  actualDepartureTime: true,
  actualArrivalTime: true,
  distanceKm: true,
  distanceSource: true,
  geometry: true,
  geometrySource: true,
  status: true,
  delayMinutes: true,
  price: true,
  currency: true,
  bookingId: true,
} satisfies Prisma.BusJourneySelect;

/**
 * A trip's rentals as `GET /trips/:id` sends them: what the timeline's two
 * ends of a rental show (rental spec §6).
 */
export const TRIP_RENTAL_SELECT = {
  id: true,
  provider: true,
  pickupStationName: true,
  returnStationName: true,
  pickupTime: true,
  returnTime: true,
  pickupTimezone: true,
  returnTimezone: true,
  pickupPrecision: true,
  returnPrecision: true,
  status: true,
  // What the rental's `times` needs, deadlines included (forgejo#285): the
  // trip page shows them on the rental's card like the detail page does.
  actualPickupTime: true,
  actualReturnTime: true,
  actualPickupPrecision: true,
  actualReturnPrecision: true,
  depositPaidOn: true,
  depositReturnedOn: true,
  freeCancellationUntil: true,
  freeCancellationOn: true,
  freeCancellationZone: true,
  paymentDueOn: true,
  // What the trip map draws (beta.22 UAT): the two branches, what the derived
  // one-way flag is read from, and the roadtrip that already draws the drive.
  pickupLat: true,
  pickupLon: true,
  returnLat: true,
  returnLon: true,
  pickupAirportId: true,
  returnAirportId: true,
  routeId: true,
  // What the map's rental card prints, read by the dashboard's own normalizer
  // (`journeyFromRental`, Codex review before 2.7.0-beta.23): the car (also the
  // subject-picture lookup), driven km with their source, the cost, the
  // branches' countries and airport codes, the counter's operator. The trip
  // page is the owner's own data (`where: { userId }`); nothing more of the
  // row — no confirmation numbers, plate or invoice lines.
  operatedBy: true,
  pickupCountry: true,
  returnCountry: true,
  pickupAirport: { select: { iata: true } },
  returnAirport: { select: { iata: true } },
  vehicleClass: true,
  vehicleExample: true,
  odometerOutKm: true,
  odometerInKm: true,
  distanceKm: true,
  distanceSource: true,
  price: true,
  currency: true,
  finalAmount: true,
  finalCurrency: true,
} satisfies Prisma.RentalBookingSelect;

/** The trip page's rentals: pickup order, a cancelled one left out (it never happened). */
export const TRIP_DETAIL_RENTALS = {
  where: { status: { not: "cancelled" } },
  select: TRIP_RENTAL_SELECT,
  orderBy: { pickupTime: "asc" },
} satisfies Prisma.Trip$rentalBookingsArgs;

export const TRIPS_LIST_INCLUDE = {
  _count: {
    select: {
      flights: true,
      cruises: true,
      lodgingStays: true,
      routes: true,
      photos: true,
      // The other areas the trip page lists as entries, so the card can count
      // them too: "Bahn – 1 Fahrt" on the page sat over "0 Einträge" on the
      // card (forgejo#169). A cancelled rental never happened, as on the page
      // (TRIP_DETAIL_RENTALS). Roadtrips: services/trip/tripRoadtripCounts.ts.
      railJourneys: true,
      // Bus rides: "Bus – 1 Fahrt" on the page sat over "1 Eintrag" on the card
      // (forgejo#289) — the card's counter had `bus: () => 0` and no count to read.
      busJourneys: true,
      ferryJourneys: true,
      rentalBookings: { where: { status: { not: "cancelled" } } },
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
