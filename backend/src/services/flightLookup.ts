/**
 * Flight Number Lookup Service
 *
 * Uses AirLabs API (Free Tier: 1000 requests/month)
 * Fetches real-time and historical flight data by flight number
 * Implements in-memory caching to reduce API calls
 */

import axios from 'axios';

// In-memory cache for flight lookup results
interface FlightLookupCache {
  [key: string]: {
    data: FlightData[];
    timestamp: number;
  };
}

const CACHE_TTL = 6 * 60 * 60 * 1000; // 6 hours for historical flights
const RECENT_CACHE_TTL = 30 * 60 * 1000; // 30 minutes for recent/future flights
const flightCache: FlightLookupCache = {};

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
    console.warn('⚠️  AIRLABS_API_KEY not configured - flight lookup disabled');
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
      const age = Math.round((now - cached.timestamp) / 1000 / 60);
      console.log(`🔄 Using cached flight data for ${flightNumber} (age: ${age}min)`);
      return cached.data;
    }
  }

  try {
    // AirLabs API endpoint for flight schedules
    const response = await axios.get('https://airlabs.co/api/v9/schedules', {
      params: {
        api_key: apiKey,
        flight_iata: flightNumber,
        // Optional: Filter by date (YYYY-MM-DD format)
        ...(date && { dep_date: date.toISOString().split('T')[0] }),
      },
      timeout: 5000,
    });

    if (!response.data || !response.data.response) {
      // Cache empty results for 1 hour to avoid repeated failed lookups
      flightCache[cacheKey] = {
        data: [],
        timestamp: now,
      };
      return [];
    }

    const flights: FlightData[] = response.data.response.map((flight: any) => ({
      flightNumber: flight.flight_iata || flightNumber,
      airline: flight.airline_name || 'Unknown',
      airlineIata: flight.airline_iata,
      airlineIcao: flight.airline_icao,
      departure: {
        iata: flight.dep_iata,
        icao: flight.dep_icao,
        name: flight.dep_name,
        scheduledTime: flight.dep_time,
        actualTime: flight.dep_actual,
        terminal: flight.dep_terminal,
        gate: flight.dep_gate,
      },
      arrival: {
        iata: flight.arr_iata,
        icao: flight.arr_icao,
        name: flight.arr_name,
        scheduledTime: flight.arr_time,
        actualTime: flight.arr_actual,
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

    console.log(`✅ Found ${flights.length} flights for ${flightNumber} (cached for ${date && date < new Date() ? '6h' : '30min'})`);
    return flights;

  } catch (error: any) {
    if (error.response?.status === 429) {
      console.error('❌ AirLabs API rate limit exceeded');
    } else if (error.response?.status === 401) {
      console.error('❌ AirLabs API authentication failed - check API key');
    } else {
      console.error('❌ Error looking up flight:', error.message);
    }

    // Return cached data even if expired, as fallback
    if (cached) {
      console.log(`⚠️  Returning expired cache for ${flightNumber} due to API error`);
      return cached.data;
    }

    return [];
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
  // Match patterns like "LH400", "LH 400", "BA1234"
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
    'LH': 'Lufthansa',
    'BA': 'British Airways',
    'AF': 'Air France',
    'KL': 'KLM',
    'UA': 'United Airlines',
    'AA': 'American Airlines',
    'DL': 'Delta Air Lines',
    'EK': 'Emirates',
    'QR': 'Qatar Airways',
    'SQ': 'Singapore Airlines',
    'TK': 'Turkish Airlines',
    'EW': 'Eurowings',
    'FR': 'Ryanair',
    'U2': 'easyJet',
    'WZ': 'Wizz Air',
    // Add more as needed
  };

  return airlines[iataCode.toUpperCase()] || null;
}
