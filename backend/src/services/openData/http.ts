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
 * The upstream service did not answer (network, timeout, 5xx, 429, not
 * JSON). Distinct from "it answered: there is nothing" — an endpoint turns it
 * into `unavailable: true`, so a card can say the service is unreachable
 * instead of silently not appearing, and a service does not cache it.
 */
export class OpenDataUnavailableError extends Error {
  constructor(public readonly service: string) {
    super(`Open data service unavailable: ${service}`);
    this.name = "OpenDataUnavailableError";
  }
}

/**
 * Why a service did not answer usefully (2026-09-26). The callers that face a
 * user need it: "the service is overloaded" and "the service answered that
 * there is nothing" used to be the same null, and the UI turned both into
 * "nothing found" — an Overpass timeout read "OpenStreetMap does not know this
 * house", an Open-Meteo 429 deleted a journal entry's stored weather.
 */
export type OpenDataFailure = "timeout" | "rateLimited" | "unavailable";

/**
 * One result shape for every open data call. `status` is the HTTP status of a
 * non-2xx answer, null when there was no HTTP answer at all (network, timeout,
 * not JSON) — Wikipedia needs it to tell a 404 ("no article") from an outage.
 */
export type OpenDataResult =
  { ok: true; body: unknown } | { ok: false; failure: OpenDataFailure; status: number | null };

function failureOfStatus(status: number): OpenDataFailure {
  return status === 429 ? "rateLimited" : status === 504 ? "timeout" : "unavailable";
}

function failureOfError(error: unknown): OpenDataFailure {
  const name = error instanceof Error ? error.name : "";
  return name === "TimeoutError" || name === "AbortError" ? "timeout" : "unavailable";
}

/**
 * GET (or POST a form body) and parse JSON, saying why when it did not work —
 * a network error or a body that is not JSON is `unavailable`, a timeout
 * `timeout`, a 429 `rateLimited`. Logged with the service name either way.
 */
export async function fetchOpenData(
  service: string,
  url: string,
  init: { form?: Record<string, string>; timeoutMs?: number } = {}
): Promise<OpenDataResult> {
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
      return { ok: false, failure: failureOfStatus(response.status), status: response.status };
    }
    return { ok: true, body: (await response.json()) as unknown };
  } catch (error) {
    logger.warn({
      operation: "open_data_request",
      service,
      error: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, failure: failureOfError(error), status: null };
  }
}

/**
 * The body, or null on any failure. For callers whose answer is an optional
 * extra (a Wikipedia summary) where "could not ask" and "nothing there" lead
 * to the same screen. A caller that stores, or tells the user "not found",
 * uses `fetchOpenData` and keeps the reason.
 */
export async function fetchOpenDataJson(
  service: string,
  url: string,
  init: { form?: Record<string, string>; timeoutMs?: number } = {}
): Promise<unknown> {
  const result = await fetchOpenData(service, url, init);
  return result.ok ? result.body : null;
}
