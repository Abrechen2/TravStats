import logger from "../../utils/logger";
import { getInstanceSettings } from "../instanceSettingsService";

/**
 * Shared plumbing for the open data services (Open-Meteo, Wikipedia/Wikidata,
 * OpenStreetMap). Each of them asks for a descriptive User-Agent, and none of
 * them may hold a request of ours open for long: every call here abstains on
 * a timeout or a bad answer rather than failing the request that wanted it.
 */

/** Same identity the geocoders already send (services/geo/nominatim.ts). */
export const OPEN_DATA_USER_AGENT =
  "TravStats/2.0 (self-hosted travel logbook; +https://travstats.de)";

export const OPEN_DATA_TIMEOUT_MS = 8_000;

/** Whether the instance admin allowed these calls at all (off by default). */
export async function isOpenDataEnabled(): Promise<boolean> {
  const { openDataEnabled } = await getInstanceSettings();
  return openDataEnabled;
}

/** Thrown by an endpoint when the switch is off; answered as 409 `openDataDisabled`. */
export class OpenDataDisabledError extends Error {
  constructor() {
    super("Open data services are switched off on this instance");
    this.name = "OpenDataDisabledError";
  }
}

export async function assertOpenDataEnabled(): Promise<void> {
  if (!(await isOpenDataEnabled())) throw new OpenDataDisabledError();
}

/**
 * GET (or POST a form body) and parse JSON. Null on any failure — a network
 * error, a timeout, a non-2xx answer or a body that is not JSON — logged with
 * the service name so a quiet abstention can still be traced.
 */
export async function fetchOpenDataJson(
  service: string,
  url: string,
  init: { form?: Record<string, string>; timeoutMs?: number } = {}
): Promise<unknown> {
  try {
    const response = await fetch(url, {
      method: init.form ? "POST" : "GET",
      headers: {
        "User-Agent": OPEN_DATA_USER_AGENT,
        Accept: "application/json",
        ...(init.form ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
      },
      ...(init.form ? { body: new URLSearchParams(init.form).toString() } : {}),
      signal: AbortSignal.timeout(init.timeoutMs ?? OPEN_DATA_TIMEOUT_MS),
    });
    if (!response.ok) {
      logger.warn({ operation: "open_data_request", service, status: response.status });
      return null;
    }
    return (await response.json()) as unknown;
  } catch (error) {
    logger.warn({
      operation: "open_data_request",
      service,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
