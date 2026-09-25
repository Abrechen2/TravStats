/**
 * Rail journeys — one row per train ride (spec
 * docs/superpowers/specs/2026-09-25-rail-domain.md). Mirrors the backend row
 * (`RailJourney`) and the write body (`schemas/rail.ts`).
 */

export type RailStatus = "scheduled" | "in_progress" | "completed" | "cancelled";
export type RailTravelClass = "first" | "second" | "sleeper" | "couchette";
export type RailDistanceSource = "great_circle" | "user";

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
  depLat: number;
  depLon: number;
  depCountry: string | null;
  /** IANA zone the server derived from the station's coordinates. */
  depTimezone: string | null;
  arrStationName: string;
  arrStationCode: string | null;
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
  lookupProvider: string | null;
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

export interface RailStationInput {
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
}
