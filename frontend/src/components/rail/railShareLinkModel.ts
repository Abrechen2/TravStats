import type { RailShareLinkFacts, RailShareLinkFailure } from "../../types/railShareLink";
import { draftFrom, type RailFormDraft } from "./railFormModel";

/**
 * The rail share-link route's rules (forgejo#204): what a failed link still
 * hands to the manual form, and how the import dialog recognises that
 * hand-over among the other things a route may pass as `prefill`.
 */

const unplaced = (name: string): RailFormDraft["departure"] => ({
  name,
  lat: null,
  lon: null,
  country: null,
  code: null,
  stationId: null,
});

/**
 * The manual form, started from what the link itself said. A station keeps
 * its name and no position — the form asks for the station, as the import
 * review does; a field the link did not carry stays empty.
 */
export function draftFromShareLinkFacts(facts: RailShareLinkFacts): RailFormDraft {
  const empty = draftFrom(null);
  return {
    ...empty,
    departure: facts.departureStationName ? unplaced(facts.departureStationName) : empty.departure,
    arrival: facts.arrivalStationName ? unplaced(facts.arrivalStationName) : empty.arrival,
    departureLocal: facts.departureLocal ?? "",
    travelClass: facts.travelClass ?? "",
  };
}

export function hasShareLinkFacts(facts: RailShareLinkFacts): boolean {
  return (
    facts.departureStationName !== null ||
    facts.arrivalStationName !== null ||
    facts.departureLocal !== null ||
    facts.travelClass !== null
  );
}

/** What the route hands the manual form; tagged, so no other prefill is mistaken for it. */
export interface RailShareLinkPrefill {
  kind: "railShareLink";
  draft: RailFormDraft;
}

export function isRailShareLinkPrefill(value: unknown): value is RailShareLinkPrefill {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { kind?: unknown }).kind === "railShareLink" &&
    typeof (value as { draft?: unknown }).draft === "object"
  );
}

/** Our own server's refusal of the request, as opposed to bahn.de's. */
export type RailShareLinkRequestFailure = "requestRateLimited" | "requestFailed";

export function shareLinkReasonKey(
  reason: RailShareLinkFailure | RailShareLinkRequestFailure
): string {
  return `rail:shareLink.reason.${reason}`;
}
