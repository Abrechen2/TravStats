/**
 * The wire shape of `GET /stats/cruise`, assembled in one place.
 *
 * Lifted out of `routes/stats.ts` when that router was already past the
 * 800-line limit and this endpoint grew a money figure. The handler's own work
 * is loading, guarding and answering; WHAT the cruise tab receives — which
 * sets become sorted arrays, which vocabulary each country list speaks, where
 * the base-currency total comes from — is one decision per field and belongs
 * beside the other cruise stats services.
 *
 * The return type is the Zod schema's own, so the spec and the handler cannot
 * say different things (forgejo#52): a field added here without a line in
 * `schemas/statsCruise.ts` does not compile.
 */
import type { CruiseStatsResponse } from "../../schemas/statsCruise";
import type { CruiseStats } from "../../utils/cruiseStats";
import { isoCodes } from "./countryStats";
import { cruiseTotalSpendBase } from "./cruiseSpendBase";
import type { CruiseStatsRow } from "./cruiseStatsData";

export function buildCruiseTabResponse(
  stats: CruiseStats,
  rows: readonly CruiseStatsRow[],
  baseCurrency: string
): CruiseStatsResponse {
  return {
    // Counts + ladders
    cruisesCount: stats.cruisesCount,
    cruisePortsUnique: stats.cruisePortsUnique,
    cruisePortsSingleMax: stats.cruisePortsSingleMax,
    cruiseShipsUnique: stats.cruiseShipsUnique,
    cruiseLinesUnique: stats.cruiseLinesUnique,
    cruiseLineLoyaltyMax: stats.cruiseLineLoyaltyMax,
    // Ranked by how often they were sailed, ties alphabetical. The
    // cross-domain tile slices the first five and labels them "Top", so a
    // purely alphabetical list put AIDA and Costa there for their
    // initials rather than for having been sailed.
    cruiseLines: Array.from(stats.cruiseLines).sort((a, b) => {
      const diff = (stats.cruiseLineCounts[b] ?? 0) - (stats.cruiseLineCounts[a] ?? 0);
      return diff !== 0 ? diff : a.localeCompare(b);
    }),
    resolvedPortCalls: stats.resolvedPortCalls,
    seaDays: stats.seaDays,
    seaDaysStreak: stats.seaDaysStreak,
    // Regions + countries (lists already in API; counts derived
    // client-side)
    regions: Array.from(stats.regions).sort(),
    regionVisitCounts: stats.regionVisitCounts,
    // Display vocabulary: English names, rendered as-is in the cruise
    // tab's country tag cloud. Do NOT switch these to codes.
    countries: Array.from(stats.countries).sort(),
    // Counting vocabulary: ISO alpha-2, so the cross-domain KPI can union
    // these with the airport catalogue's codes without counting "Germany"
    // and "DE" as two countries. Ports whose name does not resolve are
    // dropped from the COUNT rather than counted under their raw name —
    // an unresolvable name cannot be deduplicated against anything.
    countriesIso: isoCodes(stats.countries),
    // Year-scoped counterpart — see the CruiseStats doc comment. Keyed by
    // the cruise's start year so the overview's "countries visited" tile
    // can answer for a selected year instead of showing the lifetime set
    // with a delta on top that could only ever read zero.
    countriesByYear: Object.fromEntries(
      [...stats.countriesByYear.entries()].map(([year, set]) => [String(year), isoCodes(set)])
    ),
    // Distance metrics (added 2026-04-25 with the schematic-routes
    // pipeline; long-overdue exposure to the stats UI)
    totalDistanceKm: Math.round(stats.totalDistanceKm),
    longestLegKm: Math.round(stats.longestLegKm),
    // Trip-shape derivations
    totalPortCalls: stats.totalPortCalls,
    totalCruiseDays: stats.totalCruiseDays,
    // Cabin / deck signals
    hasBalconyCabin: stats.hasBalconyCabin,
    hasSuiteCabin: stats.hasSuiteCabin,
    maxDeck: stats.maxDeck,
    // Achievement-style flags
    hasCanalTransit: stats.hasCanalTransit,
    hasPolar: stats.hasPolar,
    hasColdWater: stats.hasColdWater,
    hasDatelineCrossing: stats.hasDatelineCrossing,
    hasBirthdayAtSea: stats.hasBirthdayAtSea,
    hasNewYearsAtSea: stats.hasNewYearsAtSea,
    // The one money figure on this tab that is a single number. The rows
    // beside it stay per-currency; this is the base-currency sum, and the
    // rule is `services/stats/cruiseSpendBase.ts` — the SAME one the
    // evidence panel answers `metric:cruiseTotalSpend` with, so the tile
    // and the panel cannot drift apart. Folding it on the client would be
    // a second spelling of it.
    totalSpendBase: cruiseTotalSpendBase(rows, baseCurrency),
  };
}
