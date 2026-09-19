/**
 * The aircraft views' payloads: the ranking list and one registration's
 * profile. They left `index.ts` when it passed the 800-line limit, into the
 * per-subject module the directory already uses for achievements, cruises
 * and the catalogue.
 */
export interface AircraftRankingItem {
  registration: string;
  count: number;
  airline: string | null;
  aircraft: string | null;
  totalDistanceKm: number;
  firstFlightDate: string | null;
  lastFlightDate: string | null;
}

export interface AircraftRankingResponse {
  aircraft: AircraftRankingItem[];
  total: number;
}

export interface AircraftProfileFlight {
  id: string;
  flightNumber: string | null;
  airline: string | null;
  depIata: string | null;
  arrIata: string | null;
  depName: string | null;
  arrName: string | null;
  departureTime: string | null;
  arrivalTime: string | null;
  distanceKm: number;
  status: string;
}

export interface AircraftProfileResponse {
  registration: string;
  modeS: string | null;
  airline: string | null;
  aircraft: string | null;
  flightCount: number;
  totalDistanceKm: number;
  firstFlightDate: string | null;
  lastFlightDate: string | null;
  uniqueAirports: number;
  flights: AircraftProfileFlight[];
}
