/**
 * The loyalty ranking — carriers by flight count.
 *
 * Extracted for forgejo#49 so `GET /stats/airlines` and the composed
 * `GET /stats/page` share one definition. The interesting part is that both can:
 * the endpoint reaches the answer through `count` + `groupBy(airline,
 * airlineIata, airlineIcao)`, the composed route through the rows it already
 * holds, and the two cannot disagree — `groupAirlines` takes a per-row count,
 * adds it, weights the label by that count, and sorts on `count` desc then
 * `label` asc. A group of three rows and one aggregate row of count 3 fold to
 * the same group, and the order is total.
 *
 * So this function takes counted identities, and each caller says what one
 * "row" is: a database group for the endpoint, a single flight for the page.
 */

import { groupAirlines, type AirlineIdentity } from "../../shared/airlineNormalize";
import { airlineResolvers } from "../../utils/airlineNormalize";
import type { AirlineRankingItem, AirlineRankingResponse } from "../../schemas/statsFlights";

/** One carrier identity, carrying how many flights it stands for. */
export type CountedAirlineIdentity = AirlineIdentity & { count: number };

/**
 * `total` is the countable flight count BEFORE the nameless rows are removed —
 * the endpoint reads it from `prisma.flight.count`, the composed route from
 * `rows.length`.
 */
export function computeAirlineRanking(
  identities: ReadonlyArray<CountedAirlineIdentity>,
  total: number
): AirlineRankingResponse {
  // Same airline = same CODE, not same spelling (forgejo#81): "SWISS" and
  // "Swiss" are one carrier once either row's code is known, and the
  // catalogue names the group. The rule lives in shared/airlineNormalize.ts
  // and every client surface uses the same one.
  // A row without an airline is NOT an airline. It used to be folded in
  // under the label "Unknown", which could top the loyalty ranking on an
  // account with many imported rows — and it sat in the percentage
  // denominator too, quietly diluting every real airline's share. Such rows
  // are excluded from both, and reported separately so the ranking can say
  // what it is silent about.
  const { groups, withoutAirline: flightsWithoutAirline } = groupAirlines(
    identities,
    airlineResolvers
  );
  const attributedTotal = total - flightsWithoutAirline;

  const airlines: AirlineRankingItem[] = groups.map((g) => ({
    airline: g.label,
    count: g.count,
    percentage: attributedTotal > 0 ? Math.round((g.count / attributedTotal) * 1000) / 10 : 0,
    key: g.key, // Canonical identity, always present; evidence addresses this row by it.
    ...(g.iata ? { iata: g.iata } : {}),
  }));

  return { airlines, total: attributedTotal, flightsWithoutAirline };
}
