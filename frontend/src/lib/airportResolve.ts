import { airportsApi } from "./api/airports";
import type { Airport } from "./api/types";

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
  | { kind: "failed"; code: string };

export async function resolveAirportByCode(code: string): Promise<AirportResolution> {
  const normalized = code.trim().toUpperCase();
  try {
    return { kind: "found", airport: await airportsApi.getByCode(normalized) };
  } catch (err) {
    const status = (err as { response?: { status?: number } } | undefined)?.response?.status;
    return status === 404
      ? { kind: "missing", code: normalized }
      : { kind: "failed", code: normalized };
  }
}

/** The i18n key and params that explain an unresolved code to the user. */
export function airportResolutionMessage(
  resolution: Exclude<AirportResolution, { kind: "found" }>
): { key: string; params: { code: string } } {
  return {
    key:
      resolution.kind === "missing"
        ? "errors:airportNotInCatalogue"
        : "errors:airportLoadFailedCode",
    params: { code: resolution.code },
  };
}
