import { TRIP_PLAUSIBLE_KM } from "../../shared/tripSuggestionRules";
import {
  absencesFromClusters,
  buildAbsences,
  glueByFlightClusters,
  mergeOverlapping,
} from "./absences";
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
  /** The rejection memory's clock (v2); absent, only the span-and-double rule applies. */
  memory?: { today: string; quietDays: number };
}

/**
 * One package booking is one trip: entries a booking sold together (flight,
 * hotel, transfer) are glued like a flight cluster, whatever lies between them.
 */
export function packageClusters(entries: readonly PresenceEntry[]): FlightCluster[] {
  const byBooking = new Map<string, string[]>();
  for (const e of entries) {
    if (!e.bookingId) continue;
    byBooking.set(e.bookingId, [...(byBooking.get(e.bookingId) ?? []), e.key]);
  }
  return [...byBooking.values()]
    .filter((keys) => keys.length > 1)
    .map((keys) => ({ source: "package" as const, flightKeys: keys }));
}

/**
 * Every proposal the logbook supports, newest first, minus what the user has
 * already answered. Pure: the same input always gives the same list, which is
 * what makes a proposal's id stable enough to accept by.
 */
export function composeSuggestions(input: ComposeInput): TripSuggestion[] {
  const { entries, trips, places, homeAt, homeKnown, clusters, answered, memory } = input;

  const absences = homeKnown
    ? mergeOverlapping(
        glueByFlightClusters(
          buildAbsences(entries, homeAt),
          [...clusters, ...packageClusters(entries)],
          homeAt
        ),
        homeAt
      )
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
    ...placeVisitProposals(entries, places, answered),
  ];
  const context = memory
    ? { ...memory, homeAt, entries }
    : { today: "9999-12-31", quietDays: 0, homeAt, entries };
  return withoutAnswered(proposals, answered, context).sort(
    (a, b) => b.startDay.localeCompare(a.startDay) || a.id.localeCompare(b.id)
  );
}
