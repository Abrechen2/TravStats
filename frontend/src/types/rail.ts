/**
 * Rail journeys — one row per train ride (spec
 * docs/superpowers/specs/2026-09-25-rail-domain.md). Mirrors the backend row
 * (`RailJourney`) and the write body (`schemas/rail.ts`).
 */

export type RailStatus = "scheduled" | "in_progress" | "completed" | "cancelled";
export type RailTravelClass = "first" | "second" | "sleeper" | "couchette";
/** great_circle = straight line; user = typed; route = along the traced Transitous line. */
export type RailDistanceSource = "great_circle" | "user" | "route";
export type RailLookupProvider = "transitous" | "db-rest";

export const RAIL_TRAVEL_CLASSES: readonly RailTravelClass[] = [
  "first",
  "second",
  "sleeper",
  "couchette",
];

export interface RailJourney {
  id: string;
  userId: string;
  operator: string | null;
  trainCategory: string | null;
  trainNumber: string | null;
  depStationName: string;
  depStationCode: string | null;
  /** Catalogue row the station was picked from; null = geocoder pick. */
  depStationId: number | null;
  depLat: number;
  depLon: number;
  depCountry: string | null;
  /** IANA zone the server derived from the station's coordinates. */
  depTimezone: string | null;
  arrStationName: string;
  arrStationCode: string | null;
  arrStationId: number | null;
  arrLat: number;
  arrLon: number;
  arrCountry: string | null;
  arrTimezone: string | null;
  /** Real UTC instant. */
  departureTime: string;
  arrivalTime: string | null;
  distanceKm: number | null;
  distanceSource: RailDistanceSource | null;
  /** `[lon, lat]` points frozen at logging time; null = straight line. */
  geometry: [number, number][] | null;
  geometrySource: "none" | "straight" | "transitous" | "openrailrouting" | "manual";
  actualDepartureTime: string | null;
  actualArrivalTime: string | null;
  lookupProvider: RailLookupProvider | null;
  lookupRef: string | null;
  travelClass: RailTravelClass | null;
  coach: string | null;
  seat: string | null;
  bookingReference: string | null;
  price: number | null;
  currency: string | null;
  status: RailStatus;
  delayMinutes: number | null;
  notes: string | null;
  tags: string[];
  companions: string[];
  tripId: string | null;
  bookingId: string | null;
  trip?: { id: string; name: string; color: string } | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * A journey as `GET /trips/:id` carries it: everything a timeline entry and a
 * logistics row show, without the frozen line (thousands of points a trip page
 * does not draw).
 */
export type TripRailJourney = Pick<
  RailJourney,
  | "id"
  | "operator"
  | "trainCategory"
  | "trainNumber"
  | "depStationName"
  | "arrStationName"
  | "depTimezone"
  | "arrTimezone"
  | "departureTime"
  | "arrivalTime"
  | "distanceKm"
  | "distanceSource"
  | "status"
  | "delayMinutes"
  | "price"
  | "currency"
  | "bookingId"
>;

/** A leg of the same booking, as `GET /rail/:id` lists it. */
export interface RailBookingLeg {
  id: string;
  depStationName: string;
  arrStationName: string;
  departureTime: string;
  arrivalTime: string | null;
  depTimezone: string | null;
  arrTimezone: string | null;
  trainCategory: string | null;
  trainNumber: string | null;
  status: RailStatus;
}

/** A single journey read: the row plus the booking that binds its connection. */
export interface RailJourneyDetail extends RailJourney {
  booking: { id: string; pnr: string | null; railJourneys: RailBookingLeg[] } | null;
}

export interface RailStationInput {
  /** Catalogue row; the server then takes position, code and country from it. */
  stationId?: number | null;
  name: string;
  code?: string | null;
  lat: number;
  lon: number;
  country?: string | null;
}

/** The write body. Times are the station's wall clock, `YYYY-MM-DDTHH:mm`. */
export interface RailJourneyInput {
  operator?: string | null;
  trainCategory?: string | null;
  trainNumber?: string | null;
  departureStation: RailStationInput;
  arrivalStation: RailStationInput;
  departureLocal: string;
  arrivalLocal?: string | null;
  /** Only a distance typed from the ticket; null = measure it. */
  distanceKm?: number | null;
  travelClass?: RailTravelClass | null;
  coach?: string | null;
  seat?: string | null;
  bookingReference?: string | null;
  price?: number | null;
  currency?: string;
  status?: "scheduled" | "cancelled";
  delayMinutes?: number | null;
  notes?: string | null;
  tags?: string[];
  companions?: string[];
  tripId?: string | null;
  bookingId?: string | null;
  /** Create only: the leg this one continues (a connecting train). */
  connectsFrom?: string;
  /** The timetable trip a lookup matched; null drops it (and its traced line). */
  lookup?: { provider: RailLookupProvider; ref: string } | null;
}

/** A row of the station catalogue (GET /rail/stations). */
export interface RailStationHit {
  id: number;
  name: string;
  uic: string | null;
  dbId: string | null;
  lat: number;
  lon: number;
  country: string | null;
  timezone: string | null;
}

export interface RailLookupStop {
  name: string;
  lat: number;
  lon: number;
  stationId: number | null;
  code: string | null;
  country: string | null;
  /** Station clock, `YYYY-MM-DDTHH:mm`. */
  arrivalLocal: string | null;
  departureLocal: string | null;
}

export type RailLookupOutcome =
  "matched" | "noMatch" | "unavailable" | "disabled" | "notApplicable";

export interface RailLookupAnswer {
  match: {
    provider: RailLookupProvider;
    ref: string;
    operator: string | null;
    trainCategory: string | null;
    trainNumber: string | null;
    stops: RailLookupStop[];
    boardingIndex: number;
    hasGeometry: boolean;
  } | null;
  attempts: Array<{ provider: RailLookupProvider; outcome: RailLookupOutcome }>;
}

export interface RailLookupProviders {
  transitous: boolean;
  dbRest: boolean;
  transitousSourcesUrl: string;
}

/** One ranked label — an operator, a train category, a station. */
export interface RailRanked {
  label: string;
  count: number;
}

/**
 * `GET /rail/stats` — mirrors `RailStats` in `backend/src/services/rail/railStats.ts`.
 * Kilometres come per source and are never one undifferentiated figure; hours
 * and delays carry the size of the sample they were measured over.
 */
export interface RailStats {
  journeys: number;
  distance: {
    totalKm: number;
    straightLineKm: number;
    tracedKm: number;
    ticketKm: number;
    unmeasuredJourneys: number;
  };
  hoursOnBoard: { hours: number; measuredJourneys: number };
  countries: string[];
  operators: RailRanked[];
  trainCategories: RailRanked[];
  stations: RailRanked[];
  longest: {
    id: string;
    depStationName: string;
    arrStationName: string;
    distanceKm: number;
    distanceSource: string | null;
  } | null;
  delays: {
    recordedJourneys: number;
    buckets: Array<{ upToMinutes: number | null; count: number }>;
  };
  byYear: Array<{ year: number; journeys: number; km: number }>;
}
