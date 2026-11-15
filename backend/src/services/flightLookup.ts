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

import { getApiKey, getOpenSkyCredentials } from "./apiKeyResolver";
import { lookupFlightAerodatabox } from "./aerodataboxLookup";
import { lookupFlightAeroapi } from "./aeroapiLookup";
import { flightLookupResultToFlightData } from "./flightLookup/toFlightData";
import { fillFromAdsb, isAdsb, lookupAdsbIfToday, lookupAfterMiss } from "./flightLookup/adsbChain";
import { mapAirlabsResult } from "./flightLookup/providerMapping";
import {
  logLookupStart,
  lookupViaAviationstack,
  resolveAviationstackGate,
} from "./flightLookup/aviationstackLookup";
import { flightProviderAvailability } from "./flightLookup/providerAvailability";
import {
  LookupOutcomeLog,
  type FlightDataProvider,
  type ProviderFailure,
} from "./flightLookup/providerOutcome";
import { getAirportTimezone, toLocalDateString } from "../utils/timezone";
import { dayDiff, getAirlineName, parseFlightNumber } from "./flightLookup/fieldReaders";
import logger from "../utils/logger";
import { lookupFlightByNumber, type FlightData } from "./flightLookup/airlabs";
import type { AirportInfo } from "./flightLookup/providerTypes";

export { lookupFlightByNumber };
export type { FlightData };

// The budget state moved to its own module; its public surface stays
// reachable here because every caller and test imports it from this path.
export {
  isInLiveWindow,
  getAviationstackCallCountToday,
  __resetAviationstackBudgetForTests,
  __setAviationstackDateFilterRestrictedForTests,
} from "./flightLookup/aviationstackBudget";

/** Provider that actually served a lookup result. */
export type FlightLookupSource = FlightDataProvider;

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

export async function lookupFlightDetails(
  flightNumber: string,
  date?: string,
  userId?: string,
  departureTime?: Date | string | null,
  arrivalTime?: Date | string | null,
  /** Our flight's departure airport, where the caller knows it — see the
   *  AeroDataBox adapter for why a flight number alone is not unique. */
  depAirportCode?: string,
  /** Receives what each provider answered — see `providerOutcome.ts`. */
  outcomes?: LookupOutcomeLog
): Promise<FlightLookupResult | null> {
  const trimmedNumber = flightNumber.trim();
  if (!trimmedNumber) return null;

  // FlightAware AeroAPI first where a key is configured: it is the one paid for
  // as a status source. No key means null without a request, and null falls
  // through to the order below unchanged.
  const aeroapi = date
    ? await lookupFlightAeroapi(
        trimmedNumber,
        date,
        userId,
        depAirportCode,
        outcomes,
        departureTime
      )
    : null;
  if (aeroapi) {
    logger.info({ api: "aeroapi", operation: "lookup_aeroapi_hit" }, "AeroAPI served");
    return { ...aeroapi, source: "aeroapi" };
  }

  // Get OpenSky credentials with priority resolution
  const openSkyCredentials = await getOpenSkyCredentials(userId);
  const aviationstackKey = await getApiKey("aviationstack", userId);
  const gate = await resolveAviationstackGate(aviationstackKey, date, departureTime, arrivalTime);
  logLookupStart(trimmedNumber, date, gate, !!openSkyCredentials);
  if (gate.available && aviationstackKey) {
    const served = await lookupViaAviationstack(aviationstackKey, trimmedNumber, date, outcomes);
    if (served) return served;
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
      outcomes
    );
    if (aerodataboxResult) {
      logger.info(
        { api: "aerodatabox", operation: "lookup_aerodatabox_hit" },
        "AeroDataBox served"
      );
      return { ...aerodataboxResult, source: "aerodatabox" };
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
  if (departureTime && !gate.inLiveWindow) {
    logger.info(
      { operation: "lookup_no_result" },
      "No data found from any API (outside live window, AirLabs skipped)"
    );
    return null;
  }

  return lookupViaAirlabs(trimmedNumber, date, userId, openSkyCredentials, outcomes);
}

/** AirLabs (live window, or ad-hoc lookup with no departureTime), ADS-B filled in. */
async function lookupViaAirlabs(
  trimmedNumber: string,
  date: string | undefined,
  userId: string | undefined,
  openSkyCredentials: Awaited<ReturnType<typeof getOpenSkyCredentials>>,
  outcomes: LookupOutcomeLog | undefined
): Promise<FlightLookupResult | null> {
  logger.info({ api: "airlabs", operation: "fallback_airlabs" }, "Falling back to AirLabs");
  const fallbackDate = date ? new Date(date) : undefined;
  // `userId` is not optional decoration here: `lookupFlightByNumber` resolves
  // its own key with `getApiKey('airlabs', userId)`, so dropping it silently
  // demotes a user's personal key to the global one — or, where only a personal
  // key exists, to no key at all and a null result (AUD-100).
  const flights = await lookupFlightByNumber(trimmedNumber, fallbackDate, userId, outcomes);

  const adsb = await lookupAdsbIfToday(trimmedNumber, date, userId, outcomes);
  if (!flights.length) {
    return lookupAfterMiss(trimmedNumber, date, openSkyCredentials, adsb, outcomes);
  }
  return fillFromAdsb(await mapAirlabsResult(flights[0]), adsb);
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
  unavailableReason?:
    "not_configured" | "no_provider" | "no_match" | "no_match_api_gap" | "provider_failed";
  /**
   * With `'provider_failed'`: which provider could not answer, and why
   * (`auth`, `quota`, `timeout`, `plan_restricted`, `provider_error`). Set
   * whenever no flight came back and at least one provider FAILED rather than
   * answered "not found" — then "no flight" is not a claim anyone made.
   */
  providerFailures?: ProviderFailure[];
}

export interface LookupWithHistoricalOptions {
  /**
   * The asking user's IANA zone, for a lookup whose departure airport is not
   * known yet (the flight form). Decides what "today" is — see below.
   */
  clientTimezone?: string;
}

/** An IANA zone the runtime accepts, else undefined. */
function validTimezone(zone: string | undefined): string | undefined {
  if (!zone) return undefined;
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: zone });
    return zone;
  } catch {
    return undefined;
  }
}

/** The local calendar day of an instant string, falling back to its UTC day. */
function localDayOfInstant(instant: string, zone: string | null): string {
  const parsed = new Date(instant);
  return Number.isNaN(parsed.getTime()) ? instant.slice(0, 10) : toLocalDateString(parsed, zone);
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
  options: LookupWithHistoricalOptions = {}
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
  const depTz = depAirportCode ? await getAirportTimezone(depAirportCode) : null;
  if (date && depTz) localDayStr = toLocalDateString(date, depTz);

  // Direction is decided on calendar-day boundaries, not on hours: "tomorrow"
  // / "yesterday" should always count as future / past regardless of how many
  // hours away they are at the moment of the call (the issue-#82 symptom).
  //
  // WHOSE calendar: the departure airport's where it is known, else the
  // asking user's. It used to be UTC, so at 00:30 in Germany a search for
  // "today" was a search for tomorrow — refused as needing a paid provider.
  const todayZone = depTz ?? validTimezone(options.clientTimezone) ?? null;
  const todayStr = toLocalDateString(new Date(), todayZone);
  const requestedStr = localDayStr ?? (date ? date.toISOString().slice(0, 10) : undefined);
  const dayDelta = requestedStr ? dayDiff(requestedStr, todayStr) : 0;

  const isOutsideLiveWindow = dayDelta !== 0;

  // Nothing configured at all: no provider can answer ANY date, including
  // today. Without this gate the cascade ran, found every provider disabled,
  // and returned an ordinary empty result — so a fresh install was told
  // "no flights found, try another date" when nothing had been searched
  // (#232). "Not configured" and "not found" call for opposite actions:
  // add a key in Settings, versus check the number and date. Asked before
  // the date gate below; `providerAvailability.ts` says why.
  const providers = await flightProviderAvailability(userId);
  if (!providers.any) {
    logger.info(
      { operation: "lookup_unavailable_not_configured" },
      "Lookup requested but no flight-data provider is configured"
    );
    return { flights: [], unavailableReason: "not_configured" };
  }
  if (isOutsideLiveWindow && !providers.byDate) {
    logger.info(
      { direction: dayDelta > 0 ? "future" : "past", operation: "lookup_unavailable_no_provider" },
      "Lookup outside live window requested but no provider answers by date"
    );
    return { flights: [], unavailableReason: "no_provider" };
  }

  const dateStr = requestedStr;
  const outcomes = new LookupOutcomeLog();
  const result = await lookupFlightDetails(
    trimmed,
    dateStr,
    userId,
    undefined,
    undefined,
    depAirportCode,
    outcomes
  );

  if (!result) {
    // A provider that failed has not said "no such flight"; reporting its
    // silence as one sends the user to re-check a number that was right.
    const providerFailures = outcomes.failures();
    if (providerFailures.length > 0) {
      logger.warn(
        {
          flightNumber: trimmed,
          date: dateStr,
          providerFailures,
          operation: "lookup_provider_failed",
        },
        `Lookup for ${trimmed} found nothing and ${providerFailures.length} provider(s) failed`
      );
      return { flights: [], unavailableReason: "provider_failed", providerFailures };
    }
    if (isOutsideLiveWindow) {
      return { flights: [], unavailableReason: "no_match_api_gap" };
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
  if (isOutsideLiveWindow && isAdsb(result.source)) {
    return { flights: [], unavailableReason: "no_match_api_gap" };
  }
  if (isOutsideLiveWindow && dateStr && result.departureTime) {
    const returnedCode = result.departure?.iata ?? result.departure?.icao ?? undefined;
    const returnedTz = (await getAirportTimezone(returnedCode)) ?? todayZone;
    const returnedDate = localDayOfInstant(result.departureTime, returnedTz);
    const strictMismatch = Math.abs(dayDiff(dateStr, returnedDate)) > 1;
    const smokingGun = returnedDate === todayStr;

    if (strictMismatch || smokingGun) {
      const operation = "lookup_date_mismatch";
      logger.info(
        { strictMismatch, smokingGun, operation },
        "Provider ignored the requested date; treating as no_match_api_gap"
      );
      logger.debug({ flightNumber: trimmed, requestedDate: dateStr, returnedDate, operation });
      return { flights: [], unavailableReason: "no_match_api_gap" };
    }
  }

  return { flights: [await flightLookupResultToFlightData(result, trimmed)] };
}

// The pure field readers live in `flightLookup/fieldReaders` — see its header.
// Re-exported so every existing importer of this module is untouched.
export { getAirlineName, parseFlightNumber };
