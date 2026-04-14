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
import NodeCache from 'node-cache';
import { findOrCreateAirport } from './airportLookup';
import { getApiKey, getOpenSkyCredentials } from './apiKeyResolver';
import { convertAviationstackTimeToUtc, convertAirlabsTimeToUtc } from '../utils/timezone';
import { prisma } from '../db';
import logger from '../utils/logger';

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

/** Aviationstack API response structures */
interface AviationstackFlightResult {
  airline?: { name?: string };
  flight?: { iata?: string; icao?: string };
  aircraft?: { icao?: string; iata?: string };
  departure?: {
    iata?: string;
    icao?: string;
    estimated?: string;
    scheduled?: string;
    terminal?: string;
    gate?: string;
  };
  arrival?: {
    iata?: string;
    icao?: string;
    estimated?: string;
    scheduled?: string;
    terminal?: string;
    gate?: string;
  };
}

/** Aviationstack API response wrapper */
interface AviationstackApiResponse {
  data?: AviationstackFlightResult[];
}

/** OpenSky API flight result */
interface OpenSkyFlightResult {
  estDepartureAirport?: string;
  estArrivalAirport?: string;
  firstSeen?: number;
  lastSeen?: number;
  callsign?: string;
}

/** Airport data returned from findOrCreateAirport */
interface AirportInfo {
  iata?: string | null;
  icao?: string | null;
  name?: string;
  lat?: number;
  lon?: number;
  terminal?: string;
  gate?: string;
}

// Bounded cache for flight lookup results using node-cache
const CACHE_TTL_SECONDS = 6 * 60 * 60; // 6 hours for historical flights
const RECENT_CACHE_TTL_SECONDS = 30 * 60; // 30 minutes for recent/future flights
const MAX_CACHE_KEYS = 500;
const flightCache = new NodeCache({ stdTTL: CACHE_TTL_SECONDS, maxKeys: MAX_CACHE_KEYS, checkperiod: 600 });

// OpenSky token cache
let openSkyTokenCache: { token: string; expiresAt: number } | null = null;

// In-memory cooldown for Aviationstack 429 (Free tier is 100 req/month —
// a single 429 means we've hit the wall; retrying minutely would be wasteful).
// Lives only in process memory, so it's rechecked after each restart.
const AVIATIONSTACK_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour
let aviationstack429Until: Date | null = null;

function isAviationstackCooledDown(): boolean {
  if (!aviationstack429Until) return false;
  if (Date.now() >= aviationstack429Until.getTime()) {
    aviationstack429Until = null;
    return false;
  }
  return true;
}

function markAviationstack429(): void {
  aviationstack429Until = new Date(Date.now() + AVIATIONSTACK_COOLDOWN_MS);
}

// ─── API-sparing: tier gating + daily budget ────────────────────────────────
//
// Free tier constraints (as of 2026-04):
//   Aviationstack Free:  100 req/month (~3.3/day) — tightest by far
//   AirLabs Free:       ~1000 req/month
//   OpenSky:            ~400 queries/day
//
// Strategy: reserve Aviationstack for the "live window" (±3h around departure
// and during the flight) where its superior live-tracking data matters, and
// use AirLabs for bulk pre-departure schedule lookups. Combined with a daily
// Aviationstack budget this keeps us inside the Free tier indefinitely.

/** Treat `now ± 3 hours` and "still en route" as the live window. */
const LIVE_WINDOW_BEFORE_DEPARTURE_MS = 3 * 60 * 60 * 1000; // 3h
const LIVE_WINDOW_AFTER_ARRIVAL_MS = 2 * 60 * 60 * 1000;    // 2h

export function isInLiveWindow(
  departureTime: Date | string | null | undefined,
  arrivalTime: Date | string | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!departureTime) return false;
  const dep = typeof departureTime === 'string' ? new Date(departureTime) : departureTime;
  if (isNaN(dep.getTime())) return false;

  const nowMs = now.getTime();
  const depMs = dep.getTime();

  // Within ±3h of departure — covers pre-departure gate changes and first
  // hour of flight where live tracking is most useful.
  if (Math.abs(nowMs - depMs) <= LIVE_WINDOW_BEFORE_DEPARTURE_MS) return true;

  // In-flight and up to 2h past scheduled arrival — needed to capture actual
  // arrival time and final delay. Fall through to false if no arrival given.
  if (depMs < nowMs && arrivalTime) {
    const arr = typeof arrivalTime === 'string' ? new Date(arrivalTime) : arrivalTime;
    if (!isNaN(arr.getTime()) && nowMs <= arr.getTime() + LIVE_WINDOW_AFTER_ARRIVAL_MS) {
      return true;
    }
  }

  return false;
}

// Per-UTC-day Aviationstack call counter. In-memory only — resets on process
// restart. Small overshoot possible across restarts, but bounded by 429
// cooldown so it's never catastrophic.
let aviationstackDay: string | null = null;
let aviationstackTodayCount = 0;

function currentUtcDay(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function resetBudgetIfNewDay(): void {
  const today = currentUtcDay();
  if (aviationstackDay !== today) {
    aviationstackDay = today;
    aviationstackTodayCount = 0;
  }
}

export function getAviationstackCallCountToday(): number {
  resetBudgetIfNewDay();
  return aviationstackTodayCount;
}

async function resolveAviationstackBudget(): Promise<number> {
  // Read admin setting; defaults to 3 per Prisma schema when the row exists.
  // If admin_settings is missing entirely (fresh DB before setup), fall back
  // to 3 so we don't accidentally hammer the API.
  try {
    const settings = await prisma.adminSettings.findFirst({
      select: { aviationstackDailyBudget: true },
    });
    return settings?.aviationstackDailyBudget ?? 3;
  } catch {
    return 3;
  }
}

async function hasAviationstackBudget(): Promise<boolean> {
  resetBudgetIfNewDay();
  const budget = await resolveAviationstackBudget();
  if (budget <= 0) return false;
  return aviationstackTodayCount < budget;
}

function recordAviationstackCall(): void {
  resetBudgetIfNewDay();
  aviationstackTodayCount++;
}

/** Test-only helper to reset the counter between unit tests. */
export function __resetAviationstackBudgetForTests(): void {
  aviationstackDay = null;
  aviationstackTodayCount = 0;
  aviationstack429Until = null;
}

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
  date?: Date,
  userId?: string
): Promise<FlightData[]> {
  const apiKey = await getApiKey('airlabs', userId);

  if (!apiKey) {
    logger.warn({ operation: 'flight_lookup', message: 'AIRLABS_API_KEY not configured - flight lookup disabled' });
    return [];
  }

  // Generate cache key
  const dateStr = date ? date.toISOString().split('T')[0] : 'nodate';
  const cacheKey = `${flightNumber.toUpperCase()}_${dateStr}`;

  // Check cache
  const cached = flightCache.get<FlightData[]>(cacheKey);
  if (cached !== undefined) {
    logger.info({ flightNumber, date: dateStr, operation: 'airlabs_cache_hit' },
      `AirLabs cache hit for ${flightNumber} on ${dateStr}`);
    return cached;
  }

  try {
    logger.info({ flightNumber, date: dateStr, api: 'airlabs', operation: 'api_call_start' },
      `Calling AirLabs API for ${flightNumber} on ${dateStr}`);
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
      logger.info({ flightNumber, date: dateStr, api: 'airlabs', operation: 'api_empty_response' },
        `AirLabs returned no data for ${flightNumber} on ${dateStr}`);
      const isHistorical = date && date < new Date();
      flightCache.set(cacheKey, [], isHistorical ? CACHE_TTL_SECONDS : RECENT_CACHE_TTL_SECONDS);
      return [];
    }

    const flights: FlightData[] = response.data.response.map((flight: AirLabsFlightRecord) => ({
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

    logger.info({ flightNumber, date: dateStr, api: 'airlabs', resultCount: flights.length,
      hasGate: flights.some(f => f.departure?.gate || f.arrival?.gate),
      hasTerminal: flights.some(f => f.departure?.terminal || f.arrival?.terminal),
      hasAircraft: flights.some(f => f.aircraft),
      operation: 'api_call_success' },
      `AirLabs returned ${flights.length} result(s) for ${flightNumber} on ${dateStr}`);

    // Cache the results with appropriate TTL
    const isHistorical = date && date < new Date();
    flightCache.set(cacheKey, flights, isHistorical ? CACHE_TTL_SECONDS : RECENT_CACHE_TTL_SECONDS);

    return flights;
  } catch (_error: unknown) {
    const errMsg = _error instanceof Error ? _error.message : String(_error);
    logger.warn({ flightNumber, date: dateStr, api: 'airlabs', error: errMsg, operation: 'api_call_error' },
      `AirLabs lookup failed for ${flightNumber}: ${errMsg}`);
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
  departure?: AirportInfo;
  arrival?: AirportInfo;
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
      logger.warn({ operation: 'opensky_token_fetch', message: 'OpenSky OAuth token fetch failed', error: err instanceof Error ? err.message : String(err) });
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
  date?: string,
  userId?: string,
  departureTime?: Date | string | null,
  arrivalTime?: Date | string | null,
): Promise<FlightLookupResult | null> {
  const trimmedNumber = flightNumber.trim();
  if (!trimmedNumber) return null;

  // Get OpenSky credentials with priority resolution
  const openSkyCredentials = await getOpenSkyCredentials(userId);

  // Aviationstack gating — multiple guards to protect the Free-tier budget:
  //   (1) admin has a key configured
  //   (2) not in 429 cooldown (set when quota actually exceeded)
  //   (3) flight is in the live window (±3h of departure or in flight)
  //   (4) we haven't yet used today's configured budget
  // If the caller didn't pass a departureTime (manual ad-hoc lookup via UI),
  // treat as "live" so on-demand user actions still reach Aviationstack.
  const aviationstackKey = await getApiKey('aviationstack', userId);
  const inLiveWindow = departureTime
    ? isInLiveWindow(departureTime, arrivalTime)
    : true;
  const budgetOk = aviationstackKey ? await hasAviationstackBudget() : false;
  const aviationstackAvailable =
    !!aviationstackKey &&
    !isAviationstackCooledDown() &&
    inLiveWindow &&
    budgetOk;

  let skipReason: string | undefined;
  if (aviationstackKey && !aviationstackAvailable) {
    if (isAviationstackCooledDown()) skipReason = 'cooldown';
    else if (!inLiveWindow) skipReason = 'outside_live_window';
    else if (!budgetOk) skipReason = 'daily_budget_exceeded';
  }

  logger.info({ flightNumber: trimmedNumber, date,
    hasAviationstack: !!aviationstackKey,
    aviationstackAvailable,
    aviationstackSkipReason: skipReason,
    aviationstackCallsToday: getAviationstackCallCountToday(),
    hasOpenSky: !!openSkyCredentials,
    operation: 'lookup_start' },
    `Looking up ${trimmedNumber} (date=${date ?? 'none'}, apis: ${aviationstackAvailable ? 'aviationstack' : ''}${openSkyCredentials ? '+opensky' : ''} +airlabs)`);
  if (aviationstackAvailable) {
    // Record the call up-front — even failures count against the daily budget,
    // because Aviationstack bills 429s too in the Free tier.
    recordAviationstackCall();
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
      const json = response.data as AviationstackApiResponse;
      const result = json.data?.[0];

      if (result) {
        const departureCode = result.departure?.iata || result.departure?.icao;
        const arrivalCode = result.arrival?.iata || result.arrival?.icao;

        const [departureAirport, arrivalAirport] = await Promise.all([
          departureCode ? findOrCreateAirport(departureCode) : Promise.resolve(null),
          arrivalCode ? findOrCreateAirport(arrivalCode) : Promise.resolve(null),
        ]);

        // Convert Aviationstack times from local airport time to UTC
        const departureTimeRaw = result.departure?.estimated || result.departure?.scheduled;
        const arrivalTimeRaw = result.arrival?.estimated || result.arrival?.scheduled;

        const [departureTimeUtc, arrivalTimeUtc] = await Promise.all([
          departureTimeRaw && departureCode
            ? convertAviationstackTimeToUtc(departureTimeRaw, departureCode)
            : Promise.resolve(departureTimeRaw || null),
          arrivalTimeRaw && arrivalCode
            ? convertAviationstackTimeToUtc(arrivalTimeRaw, arrivalCode)
            : Promise.resolve(arrivalTimeRaw || null),
        ]);

        return {
          airline: result.airline?.name,
          flightNumber: result.flight?.iata || result.flight?.icao || trimmedNumber,
          aircraft: result.aircraft?.icao || result.aircraft?.iata,
          departure: departureAirport || undefined,
          arrival: arrivalAirport || undefined,
          departureTime: departureTimeUtc || undefined,
          arrivalTime: arrivalTimeUtc || undefined,
        };
      }
    } catch (err) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status === 429) {
        // Quota exhausted — back off for an hour so we don't burn through the
        // free tier's monthly budget on rapid-fire retries.
        markAviationstack429();
        logger.warn({
          operation: 'aviationstack_rate_limited',
          message: 'Aviationstack returned 429 — backing off for 1 hour',
          context: { cooldownUntil: aviationstack429Until?.toISOString() },
        });
      } else {
        logger.error({ operation: 'aviationstack_lookup', message: 'Aviationstack lookup failed', error: err instanceof Error ? err.message : String(err) });
      }
    }
  }

  // Fallback to AirLabs
  logger.info({ flightNumber: trimmedNumber, date, api: 'airlabs', operation: 'fallback_airlabs' },
    `Falling back to AirLabs for ${trimmedNumber}`);
  const fallbackDate = date ? new Date(date) : undefined;
  const flights = await lookupFlightByNumber(trimmedNumber, fallbackDate);

  if (!flights.length) {
    // Try OpenSky as last resort (requires credentials)
    if (openSkyCredentials) {
      logger.info({ flightNumber: trimmedNumber, date, api: 'opensky', operation: 'fallback_opensky' },
        `Falling back to OpenSky for ${trimmedNumber}`);
      const openSkyAuth = await getOpenSkyAuthHeaders(openSkyCredentials);
      const openSky = await lookupOpenSkyFlight(trimmedNumber, date, openSkyAuth ?? undefined);
      if (openSky) return openSky;
    }
    logger.info({ flightNumber: trimmedNumber, date, operation: 'lookup_no_result' },
      `No data found for ${trimmedNumber} from any API`);
    return null;
  }

  const first = flights[0];
  const departureCode = first.departure.iata || first.departure.icao;
  const arrivalCode = first.arrival.iata || first.arrival.icao;

  const [departureAirport, arrivalAirport] = await Promise.all([
    departureCode ? findOrCreateAirport(departureCode) : Promise.resolve(null),
    arrivalCode ? findOrCreateAirport(arrivalCode) : Promise.resolve(null),
  ]);

  // Convert AirLabs times to UTC (AirLabs may return UTC or local times)
  const departureTimeRaw = first.departure.scheduledTime || first.departure.actualTime;
  const arrivalTimeRaw = first.arrival.scheduledTime || first.arrival.actualTime;

  const [departureTimeUtc, arrivalTimeUtc] = await Promise.all([
    departureTimeRaw
      ? convertAirlabsTimeToUtc(departureTimeRaw, departureCode)
      : Promise.resolve(null),
    arrivalTimeRaw
      ? convertAirlabsTimeToUtc(arrivalTimeRaw, arrivalCode)
      : Promise.resolve(null),
  ]);

  return {
    airline: first.airline || (first.airlineIata ? getAirlineName(first.airlineIata) || undefined : undefined) || first.airlineIcao,
    flightNumber: first.flightNumber,
    aircraft: first.aircraft || first.aircraftIcao,
    departure: departureAirport || undefined,
    arrival: arrivalAirport || undefined,
    departureTime: departureTimeUtc || undefined,
    arrivalTime: arrivalTimeUtc || undefined,
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
    const result = (response.data as OpenSkyFlightResult[])[0];
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
    logger.warn({ operation: 'opensky_fallback', message: 'OpenSky fallback failed', error: err instanceof Error ? err.message : String(err) });
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
// Re-export from consolidated data source
import { AIRLINE_IATA_MAP } from '../data/airlines';
export { AIRLINE_IATA_MAP };

export function getAirlineName(iataCode: string): string | null {
  return AIRLINE_IATA_MAP[iataCode.toUpperCase()] ?? null;
}
