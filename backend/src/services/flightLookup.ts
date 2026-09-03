/**
 * Flight Number Lookup Service
 *
 * Supports four providers, layered by tier and cost:
 * - Aviationstack (paid; live window only, daily-budget-gated)
 * - AeroDataBox (RapidAPI; historical fallback, 365-day window)
 * - AirLabs (free; live-window today-only — silently lies about other dates)
 * - OpenSky (free; last-resort callsign lookup)
 *
 * The cascade prefers Aviationstack inside the live window, AeroDataBox
 * for historical / out-of-live-window dates when configured, then AirLabs
 * for live or ad-hoc lookups, and OpenSky as a final fallback.
 */

import axios from 'axios';
import NodeCache from 'node-cache';
import { findOrCreateAirport } from './airportLookup';
import { getApiKey, getOpenSkyCredentials } from './apiKeyResolver';
import { lookupFlightAerodatabox } from './aerodataboxLookup';
import {
  convertAviationstackTimeToUtc,
  convertAirlabsTimeToUtc,
  getAirportTimezone,
  toLocalDateString,
} from '../utils/timezone';
import { resolveAirlineCodes } from '../utils/airlineNormalize';
import { toProviderFlightNumber } from '../schemas/flight';
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

// Aviationstack Free tier rejects the `flight_date` filter with 403
// `function_access_restricted` (real-time queries stay allowed). Learned at
// runtime from the first 403 and kept for the process lifetime so follow-up
// lookups stop burning budget calls on guaranteed failures.
let aviationstackDateFilterRestricted = false;

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
  aviationstackDateFilterRestricted = false;
}

/** Test-only helper to simulate an already-learned date-filter restriction. */
export function __setAviationstackDateFilterRestrictedForTests(value: boolean): void {
  aviationstackDateFilterRestricted = value;
}

/**
 * Tag an AirLabs `*_utc` value as UTC.
 *
 * AirLabs returns BOTH a local (`dep_time`) and a UTC (`dep_time_utc`)
 * field, and BOTH in the bare form "YYYY-MM-DD HH:mm" — no `Z`, no offset.
 * `convertAirlabsTimeToUtc` decides by that missing marker and re-interprets
 * the value as airport-local, so preferring `*_utc` silently subtracted the
 * airport's offset a second time (EK51 DXB→MUC 15:55 local / 11:55Z came out
 * as 07:55Z; measured 2026-08-11). Marking the value keeps the converter's
 * existing already-has-a-zone branch, and the local fallback still converts.
 */
function markUtc(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const v = value.trim();
  if (!v) return undefined;
  if (/[zZ]$/.test(v) || /[+-]\d{2}:?\d{2}$/.test(v)) return v;
  return `${v.replace(' ', 'T')}Z`;
}

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
    // AirLabs API endpoint for flight schedules. The query uses the UNPADDED
    // IATA form — "EK051" returns zero records where "EK51" returns the
    // flight (see toProviderFlightNumber).
    const response = await axios.get('https://airlabs.co/api/v9/schedules', {
      params: {
        api_key: apiKey,
        flight_iata: toProviderFlightNumber(flightNumber) ?? flightNumber,
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
      // Deliberately the CALLER's spelling, not the provider's: echoing back
      // "EK51" for a stored "EK051" makes calculateChanges see a flightNumber
      // change, which auto-apply would write — silently renaming the user's
      // flight to the provider's padding convention.
      flightNumber,
      airline: flight.airline_name || getAirlineName(flight.airline_iata || '') || flight.airline_icao || 'Unknown',
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

/** Provider that actually served a lookup result. */
export type FlightLookupSource = 'aviationstack' | 'aerodatabox' | 'airlabs' | 'opensky';

/**
 * Aviationstack + enrichment (preferred when key is set), AirLabs fallback.
 */
export interface FlightLookupResult {
  /**
   * Provider that actually served this result — NOT which keys happen to be
   * configured. Consumers (e.g. pending updates) must attribute data to this.
   */
  source?: FlightLookupSource;
  airline?: string;
  flightNumber?: string;
  aircraft?: string;
  /** Aircraft registration / tail number, e.g. "D-AIHX". AeroDataBox-only. */
  aircraftRegistration?: string;
  /** Mode-S transponder hex, e.g. "3C6518". AeroDataBox-only. ADS-B bridge. */
  aircraftModeS?: string;
  /** ATC callsign, e.g. "DLH400". AeroDataBox-only. */
  callsign?: string;
  /** Operating airline when the requested flight number is a codeshare. */
  operatingAirline?: string;
  /** True when the response indicates this flight number is sold by a partner. */
  isCodeshare?: boolean;
  /** IATA code of the operating airline (e.g. "LH"). */
  airlineIata?: string;
  /** ICAO code of the operating airline (e.g. "DLH"). */
  airlineIcao?: string;
  /** Great-circle route distance in km from the provider; saves a haversine. */
  distanceKm?: number;
  /**
   * Hint to override the locally-derived flight status. Currently only
   * `'cancelled'` and `'diverted'` are surfaced — providers reporting
   * normal "Landed" / "EnRoute" map to `'flown'` / `'scheduled'` via the
   * usual date heuristic.
   */
  statusOverride?: "cancelled" | "diverted";
  departure?: AirportInfo;
  arrival?: AirportInfo;
  departureTime?: string;
  arrivalTime?: string;
  /** Actual off-block time (UTC ISO); populated when the API reports it */
  actualDeparture?: string;
  /** Actual on-block time (UTC ISO); populated when the API reports it */
  actualArrival?: string;
  /** Wheels-off time (UTC ISO); AeroDataBox `runwayTime` on the departure side. */
  runwayDepartureTime?: Date | null;
  /** Wheels-on time (UTC ISO); AeroDataBox `runwayTime` on the arrival side. */
  runwayArrivalTime?: Date | null;
  /** True when AeroDataBox reports the flight as a cargo service. */
  isCargo?: boolean | null;
  /** Timestamp of the last data update reported by AeroDataBox. */
  aerodataboxLastUpdatedUtc?: Date | null;
  /** AeroDataBox quality tags, e.g. ["Basic", "Live"]. */
  aerodataboxQualityTags?: string[];
  /** Arrival baggage belt identifier (departure side is irrelevant for passengers). */
  baggageBelt?: string | null;
  /** Departure check-in desk range, e.g. "120-150". */
  checkInDesk?: string | null;
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
  /** Our flight's departure airport, where the caller knows it — see the
   *  AeroDataBox adapter for why a flight number alone is not unique. */
  depAirportCode?: string,
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
  // Once the plan is known to reject the `flight_date` filter, a lookup for
  // another day can't be served — skip up-front instead of burning a budget
  // call on a guaranteed 403.
  //
  // UNLESS THE FLIGHT IS IN THE AIR RIGHT NOW. This used to read "non-today
  // lookups can't be served at all (real-time queries only cover today)", and
  // for an overnight flight that is simply wrong: it departed yesterday and is
  // aboard the real-time feed this minute, because it has not landed. The
  // date-less query below is exactly the one the free plan still allows, and
  // the `aviationstack_date_mismatch` guard after it discards an answer that
  // turns out to belong to another service day. Both were already here; only
  // this gate stopped them being reached.
  //
  // What that cost, measured on the owner's account 2026-09-03: LX93
  // GRU→ZRH, departing the 2nd and landing the 3rd. Its two arrival checks
  // (arrival −60 min and +30 min) both ran on the 3rd, both were refused here
  // with `date_filter_restricted`, and the flight kept no actual times at all
  // — while the short hop beside it, whose checks all fell on its departure
  // day, got its own. Every long-haul leg fails the same way.
  //
  // `inLiveWindow` is what makes this safe rather than a hole: it is already a
  // precondition of `aviationstackAvailable`, it spans in-flight through two
  // hours past scheduled arrival, and outside it nothing changes at all.
  // Deliberately NOT `inLiveWindow`, which defaults to true when the caller
  // passes no departureTime — that default means "ad-hoc lookup from the UI",
  // and a user typing a date from last May is asking a historical question
  // that the free plan genuinely cannot answer. The exception here needs a
  // MEASURED position in the air, so it asks for a departure time and gets one.
  const flyingRightNow = departureTime
    ? isInLiveWindow(departureTime, arrivalTime)
    : false;
  const requestedDateIsToday = !date || date === currentUtcDay();
  const dateFilterBlocked =
    aviationstackDateFilterRestricted && !requestedDateIsToday && !flyingRightNow;
  const aviationstackAvailable =
    !!aviationstackKey &&
    !isAviationstackCooledDown() &&
    inLiveWindow &&
    budgetOk &&
    !dateFilterBlocked;

  let skipReason: string | undefined;
  if (aviationstackKey && !aviationstackAvailable) {
    if (isAviationstackCooledDown()) skipReason = 'cooldown';
    else if (!inLiveWindow) skipReason = 'outside_live_window';
    else if (!budgetOk) skipReason = 'daily_budget_exceeded';
    else if (dateFilterBlocked) skipReason = 'date_filter_restricted';
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
    // Up to two attempts: the second fires only when the first reveals a
    // Free-tier date-filter restriction on a same-day lookup — the retry
    // drops `flight_date` (real-time queries stay allowed on the Free plan).
    let omitDateFilter = aviationstackDateFilterRestricted;
    for (let attempt = 0; attempt < 2; attempt++) {
      // Record the call up-front — even failures count against the daily budget,
      // because Aviationstack bills 429s too in the Free tier.
      recordAviationstackCall();
      // API docs: https://docs.apilayer.com/aviationstack/docs/endpoints#flights
      // Use HTTPS + params to avoid signature/order issues
      const params: Record<string, string> = {
        access_key: aviationstackKey,
        limit: '1',
      };
      // Unpadded IATA form for the same reason as AirLabs (see
      // toProviderFlightNumber) — providers do not carry leading zeros.
      const providerNumber = toProviderFlightNumber(trimmedNumber) ?? trimmedNumber;
      if (/^[A-Za-z]{2}\d+/.test(providerNumber)) {
        params.flight_iata = providerNumber;
      } else {
        params.flight_icao = providerNumber;
      }
      if (date && !omitDateFilter) {
        params.flight_date = date;
      }

      try {
        const response = await axios.get('https://api.aviationstack.com/v1/flights', {
          params,
          timeout: 6000,
        });
        const json = response.data as AviationstackApiResponse;
        let result = json.data?.[0];

        // A date-less (real-time) query returns the latest known flight for
        // the number — guard against it belonging to a different service day.
        if (result && date && omitDateFilter && result.flight_date && result.flight_date !== date) {
          logger.warn({ flightNumber: trimmedNumber, date, resultDate: result.flight_date,
            operation: 'aviationstack_date_mismatch' },
            `Aviationstack real-time result for ${trimmedNumber} is for ${result.flight_date}, not ${date} — discarding`);
          result = undefined;
        }

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
          const actualDepartureRaw = result.departure?.actual;
          const actualArrivalRaw = result.arrival?.actual;

          const [departureTimeUtc, arrivalTimeUtc, actualDepartureUtc, actualArrivalUtc] =
            await Promise.all([
              departureTimeRaw && departureCode
                ? convertAviationstackTimeToUtc(departureTimeRaw, departureCode)
                : Promise.resolve(departureTimeRaw || null),
              arrivalTimeRaw && arrivalCode
                ? convertAviationstackTimeToUtc(arrivalTimeRaw, arrivalCode)
                : Promise.resolve(arrivalTimeRaw || null),
              actualDepartureRaw && departureCode
                ? convertAviationstackTimeToUtc(actualDepartureRaw, departureCode)
                : Promise.resolve(actualDepartureRaw || null),
              actualArrivalRaw && arrivalCode
                ? convertAviationstackTimeToUtc(actualArrivalRaw, arrivalCode)
                : Promise.resolve(actualArrivalRaw || null),
            ]);

          // Merge per-flight fields (gate/terminal) onto the airport record.
          // findOrCreateAirport only supplies static metadata (name/lat/lon); the
          // API is the sole source of live gate/terminal. Before this merge, those
          // fields were silently dropped when the airport object shadowed them.
          const departureWithLive: AirportInfo | undefined = departureAirport
            ? {
                iata: departureAirport.iata ?? undefined,
                icao: departureAirport.icao ?? undefined,
                name: departureAirport.name,
                lat: departureAirport.lat,
                lon: departureAirport.lon,
                terminal: result.departure?.terminal,
                gate: result.departure?.gate,
              }
            : undefined;
          const arrivalWithLive: AirportInfo | undefined = arrivalAirport
            ? {
                iata: arrivalAirport.iata ?? undefined,
                icao: arrivalAirport.icao ?? undefined,
                name: arrivalAirport.name,
                lat: arrivalAirport.lat,
                lon: arrivalAirport.lon,
                terminal: result.arrival?.terminal,
                gate: result.arrival?.gate,
              }
            : undefined;

          return {
            source: 'aviationstack',
            airline: result.airline?.name,
            // Caller's spelling — see the AirLabs mapping: echoing the
            // provider's unpadded form would auto-rename a stored "EK051".
            flightNumber: trimmedNumber,
            aircraft: result.aircraft?.icao || result.aircraft?.iata,
            departure: departureWithLive,
            arrival: arrivalWithLive,
            departureTime: departureTimeUtc || undefined,
            arrivalTime: arrivalTimeUtc || undefined,
            actualDeparture: actualDepartureUtc || undefined,
            actualArrival: actualArrivalUtc || undefined,
          };
        }
        break; // no usable result — fall through to the other providers
      } catch (err) {
        const errResponse = (err as {
          response?: { status?: number; data?: { error?: { code?: string } } };
        })?.response;
        const status = errResponse?.status;
        if (status === 429) {
          // Quota exhausted — back off for an hour so we don't burn through the
          // free tier's monthly budget on rapid-fire retries.
          markAviationstack429();
          logger.warn({
            operation: 'aviationstack_rate_limited',
            message: 'Aviationstack returned 429 — backing off for 1 hour',
            context: { cooldownUntil: aviationstack429Until?.toISOString() },
          });
          break;
        }
        if (
          status === 403 &&
          errResponse?.data?.error?.code === 'function_access_restricted' &&
          !omitDateFilter &&
          date
        ) {
          // The plan rejects the `flight_date` filter (Free tier). Remember it
          // for the process lifetime; retry without the filter when the
          // requested date is today (real-time data still matches). Past or
          // future dates can't be served — fall through to other providers.
          aviationstackDateFilterRestricted = true;
          logger.warn({ flightNumber: trimmedNumber, date,
            operation: 'aviationstack_date_filter_restricted' },
            'Aviationstack plan rejects the flight_date filter — skipping it from now on');
          if (date === currentUtcDay()) {
            omitDateFilter = true;
            continue;
          }
          break;
        }
        logger.error({ operation: 'aviationstack_lookup', message: 'Aviationstack lookup failed', error: err instanceof Error ? err.message : String(err) });
        break;
      }
    }
  }

  // AeroDataBox tertiary fallback — covers the last 365 days plus
  // ~365 days into the future, which is the gap between Aviationstack
  // (paid) and AirLabs (live-only). Fires whenever we have a date,
  // regardless of live window: in-window adds resilience if
  // Aviationstack 429'd or returned nothing; out-of-window it's the
  // only free provider that can serve the request.
  if (date) {
    // The departure airport disambiguates a flight number flown more than
    // once on one day — see the adapter's own note for the measured case.
    const aerodataboxResult = await lookupFlightAerodatabox(
      trimmedNumber,
      date,
      userId,
      depAirportCode,
    );
    if (aerodataboxResult) {
      logger.info(
        { flightNumber: trimmedNumber, date, api: 'aerodatabox', operation: 'lookup_aerodatabox_hit' },
        `AeroDataBox served ${trimmedNumber} on ${date}`,
      );
      return { ...aerodataboxResult, source: 'aerodatabox' };
    }
  }

  // For deliberate out-of-live-window lookups (caller passed a
  // departureTime that's not within the live window) skip AirLabs
  // entirely. AirLabs's free tier silently ignores `dep_date` and
  // returns today's schedule, which poisons the wrapper's date-mismatch
  // safety net (issue #82). No working free provider exists for past or
  // future date lookups — Aviationstack and AeroDataBox (above) are the
  // only ones, and both have already been tried with the correct date
  // at this point. Ad-hoc UI lookups (no departureTime) still treat
  // AirLabs as the live-window fallback.
  if (departureTime && !inLiveWindow) {
    logger.info({ flightNumber: trimmedNumber, date, operation: 'lookup_no_result' },
      `No data found for ${trimmedNumber} from any API (outside live window, AirLabs skipped)`);
    return null;
  }

  // Fallback to AirLabs (live window, or ad-hoc lookup with no departureTime)
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
      if (openSky) return { ...openSky, source: 'opensky' };
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
  const actualDepartureRaw = first.departure.actualTime;
  const actualArrivalRaw = first.arrival.actualTime;

  const [departureTimeUtc, arrivalTimeUtc, actualDepartureUtc, actualArrivalUtc] =
    await Promise.all([
      departureTimeRaw
        ? convertAirlabsTimeToUtc(departureTimeRaw, departureCode)
        : Promise.resolve(null),
      arrivalTimeRaw
        ? convertAirlabsTimeToUtc(arrivalTimeRaw, arrivalCode)
        : Promise.resolve(null),
      actualDepartureRaw
        ? convertAirlabsTimeToUtc(actualDepartureRaw, departureCode)
        : Promise.resolve(null),
      actualArrivalRaw
        ? convertAirlabsTimeToUtc(actualArrivalRaw, arrivalCode)
        : Promise.resolve(null),
    ]);

  // Merge per-flight fields (gate/terminal) onto the airport record.
  // findOrCreateAirport only supplies static metadata (name/lat/lon); the API
  // is the sole source of live gate/terminal. Before this merge, those fields
  // were silently dropped when the airport object shadowed them.
  const departureWithLive: AirportInfo | undefined = departureAirport
    ? {
        iata: departureAirport.iata ?? undefined,
        icao: departureAirport.icao ?? undefined,
        name: departureAirport.name,
        lat: departureAirport.lat,
        lon: departureAirport.lon,
        terminal: first.departure.terminal,
        gate: first.departure.gate,
      }
    : undefined;
  const arrivalWithLive: AirportInfo | undefined = arrivalAirport
    ? {
        iata: arrivalAirport.iata ?? undefined,
        icao: arrivalAirport.icao ?? undefined,
        name: arrivalAirport.name,
        lat: arrivalAirport.lat,
        lon: arrivalAirport.lon,
        terminal: first.arrival.terminal,
        gate: first.arrival.gate,
      }
    : undefined;

  return {
    source: 'airlabs',
    airline: first.airline || (first.airlineIata ? getAirlineName(first.airlineIata) || undefined : undefined) || first.airlineIcao,
    flightNumber: first.flightNumber,
    aircraft: first.aircraft || first.aircraftIcao,
    departure: departureWithLive,
    arrival: arrivalWithLive,
    departureTime: departureTimeUtc || undefined,
    arrivalTime: arrivalTimeUtc || undefined,
    actualDeparture: actualDepartureUtc || undefined,
    actualArrival: actualArrivalUtc || undefined,
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

export interface LookupWithHistoricalResult {
  flights: FlightData[];
  /**
   * Set when the lookup cannot be served. Three distinct reasons:
   * - `'no_provider'`: the requested date is anything other than today AND
   *   no Aviationstack key is configured. The free providers (AirLabs,
   *   OpenSky) only cover live flights, so without a paid provider the
   *   request cannot be served. Surface a "manual entry / paid plan"
   *   message.
   * - `'no_match'`: a live-window lookup was queried but returned no
   *   usable data. Most likely a typo in flight number or date — worth
   *   pointing the user at their inputs.
   * - `'no_match_api_gap'`: an out-of-live-window lookup was attempted
   *   with an Aviationstack key configured, but the provider returned
   *   nothing (or returned today's schedule for a non-today request —
   *   the issue-#82 symptom). The flight just isn't covered by the API
   *   for that date; do not blame the user for a typo.
   */
  unavailableReason?: 'not_configured' | 'no_provider' | 'no_match' | 'no_match_api_gap';
}

/** Coerce `string | null | undefined` -> `string | undefined` (FlightData fields don't accept null). */
const toUndef = (value: string | null | undefined): string | undefined =>
  value === null ? undefined : value;

/** Map a `lookupFlightDetails` result onto the legacy `FlightData` shape. */
function flightLookupResultToFlightData(
  result: FlightLookupResult,
  fallbackFlightNumber: string,
): FlightData {
  return {
    flightNumber: result.flightNumber || fallbackFlightNumber,
    airline: result.airline || 'Unknown',
    airlineIata: result.airlineIata,
    airlineIcao: result.airlineIcao,
    operatingAirline: result.operatingAirline,
    isCodeshare: result.isCodeshare,
    callsign: result.callsign,
    departure: {
      iata: toUndef(result.departure?.iata),
      icao: toUndef(result.departure?.icao),
      name: result.departure?.name,
      scheduledTime: result.departureTime,
      actualTime: result.actualDeparture,
      terminal: result.departure?.terminal,
      gate: result.departure?.gate,
    },
    arrival: {
      iata: toUndef(result.arrival?.iata),
      icao: toUndef(result.arrival?.icao),
      name: result.arrival?.name,
      scheduledTime: result.arrivalTime,
      actualTime: result.actualArrival,
      terminal: result.arrival?.terminal,
      gate: result.arrival?.gate,
    },
    aircraft: result.aircraft,
    aircraftRegistration: result.aircraftRegistration,
    aircraftModeS: result.aircraftModeS,
    status: result.statusOverride,
    distance: result.distanceKm,
  };
}

/**
 * UI-facing lookup that consumes the full provider cascade
 * (Aviationstack -> AirLabs) instead of going AirLabs-only.
 *
 * - For live requests (today) it behaves like `lookupFlightDetails`,
 *   wrapped in a single-element array to preserve the legacy
 *   `FlightData[]` contract that the UI depends on.
 * - For any non-today request without an Aviationstack key the free
 *   providers cannot deliver: AirLabs's free tier silently ignores the
 *   date filter and returns today's schedule (issue #82), and OpenSky's
 *   REST API has no working callsign-by-date endpoint. Report
 *   `unavailableReason: 'no_provider'` so the caller can show a
 *   "manual entry / paid plan" message instead of misleading data.
 * - For non-today requests with an Aviationstack key, run the cascade
 *   and use a date-mismatch safety net: if a provider returns today's
 *   schedule for a non-today request, surface `'no_match_api_gap'`
 *   rather than the misleading data. In-live-window empty responses
 *   stay `'no_match'` because a typo is a plausible cause there.
 */
export async function lookupFlightWithHistorical(
  flightNumber: string,
  date: Date | undefined,
  userId?: string,
  depAirportCode?: string,
): Promise<LookupWithHistoricalResult> {
  const trimmed = flightNumber.trim();
  if (!trimmed) return { flights: [] };

  // When the caller passes a stored departure INSTANT (bulk refresh does),
  // the provider date filter must be the LOCAL departure day at the airport,
  // not the instant's UTC day — providers key rotations by local date. A
  // SYD 06:00 departure is the previous day in UTC; querying that UTC day
  // returns the previous rotation (the EK415 day-shift bug, 2026-08-11).
  // Callers passing a user-picked calendar date (UI lookup) omit
  // depAirportCode and keep the date exactly as given.
  let localDayStr: string | undefined;
  if (date && depAirportCode) {
    const depTz = await getAirportTimezone(depAirportCode);
    if (depTz) localDayStr = toLocalDateString(date, depTz);
  }

  // Direction is decided on UTC-day boundaries, not on hours: "tomorrow" /
  // "yesterday" should always count as future / past regardless of how many
  // hours away they are at the moment of the call. The hour-based threshold
  // earlier let "tomorrow at 00:00 UTC" slip through when called late in the
  // day, which is exactly the issue-#82 symptom we're guarding against.
  const now = Date.now();
  const todayStr = new Date(now).toISOString().slice(0, 10);
  const requestedStr = localDayStr ?? (date ? date.toISOString().slice(0, 10) : undefined);
  const dayDelta = requestedStr ? dayDiff(requestedStr, todayStr) : 0;

  const isOutsideLiveWindow = dayDelta !== 0;

  // Nothing configured at all: no provider can answer ANY date, including
  // today. Without this gate the cascade ran, found every provider disabled,
  // and returned an ordinary empty result — so a fresh install was told
  // "no flights found, try another date" when nothing had been searched
  // (#232). "Not configured" and "not found" call for opposite actions:
  // add a key in Settings, versus check the number and date.
  //
  // Checked before the outside-live-window gate below on purpose: with no
  // provider whatsoever, "this date needs Aviationstack or AeroDataBox" is
  // the wrong answer, because it implies the free providers are set up and
  // merely limited.
  const [anyAirlabs, anyAviationstack, anyAerodatabox, anyOpenSky] = await Promise.all([
    getApiKey('airlabs', userId),
    getApiKey('aviationstack', userId),
    getApiKey('aerodatabox', userId),
    getOpenSkyCredentials(userId),
  ]);
  if (!anyAirlabs && !anyAviationstack && !anyAerodatabox && !anyOpenSky) {
    logger.info(
      {
        flightNumber: trimmed,
        date: requestedStr,
        operation: 'lookup_unavailable_not_configured',
      },
      `Lookup requested for ${trimmed} but no flight-data provider is configured`,
    );
    return { flights: [], unavailableReason: 'not_configured' };
  }

  // Capability gate: any non-today request needs Aviationstack OR
  // AeroDataBox. Without one of them, the free providers can't deliver:
  // AirLabs lies about non-today dates, OpenSky has no working
  // callsign-by-date endpoint. AeroDataBox covers historical (≤ 365 d)
  // and near-future schedules.
  if (isOutsideLiveWindow) {
    const [aviationstackKey, aerodataboxKey] = await Promise.all([
      getApiKey('aviationstack', userId),
      getApiKey('aerodatabox', userId),
    ]);
    if (!aviationstackKey && !aerodataboxKey) {
      logger.info(
        {
          flightNumber: trimmed,
          date: requestedStr,
          direction: dayDelta > 0 ? 'future' : 'past',
          operation: 'lookup_unavailable_no_provider',
        },
        `Lookup outside live window requested for ${trimmed} (date=${requestedStr}, direction=${dayDelta > 0 ? 'future' : 'past'}) but neither Aviationstack nor AeroDataBox is configured`,
      );
      return { flights: [], unavailableReason: 'no_provider' };
    }
  }

  const dateStr = requestedStr;
  const result = await lookupFlightDetails(
    trimmed,
    dateStr,
    userId,
    undefined,
    undefined,
    depAirportCode,
  );

  if (!result) {
    if (isOutsideLiveWindow) {
      return { flights: [], unavailableReason: 'no_match_api_gap' };
    }
    return { flights: [] };
  }

  // Safety net: if a provider ignored the date filter and returned today's
  // schedule for an out-of-live-window request, surface that as
  // no_match_api_gap instead of showing the user misleading "today" data
  // (issue #82). It's an API gap, not a user typo, so we don't blame the
  // input.
  //
  // Two heuristics:
  //  1. Strict mismatch — returned date is more than 1 day off from the
  //     requested date (covers far-off-historical and far-future bug
  //     responses).
  //  2. Smoking gun — returned date is today (we already know the user did
  //     not ask for today because we're inside isOutsideLiveWindow). Covers
  //     the off-by-one case like "yesterday" / "tomorrow" -> today.
  if (isOutsideLiveWindow && dateStr && result.departureTime) {
    const returnedDate = result.departureTime.slice(0, 10);
    const strictMismatch = Math.abs(dayDiff(dateStr, returnedDate)) > 1;
    const smokingGun = returnedDate === todayStr;

    if (strictMismatch || smokingGun) {
      logger.info(
        {
          flightNumber: trimmed,
          requestedDate: dateStr,
          returnedDate,
          today: todayStr,
          operation: 'lookup_date_mismatch',
        },
        `Provider ignored requested date ${dateStr} for ${trimmed} (returned ${returnedDate}); treating as no_match_api_gap`,
      );
      return { flights: [], unavailableReason: 'no_match_api_gap' };
    }
  }

  return { flights: [flightLookupResultToFlightData(result, trimmed)] };
}

/** Absolute day difference between two YYYY-MM-DD strings (positive when a > b). */
function dayDiff(a: string, b: string): number {
  const aMs = Date.UTC(
    Number(a.slice(0, 4)),
    Number(a.slice(5, 7)) - 1,
    Number(a.slice(8, 10)),
  );
  const bMs = Date.UTC(
    Number(b.slice(0, 4)),
    Number(b.slice(5, 7)) - 1,
    Number(b.slice(8, 10)),
  );
  return Math.round((aMs - bMs) / (24 * 60 * 60 * 1000));
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
 * Get airline name from IATA code. Resolves via the DB-backed airline
 * catalogue cache (with the curated cold-start fallback baked into
 * `resolveAirlineCodes` for use before the cache is warm) — a superset of
 * the old static 147-entry map, and correct even on a fresh boot.
 */
export function getAirlineName(iataCode: string): string | null {
  if (!iataCode) return null;
  return resolveAirlineCodes(iataCode)?.name ?? null;
}
