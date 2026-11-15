/**
 * The Aviationstack step of `lookupFlightDetails`: the gate that protects the
 * Free-tier budget, the (up to two) request attempts and the mapping of an
 * answer. Pulled out of flightLookup.ts; behaviour is unchanged.
 */

import axios from "axios";
import { convertAviationstackTimeToUtc } from "../../utils/timezone";
import { toProviderFlightNumber } from "../../schemas/flight";
import logger from "../../utils/logger";
import {
  isInLiveWindow,
  currentUtcDay,
  hasAviationstackBudget,
  recordAviationstackCall,
  getAviationstackCallCountToday,
  isAviationstackCooledDown,
  markAviationstack429,
  aviationstackCooldownUntil,
  isAviationstackDateFilterRestricted,
  markAviationstackDateFilterRestricted,
} from "./aviationstackBudget";
import { classifyProviderError, type LookupOutcomeLog } from "./providerOutcome";
import { airportWithLive, resolveAirports } from "./providerMapping";
import type { AviationstackApiResponse } from "./providerTypes";
import type { FlightLookupResult } from "../flightLookup";

type AviationstackFlight = NonNullable<AviationstackApiResponse["data"]>[number];

export interface AviationstackGate {
  /** Admin/user key, when configured. */
  key: string | null | undefined;
  /** Departure inside the live window — true when the caller passed no time. */
  inLiveWindow: boolean;
  available: boolean;
  skipReason?: string;
}

/**
 * Aviationstack gating — multiple guards to protect the Free-tier budget:
 *   (1) admin has a key configured
 *   (2) not in 429 cooldown (set when quota actually exceeded)
 *   (3) flight is in the live window (±3h of departure or in flight)
 *   (4) we haven't yet used today's configured budget
 * If the caller didn't pass a departureTime (manual ad-hoc lookup via UI),
 * treat as "live" so on-demand user actions still reach Aviationstack.
 */
export async function resolveAviationstackGate(
  key: string | null | undefined,
  date: string | undefined,
  departureTime: Date | string | null | undefined,
  arrivalTime: Date | string | null | undefined
): Promise<AviationstackGate> {
  const inLiveWindow = departureTime ? isInLiveWindow(departureTime, arrivalTime) : true;
  const budgetOk = key ? await hasAviationstackBudget() : false;
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
  const flyingRightNow = departureTime ? isInLiveWindow(departureTime, arrivalTime) : false;
  const requestedDateIsToday = !date || date === currentUtcDay();
  const dateFilterBlocked =
    isAviationstackDateFilterRestricted() && !requestedDateIsToday && !flyingRightNow;
  const available =
    !!key && !isAviationstackCooledDown() && inLiveWindow && budgetOk && !dateFilterBlocked;

  let skipReason: string | undefined;
  if (key && !available) {
    if (isAviationstackCooledDown()) skipReason = "cooldown";
    else if (!inLiveWindow) skipReason = "outside_live_window";
    else if (!budgetOk) skipReason = "daily_budget_exceeded";
    else if (dateFilterBlocked) skipReason = "date_filter_restricted";
  }
  return { key, inLiveWindow, available, skipReason };
}

/** The "looking up" log pair, kept with the gate's numbers it reports. */
export function logLookupStart(
  flightNumber: string,
  date: string | undefined,
  gate: AviationstackGate,
  hasOpenSky: boolean
): void {
  logger.debug({ flightNumber, date, operation: "lookup_start" });
  logger.info(
    {
      hasAviationstack: !!gate.key,
      aviationstackAvailable: gate.available,
      aviationstackSkipReason: gate.skipReason,
      aviationstackCallsToday: getAviationstackCallCountToday(),
      hasOpenSky,
      operation: "lookup_start",
    },
    `Looking up flight (apis: ${gate.available ? "aviationstack" : ""}${hasOpenSky ? "+opensky" : ""} +airlabs)`
  );
}

function buildParams(
  key: string,
  flightNumber: string,
  date: string | undefined,
  omitDateFilter: boolean
): Record<string, string> {
  // API docs: https://docs.apilayer.com/aviationstack/docs/endpoints#flights
  // Use HTTPS + params to avoid signature/order issues
  const params: Record<string, string> = { access_key: key, limit: "1" };
  // Unpadded IATA form for the same reason as AirLabs (see
  // toProviderFlightNumber) — providers do not carry leading zeros.
  const providerNumber = toProviderFlightNumber(flightNumber) ?? flightNumber;
  if (/^[A-Za-z]{2}\d+/.test(providerNumber)) {
    params.flight_iata = providerNumber;
  } else {
    params.flight_icao = providerNumber;
  }
  if (date && !omitDateFilter) {
    params.flight_date = date;
  }
  return params;
}

/** Local-airport time to UTC, passing the raw value through when unconvertible. */
function toUtc(raw: string | undefined, code: string | undefined) {
  return raw && code ? convertAviationstackTimeToUtc(raw, code) : Promise.resolve(raw || null);
}

async function mapResult(
  result: AviationstackFlight,
  flightNumber: string
): Promise<FlightLookupResult> {
  const departureCode = result.departure?.iata || result.departure?.icao;
  const arrivalCode = result.arrival?.iata || result.arrival?.icao;
  const [departureAirport, arrivalAirport] = await resolveAirports(departureCode, arrivalCode);

  // Convert Aviationstack times from local airport time to UTC
  const [departureTimeUtc, arrivalTimeUtc, actualDepartureUtc, actualArrivalUtc] =
    await Promise.all([
      toUtc(result.departure?.estimated || result.departure?.scheduled, departureCode),
      toUtc(result.arrival?.estimated || result.arrival?.scheduled, arrivalCode),
      toUtc(result.departure?.actual, departureCode),
      toUtc(result.arrival?.actual, arrivalCode),
    ]);

  return {
    source: "aviationstack",
    airline: result.airline?.name,
    // Caller's spelling — see the AirLabs mapping: echoing the
    // provider's unpadded form would auto-rename a stored "EK051".
    flightNumber,
    aircraft: result.aircraft?.icao || result.aircraft?.iata,
    departure: airportWithLive(departureAirport, result.departure ?? {}),
    arrival: airportWithLive(arrivalAirport, result.arrival ?? {}),
    departureTime: departureTimeUtc || undefined,
    arrivalTime: arrivalTimeUtc || undefined,
    actualDeparture: actualDepartureUtc || undefined,
    actualArrival: actualArrivalUtc || undefined,
  };
}

/** A date-less (real-time) query may answer with another service day's flight. */
function discardForeignDay(
  result: AviationstackFlight | undefined,
  flightNumber: string,
  date: string | undefined,
  omitDateFilter: boolean
): AviationstackFlight | undefined {
  if (!(result && date && omitDateFilter && result.flight_date && result.flight_date !== date)) {
    return result;
  }
  const operation = "aviationstack_date_mismatch";
  logger.warn({ operation }, "Aviationstack real-time result is for another day — discarding");
  logger.debug({ flightNumber, date, resultDate: result.flight_date, operation });
  return undefined;
}

type FailureVerdict = "retry-without-date" | "stop";

function handleFailure(
  err: unknown,
  date: string | undefined,
  omitDateFilter: boolean,
  outcomes: LookupOutcomeLog | undefined
): FailureVerdict {
  const errResponse = (
    err as { response?: { status?: number; data?: { error?: { code?: string } } } }
  )?.response;
  const status = errResponse?.status;
  if (status === 429) {
    // Quota exhausted — back off for an hour so we don't burn through the
    // free tier's monthly budget on rapid-fire retries.
    markAviationstack429();
    outcomes?.record("aviationstack", "quota");
    logger.warn({
      operation: "aviationstack_rate_limited",
      message: "Aviationstack returned 429 — backing off for 1 hour",
      context: { cooldownUntil: aviationstackCooldownUntil()?.toISOString() },
    });
    return "stop";
  }
  if (
    status === 403 &&
    errResponse?.data?.error?.code === "function_access_restricted" &&
    !omitDateFilter &&
    date
  ) {
    // The plan rejects the `flight_date` filter (Free tier). Remember it
    // for the process lifetime; retry without the filter when the
    // requested date is today (real-time data still matches). Past or
    // future dates can't be served — fall through to other providers.
    markAviationstackDateFilterRestricted();
    logger.warn(
      { operation: "aviationstack_date_filter_restricted" },
      "Aviationstack plan rejects the flight_date filter — skipping it from now on"
    );
    if (date === currentUtcDay()) return "retry-without-date";
    outcomes?.record("aviationstack", "plan_restricted");
    return "stop";
  }
  logger.error({
    operation: "aviationstack_lookup",
    message: "Aviationstack lookup failed",
    error: err instanceof Error ? err.message : String(err),
  });
  outcomes?.record("aviationstack", classifyProviderError(err));
  return "stop";
}

/**
 * Up to two attempts: the second fires only when the first reveals a
 * Free-tier date-filter restriction on a same-day lookup — the retry
 * drops `flight_date` (real-time queries stay allowed on the Free plan).
 * Null means "fall through to the other providers".
 */
export async function lookupViaAviationstack(
  key: string,
  flightNumber: string,
  date: string | undefined,
  outcomes: LookupOutcomeLog | undefined
): Promise<FlightLookupResult | null> {
  let omitDateFilter = isAviationstackDateFilterRestricted();
  for (let attempt = 0; attempt < 2; attempt++) {
    // Record the call up-front — even failures count against the daily budget,
    // because Aviationstack bills 429s too in the Free tier.
    recordAviationstackCall();
    const params = buildParams(key, flightNumber, date, omitDateFilter);
    try {
      const response = await axios.get("https://api.aviationstack.com/v1/flights", {
        params,
        timeout: 6000,
      });
      const json = response.data as AviationstackApiResponse;
      const result = discardForeignDay(json.data?.[0], flightNumber, date, omitDateFilter);
      outcomes?.record("aviationstack", result ? "ok" : "no_match");
      if (result) return await mapResult(result, flightNumber);
      return null; // no usable result — fall through to the other providers
    } catch (err) {
      if (handleFailure(err, date, omitDateFilter, outcomes) === "retry-without-date") {
        omitDateFilter = true;
        continue;
      }
      return null;
    }
  }
  return null;
}
