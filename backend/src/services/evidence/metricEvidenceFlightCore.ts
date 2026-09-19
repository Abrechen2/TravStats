import { prisma } from "../../db";
import { AppError } from "../../middleware/errorHandler";
import type { EvidenceScope } from "../../shared/evidence";
import type { EvidenceResponse } from "../../schemas/evidence";
import type { PagingParams } from "./paging";
import {
  flightDateOf,
  hydrateFlightSumEntries,
  hydrateFlightDistinctEntries,
} from "./entryMappers";
import { countableFlightWhere } from "../../shared/flightCounting";
import { calculateDistance } from "../../utils/geo";
import { measureFlightMinutes, resolveFlightDuration } from "../../shared/flightDuration";
import { airlineGroupKey } from "../../shared/airlineNormalize";
import { airlineResolvers } from "../../utils/airlineNormalize";
import { computeDedupedTotalCost } from "../../utils/stats/dedupedCost";
import { getBaseCurrency } from "../fx/snapshot";

/**
 * `metric` evidence, flight tab, allTime headline family — `flightCount`,
 * `flightTimeMinutes`, `distanceKmTotal`, `airlineCount`,
 * `flightsWithoutAirlineCount`, `businessTotalCost`, `punctualitySampleSize`
 * (task-7-brief.md, `evidenceMeasuresFlightCore.ts`). All seven answer over
 * the SAME population — every countable flight, all time, no year — under
 * one shared `where`, and each reads only the columns its own measure needs.
 * Paging and hydration are shared via `entryMappers.ts`, not re-derived per
 * resolver.
 *
 * The population used to be ONE twenty-column select with a `booking` join,
 * which every resolver called, while this paragraph claimed each read only
 * its own columns. `resolveFlightCount` — which needs an id and a date —
 * was therefore loading prices, coordinates, durations and a joined booking
 * row for every countable flight on the account, on an endpoint one click
 * opens. The four projections below are what the comment always said, and
 * the shared `where` is what made a single select look like the economical
 * choice in the first place.
 */

/** The shared population: one predicate, four projections over it. */
function countableFlightsOf(userId: string) {
  return { userId, ...countableFlightWhere() };
}

/** `flightCount`: what it takes to count a row and sort it by date. */
interface FlightIdentityRow {
  id: string;
  departureTime: Date | null;
}

async function loadFlightIdentityRows(userId: string): Promise<FlightIdentityRow[]> {
  return prisma.flight.findMany({
    where: countableFlightsOf(userId),
    select: { id: true, departureTime: true },
  });
}

/** `flightTimeMinutes` and `distanceKmTotal`: clocks and coordinates, no money. */
interface FlightMeasurementRow extends FlightIdentityRow {
  arrivalTime: Date | null;
  depLat: number;
  depLon: number;
  arrLat: number;
  arrLon: number;
  durationMinutes: number | null;
  depTimeSemantics: string | null;
}

async function loadFlightMeasurementRows(userId: string): Promise<FlightMeasurementRow[]> {
  return prisma.flight.findMany({
    where: countableFlightsOf(userId),
    select: {
      id: true,
      departureTime: true,
      arrivalTime: true,
      depLat: true,
      depLon: true,
      arrLat: true,
      arrLon: true,
      durationMinutes: true,
      depTimeSemantics: true,
    },
  });
}

/** `airlineCount` and `flightsWithoutAirlineCount`: the three columns `airlineGroupKey` reads. */
interface FlightAirlineRow extends FlightIdentityRow {
  airline: string | null;
  airlineIata: string | null;
  airlineIcao: string | null;
}

async function loadFlightAirlineRows(userId: string): Promise<FlightAirlineRow[]> {
  return prisma.flight.findMany({
    where: countableFlightsOf(userId),
    select: {
      id: true,
      departureTime: true,
      airline: true,
      airlineIata: true,
      airlineIcao: true,
    },
  });
}

/**
 * `businessTotalCost` alone: `CostFlight` (`utils/stats/dedupedCost.ts`) in
 * full, including the `booking` join a shared booking's amount is read from.
 * The only projection here that joins another table, and the reason the
 * split is worth having.
 */
interface FlightCostRow extends FlightIdentityRow {
  price: number | null;
  taxes: number | null;
  fees: number | null;
  currency: string | null;
  priceBase: number | null;
  fxBaseCurrency: string | null;
  bookingId: string | null;
  booking: {
    price: number | null;
    currency: string | null;
    priceBase: number | null;
    fxBaseCurrency: string | null;
  } | null;
}

async function loadFlightCostRows(userId: string): Promise<FlightCostRow[]> {
  return prisma.flight.findMany({
    where: countableFlightsOf(userId),
    select: {
      id: true,
      departureTime: true,
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
  });
}

/**
 * None of these seven measures accepts anything but `allTime` — the tiles
 * they back (`StatsOverviewCards`, `StatsDistanceSection`,
 * `StatsBusinessSection`, `PunctualitySection`) send no year/domain filter at
 * all (registry `scopes: ["allTime"]`). A 400, not a silent all-time answer,
 * for the same reason the ranking resolvers reject a scope their endpoint
 * never actually shows.
 */
function requireAllTime(scope: EvidenceScope, label: string): void {
  if (scope.period.kind !== "allTime") {
    throw new AppError(
      `${label} evidence only supports period=allTime; got period=${scope.period.kind}.`,
      400
    );
  }
}

export async function resolveFlightCount(
  userId: string,
  scope: EvidenceScope,
  page: PagingParams
): Promise<EvidenceResponse> {
  requireAllTime(scope, "flightCount");
  const rows = await loadFlightIdentityRows(userId);
  const matched = rows.map((r) => ({
    id: r.id,
    date: flightDateOf(r.departureTime),
    contribution: 1,
  }));
  const { entries, omittedCount, omittedContribution } = await hydrateFlightSumEntries(
    userId,
    matched,
    page
  );
  return {
    measure: {
      kind: "metric",
      key: "flightCount",
      aggregation: "sum",
      label: { key: "evidence.metric.flightCount" },
      unit: "flights",
      value: rows.length,
      scope,
    },
    entries,
    returned: entries.length,
    omitted: { count: omittedCount, contribution: omittedContribution },
    unattributed: [],
    page,
  };
}

/**
 * `flightTimeMinutes` mirrors `AdvancedStatsPage.tsx`'s OWN reading, not
 * `services/stats/summary.ts`'s tz-aware one: the overview card prefers the
 * stored generated `durationMinutes` column outright, and only falls back to
 * a raw (non-timezone-aware) clock diff via `measureFlightMinutes` — it never
 * consults the airport timezone catalogue at all. Reusing `summary.ts`'s
 * tz-aware path here would answer a slightly different question than the
 * tile actually shows for the handful of `LEGACY_FAKE_UTC` rows where the two
 * diverge.
 */
export async function resolveFlightTimeMinutes(
  userId: string,
  scope: EvidenceScope,
  page: PagingParams
): Promise<EvidenceResponse> {
  requireAllTime(scope, "flightTimeMinutes");
  const rows = await loadFlightMeasurementRows(userId);
  const matched = rows.map((r) => {
    const stored = r.durationMinutes != null && r.durationMinutes > 0 ? r.durationMinutes : null;
    const measuredMinutes = stored ?? measureFlightMinutes(r);
    const minutes =
      resolveFlightDuration({
        measuredMinutes,
        depLat: r.depLat,
        depLon: r.depLon,
        arrLat: r.arrLat,
        arrLon: r.arrLon,
      })?.minutes ?? 0;
    return { id: r.id, date: flightDateOf(r.departureTime), contribution: minutes };
  });
  const { entries, omittedCount, omittedContribution } = await hydrateFlightSumEntries(
    userId,
    matched,
    page
  );
  const total = matched.reduce((sum, m) => sum + m.contribution, 0);
  return {
    measure: {
      kind: "metric",
      key: "flightTimeMinutes",
      aggregation: "sum",
      label: { key: "evidence.metric.flightTimeMinutes" },
      unit: "minutes",
      value: Math.round(total),
      scope,
    },
    entries,
    returned: entries.length,
    omitted: { count: omittedCount, contribution: omittedContribution },
    unattributed: [],
    page,
  };
}

export async function resolveDistanceKmTotal(
  userId: string,
  scope: EvidenceScope,
  page: PagingParams
): Promise<EvidenceResponse> {
  requireAllTime(scope, "distanceKmTotal");
  const rows = await loadFlightMeasurementRows(userId);
  const matched = rows.map((r) => ({
    id: r.id,
    date: flightDateOf(r.departureTime),
    contribution: calculateDistance(r.depLat, r.depLon, r.arrLat, r.arrLon),
  }));
  const { entries, omittedCount, omittedContribution } = await hydrateFlightSumEntries(
    userId,
    matched,
    page
  );
  const total = matched.reduce((sum, m) => sum + m.contribution, 0);
  return {
    measure: {
      kind: "metric",
      key: "distanceKmTotal",
      aggregation: "sum",
      label: { key: "evidence.metric.distanceKmTotal" },
      unit: "km",
      value: Math.round(total),
      scope,
    },
    entries,
    returned: entries.length,
    omitted: { count: omittedCount, contribution: omittedContribution },
    unattributed: [],
    page,
  };
}

/**
 * `airlineCount` (distinct) and `flightsWithoutAirlineCount` (sum) share one
 * fold — `airlineGroupKey` per row, exactly as `GET /stats/airlines` and the
 * overview's own client fold both use it. A row with no resolvable airline
 * credits nothing to the distinct set and is exactly the population
 * `flightsWithoutAirlineCount` counts.
 */
function flightAirlineGroupKeys(
  rows: FlightAirlineRow[]
): Array<{ id: string; departureTime: Date | null; groupKey: string | null; airline: string }> {
  return rows.map((r) => {
    const groupKey = airlineGroupKey(r, airlineResolvers);
    return {
      id: r.id,
      departureTime: r.departureTime,
      groupKey,
      airline: airlineDisplayName(groupKey, r.airline),
    };
  });
}

/**
 * What to PRINT for a group key. The key is deliberately machine-shaped — it
 * carries the `iata:` / `name:` prefix that decides how two rows were matched
 * — and the panel used to print it raw, so a row read "belegt: iata:LH"
 * (browser pass, 2026-09-19). The catalogue name where there is one, the bare
 * code where the catalogue does not know the carrier, and the row's own
 * spelling for a `name:`-keyed group, which is lower-cased in the key itself.
 */
function airlineDisplayName(groupKey: string | null, stored: string | null): string {
  if (!groupKey) return "";
  if (groupKey.startsWith("iata:")) {
    const iata = groupKey.slice("iata:".length);
    return airlineResolvers.nameForIata(iata) ?? iata;
  }
  return stored?.trim() || groupKey.slice("name:".length);
}

export async function resolveAirlineCount(
  userId: string,
  scope: EvidenceScope,
  page: PagingParams
): Promise<EvidenceResponse> {
  requireAllTime(scope, "airlineCount");
  const rows = await loadFlightAirlineRows(userId);
  const withKeys = flightAirlineGroupKeys(rows);
  const matched = withKeys.map((row) => ({
    id: row.id,
    date: flightDateOf(row.departureTime),
    credits: row.groupKey ? [row.groupKey] : [],
    ...(row.groupKey ? { creditLabels: { [row.groupKey]: row.airline } } : {}),
  }));
  const { entries, omittedRowCount, omittedCredits } = await hydrateFlightDistinctEntries(
    userId,
    matched,
    page
  );
  const value = new Set(matched.flatMap((m) => m.credits)).size;
  return {
    measure: {
      kind: "metric",
      key: "airlineCount",
      aggregation: "distinct",
      label: { key: "evidence.metric.airlineCount" },
      unit: "airlines",
      value,
      scope,
    },
    entries,
    returned: entries.length,
    omitted: { count: omittedRowCount, credits: omittedCredits },
    unattributed: [],
    page,
  };
}

export async function resolveFlightsWithoutAirlineCount(
  userId: string,
  scope: EvidenceScope,
  page: PagingParams
): Promise<EvidenceResponse> {
  requireAllTime(scope, "flightsWithoutAirlineCount");
  const rows = await loadFlightAirlineRows(userId);
  const withoutAirline = flightAirlineGroupKeys(rows).filter((row) => row.groupKey === null);
  const matched = withoutAirline.map((row) => ({
    id: row.id,
    date: flightDateOf(row.departureTime),
    contribution: 1,
  }));
  const { entries, omittedCount, omittedContribution } = await hydrateFlightSumEntries(
    userId,
    matched,
    page
  );
  return {
    measure: {
      kind: "metric",
      key: "flightsWithoutAirlineCount",
      aggregation: "sum",
      label: { key: "evidence.metric.flightsWithoutAirlineCount" },
      unit: "flights",
      value: matched.length,
      scope,
    },
    entries,
    returned: entries.length,
    omitted: { count: omittedCount, contribution: omittedContribution },
    unattributed: [],
    page,
  };
}

/**
 * `businessTotalCost` (`GET /stats/business`, `calculateBusinessStats`) runs
 * its OWN dedupe loop, but `dedupedCost.ts`'s own header says it in so many
 * words: "the SAME rules as businessStats.ts (kept in sync by hand)" — one
 * booking counted once, a per-flight fallback to price+taxes+fees, a
 * currency-shortcut or FX snapshot to convert. Reusing `computeDedupedTotalCost`
 * here is therefore not a resolver that merely resembles `calculateBusinessStats`;
 * it is the rule the two are already contracted to share. The drift guard is
 * `evidence.metricFlightCore.test.ts`'s "answers the same total
 * /stats/business renders", which fetches BOTH numbers in one test — this
 * sentence claimed such a guard existed for a while before it did, and the
 * sum invariant could never have been it: `value` and `omitted.contribution`
 * come from the same total, so it holds however wrong the population is
 * (`__tests__/invariants.ts` now says so at the top).
 */
export async function resolveBusinessTotalCost(
  userId: string,
  scope: EvidenceScope,
  page: PagingParams
): Promise<EvidenceResponse> {
  requireAllTime(scope, "businessTotalCost");
  const rows = await loadFlightCostRows(userId);
  const baseCurrency = await getBaseCurrency(userId);
  const cost = computeDedupedTotalCost(rows, baseCurrency);
  const matched = rows.map((r, index) => ({
    id: r.id,
    date: flightDateOf(r.departureTime),
    contribution: cost.perFlightBaseContribution[index],
  }));
  const { entries, omittedCount, omittedContribution } = await hydrateFlightSumEntries(
    userId,
    matched,
    page
  );
  // `cost.base` is `null` when NO flight's amount reached the base currency —
  // a legitimate abstention (forgejo#83), not an error, but the evidence
  // contract still requires a reason. None of the three closed
  // `UnattributedReason`s names "every row priced zero or unconvertible"
  // exactly; `notPerEntry` is the nearest fit ("no per-row split" reads, here,
  // as "no row's split is anything but zero") and is used with this note
  // rather than silently picking one. A real gap for release 2 to close if a
  // sixth reason is ever added.
  const unattributed =
    cost.base === null ? [{ count: rows.length, reason: "notPerEntry" as const }] : [];
  return {
    measure: {
      kind: "metric",
      key: "businessTotalCost",
      aggregation: "sum",
      label: { key: "evidence.metric.businessTotalCost" },
      unit: "currency",
      value: cost.base,
      scope,
    },
    entries,
    returned: entries.length,
    omitted: { count: omittedCount, contribution: omittedContribution },
    unattributed,
    page,
  };
}

/**
 * `punctualitySampleSize` (`GET /stats/punctuality`) samples countable
 * flights carrying a recorded delay — no year/date filter is ever sent by
 * the page, so this is allTime like its siblings despite living on its own
 * endpoint with its own (unused, by this tile) date-range parameters.
 */
export async function resolvePunctualitySampleSize(
  userId: string,
  scope: EvidenceScope,
  page: PagingParams
): Promise<EvidenceResponse> {
  requireAllTime(scope, "punctualitySampleSize");
  const rows = await prisma.flight.findMany({
    where: { userId, ...countableFlightWhere(), delayMinutes: { not: null } },
    select: { id: true, departureTime: true },
  });
  const matched = rows.map((r) => ({
    id: r.id,
    date: flightDateOf(r.departureTime),
    contribution: 1,
  }));
  const { entries, omittedCount, omittedContribution } = await hydrateFlightSumEntries(
    userId,
    matched,
    page
  );
  return {
    measure: {
      kind: "metric",
      key: "punctualitySampleSize",
      aggregation: "sum",
      label: { key: "evidence.metric.punctualitySampleSize" },
      unit: "flights",
      value: matched.length,
      scope,
    },
    entries,
    returned: entries.length,
    omitted: { count: omittedCount, contribution: omittedContribution },
    unattributed: [],
    page,
  };
}
