// AirLabs lookup by flight number, the AirLabs response record, the lookup
// result cache and the `FlightData` shape. Split from `flightLookup.ts`
// (forgejo#386, REF-16); the code is unchanged.

import axios from "axios";
import NodeCache from "node-cache";
import { getApiKey } from "../apiKeyResolver";
import {
  classifyAirlabsBodyError,
  classifyProviderError,
  LookupOutcomeLog,
} from "./providerOutcome";
import { getAirlineName, markUtc } from "./fieldReaders";
import { toProviderFlightNumber } from "../../schemas/flight";
import logger from "../../utils/logger";

/** AirLabs API response flight record */
interface AirLabsFlightRecord {
  flight_iata?: string;
  airline_name?: string;
  airline_iata?: string;
  airline_icao?: string;
  dep_iata?: string;
  dep_icao?: string;
  dep_name?: string;
  dep_time_utc?: string;
  dep_time?: string;
  dep_actual_utc?: string;
  dep_actual?: string;
  dep_terminal?: string;
  dep_gate?: string;
  arr_iata?: string;
  arr_icao?: string;
  arr_name?: string;
  arr_time_utc?: string;
  arr_time?: string;
  arr_actual_utc?: string;
  arr_actual?: string;
  arr_terminal?: string;
  arr_gate?: string;
  aircraft_icao?: string;
  status?: string;
  duration?: number;
  distance?: number;
}

// Bounded cache for flight lookup results using node-cache
const CACHE_TTL_SECONDS = 6 * 60 * 60; // 6 hours for historical flights
const RECENT_CACHE_TTL_SECONDS = 30 * 60; // 30 minutes for recent/future flights
const MAX_CACHE_KEYS = 500;
const flightCache = new NodeCache({
  stdTTL: CACHE_TTL_SECONDS,
  maxKeys: MAX_CACHE_KEYS,
  checkperiod: 600,
});

export interface FlightData {
  flightNumber: string;
  airline: string;
  airlineIata?: string;
  airlineIcao?: string;
  /** Operating airline name when the flight number is a marketing codeshare. */
  operatingAirline?: string;
  /** True when AeroDataBox flagged the entry as `IsCodeshare`. */
  isCodeshare?: boolean;
  /** ATC callsign, e.g. "DLH400". AeroDataBox-only. */
  callsign?: string;
  departure: {
    iata?: string;
    icao?: string;
    name?: string;
    scheduledTime?: string;
    actualTime?: string;
    terminal?: string;
    gate?: string;
    /** IANA zone of the airport — set on UI lookup results (`toFlightData`). */
    timezone?: string;
    /** "YYYY-MM-DDTHH:mm" wall clock at the airport, when its zone is known. */
    scheduledLocal?: string;
  };
  arrival: {
    iata?: string;
    icao?: string;
    name?: string;
    scheduledTime?: string;
    actualTime?: string;
    terminal?: string;
    gate?: string;
    timezone?: string;
    scheduledLocal?: string;
  };
  aircraft?: string;
  aircraftIcao?: string;
  /** Tail number / aircraft registration, e.g. "D-AIHX". AeroDataBox-only. */
  aircraftRegistration?: string;
  /** Mode-S transponder hex, e.g. "3C6518". AeroDataBox-only. */
  aircraftModeS?: string;
  /** "scheduled" | "flown" | "cancelled" | "diverted" — derived. */
  status?: string;
  duration?: number;
  /** Great-circle route distance in km when the provider supplies it. */
  distance?: number;
}

/**
 * Lookup flight by flight number and optional date
 * Uses AirLabs API (free tier) with caching
 */
export async function lookupFlightByNumber(
  flightNumber: string,
  date?: Date,
  userId?: string,
  outcomes?: LookupOutcomeLog
): Promise<FlightData[]> {
  const apiKey = await getApiKey("airlabs", userId);

  if (!apiKey) {
    logger.warn({
      operation: "flight_lookup",
      message: "AIRLABS_API_KEY not configured - flight lookup disabled",
    });
    return [];
  }

  // Generate cache key
  const dateStr = date ? date.toISOString().split("T")[0] : "nodate";
  const cacheKey = `${flightNumber.toUpperCase()}_${dateStr}`;

  // Check cache
  const cached = flightCache.get<FlightData[]>(cacheKey);
  if (cached !== undefined) {
    logger.info({ operation: "airlabs_cache_hit" }, "AirLabs cache hit");
    outcomes?.record("airlabs", cached.length > 0 ? "ok" : "no_match");
    return cached;
  }

  try {
    logger.info({ api: "airlabs", operation: "api_call_start" }, "Calling AirLabs API");
    logger.debug({ flightNumber, date: dateStr, api: "airlabs", operation: "api_call_start" });
    // AirLabs API endpoint for flight schedules. The query uses the UNPADDED
    // IATA form — "EK051" returns zero records where "EK51" returns the
    // flight (see toProviderFlightNumber).
    const response = await axios.get("https://airlabs.co/api/v9/schedules", {
      params: {
        api_key: apiKey,
        flight_iata: toProviderFlightNumber(flightNumber) ?? flightNumber,
        ...(date && { dep_date: date.toISOString().split("T")[0] }),
      },
      timeout: 5000,
    });

    // AirLabs reports a refused key or a spent quota as HTTP 200 with an
    // `error` body. Read as "no response" that became "no flight", and was
    // even cached as such for hours.
    const bodyFailure = classifyAirlabsBodyError(response.data);
    if (bodyFailure) {
      logger.warn(
        {
          flightNumber,
          date: dateStr,
          api: "airlabs",
          failure: bodyFailure,
          operation: "api_body_error",
        },
        `AirLabs refused the lookup for ${flightNumber} (${bodyFailure})`
      );
      outcomes?.record("airlabs", bodyFailure);
      return [];
    }

    if (!response.data || !response.data.response) {
      logger.info({ api: "airlabs", operation: "api_empty_response" }, "AirLabs returned no data");
      const isHistorical = date && date < new Date();
      flightCache.set(cacheKey, [], isHistorical ? CACHE_TTL_SECONDS : RECENT_CACHE_TTL_SECONDS);
      outcomes?.record("airlabs", "no_match");
      return [];
    }

    const flights: FlightData[] = response.data.response.map((flight: AirLabsFlightRecord) => ({
      // Deliberately the CALLER's spelling, not the provider's: echoing back
      // "EK51" for a stored "EK051" makes calculateChanges see a flightNumber
      // change, which auto-apply would write — silently renaming the user's
      // flight to the provider's padding convention.
      flightNumber,
      airline:
        flight.airline_name ||
        getAirlineName(flight.airline_iata || "") ||
        flight.airline_icao ||
        "Unknown",
      airlineIata: flight.airline_iata,
      airlineIcao: flight.airline_icao,
      departure: {
        iata: flight.dep_iata,
        icao: flight.dep_icao,
        name: flight.dep_name,
        scheduledTime: markUtc(flight.dep_time_utc) || flight.dep_time,
        actualTime: markUtc(flight.dep_actual_utc) || flight.dep_actual,
        terminal: flight.dep_terminal,
        gate: flight.dep_gate,
      },
      arrival: {
        iata: flight.arr_iata,
        icao: flight.arr_icao,
        name: flight.arr_name,
        scheduledTime: markUtc(flight.arr_time_utc) || flight.arr_time,
        actualTime: markUtc(flight.arr_actual_utc) || flight.arr_actual,
        terminal: flight.arr_terminal,
        gate: flight.arr_gate,
      },
      aircraft: flight.aircraft_icao,
      status: flight.status,
      duration: flight.duration,
      distance: flight.distance,
    }));

    logger.info(
      {
        api: "airlabs",
        resultCount: flights.length,
        hasGate: flights.some((f) => f.departure?.gate || f.arrival?.gate),
        hasTerminal: flights.some((f) => f.departure?.terminal || f.arrival?.terminal),
        hasAircraft: flights.some((f) => f.aircraft),
        operation: "api_call_success",
      },
      `AirLabs returned ${flights.length} result(s)`
    );

    // Cache the results with appropriate TTL
    const isHistorical = date && date < new Date();
    flightCache.set(cacheKey, flights, isHistorical ? CACHE_TTL_SECONDS : RECENT_CACHE_TTL_SECONDS);
    outcomes?.record("airlabs", flights.length > 0 ? "ok" : "no_match");
    return flights;
  } catch (_error: unknown) {
    const errMsg = _error instanceof Error ? _error.message : String(_error);
    logger.warn(
      { api: "airlabs", error: errMsg, operation: "api_call_error" },
      `AirLabs lookup failed: ${errMsg}`
    );
    outcomes?.record("airlabs", classifyProviderError(_error));
    return [];
  }
}
