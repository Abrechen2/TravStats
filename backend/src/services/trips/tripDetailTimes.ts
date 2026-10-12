import {
  withCruiseTimes,
  type CruiseStopTimeColumns,
  type CruiseTimeColumns,
} from "../cruise/timesDto";
import { withStayTimes, type StayTimeColumns } from "../lodging/timesDto";
import { withRailTimes, type RailTimeColumns } from "../rail/timesDto";
import { withBusTimes } from "../bus/timesDto";
import { rentalTimes, type RentalTimeColumns } from "../rental/timesDto";
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
    railJourneys: RailTimeColumns[];
    ferryJourneys: RailTimeColumns[];
    busJourneys: RailTimeColumns[];
    bookings: DeadlineColumns[];
    rentalBookings: RentalTimeColumns[];
  },
>(trip: T): T {
  return {
    ...withTripTimes(trip),
    stops: trip.stops.map(withTripStopTimes),
    journalEntries: trip.journalEntries.map(withJournalEntryTimes),
    cruises: trip.cruises.map(withCruiseTimes),
    lodgingStays: trip.lodgingStays.map(withStayTimes),
    railJourneys: trip.railJourneys.map(withRailTimes),
    // A bus ride's ends carry rail's columns, so rail's reader serves (forgejo#180).
    busJourneys: trip.busJourneys.map(withBusTimes),
    ferryJourneys: trip.ferryJourneys.map(withRailTimes),
    bookings: trip.bookings.map(withBookingTimes),
    // Rentals carry their `times` too, deadlines included (forgejo#285).
    rentalBookings: trip.rentalBookings.map((r) => ({
      ...r,
      ...deadlineDayFields(r),
      times: rentalTimes(r),
    })),
  };
}
