/**
 * `GET /stats/flight-insights` (forgejo#256).
 *
 * MIRRORS `backend/src/schemas/statsFlightInsights.ts`; change both together.
 * Codes and numbers only — the client names an airport and formats a duration.
 */

export interface FlightReunion {
  airport: string;
  fromDay: string;
  toDay: string;
  days: number;
  /** Whole calendar years completed between the two days. */
  years: number;
  fromFlightId: string;
  toFlightId: string;
}

export interface MeasuredTransfer {
  minutes: number;
  airport: string | null;
  airportChange: { from: string; to: string; km: number | null } | null;
  /** The landing's local day at the connecting airport. */
  day: string;
  arrivingFlightId: string;
  departingFlightId: string;
  arrivingFlightNumber: string | null;
  departingFlightNumber: string | null;
}

export interface FlightInsightYear {
  year: number;
  flights: number;
  distanceKm: number;
  airportsUsed: number;
  newAirports: string[];
  /** 0–1; null when the year used no airport. */
  discoveryRate: number | null;
  connections: number;
  newConnections: string[];
  repeatedConnections: string[];
  flightsOnNewConnections: number;
  flightsOnRepeatedConnections: number;
}

export interface FlightTransferYear {
  year: number;
  count: number;
  totalMinutes: number;
  medianMinutes: number;
  shortest: MeasuredTransfer;
  longest: MeasuredTransfer;
}

export type StoryMeasure = "flights" | "distanceKm" | "airports" | "connections";

export interface FlightYearStory {
  year: number;
  availableYears: number[];
  /** The logbook's first year: every airport in it is new by definition. */
  firstRecordedYear: boolean;
  newAirports: string[];
  biggestChange: {
    measure: StoryMeasure;
    previousYear: number;
    previous: number;
    current: number;
    ratio: number;
  } | null;
  curiousRepetition:
    | { kind: "reunion"; reunion: FlightReunion }
    | { kind: "connection"; connection: string; flights: number }
    | null;
  funFacts: {
    fastestDay: string | null;
    fastestDayFlights: number;
    routeMaster: string | null;
    routeMasterCount: number;
    timezones: number;
  };
  transfers: { count: number; shortestMinutes: number | null };
}

export interface TransferCoverage {
  bookings: number;
  gaps: number;
  measured: number;
  unknownTime: number;
  unknownOrder: number;
  conflict: number;
  separate: number;
  notFlown: number;
}

export interface FlightInsights {
  history: {
    firstYear: number | null;
    lastYear: number | null;
    airportsTotal: number;
    connectionsTotal: number;
    countedFlights: number;
    undatedFlights: number;
    /** Year-only/unclassified dates: in their year, but in no pause or quarter. */
    placeholderDateFlights: number;
    unknownEndFlights: number;
  };
  years: FlightInsightYear[];
  reunions: FlightReunion[];
  quarterAirports: Array<{
    airport: string;
    year: number;
    /** The first visit in each quarter — the flights that prove it. */
    visits: Array<{ quarter: number; day: string; flightId: string }>;
  }>;
  transfers: {
    years: FlightTransferYear[];
    shortest: MeasuredTransfer | null;
    longest: MeasuredTransfer | null;
    coverage: TransferCoverage;
  };
  story: FlightYearStory | null;
}
