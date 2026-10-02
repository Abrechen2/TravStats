/**
 * FlightAware AeroAPI (v4) provider adapter.
 *
 * The flight-STATUS provider: gate, terminal, cancellation and diversion as
 * the airline publishes them. Paid per query, so it is asked only when the
 * user or the admin configured a key, and then FIRST in `lookupFlightDetails`
 * — a null answer falls through to the existing order unchanged.
 *
 * Auth: header `x-apikey: <key>`.
 *
 * Endpoint used:
 *   GET /aeroapi/flights/{ident}?ident_type=designator&start=…&end=…
 *   - Every instance of the number in the window, newest first
 *   - Times are ISO-8601 UTC ("2026-10-05T11:55:00Z")
 *   - AeroAPI only serves 10 days back to 2 days ahead; a date outside that
 *     is never asked about (it would cost a query and answer nothing).
 *
 * Field names follow FlightAware's published v4 schema. The test fixture is
 * docs-derived until a response is recorded with a real key.
 */

import axios from "axios";
import NodeCache from "node-cache";
import { findOrCreateAirport } from "./airportLookup";
import { getApiKey } from "./apiKeyResolver";
import { recordObservedQuota } from "./apiQuota";
import logger from "../utils/logger";
import type { FlightLookupResult } from "./flightLookup";
import { classifyProviderError, type LookupOutcomeLog } from "./flightLookup/providerOutcome";
import { getAirlineName } from "./flightLookup/fieldReaders";
import { normalizeFlightNumber, toProviderFlightNumber } from "../schemas/flight";
import { localDay } from "../shared/time/instant";
import { isValidZone } from "../shared/time/zonedParts";

const BASE_URL = "https://aeroapi.flightaware.com/aeroapi";
const REQUEST_TIMEOUT_MS = 8000;

const DAY_MS = 24 * 60 * 60 * 1000;
/** AeroAPI's documented window for /flights/{ident}: 10 days back, 2 ahead. */
const MAX_PAST_MS = 10 * DAY_MS;
const MAX_FUTURE_MS = 2 * DAY_MS;
/** Kept off the window's very edge so clock skew cannot earn a 400. */
const WINDOW_MARGIN_MS = 60 * 1000;

// Status is the point of this provider, and the smart check asks every
// 15 minutes near departure — a recent answer must not outlive that. A
// departed day no longer changes and keeps for a day.
const CACHE_TTL_HISTORICAL_SECONDS = 24 * 60 * 60;
const CACHE_TTL_RECENT_SECONDS = 5 * 60;
const MAX_CACHE_KEYS = 500;

const cache = new NodeCache({
  stdTTL: CACHE_TTL_RECENT_SECONDS,
  maxKeys: MAX_CACHE_KEYS,
  checkperiod: 120,
});

function captureRateLimit(headers: Record<string, unknown>, userId?: string): void {
  recordObservedQuota("aeroapi", userId, headers);
}

interface AeroapiAirportRef {
  code?: string | null;
  code_icao?: string | null;
  code_iata?: string | null;
  timezone?: string | null;
  name?: string | null;
}

/** One item of `flights[]` — only the fields this adapter reads. */
export interface AeroapiFlight {
  ident?: string | null;
  ident_icao?: string | null;
  ident_iata?: string | null;
  fa_flight_id?: string | null;
  operator_icao?: string | null;
  operator_iata?: string | null;
  atc_ident?: string | null;
  registration?: string | null;
  aircraft_type?: string | null;
  cancelled?: boolean | null;
  diverted?: boolean | null;
  origin?: AeroapiAirportRef | null;
  destination?: AeroapiAirportRef | null;
  scheduled_out?: string | null;
  actual_out?: string | null;
  actual_off?: string | null;
  actual_on?: string | null;
  scheduled_in?: string | null;
  actual_in?: string | null;
  gate_origin?: string | null;
  gate_destination?: string | null;
  terminal_origin?: string | null;
  terminal_destination?: string | null;
  baggage_claim?: string | null;
}

interface AeroapiFlightsResponse {
  flights?: AeroapiFlight[];
}

function parseUtc(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

function toDate(value: string | null | undefined): Date | null {
  const iso = parseUtc(value);
  return iso ? new Date(iso) : null;
}

/** "2026-10-04T00:00:00Z" — AeroAPI takes ISO-8601 without milliseconds. */
function isoSeconds(ms: number): string {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
}

/**
 * The query window around a local calendar date, clamped to what AeroAPI
 * serves. One day either side covers every zone's offset from UTC. Null
 * when nothing of the date lies inside AeroAPI's window.
 */
export function aeroapiWindow(date: string, nowMs: number): { start: string; end: string } | null {
  const day = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(day)) return null;
  const start = Math.max(day - DAY_MS, nowMs - MAX_PAST_MS + WINDOW_MARGIN_MS);
  const end = Math.min(day + 2 * DAY_MS, nowMs + MAX_FUTURE_MS - WINDOW_MARGIN_MS);
  if (start >= end) return null;
  return { start: isoSeconds(start), end: isoSeconds(end) };
}

/**
 * Does this instance leave on `date` at its ORIGIN? Read in the origin's zone
 * because that is the date on the ticket; a late-evening departure is already
 * tomorrow in UTC. An unreadable time is kept, as AeroDataBox keeps it — this
 * removes wrong answers, it does not invent stricter ones.
 */
export function aeroapiDepartsOnLocalDate(flight: AeroapiFlight, date: string): boolean {
  const scheduled = toDate(flight.scheduled_out);
  if (!scheduled) return true;
  const zone = flight.origin?.timezone ?? null;
  const local = isValidZone(zone) ? localDay(scheduled, zone) : scheduled.toISOString();
  return local.slice(0, 10) === date;
}

/** Preference for OUR departure airport, never a filter (see AeroDataBox). */
function preferOrigin(flights: AeroapiFlight[], depAirportCode?: string): AeroapiFlight[] {
  if (!depAirportCode) return flights;
  const wanted = depAirportCode.toUpperCase();
  const matching = flights.filter(
    (f) =>
      f.origin?.code_iata?.toUpperCase() === wanted ||
      f.origin?.code_icao?.toUpperCase() === wanted ||
      f.origin?.code?.toUpperCase() === wanted
  );
  return matching.length > 0 ? matching : flights;
}

function statusOverride(flight: AeroapiFlight): "cancelled" | "diverted" | undefined {
  if (flight.cancelled) return "cancelled";
  if (flight.diverted) return "diverted";
  return undefined;
}

function isHistoricalDate(date: string, nowMs: number): boolean {
  const requested = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(requested)) return false;
  // A whole day past the requested one: every zone's flight has landed.
  return requested + 2 * DAY_MS < nowMs;
}

/**
 * Look up a flight by number and local departure date using AeroAPI.
 *
 * Returns null when no key is configured, the date is outside AeroAPI's
 * window, the request fails, or no instance departs on that date. The
 * optional outcome log says which.
 */
export async function lookupFlightAeroapi(
  flightNumber: string,
  date: string,
  userId?: string,
  /** Our departure airport where known — a number can fly twice a day. */
  depAirportCode?: string,
  outcomes?: LookupOutcomeLog
): Promise<FlightLookupResult | null> {
  const trimmed = flightNumber.trim();
  if (!trimmed) return null;

  const apiKey = await getApiKey("aeroapi", userId);
  if (!apiKey) return null;

  const nowMs = Date.now();
  const window = aeroapiWindow(date, nowMs);
  if (!window) {
    logger.debug({ date, api: "aeroapi", operation: "aeroapi_outside_window" });
    return null;
  }

  const normalized = normalizeFlightNumber(trimmed) ?? trimmed;
  const providerNumber = toProviderFlightNumber(trimmed) ?? normalized;
  const cacheKey = `${normalized}_${date}_${depAirportCode ?? "*"}`;
  const ttl = isHistoricalDate(date, nowMs)
    ? CACHE_TTL_HISTORICAL_SECONDS
    : CACHE_TTL_RECENT_SECONDS;

  const cached = cache.get<FlightLookupResult | null>(cacheKey);
  if (cached !== undefined) {
    logger.info({ operation: "aeroapi_cache_hit" }, "AeroAPI cache hit");
    outcomes?.record("aeroapi", cached ? "ok" : "no_match");
    return cached;
  }

  try {
    logger.info({ api: "aeroapi", operation: "api_call_start" }, "Calling AeroAPI");
    logger.debug({
      flightNumber: normalized,
      date,
      depAirportCode,
      api: "aeroapi",
      operation: "api_call_start",
    });

    const response = await axios.get<AeroapiFlightsResponse>(
      `${BASE_URL}/flights/${encodeURIComponent(providerNumber)}`,
      {
        headers: { "x-apikey": apiKey, Accept: "application/json" },
        params: { ident_type: "designator", start: window.start, end: window.end },
        timeout: REQUEST_TIMEOUT_MS,
      }
    );

    captureRateLimit(response.headers as Record<string, unknown>, userId);

    const flights = response.data?.flights;
    if (!Array.isArray(flights)) {
      logger.warn(
        { api: "aeroapi", receivedType: typeof flights, operation: "unexpected_response_shape" },
        "AeroAPI answered without a flight list"
      );
      outcomes?.record("aeroapi", "provider_error");
      return null;
    }

    const onDate = flights.filter((f) => aeroapiDepartsOnLocalDate(f, date));
    const picked = preferOrigin(onDate, depAirportCode)[0];
    if (!picked) {
      logger.info(
        { api: "aeroapi", returned: flights.length, operation: "api_empty_response" },
        "AeroAPI has no instance departing on the requested date"
      );
      cache.set(cacheKey, null, ttl);
      outcomes?.record("aeroapi", "no_match");
      return null;
    }

    const result = await mapToLookupResult(picked, normalized);
    logger.info(
      {
        api: "aeroapi",
        hasGate: !!(result.departure?.gate || result.arrival?.gate),
        statusOverride: result.statusOverride,
        operation: "api_call_success",
      },
      "AeroAPI returned data"
    );
    cache.set(cacheKey, result, ttl);
    outcomes?.record("aeroapi", "ok");
    return result;
  } catch (error: unknown) {
    const errResponse = (
      error as { response?: { status?: number; headers?: Record<string, unknown> } }
    )?.response;
    const status = errResponse?.status;
    if (errResponse?.headers) captureRateLimit(errResponse.headers, userId);

    if (status === 429) {
      logger.warn(
        { api: "aeroapi", status, operation: "rate_limited" },
        "AeroAPI returned 429 — rate or account limit hit"
      );
    } else if (status === 401 || status === 403) {
      logger.warn(
        { api: "aeroapi", status, operation: "auth_failed" },
        "AeroAPI returned an auth error — check the API key"
      );
    } else {
      // The message only: an axios error object carries the request config,
      // and with it the x-apikey header.
      const message = error instanceof Error ? error.message : "Unknown error";
      logger.warn(
        { api: "aeroapi", status, error: message, operation: "api_call_error" },
        `AeroAPI lookup failed: ${message}`
      );
    }
    outcomes?.record("aeroapi", classifyProviderError(error));
    return null;
  }
}

/**
 * Times mirror `aerodataboxLookup.mapToLookupResult`: the SCHEDULED times are
 * the plan (`departureTime` / `arrivalTime`); gate-out / gate-in are the actual
 * times, falling back to wheels-off / wheels-on as AeroDataBox falls back from
 * actualTime to runwayTime; wheels-off / -on also fill the runway fields.
 * Estimates (`estimated_*`) are not read, as AeroDataBox's revised and
 * predicted times are not.
 */
async function mapToLookupResult(
  flight: AeroapiFlight,
  requestedNumber: string
): Promise<FlightLookupResult> {
  const departureCode = flight.origin?.code_iata || flight.origin?.code_icao || undefined;
  const arrivalCode = flight.destination?.code_iata || flight.destination?.code_icao || undefined;

  const [departureAirport, arrivalAirport] = await Promise.all([
    departureCode ? findOrCreateAirport(departureCode) : Promise.resolve(null),
    arrivalCode ? findOrCreateAirport(arrivalCode) : Promise.resolve(null),
  ]);

  // AeroAPI answers with the operating flight. When the user asked by a
  // partner's number, the ident differs from the request.
  const operatingNumber = toProviderFlightNumber(flight.ident_iata ?? "");
  const isCodeshare =
    !!operatingNumber && operatingNumber !== toProviderFlightNumber(requestedNumber);
  const operatorName = flight.operator_iata
    ? (getAirlineName(flight.operator_iata) ?? undefined)
    : undefined;

  return {
    // The user's spelling, as the other adapters keep it.
    flightNumber: requestedNumber,
    airline: isCodeshare ? undefined : operatorName,
    operatingAirline: isCodeshare ? operatorName : undefined,
    isCodeshare,
    airlineIata: isCodeshare ? undefined : (flight.operator_iata ?? undefined),
    airlineIcao: isCodeshare ? undefined : (flight.operator_icao ?? undefined),
    aircraft: flight.aircraft_type || flight.registration || undefined,
    aircraftRegistration: flight.registration ?? undefined,
    callsign: flight.atc_ident ?? flight.ident_icao ?? undefined,
    statusOverride: statusOverride(flight),
    departure: departureAirport
      ? {
          iata: departureAirport.iata ?? undefined,
          icao: departureAirport.icao ?? undefined,
          name: departureAirport.name,
          lat: departureAirport.lat,
          lon: departureAirport.lon,
          terminal: flight.terminal_origin ?? undefined,
          gate: flight.gate_origin ?? undefined,
        }
      : undefined,
    arrival: arrivalAirport
      ? {
          iata: arrivalAirport.iata ?? undefined,
          icao: arrivalAirport.icao ?? undefined,
          name: arrivalAirport.name,
          lat: arrivalAirport.lat,
          lon: arrivalAirport.lon,
          terminal: flight.terminal_destination ?? undefined,
          gate: flight.gate_destination ?? undefined,
        }
      : undefined,
    departureTime: parseUtc(flight.scheduled_out),
    arrivalTime: parseUtc(flight.scheduled_in),
    actualDeparture: parseUtc(flight.actual_out ?? flight.actual_off),
    actualArrival: parseUtc(flight.actual_in ?? flight.actual_on),
    runwayDepartureTime: toDate(flight.actual_off),
    runwayArrivalTime: toDate(flight.actual_on),
    baggageBelt: flight.baggage_claim ?? null,
  };
}

/** Test-only helper: wipe the in-memory cache between unit tests. */
export function __resetAeroapiCacheForTests(): void {
  cache.flushAll();
}
