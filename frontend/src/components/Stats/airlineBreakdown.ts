import type { Flight } from "../../types";
import { airlineGroupKey, groupAirlines } from "../../shared/airlineNormalize";
import type { AirlineResolvers } from "../../shared/airlineNormalize";

/**
 * The statistics page's airline fold, extracted from `AdvancedStatsPage.tsx`
 * so that its IDENTITY can be tested — which is the whole point of the fix
 * it carries.
 *
 * The page keyed its accumulator by `group.label`. `groupAirlines` keys by
 * `group.key`, the carrier's IATA code where one is resolvable and a
 * normalised name only where none is, and two different codes can share a
 * label: a regional subsidiary carrying the parent's catalogue name, two
 * carriers whose only stored spelling is identical. Those two rows collapsed
 * into one in the tile while the server's `airlineCount` resolver — which
 * folds by `airlineGroupKey` — kept them apart, so the count on screen was
 * one lower than the number the evidence panel measured, and the panel
 * announced "this figure has since been recomputed" with nothing whatsoever
 * having changed.
 *
 * The label therefore travels as DATA on the row rather than as its key.
 */
export interface AirlineBreakdownRow {
  /** What the list prints. Not an identity — two rows may share one. */
  label: string;
  count: number;
  /** Hours, summed by the caller's own duration rule. */
  totalDuration: number;
  flights: Flight[];
}

export interface AirlineBreakdown {
  /** Keyed by the group KEY — see the note above on why never by the label. */
  byGroupKey: Record<string, AirlineBreakdownRow>;
  /**
   * Counted flights naming no airline at all. Returned from here rather than
   * left to a second `groupAirlines` call at the caller: the page ran the
   * whole fold twice per render, once for this number and once for the rows,
   * and two folds of one rule are two chances for them to answer differently.
   */
  withoutAirline: number;
}

export function buildAirlineBreakdown(
  flights: Flight[],
  resolvers: AirlineResolvers,
  durationHours: (flight: Flight) => number
): AirlineBreakdown {
  const { groups, withoutAirline } = groupAirlines(
    flights.map((f) => ({ ...f, count: 1 })),
    resolvers
  );
  const byGroupKey = groups.reduce<Record<string, AirlineBreakdownRow>>((acc, group) => {
    const members = flights.filter((f) => airlineGroupKey(f, resolvers) === group.key);
    acc[group.key] = {
      label: group.label,
      count: group.count,
      totalDuration: members.reduce((sum, f) => sum + durationHours(f), 0),
      flights: members,
    };
    return acc;
  }, {});
  return { byGroupKey, withoutAirline };
}
