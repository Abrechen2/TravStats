/**
 * Single source of truth for "how did this trip MOVE" (forgejo#265) — the
 * cross-domain badges ask it per trip: three modes on one trip, arriving by
 * train or coach and discovering a place, and the fully documented trip.
 *
 * A mode counts only through an entry EXPLICITLY on the trip that really
 * happened, by its domain's own counting rule:
 *  - flight and cruise: `flown` / `historical` (`flightCounting`,
 *    `cruiseCounting`);
 *  - rail and bus: `completed` (`railCounting`, `busCounting`);
 *  - roadtrip: a roadtrip route on the trip that has started — a planned one
 *    has moved nobody (`roadtripEvidence.roadtripHasStarted`'s cut).
 * A rental is NOT a mode: a contract is no movement, and the car's driving is
 * the roadtrip it was driven on, which counts as that roadtrip once (issue:
 * "Mietvertrag allein ist keine zusätzliche Fahrt"). Day tours are not
 * travel between places and stay out too.
 *
 * Which domains may contribute is the caller's `counts` predicate: the badges
 * pass "everything but a beta domain that is switched off", so a shared badge
 * is never earned by a domain hidden behind the beta switch, while a domain
 * the user merely turned off keeps counting as it always did (the fully
 * documented trip counted cruises before any switch existed).
 *
 * Backend only.
 */

import { isCountableFlight } from "./flightCounting";
import { isCountableCruiseStatus } from "./cruiseCounting";
import { isCountableRail } from "./railCounting";
import { isCountableBus } from "./busCounting";
import type { DomainKey } from "./domains";

/** May this domain's entries count? */
export type DomainCounts = (domain: DomainKey) => boolean;

export type MovementMode = "flight" | "cruise" | "rail" | "bus" | "roadtrip";

export interface TripMovementInput {
  flights: { status: string }[];
  cruises: { status: string }[];
  railJourneys: { status: string }[];
  busJourneys: { status: string }[];
  /** Roadtrip routes on the trip that have STARTED — the caller applies the cut. */
  startedRoadtrips: number;
}

/** The modes the trip really moved by, among the domains that may count. */
export function tripMovementModes(
  trip: TripMovementInput,
  counts: DomainCounts
): Set<MovementMode> {
  const modes = new Set<MovementMode>();
  if (counts("flight") && trip.flights.some((f) => isCountableFlight(f))) modes.add("flight");
  if (counts("cruise") && trip.cruises.some((c) => isCountableCruiseStatus(c.status))) {
    modes.add("cruise");
  }
  if (counts("rail") && trip.railJourneys.some(isCountableRail)) modes.add("rail");
  if (counts("bus") && trip.busJourneys.some(isCountableBus)) modes.add("bus");
  if (counts("roadtrip") && trip.startedRoadtrips > 0) modes.add("roadtrip");
  return modes;
}

/** Arrived by train or coach — the ground modes "Ankommen und entdecken" asks for. */
export function arrivedOverland(modes: ReadonlySet<MovementMode>): boolean {
  return modes.has("rail") || modes.has("bus");
}
