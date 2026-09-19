/**
 * The ONE countable-flight load that `GET /stats/page` composes from
 * (forgejo#49).
 *
 * Measured on the rebuilt statistics page (2026-09-19, a `prisma.$use` spy
 * counting queries against the `Flight` model): the flight tab performed
 * **fifteen** `findMany` passes over the flight table for one page load, and
 * **thirteen** of them read the identical population —
 * `{ userId, status in (flown, historical) }`, the whole history, no date
 * range. Eleven of those requests are answerable from one load:
 *
 *   /stats/fun, /stats/unique, /stats/airports  — the SAME 21-column select
 *   /stats/business                             — those 21 plus five cost
 *                                                 columns and the booking
 *   /stats/seats, /stats/countries              — strict subsets
 *   /stats/airlines, /stats/aircraft-types      — count + groupBy over the
 *                                                 same rows
 *   /stats/aircraft                             — the same rows narrowed to
 *                                                 `aircraftRegistration != null`
 *   /stats/punctuality                          — narrowed to `delayMinutes != null`
 *
 * So the select below is the UNION of those projections, and the two narrowed
 * populations are taken as JS filters over the loaded rows rather than as two
 * more queries. A section that needs a column not listed here adds it here —
 * never a second query, which is the whole point.
 *
 * The population is the widest of the eleven. That is only sound because the
 * two narrowing predicates are subsets: were one of them to widen — a
 * `status` a section wanted that `countableFlightWhere` excludes — it would
 * need its own load and its own scan, and saying so would be better than
 * quietly serving a different population under the same section name.
 */

import { Prisma } from "../../prisma";

import { prisma } from "../../db";
import { countableFlightWhere } from "../../shared/flightCounting";
import { withDepartureClock } from "./departureClock";
import type { FlightTimeSemantics } from "../../utils/timezone";

/**
 * The select every composed section reads from. Written out rather than
 * assembled from the per-endpoint selects, because a section's projection is
 * something a reader of this file should be able to check against the endpoint
 * it mirrors without following four imports.
 */
const pageRowSelect = {
  id: true,
  depLat: true,
  depLon: true,
  arrLat: true,
  arrLon: true,
  depIata: true,
  depIcao: true,
  arrIata: true,
  arrIcao: true,
  airline: true,
  // `/stats/airlines` groups on the CODE, not the spelling (forgejo#81), so
  // both code columns travel even though no other section reads them.
  airlineIata: true,
  airlineIcao: true,
  aircraft: true,
  aircraftRegistration: true,
  departureTime: true,
  arrivalTime: true,
  depTimeSemantics: true,
  status: true,
  price: true,
  taxes: true,
  fees: true,
  currency: true,
  priceBase: true,
  fxBaseCurrency: true,
  category: true,
  seatClass: true,
  seatNumber: true,
  delayMinutes: true,
  createdAt: true,
  bookingId: true,
  booking: {
    select: {
      id: true,
      price: true,
      currency: true,
      priceBase: true,
      fxBaseCurrency: true,
    },
  },
} satisfies Prisma.FlightSelect;

/** One countable flight, with every column the composed sections need. */
export type StatsPageRow = Prisma.FlightGetPayload<{ select: typeof pageRowSelect }>;

/** A row that also carries its departure airport's clock — see `departureClock.ts`. */
export type StatsPageRowWithClock = StatsPageRow & {
  depTimezone: string | null;
  depTimeSemantics: FlightTimeSemantics;
};

/**
 * Load the user's countable flights once, with the departure clock already
 * attached.
 *
 * All-time and unfiltered, deliberately: four of the eleven endpoints this
 * serves (`/countries`, `/airlines`, `/aircraft`, `/aircraft-types`) accept no
 * date range at all, so accepting one here would narrow six sections and leave
 * four alone — one population presented as two.
 */
export async function loadStatsPageRows(userId: string): Promise<StatsPageRowWithClock[]> {
  const rows = await prisma.flight.findMany({
    where: { userId, ...countableFlightWhere() },
    select: pageRowSelect,
  });
  // The airport catalogue is read here once as well. `withDepartureClock` hits
  // the cached airport lookup, not the flight table, so this costs no scan.
  return withDepartureClock(rows);
}
