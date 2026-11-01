// Provider response shapes the Aviationstack branch of `flightLookup.ts` reads
// (forgejo#386, REF-16 — moved out of it unchanged).

/** Aviationstack API response structures */
export interface AviationstackFlightResult {
  /** Service day of the flight (YYYY-MM-DD) as reported by the API. */
  flight_date?: string;
  airline?: { name?: string };
  flight?: { iata?: string; icao?: string };
  aircraft?: { icao?: string; iata?: string };
  departure?: {
    iata?: string;
    icao?: string;
    estimated?: string;
    scheduled?: string;
    actual?: string;
    terminal?: string;
    gate?: string;
  };
  arrival?: {
    iata?: string;
    icao?: string;
    estimated?: string;
    scheduled?: string;
    actual?: string;
    terminal?: string;
    gate?: string;
  };
}

/** Aviationstack API response wrapper */
export interface AviationstackApiResponse {
  data?: AviationstackFlightResult[];
}

/** Airport data returned from findOrCreateAirport */
export interface AirportInfo {
  iata?: string | null;
  icao?: string | null;
  name?: string;
  lat?: number;
  lon?: number;
  terminal?: string;
  gate?: string;
}
