/**
 * Flight Number Lookup Service
 *
 * Supports two providers:
 * - AirLabs (free tier, cached)
 * - Aviationstack (if API key is present)
 *
 * Falls back to AirLabs when Aviationstack is not configured.
 */

import axios from 'axios';
import { findOrCreateAirport } from './airportLookup';

// In-memory cache for flight lookup results (AirLabs)
interface FlightLookupCache {
  [key: string]: {
    data: FlightData[];
    timestamp: number;
  };
}

const CACHE_TTL = 6 * 60 * 60 * 1000; // 6 hours for historical flights
const RECENT_CACHE_TTL = 30 * 60 * 1000; // 30 minutes for recent/future flights
const flightCache: FlightLookupCache = {};

// OpenSky token cache
let openSkyTokenCache: { token: string; expiresAt: number } | null = null;

export interface FlightData {
  flightNumber: string;
  airline: string;
  airlineIata?: string;
  airlineIcao?: string;
  departure: {
    iata?: string;
    icao?: string;
    name?: string;
    scheduledTime?: string;
    actualTime?: string;
    terminal?: string;
    gate?: string;
  };
  arrival: {
    iata?: string;
    icao?: string;
    name?: string;
    scheduledTime?: string;
    actualTime?: string;
    terminal?: string;
    gate?: string;
  };
  aircraft?: string;
  aircraftIcao?: string;
  status?: string;
  duration?: number;
  distance?: number;
}

/**
 * Lookup flight by flight number and optional date
 * Uses AirLabs API (free tier) with caching
 */
export async function lookupFlightByNumber(
  flightNumber: string,
  date?: Date
): Promise<FlightData[]> {
  const apiKey = process.env.AIRLABS_API_KEY;

  if (!apiKey) {
    console.warn('AIRLABS_API_KEY not configured - flight lookup disabled');
    return [];
  }

  // Generate cache key
  const dateStr = date ? date.toISOString().split('T')[0] : 'nodate';
  const cacheKey = `${flightNumber.toUpperCase()}_${dateStr}`;

  // Check cache
  const now = Date.now();
  const cached = flightCache[cacheKey];

  if (cached) {
    // Determine TTL based on flight date
    const isHistorical = date && date < new Date();
    const ttl = isHistorical ? CACHE_TTL : RECENT_CACHE_TTL;

    if (now - cached.timestamp < ttl) {
      return cached.data;
    }
  }

  try {
    // AirLabs API endpoint for flight schedules
    const response = await axios.get('https://airlabs.co/api/v9/schedules', {
      params: {
        api_key: apiKey,
        flight_iata: flightNumber,
        ...(date && { dep_date: date.toISOString().split('T')[0] }),
      },
      timeout: 5000,
    });

    if (!response.data || !response.data.response) {
      flightCache[cacheKey] = {
        data: [],
        timestamp: now,
      };
      return [];
    }

    const flights: FlightData[] = response.data.response.map((flight: any) => ({
      flightNumber: flight.flight_iata || flightNumber,
      airline: flight.airline_name || getAirlineName(flight.airline_iata || '') || flight.airline_icao || 'Unknown',
      airlineIata: flight.airline_iata,
      airlineIcao: flight.airline_icao,
      departure: {
        iata: flight.dep_iata,
        icao: flight.dep_icao,
        name: flight.dep_name,
        scheduledTime: flight.dep_time_utc || flight.dep_time,
        actualTime: flight.dep_actual_utc || flight.dep_actual,
        terminal: flight.dep_terminal,
        gate: flight.dep_gate,
      },
      arrival: {
        iata: flight.arr_iata,
        icao: flight.arr_icao,
        name: flight.arr_name,
        scheduledTime: flight.arr_time_utc || flight.arr_time,
        actualTime: flight.arr_actual_utc || flight.arr_actual,
        terminal: flight.arr_terminal,
        gate: flight.arr_gate,
      },
      aircraft: flight.aircraft_icao,
      status: flight.status,
      duration: flight.duration,
      distance: flight.distance,
    }));

    // Cache the results
    flightCache[cacheKey] = {
      data: flights,
      timestamp: now,
    };

    return flights;
  } catch (error: any) {
    // Return cached data even if expired, as fallback
    if (cached) {
      return cached.data;
    }
    return [];
  }
}

/**
 * Aviationstack + enrichment (preferred when key is set), AirLabs fallback.
 */
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
 * Resolve OpenSky auth headers (prefers OAuth2 client credentials, falls back to basic)
 */
async function getOpenSkyAuthHeaders(opts: {
  clientId?: string;
  clientSecret?: string;
  user?: string;
  pass?: string;
}): Promise<Record<string, string> | null> {
  // OAuth2 client credentials
  if (opts.clientId && opts.clientSecret) {
    const now = Date.now();
    if (openSkyTokenCache && openSkyTokenCache.expiresAt > now + 30_000) {
      return { Authorization: `Bearer ${openSkyTokenCache.token}` };
    }

    try {
      const params = new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: opts.clientId,
        client_secret: opts.clientSecret,
      });

      const response = await axios.post(
        'https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token',
        params.toString(),
        {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          timeout: 5000,
        }
      );

      const token = response.data?.access_token as string | undefined;
      const expiresIn = response.data?.expires_in as number | undefined;
      if (token) {
        const ttl = expiresIn ? expiresIn * 1000 : 30 * 60 * 1000; // default 30min
        openSkyTokenCache = { token, expiresAt: Date.now() + ttl };
        return { Authorization: `Bearer ${token}` };
      }
    } catch (err) {
      console.warn('OpenSky OAuth token fetch failed', err instanceof Error ? err.message : err);
      // fallback to basic if provided
    }
  }

  // Basic auth fallback
  if (opts.user && opts.pass) {
    const pair = `${opts.user}:${opts.pass}`;
    const b64 = Buffer.from(pair).toString('base64');
    return { Authorization: `Basic ${b64}` };
  }

  return null;
}

export async function lookupFlightDetails(
  flightNumber: string,
  date?: string
): Promise<FlightLookupResult | null> {
  const trimmedNumber = flightNumber.trim();
  if (!trimmedNumber) return null;

  // Optional OpenSky credentials (supports token and basic)
  const openSkyUser = process.env.OPENSKY_USERNAME;
  const openSkyPass = process.env.OPENSKY_PASSWORD;
  const openSkyClientId = process.env.OPENSKY_CLIENT_ID;
  const openSkyClientSecret = process.env.OPENSKY_CLIENT_SECRET;

  // Prefer Aviationstack if configured
  const aviationstackKey = process.env.AVIATIONSTACK_API_KEY;
  if (aviationstackKey) {
    // API docs: https://docs.apilayer.com/aviationstack/docs/endpoints#flights
    // Use HTTPS + params to avoid signature/order issues
    const params: Record<string, string> = {
      access_key: aviationstackKey,
      limit: '1',
    };
    if (/^[A-Za-z]{2}\d+/.test(trimmedNumber)) {
      params.flight_iata = trimmedNumber;
    } else {
      params.flight_icao = trimmedNumber;
    }
    if (date) {
      params.flight_date = date;
    }

    try {
      const response = await axios.get('https://api.aviationstack.com/v1/flights', {
        params,
        timeout: 6000,
      });
      const json: any = response.data;
      const result = json.data?.[0];

      if (result) {
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
      }
    } catch (err) {
      console.error('Aviationstack lookup failed', err);
    }
  }

  // Fallback to AirLabs
  const fallbackDate = date ? new Date(date) : undefined;
  const flights = await lookupFlightByNumber(trimmedNumber, fallbackDate);

  if (!flights.length) {
    // Try OpenSky as last resort (requires credentials)
    const openSkyAuth = await getOpenSkyAuthHeaders({
      clientId: openSkyClientId,
      clientSecret: openSkyClientSecret,
      user: openSkyUser,
      pass: openSkyPass,
    });
    const openSky = await lookupOpenSkyFlight(trimmedNumber, date, openSkyAuth);
    if (openSky) return openSky;
    return null;
  }

  const first = flights[0];
  const departureCode = first.departure.iata || first.departure.icao;
  const arrivalCode = first.arrival.iata || first.arrival.icao;

  const [departureAirport, arrivalAirport] = await Promise.all([
    departureCode ? findOrCreateAirport(departureCode) : Promise.resolve(null),
    arrivalCode ? findOrCreateAirport(arrivalCode) : Promise.resolve(null),
  ]);

  return {
    airline: first.airline || (first.airlineIata ? getAirlineName(first.airlineIata) || undefined : undefined) || first.airlineIcao,
    flightNumber: first.flightNumber,
    aircraft: first.aircraft || first.aircraftIcao,
    departure: departureAirport || undefined,
    arrival: arrivalAirport || undefined,
    departureTime: first.departure.scheduledTime || first.departure.actualTime,
    arrivalTime: first.arrival.scheduledTime || first.arrival.actualTime,
  };
}

/**
 * Very lightweight OpenSky fallback (requires optional OPENSKY_USERNAME/PASSWORD)
 * Only works for recent flights and provides limited fields.
 */
async function lookupOpenSkyFlight(
  flightNumber: string,
  date?: string,
  authHeaders?: Record<string, string>
): Promise<FlightLookupResult | null> {
  if (!authHeaders) return null;

  const callsign = flightNumber.toUpperCase();
  const baseDate = date ? new Date(date) : new Date();
  const begin = Math.floor(baseDate.setHours(0, 0, 0, 0) / 1000);
  const end = begin + 24 * 60 * 60;

  try {
    const url = `https://opensky-network.org/api/flights/callsign?callsign=${callsign}&begin=${begin}&end=${end}`;
    const response = await axios.get(url, { timeout: 6000, headers: authHeaders });
    const result = (response.data as any[])[0];
    if (!result) return null;

    const [departureAirport, arrivalAirport] = await Promise.all([
      result.estDepartureAirport ? findOrCreateAirport(result.estDepartureAirport) : Promise.resolve(null),
      result.estArrivalAirport ? findOrCreateAirport(result.estArrivalAirport) : Promise.resolve(null),
    ]);

    return {
      airline: getAirlineName(callsign.slice(0, 2)) || undefined,
      flightNumber: callsign.trim(),
      departure: departureAirport || undefined,
      arrival: arrivalAirport || undefined,
      departureTime: result.firstSeen ? new Date(result.firstSeen * 1000).toISOString() : undefined,
      arrivalTime: result.lastSeen ? new Date(result.lastSeen * 1000).toISOString() : undefined,
    };
  } catch (err) {
    console.warn('OpenSky fallback failed', err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Fallback: Try to lookup flight using flight number patterns
 * Extracts airline from flight number (e.g., "LH400" -> "LH")
 */
export function parseFlightNumber(flightNumber: string): {
  airlineCode: string | null;
  flightNum: string | null;
} {
  const match = flightNumber.match(/^([A-Z]{2,3})\s*(\d{1,4})$/i);

  if (match) {
    return {
      airlineCode: match[1].toUpperCase(),
      flightNum: match[2],
    };
  }

  return {
    airlineCode: null,
    flightNum: null,
  };
}

/**
 * Get airline name from IATA code (basic fallback)
 */
export function getAirlineName(iataCode: string): string | null {
  const airlines: Record<string, string> = {
    LH: 'Lufthansa',
    BA: 'British Airways',
    AF: 'Air France',
    KL: 'KLM',
    UA: 'United Airlines',
    AA: 'American Airlines',
    DL: 'Delta Air Lines',
    EK: 'Emirates',
    QR: 'Qatar Airways',
    SQ: 'Singapore Airlines',
    TK: 'Turkish Airlines',
    EW: 'Eurowings',
    FR: 'Ryanair',
    U2: 'easyJet',
    WZ: 'Wizz Air',
  };

  return airlines[iataCode.toUpperCase()] || null;
}
