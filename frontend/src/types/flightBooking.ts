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
  /** Cruises, train journeys and stays filed on the same booking. */
  otherEntries: number;
}

export interface FlightBookingAnswer {
  /** Null when the flight is linked to no booking. */
  booking: FlightBookingSummary | null;
  /** Every flight LINKED to the booking, by stored departure instant. */
  segments: Flight[];
}
