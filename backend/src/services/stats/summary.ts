/**
 * The summary figures, and the two helpers that decide which flights they are
 * about.
 *
 * Moved out of `routes/stats.ts` on 2026-09-15 to keep it under its frozen
 * size, and the seam holds on its own: none of this routes anything. It
 * answers one question — given a user, a date range and a base currency, what
 * are the headline numbers — and `/stats/summary` and `/stats/hero` both ask
 * it, which is why it cannot live inside either.
 */

import { Prisma } from "@prisma/client";

import { prisma } from "../../db";
import { calculateDistance } from "../../utils/geo";
import { getCachedAirports } from "../airportCache";
import { localWallClockOf } from "../../utils/timezone";
import { measuredDurationMinutes } from "../../utils/flightDurationColumn";
import {
  addFlightDuration,
  averageDurationMinutes,
  emptyDurationTotals,
  resolveFlightDuration,
} from "../../shared/flightDuration";
import { withDepartureClock } from "./departureClock";
import { countableFlightWhere } from "../../shared/flightCounting";
import { mergeAirlineCounts } from "../../utils/airlineNormalize";
import { computeDedupedTotalCost } from "../../utils/stats/dedupedCost";

export interface SummaryStats {
  totalFlights: number;
  /** Booked but not yet flown — reported beside the total, never inside it. */
  plannedFlights: number;
  totalDistance: number;
  /**
   * Minutes in the air: measured where the row carries times, estimated from
   * the airport coordinates where it does not (#268). Used to be measured-only,
   * which reported 0 for every DATE_ONLY row while the overview card — showing
   * the SAME label on the SAME screen — estimated them.
   */
  totalFlightTime: number;
  /** The measured part of `totalFlightTime`. */
  flightTimeMeasured: number;
  /** The estimated part. Shown so a total can say how much of it is guessed. */
  flightTimeEstimated: number;
  /** How many flights contributed an estimate rather than a measurement. */
  flightTimeEstimatedCount: number;
  /**
   * Average minutes per flight that CONTRIBUTED a duration — not per flight.
   * Dividing by every flight is what made the overview's average too low.
   * Null when nothing contributed, so the caller renders a dash, not a zero.
   */
  avgFlightTime: number | null;
  avgDistance: number;
  byStatus: Record<string, number>;
  byAirline: Record<string, number>;
  /**
   * Total in `totalCostCurrency`. Contains ONLY amounts that carry an FX
   * snapshot in that currency (#267) — this used to add every price together
   * regardless of currency and was then rendered with the user's display
   * symbol, so 300 USD + 300 EUR read as "600 €".
   *
   * Null when no amount reached it (forgejo#83) — a year with no priced
   * flight is not a free year. `unpricedFlights` says how many had none.
   */
  totalCost: number | null;
  totalCostCurrency: string;
  /** Countable flights in the window that carry neither a price nor a priced booking. */
  unpricedFlights: number;
  /**
   * What could not be converted, in the currency it was paid in. Reported
   * BESIDE the total, never folded into it. Lodging reports the same way.
   */
  totalCostUnconverted: Record<string, number>;
  byCategory: Record<string, number>;
}

/**
 * One countable flight's own contribution to `SummaryStats`, RAW and
 * unrounded — rounding happens once, at the surface. `computeSummary` used to
 * fold these straight into its totals and let the rows themselves go out of
 * scope, so nothing downstream could say WHICH flight a year's distance or
 * cost came from — adding `id` to a `select` would not have fixed that on its
 * own, because the row still never left the function. This is the fix:
 * `computeSummary` now returns both the totals AND the rows that produced
 * them, over the exact same query and the exact same predicate, for
 * `services/evidence/metricEvidenceFlightYear.ts` to build evidence from.
 */
export interface SummaryFlightRow {
  id: string;
  departureTime: Date | null;
  /** Great-circle distance in km; 0 when a coordinate is missing (matches `calculateDistance`). */
  distanceKm: number;
  /** Measured or estimated minutes, per `shared/flightDuration.ts`; null when neither clocks nor coordinates answer. */
  durationMinutes: number | null;
  /** This row's own share of `stats.totalCost`, in `stats.totalCostCurrency` — see `DedupedCost.perFlightBaseContribution`. */
  costContributionBase: number;
  /** True when this row's own price or its booking's price was recorded — matches `stats.unpricedFlights`'s complement. */
  priced: boolean;
}

export interface SummaryComputation {
  stats: SummaryStats;
  rows: SummaryFlightRow[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The ids of the flights that DEPARTED in `year`, read on the departure
 * airport's clock.
 *
 * A year filter used to compare the stored instant against UTC boundaries,
 * which is a different question from the one the user asked and a different
 * one from the answer `/stats/timeseries` gives. Measured both ways
 * (AUD-077): a Bangkok departure at 01:30 local on 1 January is stored as
 * 18:30Z on 31 December, so the summary and the year in review reported zero
 * for that year while the time series correctly reported one; a Los Angeles
 * departure at 20:30 local on 31 December is stored as 04:30Z on 1 January and
 * was counted in the wrong year the other way round. `departureClock.ts`
 * states the rule the rest of the stats already follow: every "when did I fly"
 * figure is read on the departure airport's clock.
 *
 * The window is widened by a day at each edge for the same reason
 * `fetchFlightDatedRows` widens it — the query can only filter the stored
 * instant, and the two disagree by up to fourteen hours. The margin rows are
 * dropped again once their local day is known.
 *
 * Returning ids keeps the caller's shape: `computeSummary` runs several
 * `count` and `groupBy` aggregates off one `where`, and those cannot be
 * post-filtered in JS without giving up the aggregation.
 */
async function flightIdsDepartingInLocalYear(userId: string, year: number): Promise<string[]> {
  const from = new Date(Date.UTC(year, 0, 1));
  const to = new Date(Date.UTC(year + 1, 0, 1));

  const rows = await prisma.flight.findMany({
    where: {
      userId,
      departureTime: {
        gte: new Date(from.getTime() - DAY_MS),
        lt: new Date(to.getTime() + DAY_MS),
      },
    },
    select: {
      id: true,
      depIata: true,
      depIcao: true,
      arrIata: true,
      arrIcao: true,
      departureTime: true,
      depTimeSemantics: true,
    },
  });

  const withClock = await withDepartureClock(rows);
  return withClock
    .filter(
      (f) =>
        f.departureTime !== null &&
        localWallClockOf(f.departureTime, f.depTimezone, f.depTimeSemantics).year === year
    )
    .map((f) => f.id);
}

export async function buildWhere(
  userId: string,
  fromDate: string | undefined,
  toDate: string | undefined,
  filterYear?: number
): Promise<Prisma.FlightWhereInput> {
  const where: Prisma.FlightWhereInput = { userId };

  if (filterYear !== undefined) {
    where.id = { in: await flightIdsDepartingInLocalYear(userId, filterYear) };
  } else if (fromDate || toDate) {
    // NOTE: an explicit from/to range still compares the stored instant, so it
    // carries the same edge as the year filter did. Not changed here because
    // it was not the reported case and the range is user-supplied rather than
    // a calendar year — worth settling deliberately rather than in passing.
    where.departureTime = {};
    if (fromDate) {
      (where.departureTime as Prisma.DateTimeFilter).gte = new Date(fromDate);
    }
    if (toDate) {
      (where.departureTime as Prisma.DateTimeFilter).lte = new Date(toDate);
    }
  }

  return where;
}

export async function computeSummary(
  where: Prisma.FlightWhereInput,
  baseCurrency: string
): Promise<SummaryComputation> {
  // EVERY headline figure describes the same population: flights that actually
  // happened. `totalFlights` and `totalCost` used to run on the unfiltered
  // `where`, so the year card put "14 flights" next to a distance covering ten
  // of them, and /hero answered "1 flight, 0 km, 0 airports" for an account
  // holding a single BOOKED flight.
  //
  // The old design justified that by a `byStatus` breakdown shown next to the
  // number — but its only renderer is imported nowhere, and /hero never
  // carried it. The context was gone; the bare number stayed.
  //
  // `byStatus`/`byAirline`/`byCategory` still run on the unfiltered `where`:
  // a breakdown BY status that hid statuses would be pointless. What is merely
  // booked is reported as `plannedFlights` instead of being folded in.
  const geoWhere: Prisma.FlightWhereInput = { ...where, ...countableFlightWhere() };

  const [identityRows, totalFlights, plannedFlights, statusCounts, airlineCounts, categoryCounts] =
    await Promise.all([
      // ONE query for the countable population, carrying `id` plus every
      // column both the geo/duration fold AND the cost fold need. This used
      // to be two separate `findMany` calls (`flownFlights`, `costFlights`)
      // over the identical `geoWhere` — same rows, fetched twice, and neither
      // copy carried its own identity, so nothing downstream of `computeSummary`
      // could say WHICH flight a total came from. Evidence needs exactly that.
      prisma.flight.findMany({
        where: geoWhere,
        select: {
          id: true,
          depIata: true,
          depIcao: true,
          depLat: true,
          depLon: true,
          arrIata: true,
          arrIcao: true,
          arrLat: true,
          arrLon: true,
          departureTime: true,
          arrivalTime: true,
          depTimeSemantics: true,
          arrTimeSemantics: true,
          // The stored measurement (forgejo#45). The semantics columns above
          // stay selected because they decide whether it can be trusted.
          durationMinutes: true,
          status: true,
          price: true,
          taxes: true,
          fees: true,
          currency: true,
          priceBase: true,
          fxBaseCurrency: true,
          bookingId: true,
          booking: {
            select: { price: true, currency: true, priceBase: true, fxBaseCurrency: true },
          },
        },
      }),
      prisma.flight.count({ where: geoWhere }),
      prisma.flight.count({ where: { ...where, status: "scheduled" } }),
      prisma.flight.groupBy({
        by: ["status"],
        where,
        _count: true,
      }),
      prisma.flight.groupBy({
        by: ["airline"],
        where,
        _count: true,
      }),
      prisma.flight.groupBy({
        by: ["category"],
        where,
        _count: true,
      }),
    ]);

  let totalDistance = 0;
  let distanceFlightCount = 0;
  let durationTotals = emptyDurationTotals();
  // Per-row evidence, filled by the SAME loop that folds the totals below —
  // never a second pass recomputing the same distance/duration a different
  // way. `resolveFlightDuration`'s own three-rule order (measured, else
  // estimated, else null) is reused directly rather than re-derived from
  // `durationTotals`, which only carries the sums.
  const distanceByFlightId = new Map<string, number>();
  const durationByFlightId = new Map<string, number | null>();

  // Build timezone map for all airports referenced in flown flights
  const allCodes = new Set<string>();
  for (const f of identityRows) {
    if (f.depIata) allCodes.add(f.depIata);
    if (f.depIcao) allCodes.add(f.depIcao);
    if (f.arrIata) allCodes.add(f.arrIata);
    if (f.arrIcao) allCodes.add(f.arrIcao);
  }
  let tzMap = new Map<string, string>();
  try {
    const airports = await getCachedAirports(Array.from(allCodes));
    for (const [code, data] of airports.entries()) {
      if (data?.timezone) tzMap.set(code, data.timezone);
    }
  } catch {
    // timezone lookup failed — durations will use naïve diff
  }

  identityRows.forEach((flight) => {
    const distance = calculateDistance(flight.depLat, flight.depLon, flight.arrLat, flight.arrLon);
    totalDistance += distance;
    if (distance > 0) distanceFlightCount += 1;
    distanceByFlightId.set(flight.id, distance);

    const depTz =
      (flight.depIata && tzMap.get(flight.depIata)) ||
      (flight.depIcao && tzMap.get(flight.depIcao)) ||
      null;
    const arrTz =
      (flight.arrIata && tzMap.get(flight.arrIata)) ||
      (flight.arrIcao && tzMap.get(flight.arrIcao)) ||
      null;
    // A `historical` row's clocks are placeholders, not evidence — see
    // `businessStats.ts` for the same guard and the reason. It contributes a
    // coordinate estimate below instead.
    const flightTime =
      flight.status === "flown" ? measuredDurationMinutes(flight, depTz, arrTz) : null;
    // #106A still holds: a DATE_ONLY row must never contribute its placeholder
    // times, so `flightTime` stays null for it and no fiction is measured. What
    // changed in #268 is what happens NEXT — instead of silently adding 0, the
    // row contributes a coordinate-derived estimate that is counted separately
    // and labelled as such. A guess the reader can see beats a zero they cannot.
    durationTotals = addFlightDuration(durationTotals, {
      measuredMinutes: flightTime,
      depLat: flight.depLat,
      depLon: flight.depLon,
      arrLat: flight.arrLat,
      arrLon: flight.arrLon,
    });
    durationByFlightId.set(
      flight.id,
      resolveFlightDuration({
        measuredMinutes: flightTime,
        depLat: flight.depLat,
        depLon: flight.depLon,
        arrLat: flight.arrLat,
        arrLon: flight.arrLon,
      })?.minutes ?? null
    );
  });

  // Divided by flights that HAVE a distance. A row without coordinates
  // contributes no kilometres, so counting it in the denominator only drags the
  // average down — the client already divided this way, the server did not.
  const avgDistance = distanceFlightCount > 0 ? totalDistance / distanceFlightCount : 0;

  const byStatus = statusCounts.reduce(
    (acc, item) => {
      acc[item.status] = item._count;
      return acc;
    },
    {} as Record<string, number>
  );

  const rawByAirline = airlineCounts.reduce(
    (acc, item) => {
      const airline = item.airline || "Unknown";
      acc[airline] = item._count;
      return acc;
    },
    {} as Record<string, number>
  );
  const byAirline = mergeAirlineCounts(rawByAirline);

  const byCategory = categoryCounts.reduce(
    (acc, item) => {
      const cat = item.category || "unassigned";
      acc[cat] = item._count;
      return acc;
    },
    {} as Record<string, number>
  );

  // Booking-aware: a booking's price counts once, not once per segment —
  // and grouped segments (price nulled by the import) still contribute
  // their booking's total (spec 2026-07-17-cost-booking-price §4). `cost`'s
  // per-row arrays are index-aligned with `costFlights` (== `identityRows`),
  // which is what lets `rows` below attribute the total back to one flight
  // each without re-running the dedupe logic a second, evidence-only way.
  const cost = computeDedupedTotalCost(identityRows, baseCurrency);

  const stats: SummaryStats = {
    totalFlights,
    plannedFlights,
    totalDistance: Math.round(totalDistance),
    totalFlightTime: Math.round(durationTotals.totalMinutes),
    flightTimeMeasured: Math.round(durationTotals.measuredMinutes),
    flightTimeEstimated: Math.round(durationTotals.estimatedMinutes),
    flightTimeEstimatedCount: durationTotals.estimatedCount,
    avgFlightTime: (() => {
      const avg = averageDurationMinutes(durationTotals);
      return avg === null ? null : Math.round(avg);
    })(),
    avgDistance: Math.round(avgDistance),
    byStatus,
    byAirline,
    totalCost: cost.base,
    totalCostCurrency: baseCurrency,
    unpricedFlights: cost.unpricedFlights,
    totalCostUnconverted: cost.unconvertedByCurrency,
    byCategory,
  };

  const rows: SummaryFlightRow[] = identityRows.map((flight, index) => ({
    id: flight.id,
    departureTime: flight.departureTime,
    distanceKm: distanceByFlightId.get(flight.id) ?? 0,
    durationMinutes: durationByFlightId.get(flight.id) ?? null,
    costContributionBase: cost.perFlightBaseContribution[index],
    priced: cost.perFlightPriced[index],
  }));

  return { stats, rows };
}
