/**
 * Where the ADS-B community providers sit in the flight-lookup chain (forgejo#408).
 *
 * After AirLabs, before OpenSky; ADS-B Exchange before adsb.lol; **today only**.
 * They answer "which aircraft is flying this callsign right now", so they fill
 * the aircraft (registration, type, ICAO24) and never overwrite what another
 * provider supplied. They are never consulted for a date, and
 * `flightProviderAvailability().byDate` does not count them.
 *
 * Lives outside `flightLookup.ts` because that file is frozen by the file-size
 * ratchet.
 */

import { resolveAirlineCodes } from "../../utils/airlineNormalize";
import logger from "../../utils/logger";
import type { OpenSkyCredentials } from "../apiKeyResolver";
import type { FlightLookupResult } from "../flightLookup";
import { parseFlightNumber } from "./fieldReaders";
import { getOpenSkyAuthHeaders, lookupOpenSkyFlight } from "./openSky";
import type { LookupOutcomeLog } from "./providerOutcome";
import { lookupAdsbV2, resolveAdsbEndpoints, type AdsbAircraft, type AdsbProvider } from "./adsbV2";

/** The live window these providers cover: no date at all, or today (UTC day). */
export function isLiveLookupDate(date?: string): boolean {
  return !date || date.slice(0, 10) === new Date().toISOString().slice(0, 10);
}

/** "LH400" → "DLH400" (what a transponder sends); "DLH400" stays; unknown airline → null. */
export function toIcaoCallsign(flightNumber: string): string | null {
  const { airlineCode, flightNum } = parseFlightNumber(flightNumber.trim().toUpperCase());
  if (!airlineCode || !flightNum) return null;
  const icao = airlineCode.length === 3 ? airlineCode : resolveAirlineCodes(airlineCode)?.icao;
  return icao ? `${icao}${flightNum}` : null;
}

function toLookupResult(provider: AdsbProvider, aircraft: AdsbAircraft): FlightLookupResult {
  return {
    source: provider,
    ...(aircraft.registration ? { aircraftRegistration: aircraft.registration } : {}),
    ...(aircraft.aircraftType ? { aircraft: aircraft.aircraftType } : {}),
    ...(aircraft.icao24 ? { aircraftModeS: aircraft.icao24 } : {}),
    ...(aircraft.callsign ? { callsign: aircraft.callsign } : {}),
  };
}

/**
 * Ask the enabled ADS-B providers, in order, about a flight in the air now.
 * Returns the first hit (only aircraft fields set), or null. Each provider's
 * answer, failures included, goes into `outcomes`; a lookup that is not for
 * today, or that has no provider enabled, makes no request at all.
 */
export async function lookupAdsbIfToday(
  flightNumber: string,
  date: string | undefined,
  userId: string | undefined,
  outcomes?: LookupOutcomeLog
): Promise<FlightLookupResult | null> {
  if (!isLiveLookupDate(date)) return null;
  const callsign = toIcaoCallsign(flightNumber);
  if (!callsign) return null;

  const endpoints = await resolveAdsbEndpoints(userId);
  for (const endpoint of endpoints) {
    const answer = await lookupAdsbV2(endpoint, { kind: "callsign", value: callsign });
    if (answer.status === "disabled") continue;
    if (answer.status === "failed") {
      outcomes?.record(answer.provider, answer.reason);
      continue;
    }
    outcomes?.record(answer.provider, answer.status);
    if (answer.status === "ok") return toLookupResult(answer.provider, answer.aircraft);
  }
  return null;
}

export const isAdsb = (source?: string): boolean => source === "adsbx" || source === "adsblol";

const FILLED_FIELDS = ["aircraftRegistration", "aircraft", "aircraftModeS", "callsign"] as const;

/** `base` with the aircraft fields it lacks taken from `adsb`. Never overwrites. */
export function fillFromAdsb(
  base: FlightLookupResult,
  adsb: FlightLookupResult | null
): FlightLookupResult {
  if (!adsb) return base;
  const filled: FlightLookupResult = { ...base };
  for (const field of FILLED_FIELDS) {
    if (!filled[field] && adsb[field]) filled[field] = adsb[field];
  }
  return filled;
}

/**
 * The end of the chain when AirLabs found nothing: OpenSky (where credentials
 * exist), enriched by an ADS-B hit; otherwise the ADS-B hit alone, which carries
 * the aircraft but no route.
 */
export async function lookupAfterMiss(
  flightNumber: string,
  date: string | undefined,
  openSkyCredentials: OpenSkyCredentials | null,
  adsb: FlightLookupResult | null,
  outcomes?: LookupOutcomeLog
): Promise<FlightLookupResult | null> {
  if (openSkyCredentials) {
    logger.info({ api: "opensky", operation: "fallback_opensky" }, "Falling back to OpenSky");
    const openSkyAuth = await getOpenSkyAuthHeaders(openSkyCredentials);
    const openSky = await lookupOpenSkyFlight(
      flightNumber,
      date,
      openSkyAuth ?? undefined,
      outcomes
    );
    if (openSky) return fillFromAdsb({ ...openSky, source: "opensky" }, adsb);
  }
  if (adsb) return adsb;
  logger.info({ operation: "lookup_no_result" }, "No data found from any API");
  return null;
}
