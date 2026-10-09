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
