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
import { enrichAirportMetadata, findOrCreateAirport } from "./airportLookup";
import { getApiKey } from "./apiKeyResolver";
import { recordObservedQuota } from "./apiQuota";
import logger from "../utils/logger";
import type { FlightLookupResult } from "./flightLookup";
import { normalizeFlightNumber, toProviderFlightNumber } from "../schemas/flight";

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

/** Capture RapidAPI rate-limit headers into the shared apiQuota service. */
function captureRateLimit(headers: Record<string, unknown>, userId?: string): void {
  recordObservedQuota("aerodatabox", userId, headers);
}

/** Raw response item from `/flights/number/{n}/{date}`. */
interface AerodataboxFlight {
  number?: string;
  callSign?: string;
  status?: string;
  codeshareStatus?: "isOperator" | "isCodeshare" | "unknown";
  /** True when AeroDataBox reports this as a cargo flight. */
  isCargo?: boolean;
  /** ISO-ish timestamp of the last data update, e.g. "2024-01-15 18:30Z". */
  lastUpdatedUtc?: string;
  /** Quality tier tags, e.g. ["Basic", "Live"]. */
  quality?: string[];
  aircraft?: {
    reg?: string;
    model?: string;
    modeS?: string;
  };
  airline?: {
    name?: string;
    iata?: string;
    icao?: string;
  };
  greatCircleDistance?: {
    meter?: number;
    km?: number;
    mile?: number;
    nm?: number;
    feet?: number;
  };
  departure?: AerodataboxMovement;
  arrival?: AerodataboxMovement;
}

interface AerodataboxMovement {
  airport?: {
    iata?: string;
    icao?: string;
    name?: string;
    /** Shorter display label, e.g. "Heathrow" instead of "London Heathrow Airport". */
    shortName?: string;
    /** Municipality / city the airport serves, e.g. "London". */
    municipalityName?: string;
  };
  scheduledTime?: { utc?: string; local?: string };
  revisedTime?: { utc?: string; local?: string };
  predictedTime?: { utc?: string; local?: string };
  runwayTime?: { utc?: string; local?: string };
  actualTime?: { utc?: string; local?: string };
  terminal?: string;
  gate?: string;
  /** Baggage reclaim belt identifier (arrival side). */
  baggageBelt?: string;
  /** Check-in desk range (departure side), e.g. "120-150". */
  checkInDesk?: string;
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

interface PickedFlights {
  /** The operator entry (or first entry if none flagged). */
  operator: AerodataboxFlight;
  /**
   * The codeshare entry whose flight number matches what the user
   * actually searched for. Present when the user typed a marketing
   * number that is operated by a partner — used to surface the
   * correct marketing airline name on the result.
   */
  marketing?: AerodataboxFlight;
}

/**
 * Pick the operator entry from a multi-codeshare response and, if the
 * user typed a marketing flight number, also pick the matching
 * codeshare entry so the marketing airline can be surfaced.
 */
function pickOperatorAndMarketing(
  flights: AerodataboxFlight[],
  requestedNumber: string,
): PickedFlights | undefined {
  if (flights.length === 0) return undefined;
  const operator = flights.find((f) => f.codeshareStatus === "isOperator") ?? flights[0];
  // Compare in PROVIDER form on both sides: the stored number may be
  // zero-padded ("EK051") while the response never is ("EK51"), and a
  // padded-vs-unpadded mismatch would silently drop the marketing entry.
  const normalizedRequested = toProviderFlightNumber(requestedNumber);
  const marketing = flights.find(
    (f) =>
      f !== operator && toProviderFlightNumber(f.number ?? "") === normalizedRequested,
  );
  return { operator, marketing };
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

  const normalized = normalizeFlightNumber(trimmed) ?? trimmed;
  const providerNumber = toProviderFlightNumber(trimmed) ?? normalized;
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
      // Unpadded IATA form — providers do not carry the leading zeros that
      // itineraries print (see toProviderFlightNumber).
      `${BASE_URL}/flights/number/${encodeURIComponent(providerNumber)}/${date}`,
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

    captureRateLimit(response.headers as Record<string, unknown>, userId);

    const picked = pickOperatorAndMarketing(response.data ?? [], normalized);
    if (!picked) {
      logger.info(
        { flightNumber: normalized, date, api: "aerodatabox", operation: "api_empty_response" },
        `AeroDataBox returned no data for ${normalized} on ${date}`,
      );
      const ttl = isHistoricalDate(date) ? CACHE_TTL_HISTORICAL_SECONDS : CACHE_TTL_RECENT_SECONDS;
      cache.set(cacheKey, null, ttl);
      return null;
    }

    const result = await mapToLookupResult(picked.operator, picked.marketing, normalized);

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
    const errResponse = (error as { response?: { status?: number; headers?: Record<string, unknown> } })?.response;
    const status = errResponse?.status;
    const message = error instanceof Error ? error.message : String(error);

    // RapidAPI sends rate-limit headers on 429/4xx responses too — capture
    // so the UI can show "0 of 600 left" after a throttle.
    if (errResponse?.headers) {
      captureRateLimit(errResponse.headers, userId);
    }

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

/**
 * Map AeroDataBox `status` strings ("Cancelled", "Diverted", "Landed", …)
 * to TravStats's flight-status enum. Anything unrecognized stays undefined
 * so the lookup doesn't silently overwrite a curated status.
 */
function mapAerodataboxStatus(status: string | undefined): "cancelled" | "diverted" | undefined {
  if (!status) return undefined;
  const lower = status.toLowerCase();
  if (lower === "canceled" || lower === "cancelled") return "cancelled";
  if (lower === "diverted") return "diverted";
  return undefined;
}

async function mapToLookupResult(
  flight: AerodataboxFlight,
  marketing: AerodataboxFlight | undefined,
  fallbackFlightNumber: string,
): Promise<FlightLookupResult> {
  const departureCode = flight.departure?.airport?.iata || flight.departure?.airport?.icao;
  const arrivalCode = flight.arrival?.airport?.iata || flight.arrival?.airport?.icao;

  const [departureAirport, arrivalAirport] = await Promise.all([
    departureCode ? findOrCreateAirport(departureCode) : Promise.resolve(null),
    arrivalCode ? findOrCreateAirport(arrivalCode) : Promise.resolve(null),
  ]);

  // Backfill airport-level metadata (shortName, municipalityName) when
  // AeroDataBox surfaces them and the local row is still missing those
  // columns. Cheap async fire — never overwrites a curated value.
  if (departureCode) {
    await enrichAirportMetadata(departureCode, {
      shortName: flight.departure?.airport?.shortName,
      municipalityName: flight.departure?.airport?.municipalityName,
    });
  }
  if (arrivalCode) {
    await enrichAirportMetadata(arrivalCode, {
      shortName: flight.arrival?.airport?.shortName,
      municipalityName: flight.arrival?.airport?.municipalityName,
    });
  }

  const scheduledDeparture = parseAerodataboxUtc(flight.departure?.scheduledTime?.utc);
  const scheduledArrival = parseAerodataboxUtc(flight.arrival?.scheduledTime?.utc);
  // Prefer actualTime (block-on-block reality) over predictedTime / revisedTime.
  const actualDeparture = parseAerodataboxUtc(
    flight.departure?.actualTime?.utc ?? flight.departure?.runwayTime?.utc,
  );
  const actualArrival = parseAerodataboxUtc(
    flight.arrival?.actualTime?.utc ?? flight.arrival?.runwayTime?.utc,
  );

  // Codeshare detection: the user-typed flight number is a marketing
  // partner's number, not the operator's. We surface:
  //   airline           = marketing carrier (what the user sees on the ticket)
  //   operatingAirline  = operator carrier  (who actually flies the metal)
  //   isCodeshare       = true when those differ
  const isCodeshare = !!marketing;
  const marketingAirline = marketing?.airline?.name;
  const operatorAirline = flight.airline?.name;
  const airline = marketingAirline ?? operatorAirline;
  const operatingAirline = isCodeshare ? operatorAirline : undefined;

  const distanceKm =
    typeof flight.greatCircleDistance?.km === "number"
      ? Math.round(flight.greatCircleDistance.km * 100) / 100
      : undefined;

  // When the user searched a marketing number, keep that as the visible
  // flight number on the result — the user typed it, the user expects to
  // see it. The operator's number lives implicitly through `callsign`.
  const visibleFlightNumber = isCodeshare
    ? normalizeFlightNumber(marketing?.number ?? fallbackFlightNumber)
    : normalizeFlightNumber(flight.number ?? fallbackFlightNumber);

  return {
    airline,
    flightNumber: visibleFlightNumber,
    aircraft: flight.aircraft?.model || flight.aircraft?.reg,
    aircraftRegistration: flight.aircraft?.reg,
    aircraftModeS: flight.aircraft?.modeS,
    callsign: flight.callSign,
    operatingAirline,
    isCodeshare,
    airlineIata: marketing?.airline?.iata ?? flight.airline?.iata,
    airlineIcao: marketing?.airline?.icao ?? flight.airline?.icao,
    distanceKm,
    statusOverride: mapAerodataboxStatus(flight.status),
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
    runwayDepartureTime: parseAerodataboxUtc(flight.departure?.runwayTime?.utc)
      ? new Date(parseAerodataboxUtc(flight.departure!.runwayTime!.utc)!)
      : null,
    runwayArrivalTime: parseAerodataboxUtc(flight.arrival?.runwayTime?.utc)
      ? new Date(parseAerodataboxUtc(flight.arrival!.runwayTime!.utc)!)
      : null,
    isCargo: flight.isCargo ?? null,
    aerodataboxLastUpdatedUtc: parseAerodataboxUtc(flight.lastUpdatedUtc)
      ? new Date(parseAerodataboxUtc(flight.lastUpdatedUtc)!)
      : null,
    aerodataboxQualityTags: flight.quality ?? [],
    baggageBelt: flight.arrival?.baggageBelt ?? null,
    checkInDesk: flight.departure?.checkInDesk ?? null,
  };
}

/** Test-only helper: wipe the in-memory cache between unit tests. */
export function __resetAerodataboxCacheForTests(): void {
  cache.flushAll();
}
