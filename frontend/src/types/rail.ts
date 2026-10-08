/**
 * Rail journeys — one row per train ride (spec
 * docs/superpowers/specs/2026-09-25-rail-domain.md). Mirrors the backend row
 * (`RailJourney`) and the write body (`schemas/rail.ts`).
 */

import type { RailTimes } from "./times";

export type RailStatus = "scheduled" | "in_progress" | "completed" | "cancelled";
export type RailTravelClass = "first" | "second" | "sleeper" | "couchette";
/**
 * great_circle = straight line; user = typed; route = along the traced
 * Transitous line; roadtrip = along the line a converted roadtrip leg brought.
 */
export type RailDistanceSource = "great_circle" | "user" | "route" | "roadtrip";
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
  /**
   * DB station code (Ril 100, "KK") of the catalogue row each station was
   * picked from; null when unknown or picked from the geocoder — never derived.
   * Absent on rows that do not carry it (a trip's journey list).
   */
  depStationShortCode?: string | null;
  arrStationShortCode?: string | null;
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
  geometrySource: "none" | "straight" | "transitous" | "openrailrouting" | "brouter" | "manual";
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
  /**
   * The user's own mark that the change AFTER this train is tight
   * (forgejo#234); set on the leg arriving at the change, never derived.
   */
  tightConnection: boolean;
  notes: string | null;
  tags: string[];
  companions: string[];
  tripId: string | null;
  bookingId: string | null;
  /** Import key; `roadtrip:<section>:<leg>` marks a ride converted from a roadtrip. */
  externalRef?: string | null;
  trip?: { id: string; name: string; color: string } | null;
  /** ADR 0002 phase 4 — read through lib/entityTimes.ts. */
  times?: RailTimes;
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
  | "times"
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
  /** Catalogue rows — how a change of stations is told (forgejo#234). */
  depStationId: number | null;
  arrStationId: number | null;
  departureTime: string;
  arrivalTime: string | null;
  depTimezone: string | null;
  arrTimezone: string | null;
  trainCategory: string | null;
  trainNumber: string | null;
  status: RailStatus;
  travelClass: RailTravelClass | null;
  coach: string | null;
  seat: string | null;
  bookingReference: string | null;
  tightConnection: boolean;
  times?: RailTimes;
}

/** A single journey read: the row plus the booking that binds its connection. */
export interface RailJourneyDetail extends RailJourney {
  booking: { id: string; pnr: string | null; railJourneys: RailBookingLeg[] } | null;
}

/**
 * A ride as the logbook lists it (forgejo#187): its trains in travel order —
 * one for a direct ride, several for a ride with changes. The server decides
 * which legs belong together (`shared/railJourneyGrouping.ts` there); `id` is
 * the first leg's, and any leg's id finds the connection.
 */
export interface RailConnection {
  id: string;
  legs: RailJourney[];
}

/** `GET /rail/connections/:legId`: the connection and the booking binding it. */
export interface RailConnectionDetail extends RailConnection {
  booking: { id: string; pnr: string | null } | null;
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
  /**
   * Which occurrence of a repeated autumn hour the wall clock means; null or
   * absent is the earlier one, the server's default (ADR 0002, D3 / Q5).
   */
  departureFold?: "earlier" | "later" | null;
  arrivalFold?: "earlier" | "later" | null;
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
  /** The "tight change" mark; the form never sends it, a PATCH of its own does. */
  tightConnection?: boolean;
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
  /** DB station code (Ril 100); null when no source names one. */
  shortCode: string | null;
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

/**
 * One provider's answer. `timedOut` = asked, but the lookup's 20 s budget ran
 * out first; `skippedForTime` = not asked, the budget was spent before its turn.
 */
export type RailLookupOutcome =
  | "matched"
  | "noMatch"
  | "unavailable"
  | "disabled"
  | "notApplicable"
  | "timedOut"
  | "skippedForTime";

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

/** Why a Transitous match was saved without its (new) traced line. */
export type RailGeometryFallback =
  | "providerDisabled"
  | "providerUnavailable"
  | "stationOffLine"
  | "untracedShape"
  | "railRoutingUnavailable"
  | "railRoutingNoRoute";

/**
 * `meta.geometry` of a save: what it did to the frozen line. `kept` = a
 * re-fetch did not deliver and the stored line stayed; `unchanged` = an edit
 * that touched neither station nor match.
 */
export interface RailGeometryReport {
  /** `routed` = a line over the tracks from the instance's OpenRailRouting. */
  outcome: "unchanged" | "traced" | "routed" | "straight" | "kept";
  geometrySource: RailJourney["geometrySource"];
  fallback: RailGeometryFallback | null;
}

/** A saved journey and what the save did to its line. */
export interface RailSaveResult {
  journey: RailJourney;
  geometry: RailGeometryReport | null;
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
    roadtripKm: number;
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
    /** Mean over the recorded rides; null when none carries a delay — never 0. */
    averageMinutes: number | null;
  };
  byYear: Array<{ year: number; journeys: number; km: number }>;
  /** Rides of a kind, counted by the rule the rail badges use. */
  rideKinds: { nightTrains: number; highSpeed: number; crossBorder: number; operators: number };
}

/** A train the user has ridden, as a ticket prints it ("ICE 578"). */
export interface RailTrainSuggestion {
  category: string | null;
  number: string;
}

/** `GET /rail/entry-suggestions` — chips for the rail form from the user's own rides. */
export interface RailEntrySuggestions {
  trains: RailTrainSuggestion[];
  operators: string[];
  travelClass: RailTravelClass | null;
  coaches: string[];
  seats: string[];
}

/** A station as a parsed ticket names it — tied to the catalogue, or not. */
export interface RailImportStation {
  /** The catalogue's name when resolved, else the printed one. */
  name: string;
  /** The name exactly as the ticket prints it. */
  printedName: string;
  stationId: number | null;
  code: string | null;
  lat: number | null;
  lon: number | null;
  country: string | null;
  timezone: string | null;
  /** False: no unambiguous catalogue match — the review asks the user to pick one. */
  resolved: boolean;
}

/** One ride out of a parsed ticket, as the review shows it. */
export interface RailImportLeg {
  depStationName: string;
  arrStationName: string;
  /** `YYYY-MM-DDTHH:mm` on the station's clock, as printed. */
  departureLocal: string;
  arrivalLocal: string | null;
  trainCategory: string | null;
  trainNumber: string | null;
  coach: string | null;
  seat: string | null;
  direction: "outbound" | "return" | null;
  departureStation: RailImportStation;
  arrivalStation: RailImportStation;
  /** A journey the user already logged with this reference and departure. */
  duplicateOf: string | null;
  /** Only on a reservation document's legs: the logged journey the seat belongs to. */
  reservation?: RailReservationMatch;
}

/** A logged journey a later seat reservation may attach to (forgejo#203). */
export interface RailReservationTarget {
  id: string;
  trainCategory: string | null;
  trainNumber: string | null;
  depStationName: string;
  arrStationName: string;
  /** `YYYY-MM-DDTHH:mm` on the departure station's clock. */
  departureLocal: string;
  arrivalLocal: string | null;
  coach: string | null;
  seat: string | null;
}

/** What the server found for one reservation leg — nothing is guessed. */
export type RailReservationMatch =
  | { kind: "attach"; target: RailReservationTarget; subSection: boolean }
  | { kind: "change"; target: RailReservationTarget; subSection: boolean }
  | { kind: "alreadySet"; target: RailReservationTarget; subSection: boolean }
  | { kind: "several"; targets: RailReservationTarget[] }
  | { kind: "sameJourneyTwice"; target: RailReservationTarget }
  | { kind: "none"; reason: "noTrain" | "noSeat" | "noJourney" };

export interface RailImportBooking {
  bookingReference: string | null;
  travelClass: RailTravelClass | null;
  tariff: string | null;
  /** The total the document labels as such. */
  price: number | null;
  currency: string | null;
  operator: string | null;
  source: string;
  /** `reservation`: seats for journeys already logged, never new rides. Absent: a booking. */
  documentKind?: "booking" | "reservation";
  legs: RailImportLeg[];
}

/** Why a rail parse found nothing — a stable code, worded by the client. */
export type RailParseFallbackCode =
  | "noItinerary"
  | "llmUnreachable"
  | "llmFailed"
  | "llmFoundNothing"
  | "demoNoLlm"
  /** An admin has switched the language model off. */
  | "llmDisabled"
  /** A provider outside the network, without the admin's consent. */
  | "llmCloudNotConsented"
  /** The OpenAI-compatible provider is missing its base URL or model. */
  | "llmProviderIncomplete"
  /** The document is clearly another kind of booking (D1) — see `domainMismatch`. */
  | "otherDomain"
  /** The model answered with airport codes for stations. */
  | "looksLikeFlight";
