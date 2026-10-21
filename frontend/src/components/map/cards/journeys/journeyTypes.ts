// What a ground (or trip-map) journey looks like to the map card.
//
// forgejo#323: a flight route opened a card with its two airports, the total
// distance, the last flight and the top airline; a train, coach, ferry or
// rental opened nothing. One normalised shape lets ONE set of stats helpers,
// ONE hover builder and ONE card body serve every domain that draws a line
// between two places — instead of a rail card, a bus card and a ferry card
// that would drift apart the way the flat map's five tooltips once did.

import type { Rgb } from "../../../../lib/domainColor";
import type { TimeValue } from "../../../../shared/time";

/** The domains whose journeys run between two named places. */
export type JourneyDomain = "flight" | "rail" | "bus" | "ferry" | "rental";

/** One end of a journey: a station, terminal, port, rental branch or airport. */
export interface JourneyEnd {
  name: string;
  /** A short code where the domain has one (IATA, a station code). */
  code?: string | null;
  /** ISO 3166-1 alpha-2 where recorded — drives the flag. Null is "not recorded". */
  country?: string | null;
  lat: number;
  lon: number;
}

/**
 * The domain-specific facts a card may print. Every field is optional and
 * every field is printed only when present — a card never invents a train
 * number, a cabin or a car class the entry did not record.
 */
export interface JourneyFacts {
  trainNumber?: string | null;
  travelClass?: string | null;
  lineName?: string | null;
  seat?: string | null;
  vesselName?: string | null;
  cabinType?: string | null;
  vehicleClass?: string | null;
  /** Rental days, from `shared/rentalCounting.ts`. */
  rentalDays?: number | null;
  /** Scheduled duration in minutes, when both ends are dated. */
  durationMin?: number | null;
}

export interface MapJourney {
  id: string;
  domain: JourneyDomain;
  dep: JourneyEnd;
  arr: JourneyEnd;
  /** ISO instant the journey started (departure / pick-up), or null — for ORDER only. */
  departureTime: string | null;
  /**
   * The same moment on its place's clock, cut to its precision — what a card
   * SHOWS (ADR 0002 D3). The instant read in the reader's zone named the
   * wrong day for a late departure: Berlin 00:30 on the 21st was the 20th.
   */
  departure: TimeValue | null;
  status: string;
  /** Kilometres when known. NULL when not — never 0 for "unknown". */
  distanceKm: number | null;
  /** Rail operator, bus company, ferry line, rental company, airline. */
  operator: string | null;
  /** Happened, by the domain's own counting rule (`shared/*Counting.ts`). */
  travelled: boolean;
  /** Booked and still ahead — neither travelled nor cancelled. */
  planned: boolean;
  facts: JourneyFacts;
}

/** A route: every journey of one domain between the same two places, either way. */
export interface JourneyRouteCardDatum {
  domain: JourneyDomain;
  dep: JourneyEnd;
  arr: JourneyEnd;
  journeys: MapJourney[];
  /** The domain colour, resolved by the caller from the colour store. */
  color: Rgb;
}

/** One station / terminal / port / branch, with every journey touching it. */
export interface JourneyStopCardDatum {
  domain: JourneyDomain;
  stop: JourneyEnd;
  journeys: MapJourney[];
  color: Rgb;
}

/** A day tour or a roadtrip — its line is the route, the tour is the card. */
export interface TourCardDatum {
  id: string;
  name: string;
  kind: "tour" | "roadtrip";
  mode: string | null;
  tripName: string | null;
  /** Null when not measured — a tour without legs has no distance yet. */
  distanceKm: number | null;
  ascentM: number | null;
  stopCount: number | null;
  startDate: string | null;
  endDate: string | null;
  color: Rgb;
}

/** A trip-map stop (the trip timeline's own point). */
export interface TripStopCardDatum {
  title: string;
  domain: string | null;
  startDate: string | null;
  endDate: string | null;
  color: Rgb;
}
