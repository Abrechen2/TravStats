/**
 * Types and pure helpers of the flight form, split out of useFlightForm.ts
 * (file-size debt, forgejo#59). useFlightForm re-exports the public ones, so
 * existing imports keep working.
 */
export interface FlightLookupResult {
  flightNumber: string;
  airline: string;
  /** Operating airline if the searched flight number is a marketing codeshare. */
  operatingAirline?: string;
  /** True if the API flagged the entry as `IsCodeshare`. */
  isCodeshare?: boolean;
  /** ATC callsign, e.g. "DLH400". AeroDataBox-only. */
  callsign?: string;
  /** Airline IATA code, e.g. "LH". AeroDataBox-only. */
  airlineIata?: string;
  /** Airline ICAO code, e.g. "DLH". AeroDataBox-only. */
  airlineIcao?: string;
  departure: {
    iata?: string;
    name?: string;
    scheduledTime?: string;
    terminal?: string;
    gate?: string;
  };
  arrival: {
    iata?: string;
    name?: string;
    scheduledTime?: string;
    terminal?: string;
    gate?: string;
  };
  aircraft?: string;
  /** Tail number / aircraft registration, e.g. "D-AIHX". AeroDataBox-only. */
  aircraftRegistration?: string;
  /** Mode-S transponder hex, e.g. "3C6518". AeroDataBox-only. */
  aircraftModeS?: string;
  /** Great-circle route distance in km from the provider. */
  distance?: number;
  /** Hint to set status to `'cancelled'` or `'diverted'`. AeroDataBox-only. */
  status?: string;
}

export interface DuplicateFlight {
  id: string;
  flightNumber: string;
  airline: string | null;
  depIata: string | null;
  arrIata: string | null;
  departureTime: string;
}

export interface FlightSubmitOptions {
  force?: boolean;
  merge?: boolean;
  hasMoreFlights?: boolean;
}

// Resolve a historical date string (YYYY / YYYY-MM / YYYY-MM-DD) plus an
// optional HH:mm time into the canonical local-wall-clock submit shape.
// Year-only  -> YYYY-01-01T00:00
// Year+Month -> YYYY-MM-01T00:00
// Year+Month+Day -> YYYY-MM-DDT<time|12:00>
// Everything else falls through to the original YYYY-MM-DDT<time> path.
//
// Module-level (not a hook-local closure) and exported so every submit path
// that recombines a split date+time pair (e.g. FlightEditModal) reuses this
// exact implementation instead of writing a second one — two
// implementations of this is precisely how the create and edit forms
// drifted apart before the edit form's inputs were split to match.
// `anchorDateOnly` is what separates "I only know the day" from "I cleared
// the time". A historical flight legitimately carries a day without a clock
// reading, and noon is its documented midpoint (the row is stamped DATE_ONLY
// alongside). On the ordinary path a blank time means the user emptied the
// field, and inventing noon there wrote a departure nobody entered — and,
// via actual-vs-scheduled, a delay nobody suffered. Callers on that path get
// `null` and must treat it as incomplete input, not as a value.
export function buildLocalString(
  date: string,
  time: string,
  opts: { anchorDateOnly?: boolean } = {}
): string | null {
  if (/^\d{4}$/.test(date)) {
    return `${date}-01-01T00:00`;
  }
  if (/^\d{4}-\d{2}$/.test(date)) {
    return `${date}-01T00:00`;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    if (time) return `${date}T${time}`;
    return opts.anchorDateOnly ? `${date}T12:00` : null;
  }
  return `${date}T${time}`;
}

/**
 * A 409 `already_imported` is the server saying "you already have this one" —
 * the ordinary answer to reading a forwarded confirmation a second time. It is
 * recognised by the fixed code, never by prose, so a reworded message cannot
 * turn a known outcome back into an unexplained failure.
 */
export function isAlreadyImported(err: unknown): boolean {
  const res = (err as { response?: { status?: number; data?: { error?: string } } }).response;
  return res?.status === 409 && res.data?.error === "already_imported";
}
