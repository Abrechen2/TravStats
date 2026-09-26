import { TRIP_PLAUSIBLE_KM } from "../../shared/tripSuggestionRules";
import { absencesFromClusters, buildAbsences, glueByFlightClusters } from "./absences";
import { placeVisitProposals } from "./placeVisits";
import {
  proposalsByWindow,
  proposalsFromAbsences,
  withoutAnswered,
  type AnsweredProposal,
} from "./proposals";
import type {
  HomeAt,
  PlaceContext,
  PresenceEntry,
  SuggestionSignal,
  TripContext,
  TripSuggestion,
} from "./types";

/** The flight heuristics' journeys, as the engine consumes them. */
export interface FlightCluster {
  source: SuggestionSignal;
  flightKeys: readonly string[];
}

export interface ComposeInput {
  entries: readonly PresenceEntry[];
  trips: readonly TripContext[];
  places: readonly PlaceContext[];
  homeAt: HomeAt;
  /** False when no home is known for any day — see `absencesFromClusters`. */
  homeKnown: boolean;
  clusters: readonly FlightCluster[];
  answered: readonly AnsweredProposal[];
}

/**
 * Every proposal the logbook supports, newest first, minus what the user has
 * already answered. Pure: the same input always gives the same list, which is
 * what makes a proposal's id stable enough to accept by.
 */
export function composeSuggestions(input: ComposeInput): TripSuggestion[] {
  const { entries, trips, places, homeAt, homeKnown, clusters, answered } = input;

  const absences = homeKnown
    ? glueByFlightClusters(buildAbsences(entries, homeAt), clusters, homeAt)
    : absencesFromClusters(entries, clusters, TRIP_PLAUSIBLE_KM);

  const placed = new Set(absences.flatMap((a) => a.entries.map((e) => e.key)));
  // Only entries no home could judge go to the window rule. One that is AT
  // home is not part of any trip, whatever its dates.
  const unplaced = entries.filter(
    (e) => !placed.has(e.key) && e.points.every((p) => homeAt(p.day) === null)
  );

  const proposals = [
    ...proposalsFromAbsences(absences, trips, entries, homeAt),
    ...proposalsByWindow(unplaced, trips, entries, homeAt),
    ...placeVisitProposals(entries, places),
  ];
  return withoutAnswered(proposals, answered).sort(
    (a, b) => b.startDay.localeCompare(a.startDay) || a.id.localeCompare(b.id)
  );
}
