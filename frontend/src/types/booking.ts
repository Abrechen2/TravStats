/**
 * A booking — one payment covering several entries (flight + hotel on one
 * reference, a package tour). Mirrors `model Booking` and the booking
 * schemas in `backend/src/schemas/trip.ts`. Split out of `types/index.ts`,
 * which sits at the 800-line limit, when #356 added the package fields.
 */
export interface Booking {
  id: string;
  userId: string;
  tripId: string | null;
  pnr: string | null;
  price: number | null;
  /** ISO 4217 alpha-3 code (EUR, USD, GBP, CHF, INR, JPY, …) or null. */
  currency: string | null;
  /** Who sold the package (#356). Optional: an older server does not send it. */
  operator?: string | null;
  /** How many travellers the price covers — "für N Personen" (#356). */
  travellers?: number | null;
  /** The day it was booked, which dates the FX snapshot (#356). */
  bookedOn?: string | null;
}

export interface UpdateBookingInput {
  pnr?: string | null;
  price?: number | null;
  currency?: string | null;
  operator?: string | null;
  travellers?: number | null;
  /** `YYYY-MM-DD`. */
  bookedOn?: string | null;
}
