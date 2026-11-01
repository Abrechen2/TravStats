import type { LookupOutcome } from "../../../lib/flightLookupBatch";
import type { Flight } from "../../../types";

export const REFRESH_FIELDS = ["aircraft", "aircraftRegistration", "aircraftModeS"] as const;
export type RefreshField = (typeof REFRESH_FIELDS)[number];

/** What a provider hit may carry of the fields a refresh fills. */
export type LookupAircraft = Partial<Record<RefreshField, string | null>>;

export type RefreshPlan =
  | { kind: "fill"; patch: Partial<Record<RefreshField, string>> }
  | { kind: "nothingNew" }
  | { kind: "ambiguous" };

const blank = (value: unknown): boolean => typeof value !== "string" || value.trim() === "";

/**
 * What a provider answer would add to a flight: only the fields that are EMPTY
 * on the flight and non-empty in the answer. Two or more hits for the day are
 * ambiguous (a codeshare, a repeated number) — nothing is guessed from them.
 */
export function planRefresh(
  flight: Pick<Flight, RefreshField>,
  outcome: Extract<LookupOutcome<LookupAircraft>, { status: "found" }>
): RefreshPlan {
  if (outcome.flights.length > 1) return { kind: "ambiguous" };
  const hit = outcome.flights[0] ?? {};
  const patch: Partial<Record<RefreshField, string>> = {};
  for (const field of REFRESH_FIELDS) {
    const offered = hit[field];
    if (blank(flight[field]) && typeof offered === "string" && offered.trim() !== "") {
      patch[field] = offered.trim();
    }
  }
  return Object.keys(patch).length > 0 ? { kind: "fill", patch } : { kind: "nothingNew" };
}
