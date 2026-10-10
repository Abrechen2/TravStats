/**
 * Bus rides — one row per coach ride (spec
 * docs/superpowers/specs/2026-10-07-bus-domain-design.md). Mirrors the backend
 * row (`BusJourney`) and the write body (`schemas/bus.ts`). The two ends carry
 * rail's column names, so `lib/entityTimes.ts`'s `RailLike` readers and
 * `lib/railTime.ts` accept a bus row as-is.
 */

import type { RailTimes } from "./times";

export type BusStatus = "scheduled" | "in_progress" | "completed" | "cancelled";
export type BusRideKind = "intercity" | "shuttle" | "other";
export type BusDistanceSource = "great_circle" | "user" | "route";
export type BusGeometrySource = "straight" | "road" | "manual";

export const BUS_RIDE_KINDS: readonly BusRideKind[] = ["intercity", "shuttle", "other"];

/** The same four members as a rail ride's times; the OpenAPI name is `BusTimes`. */
export type BusTimes = RailTimes;

export interface BusJourney {
  id: string;
  userId: string;
  operator: string | null;
  lineName: string | null;
  rideKind: BusRideKind | null;
  depStationName: string;
  depAddress: string | null;
  depLat: number;
  depLon: number;
  depCountry: string | null;
  depTimezone: string | null;
  arrStationName: string;
  arrAddress: string | null;
  arrLat: number;
  arrLon: number;
  arrCountry: string | null;
  arrTimezone: string | null;
  departureTime: string;
  arrivalTime: string | null;
  distanceKm: number | null;
  distanceSource: BusDistanceSource | null;
  geometry: [number, number][] | null;
  geometrySource: BusGeometrySource;
  actualDepartureTime: string | null;
  actualArrivalTime: string | null;
  fareClass: string | null;
  seat: string | null;
  bookingReference: string | null;
  price: number | null;
  currency: string | null;
  status: BusStatus;
  delayMinutes: number | null;
  notes: string | null;
  tags: string[];
  companions: string[];
  tripId: string | null;
  bookingId: string | null;
  externalRef?: string | null;
  trip?: { id: string; name: string; color: string } | null;
  times?: BusTimes;
  createdAt: string;
  updatedAt: string;
}

/** A bus ride as `GET /trips/:id` lists it (forgejo#180): timeline card + map line. */
export type TripBusJourney = Pick<
  BusJourney,
  | "id"
  | "operator"
  | "lineName"
  | "rideKind"
  | "depStationName"
  | "arrStationName"
  | "depLat"
  | "depLon"
  | "arrLat"
  | "arrLon"
  | "depTimezone"
  | "arrTimezone"
  | "departureTime"
  | "arrivalTime"
  | "times"
  | "distanceKm"
  | "distanceSource"
  | "geometry"
  | "geometrySource"
  | "status"
  | "delayMinutes"
  | "price"
  | "currency"
  | "bookingId"
>;

export interface BusStationInput {
  name: string;
  address: string | null;
  lat: number;
  lon: number;
  country: string | null;
}

/** The write body — every optional field SENT, null when empty (see `busFormModel.ts`). */
export interface BusJourneyInput {
  operator: string | null;
  lineName: string | null;
  rideKind: BusRideKind | null;
  departureStation: BusStationInput;
  arrivalStation: BusStationInput;
  departureLocal: string;
  arrivalLocal: string | null;
  departureFold?: "earlier" | "later" | null;
  arrivalFold?: "earlier" | "later" | null;
  distanceKm: number | null;
  fareClass: string | null;
  seat: string | null;
  delayMinutes: number | null;
  bookingReference: string | null;
  price: number | null;
  currency: string;
  status: "scheduled" | "cancelled";
  tags: string[];
  companions: string[];
  tripId: string | null;
  notes: string | null;
}

export interface BusTerminalSuggestion {
  name: string;
  address: string | null;
  lat: number;
  lon: number;
  country: string | null;
}

export interface BusEntrySuggestions {
  operators: string[];
  fareClasses: string[];
  terminals: BusTerminalSuggestion[];
}

export const NO_BUS_SUGGESTIONS: BusEntrySuggestions = {
  operators: [],
  fareClasses: [],
  terminals: [],
};

export interface BusRanked {
  label: string;
  count: number;
}

/** `GET /bus/stats` — mirrors `BusStats` in `backend/src/services/bus/busStats.ts` (forgejo#263). */
export interface BusStats {
  rides: number;
  distance: {
    totalKm: number;
    straightLineKm: number;
    routeKm: number;
    ticketKm: number;
    unmeasuredRides: number;
  };
  hoursOnBoard: { hours: number; measuredRides: number };
  countries: string[];
  operators: BusRanked[];
  /** intercity | shuttle | other | unknown. */
  rideKinds: BusRanked[];
  terminals: BusRanked[];
  terminalsVisited: number;
  longest: {
    id: string;
    depStationName: string;
    arrStationName: string;
    distanceKm: number;
    distanceSource: string | null;
  } | null;
  delays: {
    recordedRides: number;
    buckets: Array<{ upToMinutes: number | null; count: number }>;
    averageMinutes: number | null;
  };
  /** `km` null when no ride of the year has a distance — unknown, never 0. */
  byYear: Array<{ year: number; rides: number; km: number | null; unmeasured?: number }>;
  journeys: { total: number; withTransfer: number };
  transfers: { count: number; averageMinutes: number | null };
  favouriteConnections: Array<{ from: string; to: string; rides: number; latestRideId: string }>;
  newDestinations: { inScope: number; byYear: Array<{ year: number; count: number }> };
  longestReturn: { days: number; terminal: string } | null;
  night: { rides: number; nights: number };
}
