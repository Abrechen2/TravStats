import { airportsApi } from "./api/airports";
import type { Airport } from "./api/types";
import { apiErrorMachineCode } from "./apiError";

/**
 * Resolve an airport code (IATA or ICAO) the way the autocomplete does.
 *
 * Two places used to do this differently and silently: the review dialog
 * searched the text index and accepted only an exact IATA hit — so an ICAO
 * code, or a code the search ranked past its first page, came back "not
 * found" although `getByCode` knows it — and the flight form swallowed a
 * failed `getByCode` and left the field empty with no word. The three
 * outcomes are kept apart because they ask for different things: a missing
 * code needs a manual pick, a failed load needs a retry.
 */
export type AirportResolution =
  | { kind: "found"; airport: Airport }
  | { kind: "missing"; code: string }
  | { kind: "failed"; code: string; reason?: AirportLookupReason };

/** Why the server's online airport lookup was unavailable (503 body `reason`). */
export type AirportLookupReason = "timeout" | "network" | "http_error" | "unknown";

const LOOKUP_REASONS: ReadonlySet<string> = new Set(["timeout", "network", "http_error"]);

/**
 * The reason carried by a 503 `AIRPORT_LOOKUP_UNAVAILABLE`, or null for any
 * other error. A reason the client does not know reads as "unknown", so a
 * newer server cannot put a raw token on screen.
 */
export function airportLookupUnavailableReason(err: unknown): AirportLookupReason | null {
  if (apiErrorMachineCode(err) !== "AIRPORT_LOOKUP_UNAVAILABLE") return null;
  const reason = (err as { response?: { data?: { reason?: unknown } } }).response?.data?.reason;
  return typeof reason === "string" && LOOKUP_REASONS.has(reason)
    ? (reason as AirportLookupReason)
    : "unknown";
}

export async function resolveAirportByCode(code: string): Promise<AirportResolution> {
  const normalized = code.trim().toUpperCase();
  try {
    return { kind: "found", airport: await airportsApi.getByCode(normalized) };
  } catch (err) {
    const status = (err as { response?: { status?: number } } | undefined)?.response?.status;
    if (status === 404) return { kind: "missing", code: normalized };
    const reason = airportLookupUnavailableReason(err);
    return reason
      ? { kind: "failed", code: normalized, reason }
      : { kind: "failed", code: normalized };
  }
}

/** The i18n key and params that explain an unresolved code to the user. */
export function airportResolutionMessage(
  resolution: Exclude<AirportResolution, { kind: "found" }>
): { key: string; params: { code: string } } {
  const key =
    resolution.kind === "missing"
      ? "errors:airportNotInCatalogue"
      : resolution.reason
        ? `errors:airportLookupUnavailable.${resolution.reason}`
        : "errors:airportLoadFailedCode";
  return {
    key,
    params: { code: resolution.code },
  };
}
