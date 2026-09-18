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
 * the SAME population — every countable flight, all time, no year — so they
 * share ONE identity query rather than one `findMany` per key. Each resolver
 * still reads only the columns its own measure needs, the way the ranking
 * resolvers each project their own subset. Paging and hydration are shared
 * via `entryMappers.ts`, not re-derived per resolver.
 */

interface FlightCoreIdentityRow {
  id: string;
  departureTime: Date | null;
  arrivalTime: Date | null;
  depLat: number;
  depLon: number;
  arrLat: number;
  arrLon: number;
  durationMinutes: number | null;
  depTimeSemantics: string | null;
  airline: string | null;
  airlineIata: string | null;
  airlineIcao: string | null;
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

async function loadFlightCoreIdentityRows(userId: string): Promise<FlightCoreIdentityRow[]> {
  return prisma.flight.findMany({
    where: { userId, ...countableFlightWhere() },
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
      airline: true,
      airlineIata: true,
      airlineIcao: true,
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
  const rows = await loadFlightCoreIdentityRows(userId);
  const matched = rows.map((r) => ({
    id: r.id,
    date: flightDateOf(r.departureTime),
    contribution: 1,
  }));
  const { entries, omittedCount, omittedContribution } = await hydrateFlightSumEntries(
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
  const rows = await loadFlightCoreIdentityRows(userId);
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
  const rows = await loadFlightCoreIdentityRows(userId);
  const matched = rows.map((r) => ({
    id: r.id,
    date: flightDateOf(r.departureTime),
    contribution: calculateDistance(r.depLat, r.depLon, r.arrLat, r.arrLon),
  }));
  const { entries, omittedCount, omittedContribution } = await hydrateFlightSumEntries(
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
  rows: FlightCoreIdentityRow[]
): Array<{ id: string; departureTime: Date | null; groupKey: string | null }> {
  return rows.map((r) => ({
    id: r.id,
    departureTime: r.departureTime,
    groupKey: airlineGroupKey(r, airlineResolvers),
  }));
}

export async function resolveAirlineCount(
  userId: string,
  scope: EvidenceScope,
  page: PagingParams
): Promise<EvidenceResponse> {
  requireAllTime(scope, "airlineCount");
  const rows = await loadFlightCoreIdentityRows(userId);
  const withKeys = flightAirlineGroupKeys(rows);
  const matched = withKeys.map((row) => ({
    id: row.id,
    date: flightDateOf(row.departureTime),
    credits: row.groupKey ? [row.groupKey] : [],
  }));
  const { entries, omittedRowCount, omittedCredits } = await hydrateFlightDistinctEntries(
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
  const rows = await loadFlightCoreIdentityRows(userId);
  const withoutAirline = flightAirlineGroupKeys(rows).filter((row) => row.groupKey === null);
  const matched = withoutAirline.map((row) => ({
    id: row.id,
    date: flightDateOf(row.departureTime),
    contribution: 1,
  }));
  const { entries, omittedCount, omittedContribution } = await hydrateFlightSumEntries(
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
 * it is the rule the two are already contracted to share, and the invariant
 * test below asserts against `/stats/business`'s OWN `totalCost` — so a future
 * drift between the two hand-kept copies fails loudly here rather than being
 * assumed away.
 */
export async function resolveBusinessTotalCost(
  userId: string,
  scope: EvidenceScope,
  page: PagingParams
): Promise<EvidenceResponse> {
  requireAllTime(scope, "businessTotalCost");
  const rows = await loadFlightCoreIdentityRows(userId);
  const baseCurrency = await getBaseCurrency(userId);
  const cost = computeDedupedTotalCost(rows, baseCurrency);
  const matched = rows.map((r, index) => ({
    id: r.id,
    date: flightDateOf(r.departureTime),
    contribution: cost.perFlightBaseContribution[index],
  }));
  const { entries, omittedCount, omittedContribution } = await hydrateFlightSumEntries(
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
