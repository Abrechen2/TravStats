import type { RailImportBooking, RailTravelClass } from "./rail";

/**
 * POST /rail/share-link (forgejo#204) — mirrors
 * `backend/src/services/rail/shareLink`. A failure is an outcome with a
 * reason, never an error, and both outcomes carry what the link itself said.
 */

export const RAIL_SHARE_LINK_FAILURES = [
  "invalidLink",
  "unsupportedLink",
  "blocked",
  "expired",
  "rateLimited",
  "providerError",
  "timeout",
  "unreachable",
  "unreadable",
  "noTrain",
  "noConnectionInLink",
] as const;
export type RailShareLinkFailure = (typeof RAIL_SHARE_LINK_FAILURES)[number];

export interface RailShareLinkFacts {
  departureStationName: string | null;
  arrivalStationName: string | null;
  /** `YYYY-MM-DDTHH:mm`, the departure station's wall clock as the link states it. */
  departureLocal: string | null;
  travelClass: RailTravelClass | null;
}

export type RailShareLinkOutcome =
  | { outcome: "read"; facts: RailShareLinkFacts; booking: RailImportBooking }
  | { outcome: "failed"; reason: RailShareLinkFailure; facts: RailShareLinkFacts };
