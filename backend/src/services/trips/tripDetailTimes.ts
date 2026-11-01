import {
  withCruiseTimes,
  type CruiseStopTimeColumns,
  type CruiseTimeColumns,
} from "../cruise/timesDto";
import { withStayTimes, type StayTimeColumns } from "../lodging/timesDto";
import { withRailTimes, type RailTimeColumns } from "../rail/timesDto";
import { withBusTimes } from "../bus/timesDto";
import { rentalTimes, type RentalTimeColumns } from "../rental/timesDto";
import { withBusCo2, withFerryCo2, withRailCo2 } from "../co2/rideDto";
import {
  rentalCo2,
  type BusCo2Row,
  type FerryCo2Row,
  type RailCo2Row,
  type RentalCo2Row,
} from "../co2/transportCo2";
import { isOneWay } from "../rental/rentalWrite";
import { withBookingTimes } from "../deadlines/bookingTimesDto";
import { deadlineDayFields, type DeadlineColumns } from "../deadlines/bookingDeadlines";
import {
  withJournalEntryTimes,
  withTripStopTimes,
  withTripTimes,
  type JournalTimeColumns,
  type TripStopTimeColumns,
  type TripTimeColumns,
} from "./timesDto";

/**
 * GET /trips/:id with `times` on the trip and on everything it lists
 * (ADR 0002 phase 4) — stops, journal entries, cruises and their port calls,
 * stays, rail and bus rides, and the bookings' deadlines (forgejo#285). Flights are enriched by the route (`enrichFlightsForClients`),
 * because that needs the airport catalogue. Kept out of `routes/trips.ts`,
 * which is at the 800-line limit.
 */
export function withTripDetailTimes<
  T extends TripTimeColumns & {
    stops: TripStopTimeColumns[];
    journalEntries: JournalTimeColumns[];
    cruises: Array<CruiseTimeColumns & { stops?: CruiseStopTimeColumns[] }>;
    lodgingStays: StayTimeColumns[];
    railJourneys: Array<RailTimeColumns & RailCo2Row>;
    ferryJourneys: Array<RailTimeColumns & FerryCo2Row>;
    busJourneys: Array<RailTimeColumns & BusCo2Row>;
    bookings: DeadlineColumns[];
    rentalBookings: Array<
      RentalTimeColumns &
        RentalCo2Row &
        Parameters<typeof isOneWay>[0] & {
          pickupAirport?: { iata: string | null } | null;
          returnAirport?: { iata: string | null } | null;
        }
    >;
  },
>(trip: T): T {
  return {
    ...withTripTimes(trip),
    stops: trip.stops.map(withTripStopTimes),
    journalEntries: trip.journalEntries.map(withJournalEntryTimes),
    cruises: trip.cruises.map(withCruiseTimes),
    lodgingStays: trip.lodgingStays.map(withStayTimes),
    railJourneys: trip.railJourneys.map((r) => withRailCo2(withRailTimes(r))),
    // A bus ride's ends carry rail's columns, so rail's reader serves (forgejo#180).
    busJourneys: trip.busJourneys.map((r) => withBusCo2(withBusTimes(r))),
    ferryJourneys: trip.ferryJourneys.map((r) => withFerryCo2(withRailTimes(r))),
    bookings: trip.bookings.map(withBookingTimes),
    // Rentals carry their `times` too, deadlines included (forgejo#285).
    rentalBookings: trip.rentalBookings.map(({ pickupAirport, returnAirport, ...r }) => ({
      ...r,
      // The branches' airport codes, as the rental DTO sends them — not the airport rows.
      pickupIata: pickupAirport?.iata ?? null,
      returnIata: returnAirport?.iata ?? null,
      ...deadlineDayFields(r),
      // Derived, never stored — the trip map draws a one-way rental's link.
      oneWay: isOneWay(r),
      times: rentalTimes(r),
      co2: rentalCo2(r),
    })),
  };
}
