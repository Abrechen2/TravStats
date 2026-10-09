import type { Flight } from "./index";

/**
 * A flight's booking as `GET /flights/:id/booking` answers it (forgejo#218,
 * #219) — mirrors `FlightBookingSummary` in the backend's OpenAPI module
 * `services/openapi/paths/flightBooking.ts`.
 */
export interface FlightBookingSummary {
  id: string;
  pnr: string | null;
  /** The booking's all-in total, counted once for the whole booking. 0 = free, null = none recorded. */
  price: number | null;
  currency: string | null;
  /** The trip the BOOKING belongs to — where its price is edited. May differ from a segment's trip. */
  tripId: string | null;
  tripName: string | null;
  /** Cruises, train journeys and stays filed on the same booking. */
  otherEntries: number;
  /** The optional split across the segments (forgejo#219), or null. */
  split: FlightBookingSplit | null;
}

/**
 * A DISPLAY-ONLY split of the booking total across its flights: no total
 * reads it, totals count the booking price once. The shares sum to `price`
 * to the currency's minor unit.
 */
export interface FlightBookingSplit {
  method: "equal" | "distance";
  /** The total the split was computed from. */
  price: number;
  currency: string | null;
  shares: Array<{ flightId: string; amount: number }>;
  /** Null while the split still describes the booking; otherwise what changed since. */
  staleReason: "price" | "currency" | "segments" | null;
}

export interface FlightBookingAnswer {
  /** Null when the flight is linked to no booking. */
  booking: FlightBookingSummary | null;
  /** Every flight LINKED to the booking, by stored departure instant. */
  segments: Flight[];
}
