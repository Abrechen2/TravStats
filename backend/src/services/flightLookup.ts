import { findOrCreateAirport } from './airportLookup';

interface AviationStackResponse {
  data?: AviationStackFlight[];
  error?: { message?: string };
}

interface AviationStackFlight {
  airline?: { name?: string; iata?: string; icao?: string };
  flight?: { number?: string; iata?: string; icao?: string };
  departure?: {
    airport?: string;
    iata?: string;
    icao?: string;
    scheduled?: string;
    estimated?: string;
  };
  arrival?: {
    airport?: string;
    iata?: string;
    icao?: string;
    scheduled?: string;
    estimated?: string;
  };
  aircraft?: { iata?: string; icao?: string; registration?: string };
}

export interface FlightLookupResult {
  airline?: string;
  flightNumber?: string;
  aircraft?: string;
  departure?: any;
  arrival?: any;
  departureTime?: string;
  arrivalTime?: string;
}

/**
 * Fetches flight details from Aviationstack and enriches airports via our DB lookups.
 * Returns null when no API key is configured or no data is found.
 */
export async function lookupFlightDetails(
  flightNumber: string,
  date?: string
): Promise<FlightLookupResult | null> {
  const apiKey = process.env.AVIATIONSTACK_API_KEY;

  if (!apiKey) {
    console.warn('AVIATIONSTACK_API_KEY not set, skipping flight lookup');
    return null;
  }

  const params = new URLSearchParams({ access_key: apiKey, limit: '1' });
  const trimmedNumber = flightNumber.trim();

  if (!trimmedNumber) {
    return null;
  }

  // Aviationstack prefers either flight_iata or flight_icao
  if (/^[A-Za-z]{2}\d+/.test(trimmedNumber)) {
    params.set('flight_iata', trimmedNumber);
  } else {
    params.set('flight_icao', trimmedNumber);
  }

  if (date) {
    params.set('flight_date', date);
  }

  const url = `http://api.aviationstack.com/v1/flights?${params.toString()}`;

  try {
    const response = await fetch(url);

    if (!response.ok) {
      console.error('Aviationstack request failed', await response.text());
      return null;
    }

    const json = (await response.json()) as AviationStackResponse;

    if (json.error) {
      console.error('Aviationstack returned error', json.error);
      return null;
    }

    const result = json.data?.[0];
    if (!result) {
      return null;
    }

    const departureCode = result.departure?.iata || result.departure?.icao;
    const arrivalCode = result.arrival?.iata || result.arrival?.icao;

    const [departureAirport, arrivalAirport] = await Promise.all([
      departureCode ? findOrCreateAirport(departureCode) : Promise.resolve(null),
      arrivalCode ? findOrCreateAirport(arrivalCode) : Promise.resolve(null),
    ]);

    return {
      airline: result.airline?.name,
      flightNumber: result.flight?.iata || result.flight?.icao || trimmedNumber,
      aircraft: result.aircraft?.icao || result.aircraft?.iata,
      departure: departureAirport || undefined,
      arrival: arrivalAirport || undefined,
      departureTime: result.departure?.estimated || result.departure?.scheduled,
      arrivalTime: result.arrival?.estimated || result.arrival?.scheduled,
    };
  } catch (error) {
    console.error('Aviationstack lookup failed', error);
    return null;
  }
}
