import type { EvidenceScope } from "../../shared/evidence";
import type { EvidenceResponse } from "../../schemas/evidence";
import { rentalDays, rentalYear } from "../../shared/rentalCounting";
import { isOneWay } from "../rental/rentalWrite";
import {
  foldRentalAchievementStats,
  hasOdometerPair,
  loadRentalBadgeRows,
  type RentalBadgeRow,
} from "../../utils/rentalAchievements";
import type { PagingParams } from "./paging";
import { rentalEvidenceEntry } from "./entryMappersRentalBus";
import { domainSumEvidence, readYearScope } from "./domainMeasureResponse";

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
  const year = readYearScope(scope, key);
  const rows = await loadRentalBadgeRows(userId);
  return year === undefined ? rows : rows.filter((r) => rentalYear(r) === year);
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
