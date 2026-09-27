import {
  withCruiseTimes,
  type CruiseStopTimeColumns,
  type CruiseTimeColumns,
} from "../cruise/timesDto";
import { withStayTimes, type StayTimeColumns } from "../lodging/timesDto";
import { withRailTimes, type RailTimeColumns } from "../rail/timesDto";
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
 * stays, rail rides. Flights are enriched by the route (`enrichFlightsForClients`),
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
  },
>(trip: T): T {
  return {
    ...withTripTimes(trip),
    stops: trip.stops.map(withTripStopTimes),
    journalEntries: trip.journalEntries.map(withJournalEntryTimes),
    cruises: trip.cruises.map(withCruiseTimes),
    lodgingStays: trip.lodgingStays.map(withStayTimes),
    railJourneys: trip.railJourneys.map(withRailTimes),
  };
}
