/**
 * One arc of the flight network, in detail (forgejo#132 item 9).
 *
 * The globe's route sheet wants the flights behind an arc, the airlines that
 * flew it, how long it takes and when it was last flown. `/stats/network`
 * deliberately carries none of that — it returns EVERY airport and EVERY pair,
 * unbounded, because a truncated globe is a wrong globe (see `./network.ts`).
 * Adding per-route flight lists there would make the one unbounded endpoint
 * grow with the whole flight history on every globe open. So the facts live
 * here, one route per request, with the flight list paged: the payload is
 * bounded by the page size, and a sheet only pays for the arc it opened.
 *
 * ONE PAIRING RULE. A flight belongs to this route exactly when
 * `flightRoutePair` — the function `buildFlightNetwork` counts with — files it
 * under this pair, so `count` here is the number on the arc.
 */

import type { AirlineResolvers } from "../../shared/airlineNormalize";
import { groupAirlines } from "../../shared/airlineNormalize";
import {
  addFlightDuration,
  averageDurationMinutes,
  emptyDurationTotals,
  measureFlightMinutes,
} from "../../shared/flightDuration";
import type { NetworkRouteDetail, NetworkRouteFlight } from "../../schemas/statsNetworkRoute";
import { localWallClockOf, type FlightTimeSemantics } from "../../utils/timezone";
import { flightRoutePair, type AirportCatalogue, type RoutePairFlight } from "./network";

const FLOWN = new Set(["flown", "historical"]);

/** The columns the derivation reads. `depTimezone` comes from `withDepartureClock`. */
export interface NetworkRouteRow extends RoutePairFlight {
  id: string;
  flightNumber: string | null;
  airline: string | null;
  airlineIata: string | null;
  airlineIcao: string | null;
  departureTime: Date | null;
  arrivalTime: Date | null;
  depTimeSemantics: FlightTimeSemantics;
  depTimezone: string | null;
  status: string;
}

/**
 * @param a/b the pair, in either order — the answer is the same route
 * @returns null when no counted flight is on the pair: the route's 404
 */
export function buildNetworkRouteDetail(
  rows: readonly NetworkRouteRow[],
  a: string,
  b: string,
  catalogue: AirportCatalogue,
  resolvers: AirlineResolvers,
  page: { offset: number; limit: number }
): NetworkRouteDetail | null {
  const [lo, hi] = a < b ? [a, b] : [b, a];
  if (lo === hi) return null;

  const onRoute = rows.filter((row) => {
    if (!FLOWN.has(row.status)) return false;
    const pair = flightRoutePair(row, catalogue);
    return pair !== null && pair.a === lo && pair.b === hi;
  });
  if (onRoute.length === 0) return null;

  const dated = onRoute.map((row) => ({
    row,
    local: row.departureTime
      ? localWallClockOf(row.departureTime, row.depTimezone, row.depTimeSemantics)
      : null,
  }));

  const { groups, withoutAirline } = groupAirlines(
    onRoute.map((row) => ({ ...row, count: 1 })),
    resolvers
  );

  const totals = onRoute.reduce(
    (acc, row) =>
      addFlightDuration(acc, {
        measuredMinutes: measureFlightMinutes(row),
        depLat: row.depLat,
        depLon: row.depLon,
        arrLat: row.arrLat,
        arrLon: row.arrLon,
      }),
    emptyDurationTotals()
  );
  const average = averageDurationMinutes(totals);

  const years = dated.flatMap((d) => (d.local ? [d.local.year] : []));

  // Newest first by the stored instant, id as the tie-break so a page boundary
  // can never drop or repeat a flight; undated flights last.
  const ordered = [...dated].sort((x, y) => {
    const tx = x.row.departureTime?.getTime() ?? -Infinity;
    const ty = y.row.departureTime?.getTime() ?? -Infinity;
    if (tx !== ty) return ty - tx;
    return x.row.id < y.row.id ? -1 : x.row.id > y.row.id ? 1 : 0;
  });
  const flights: NetworkRouteFlight[] = ordered
    .slice(page.offset, page.offset + page.limit)
    .map(({ row, local }) => ({
      id: row.id,
      flightNumber: row.flightNumber,
      airline: row.airline,
      airlineIata: row.airlineIata,
      depIata: row.depIata,
      arrIata: row.arrIata,
      date: local ? local.date : null,
      status: row.status,
    }));

  return {
    aIata: lo,
    bIata: hi,
    count: onRoute.length,
    airlines: groups.map((g) => ({ key: g.key, label: g.label, iata: g.iata, count: g.count })),
    airlineCount: groups.length,
    flightsWithoutAirline: withoutAirline,
    duration: {
      averageMinutes: average === null ? null : Math.round(average),
      measuredFlights: totals.measuredCount,
      estimatedFlights: totals.estimatedCount,
    },
    lastYear: years.length > 0 ? Math.max(...years) : null,
    flights,
    returned: flights.length,
    page,
  };
}
