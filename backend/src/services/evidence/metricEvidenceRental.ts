import type { EvidenceScope } from "../../shared/evidence";
import type { EvidenceResponse } from "../../schemas/evidence";
import { rentalCost, rentalDays, rentalDrivenKm, rentalYear } from "../../shared/rentalCounting";
import { computeRentalStats, loadRentalStatsRows } from "../rental/rentalStats";
import {
  comparesVehicle,
  computeRentalExtraStats,
  costPerKmStandsOn,
  drivenModelKey,
  farthestRental,
  isBrokered,
  kmPerDayStandsOn,
  longestRental,
  newProviderFirsts,
  rentalProviderKey,
} from "../rental/rentalStatsExtra";
import { isOneWay } from "../rental/rentalWrite";
import {
  foldRentalAchievementStats,
  hasOdometerPair,
  loadRentalBadgeRows,
  type RentalBadgeRow,
} from "../../utils/rentalAchievements";
import type { PagingParams } from "./paging";
import { rentalEvidenceEntry } from "./entryMappersRentalBus";
import {
  domainDistinctEvidence,
  domainSumEvidence,
  readDayScope,
  readYearScope,
} from "./domainMeasureResponse";
import { localDay } from "../../shared/time/instant";

/**
 * The served rental measures (forgejo#262): the rental tab's figures and the
 * rental badges' progress, listed rental by rental. The population is the
 * badges' own (`loadRentalBadgeRows`: completed rentals), cut to the year of
 * the pickup on its station's calendar — the tab's cut — so a badge's
 * progress, the tab's tile and this list are one computation.
 */
async function loadScoped(
  userId: string,
  scope: EvidenceScope,
  key: string
): Promise<RentalBadgeRow[]> {
  // The pickup's day on its station's calendar (`rentalYear`'s day).
  const inPeriod = readDayScope(scope, key);
  const rows = await loadRentalBadgeRows(userId);
  return inPeriod === undefined
    ? rows
    : rows.filter((r) => inPeriod(localDay(r.pickupTime, r.pickupTimezone)));
}

function rentalSum(
  key: string,
  unit: string,
  contribution: (row: RentalBadgeRow) => number | null,
  value: (rows: RentalBadgeRow[]) => number
) {
  return async (
    userId: string,
    scope: EvidenceScope,
    page: PagingParams
  ): Promise<EvidenceResponse> => {
    const rows = await loadScoped(userId, scope, key);
    const entries = rows
      .map((row) => ({ row, share: contribution(row) }))
      .filter(({ share }) => share !== null)
      .map(({ row, share }) => rentalEvidenceEntry(row, { contribution: share as number }));
    return domainSumEvidence({ key, unit, scope, page, entries, value: value(rows) });
  };
}

export const resolveRentalCount = rentalSum(
  "rentalCount",
  "rentals",
  () => 1,
  (rows) => foldRentalAchievementStats(rows).rentalCount
);

/** Rental days on the stations' calendars — the tab's rule (`rentalDays`). */
export const resolveRentalDaysTotal = rentalSum(
  "rentalDaysTotal",
  "days",
  (row) => rentalDays(row),
  (rows) => rows.reduce((sum, r) => sum + rentalDays(r), 0)
);

export const resolveRentalOneWayCount = rentalSum(
  "rentalOneWayCount",
  "rentals",
  (row) => (isOneWay(row) ? 1 : null),
  (rows) => foldRentalAchievementStats(rows).rentalOneWayCount
);

export const resolveRentalOdometerDocumentedCount = rentalSum(
  "rentalOdometerDocumentedCount",
  "rentals",
  (row) => (hasOdometerPair(row) ? 1 : null),
  (rows) => foldRentalAchievementStats(rows).rentalOdometerDocumented
);

/**
 * forgejo#262 — the tab's further figures, over the statistics' own rows
 * (`loadRentalStatsRows`: completed rentals with price, km and vehicles) and
 * the statistics' own per-rental rules (`rentalStatsExtra.ts`), so the panel
 * lists exactly the rentals the tile stood on.
 */
async function loadStatsScoped(
  userId: string,
  scope: EvidenceScope,
  key: string
): Promise<{ all: StatsRow[]; rows: StatsRow[] }> {
  const year = readYearScope(scope, key);
  const all = await loadRentalStatsRows(userId);
  return { all, rows: year === undefined ? all : all.filter((r) => rentalYear(r) === year) };
}

type StatsRow = Awaited<ReturnType<typeof loadRentalStatsRows>>[number];

function statsSum(
  key: string,
  unit: string,
  contribution: (row: StatsRow) => number | null,
  value: (rows: StatsRow[], all: StatsRow[]) => number | null
) {
  return async (
    userId: string,
    scope: EvidenceScope,
    page: PagingParams
  ): Promise<EvidenceResponse> => {
    const { all, rows } = await loadStatsScoped(userId, scope, key);
    const entries = rows
      .map((row) => ({ row, share: contribution(row) }))
      .filter(({ share }) => share !== null)
      .map(({ row, share }) => rentalEvidenceEntry(row, { contribution: share as number }));
    return domainSumEvidence({
      key,
      unit,
      scope,
      page,
      entries,
      value: value(rows, all),
      abstained: rows.length - entries.length,
    });
  };
}

const extraOf = (rows: StatsRow[], all: StatsRow[]) => computeRentalExtraStats(rows, all);

/** Known km: the invoice's, the agreement's, a correction, or in − out (`rentalDrivenKm`). */
export const resolveRentalKmTotal = statsSum(
  "rentalKmTotal",
  "km",
  (row) => rentalDrivenKm(row)?.km ?? null,
  (rows) => computeRentalStats(rows, null).km.total
);

/** The rentals cost per rental day is taken over: a known cost (`rentalCost`), any currency. */
export const resolveRentalCostedCount = statsSum(
  "rentalCostedCount",
  "rentals",
  (row) => (rentalCost(row) === null ? null : 1),
  (rows) => computeRentalStats(rows, null).costPerDay.reduce((n, c) => n + c.rentals, 0)
);

export const resolveRentalBrokeredCount = statsSum(
  "rentalBrokeredCount",
  "rentals",
  (row) => (isBrokered(row) ? 1 : null),
  (rows, all) => extraOf(rows, all).brokered.viaBroker
);

/** The documented subset km per rental day stands on, each rental contributing 1. */
export const resolveRentalKmPerDaySampleCount = statsSum(
  "rentalKmPerDaySampleCount",
  "rentals",
  (row) => (kmPerDayStandsOn(row) ? 1 : null),
  (rows, all) => extraOf(rows, all).kmPerDay.rentals
);

/** The subset cost per km stands on: known cost AND known km above 0. */
export const resolveRentalCostPerKmSampleCount = statsSum(
  "rentalCostPerKmSampleCount",
  "rentals",
  (row) => (costPerKmStandsOn(row) ? 1 : null),
  (rows, all) => extraOf(rows, all).costPerKm.reduce((n, c) => n + c.rentals, 0)
);

/** Rentals naming both the promised example and the car driven — compared neutrally. */
export const resolveRentalVehicleComparedCount = statsSum(
  "rentalVehicleComparedCount",
  "rentals",
  (row) => (comparesVehicle(row) ? 1 : null),
  (rows, all) => extraOf(rows, all).vehicles.promisedVsDriven.compared
);

/** The longest rental (a record) as its one witness: the rental and its rental days. */
export const resolveRentalLongest = statsSumOfOne("rentalLongest", "days", (rows) => {
  const best = longestRental(rows);
  return best ? { row: best.row, value: best.days } : null;
});

/** The rental with the most known km, as its one witness. */
export const resolveRentalFarthest = statsSumOfOne("rentalFarthest", "km", (rows) => {
  const best = farthestRental(rows);
  return best ? { row: best.row, value: best.km } : null;
});

function statsSumOfOne(
  key: string,
  unit: string,
  pick: (rows: StatsRow[]) => { row: StatsRow; value: number } | null
) {
  return async (
    userId: string,
    scope: EvidenceScope,
    page: PagingParams
  ): Promise<EvidenceResponse> => {
    const { rows } = await loadStatsScoped(userId, scope, key);
    const best = pick(rows);
    const entries = best ? [rentalEvidenceEntry(best.row, { contribution: best.value })] : [];
    return domainSumEvidence({
      key,
      unit,
      scope,
      page,
      entries,
      value: best?.value ?? null,
      abstained: rows.length,
    });
  };
}

/** Distinct driven models, spelling folded; each rental naming one witnesses it. */
export async function resolveRentalDrivenModelsCount(
  userId: string,
  scope: EvidenceScope,
  page: PagingParams
): Promise<EvidenceResponse> {
  const key = "rentalDrivenModelsCount";
  const { rows } = await loadStatsScoped(userId, scope, key);
  const entries = rows.flatMap((row) => {
    const model = drivenModelKey(row);
    if (model === null) return [];
    const label = (row.vehicleDriven as string).trim();
    return [rentalEvidenceEntry(row, { credits: [model], creditLabels: { [model]: label } })];
  });
  return domainDistinctEvidence({ key, unit: "models", scope, page, entries });
}

/** Providers whose first counted rental falls in the period, witnessed by that rental. */
export async function resolveRentalNewProvidersCount(
  userId: string,
  scope: EvidenceScope,
  page: PagingParams
): Promise<EvidenceResponse> {
  const key = "rentalNewProvidersCount";
  const { all, rows } = await loadStatsScoped(userId, scope, key);
  const entries = newProviderFirsts(rows, all).map((row) => {
    const credit = rentalProviderKey(row.provider);
    return rentalEvidenceEntry(row, {
      credits: [credit],
      creditLabels: { [credit]: row.provider.trim() },
    });
  });
  return domainDistinctEvidence({ key, unit: "providers", scope, page, entries });
}
