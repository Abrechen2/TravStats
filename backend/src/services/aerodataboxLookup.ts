/**
 * AeroDataBox provider adapter (RapidAPI BASIC free tier).
 *
 * Tasked with the gap that AirLabs / Aviationstack-Free leave open:
 * historical flight lookup for any date in the last 365 days. The free
 * tier is small (600 units/month, 1 req/s) so this adapter is wired
 * into `flightLookup.ts` strictly as a tertiary fallback for
 * out-of-live-window queries — never for bulk live polling.
 *
 * Auth pattern (RapidAPI):
 *   x-rapidapi-host: aerodatabox.p.rapidapi.com
 *   x-rapidapi-key:  <user or admin key>
 *
 * Endpoint used:
 *   GET /flights/number/{number}/{YYYY-MM-DD}
 *   - Includes terminal, gate, aircraft registration, airline IATA/ICAO
 *   - Returns an array (multi-segment flights produce multiple entries)
 *   - Codeshares are flagged via `codeshareStatus`; we surface only the
 *     operator entry to avoid producing N duplicates per logical flight.
 */

import axios from "axios";
import NodeCache from "node-cache";
import { findOrCreateAirport } from "./airportLookup";
import { getApiKey } from "./apiKeyResolver";
import logger from "../utils/logger";
import type { FlightLookupResult } from "./flightLookup";

const HOST = "aerodatabox.p.rapidapi.com";
const BASE_URL = `https://${HOST}`;

// Cache historical flights aggressively — once a flight has happened its
// metadata is immutable. Recent / future windows get a shorter TTL because
// gate / terminal can still change.
const CACHE_TTL_HISTORICAL_SECONDS = 24 * 60 * 60;
const CACHE_TTL_RECENT_SECONDS = 30 * 60;
const MAX_CACHE_KEYS = 500;

const cache = new NodeCache({
  stdTTL: CACHE_TTL_HISTORICAL_SECONDS,
  maxKeys: MAX_CACHE_KEYS,
  checkperiod: 600,
});

/** Raw response item from `/flights/number/{n}/{date}`. */
interface AerodataboxFlight {
  number?: string;
  callSign?: string;
  status?: string;
  codeshareStatus?: "isOperator" | "isCodeshare" | "unknown";
  aircraft?: {
    reg?: string;
    model?: string;
  };
  airline?: {
    name?: string;
    iata?: string;
    icao?: string;
  };
  departure?: AerodataboxMovement;
  arrival?: AerodataboxMovement;
}

interface AerodataboxMovement {
  airport?: {
    iata?: string;
    icao?: string;
    name?: string;
  };
  scheduledTime?: { utc?: string; local?: string };
  revisedTime?: { utc?: string; local?: string };
  predictedTime?: { utc?: string; local?: string };
  runwayTime?: { utc?: string; local?: string };
  actualTime?: { utc?: string; local?: string };
  terminal?: string;
  gate?: string;
}

/** Normalize "LH 400" / "lh400" to "LH400" — AeroDataBox is whitespace-sensitive. */
function normalizeFlightNumber(input: string): string {
  return input.replace(/\s+/g, "").toUpperCase();
}

/** AeroDataBox returns "2024-01-15 18:30Z" — convert to a strict ISO string. */
function parseAerodataboxUtc(value: string | undefined): string | undefined {
  if (!value) return undefined;
  // The `Z` suffix is present but the space separator differs from ISO — replace.
  const iso = value.replace(" ", "T");
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return parsed.toISOString();
}

/** Pick the operator entry from a multi-codeshare response. */
function pickOperator(flights: AerodataboxFlight[]): AerodataboxFlight | undefined {
  if (flights.length === 0) return undefined;
  const operator = flights.find((f) => f.codeshareStatus === "isOperator");
  return operator ?? flights[0];
}

/**
 * Look up a flight by number and date using AeroDataBox.
 *
 * Returns null when:
 *   - no API key is configured
 *   - the request fails (401, 429, network)
 *   - the response is empty
 *
 * Callers should treat null as "no data — fall through" rather than as an error.
 */
export async function lookupFlightAerodatabox(
  flightNumber: string,
  date: string,
  userId?: string,
): Promise<FlightLookupResult | null> {
  const trimmed = flightNumber.trim();
  if (!trimmed) return null;

  const apiKey = await getApiKey("aerodatabox", userId);
  if (!apiKey) {
    return null;
  }

  const normalized = normalizeFlightNumber(trimmed);
  const cacheKey = `${normalized}_${date}`;

  const cached = cache.get<FlightLookupResult | null>(cacheKey);
  if (cached !== undefined) {
    logger.info(
      { flightNumber: normalized, date, operation: "aerodatabox_cache_hit" },
      `AeroDataBox cache hit for ${normalized} on ${date}`,
    );
    return cached;
  }

  try {
    logger.info(
      { flightNumber: normalized, date, api: "aerodatabox", operation: "api_call_start" },
      `Calling AeroDataBox for ${normalized} on ${date}`,
    );

    const response = await axios.get<AerodataboxFlight[]>(
      `${BASE_URL}/flights/number/${encodeURIComponent(normalized)}/${date}`,
      {
        headers: {
          "x-rapidapi-host": HOST,
          "x-rapidapi-key": apiKey,
          "Content-Type": "application/json",
        },
        // No aircraft-image fetch (we only need the metadata) and no
        // location enrichment — we already have airport coordinates locally.
        params: { withAircraftImage: false, withLocation: false },
        timeout: 8000,
      },
    );

    const operator = pickOperator(response.data ?? []);
    if (!operator) {
      logger.info(
        { flightNumber: normalized, date, api: "aerodatabox", operation: "api_empty_response" },
        `AeroDataBox returned no data for ${normalized} on ${date}`,
      );
      const ttl = isHistoricalDate(date) ? CACHE_TTL_HISTORICAL_SECONDS : CACHE_TTL_RECENT_SECONDS;
      cache.set(cacheKey, null, ttl);
      return null;
    }

    const result = await mapToLookupResult(operator, normalized);

    logger.info(
      {
        flightNumber: normalized,
        date,
        api: "aerodatabox",
        hasGate: !!(result.departure?.gate || result.arrival?.gate),
        hasTerminal: !!(result.departure?.terminal || result.arrival?.terminal),
        hasAircraft: !!result.aircraft,
        operation: "api_call_success",
      },
      `AeroDataBox returned data for ${normalized} on ${date}`,
    );

    const ttl = isHistoricalDate(date) ? CACHE_TTL_HISTORICAL_SECONDS : CACHE_TTL_RECENT_SECONDS;
    cache.set(cacheKey, result, ttl);
    return result;
  } catch (error: unknown) {
    const status = (error as { response?: { status?: number } })?.response?.status;
    const message = error instanceof Error ? error.message : String(error);

    if (status === 429) {
      logger.warn(
        { flightNumber: normalized, date, api: "aerodatabox", operation: "rate_limited" },
        "AeroDataBox returned 429 — quota or per-second limit hit",
      );
    } else if (status === 401 || status === 403) {
      logger.warn(
        { flightNumber: normalized, date, api: "aerodatabox", operation: "auth_failed" },
        "AeroDataBox returned auth error — check API key",
      );
    } else {
      logger.warn(
        { flightNumber: normalized, date, api: "aerodatabox", error: message, operation: "api_call_error" },
        `AeroDataBox lookup failed for ${normalized}: ${message}`,
      );
    }
    return null;
  }
}

function isHistoricalDate(date: string): boolean {
  const requested = new Date(date);
  if (Number.isNaN(requested.getTime())) return false;
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  return requested.getTime() < today.getTime();
}

async function mapToLookupResult(
  flight: AerodataboxFlight,
  fallbackFlightNumber: string,
): Promise<FlightLookupResult> {
  const departureCode = flight.departure?.airport?.iata || flight.departure?.airport?.icao;
  const arrivalCode = flight.arrival?.airport?.iata || flight.arrival?.airport?.icao;

  const [departureAirport, arrivalAirport] = await Promise.all([
    departureCode ? findOrCreateAirport(departureCode) : Promise.resolve(null),
    arrivalCode ? findOrCreateAirport(arrivalCode) : Promise.resolve(null),
  ]);

  const scheduledDeparture = parseAerodataboxUtc(flight.departure?.scheduledTime?.utc);
  const scheduledArrival = parseAerodataboxUtc(flight.arrival?.scheduledTime?.utc);
  // Prefer actualTime (block-on-block reality) over predictedTime / revisedTime.
  const actualDeparture = parseAerodataboxUtc(
    flight.departure?.actualTime?.utc ?? flight.departure?.runwayTime?.utc,
  );
  const actualArrival = parseAerodataboxUtc(
    flight.arrival?.actualTime?.utc ?? flight.arrival?.runwayTime?.utc,
  );

  return {
    airline: flight.airline?.name,
    flightNumber: normalizeFlightNumber(flight.number ?? fallbackFlightNumber),
    aircraft: flight.aircraft?.model || flight.aircraft?.reg,
    departure: departureAirport
      ? {
          iata: departureAirport.iata ?? undefined,
          icao: departureAirport.icao ?? undefined,
          name: departureAirport.name,
          lat: departureAirport.lat,
          lon: departureAirport.lon,
          terminal: flight.departure?.terminal,
          gate: flight.departure?.gate,
        }
      : undefined,
    arrival: arrivalAirport
      ? {
          iata: arrivalAirport.iata ?? undefined,
          icao: arrivalAirport.icao ?? undefined,
          name: arrivalAirport.name,
          lat: arrivalAirport.lat,
          lon: arrivalAirport.lon,
          terminal: flight.arrival?.terminal,
          gate: flight.arrival?.gate,
        }
      : undefined,
    departureTime: scheduledDeparture,
    arrivalTime: scheduledArrival,
    actualDeparture,
    actualArrival,
  };
}

/** Test-only helper: wipe the in-memory cache between unit tests. */
export function __resetAerodataboxCacheForTests(): void {
  cache.flushAll();
}
