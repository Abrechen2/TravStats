import type { EvidenceScope } from "../../shared/evidence";
import type { EvidenceEntry, EvidenceResponse } from "../../schemas/evidence";
import { railYear } from "../../shared/railCounting";
import {
  foldRailAchievementStats,
  loadRailBadgeRows,
  railRideFacts,
  type RailAchievementStats,
  type RailBadgeRow,
  type RailRideFacts,
} from "../../utils/railAchievements";
import type { PagingParams } from "./paging";
import { railEvidenceEntry } from "./entryMappersDomains";
import { domainDistinctEvidence, domainSumEvidence, readYearScope } from "./domainMeasureResponse";

/**
 * The seven served rail measures (2.7): the rail tab's figures and the rail
 * badges' progress, listed ride by ride.
 *
 * The figure is the badges' own fold (`foldRailAchievementStats`) and each
 * ride's share is `railRideFacts` — the same function the fold adds up — so
 * the panel cannot name a ride the badge did not count, or miss one it did.
 * The population is the counted rides (`shared/railCounting.ts`), cut to the
 * year a ride LEFT on its departure station's calendar, as the rail tab cuts it.
 */

interface ScopedRides {
  rows: RailBadgeRow[];
  total: RailAchievementStats;
  facts: Map<string, RailRideFacts>;
}

async function loadScoped(userId: string, scope: EvidenceScope, key: string): Promise<ScopedRides> {
  const year = readYearScope(scope, key);
  const all = await loadRailBadgeRows(userId);
  const rows = year === undefined ? all : all.filter((r) => railYear(r) === year);
  return {
    rows,
    total: foldRailAchievementStats(rows),
    facts: new Map(rows.map((r) => [r.id, railRideFacts(r)])),
  };
}

function label(row: RailBadgeRow): string {
  const train = [row.trainCategory, row.trainNumber].filter(Boolean).join(" ");
  const route = `${row.depStationName} → ${row.arrStationName}`;
  return train ? `${train} · ${route}` : route;
}

function entryOf(
  row: RailBadgeRow,
  fields: Pick<EvidenceEntry, "contribution" | "credits" | "creditLabels">
): EvidenceEntry {
  return railEvidenceEntry(
    { id: row.id, label: label(row), departureTime: row.departureTime },
    { ...fields, subtitle: null }
  );
}

/** A count of rides of one kind: each ride of that kind contributes 1, every other ride stays out. */
function rideKindSum(
  key: string,
  pick: (facts: RailRideFacts) => boolean,
  read: (stats: RailAchievementStats) => number
) {
  return async (
    userId: string,
    scope: EvidenceScope,
    page: PagingParams
  ): Promise<EvidenceResponse> => {
    const { rows, total, facts } = await loadScoped(userId, scope, key);
    const entries = rows
      .filter((r) => pick(facts.get(r.id)!))
      .map((r) => entryOf(r, { contribution: 1 }));
    return domainSumEvidence({ key, unit: "rides", scope, page, entries, value: read(total) });
  };
}

function rideDistinct(
  key: string,
  unit: string,
  credits: (facts: RailRideFacts) => string[],
  labels?: (row: RailBadgeRow, facts: RailRideFacts) => Record<string, string>
) {
  return async (
    userId: string,
    scope: EvidenceScope,
    page: PagingParams
  ): Promise<EvidenceResponse> => {
    const { rows, facts } = await loadScoped(userId, scope, key);
    const entries = rows
      .map((r) => ({ row: r, credited: credits(facts.get(r.id)!) }))
      .filter(({ credited }) => credited.length > 0)
      .map(({ row, credited }) =>
        entryOf(row, {
          credits: credited,
          ...(labels ? { creditLabels: labels(row, facts.get(row.id)!) } : {}),
        })
      );
    return domainDistinctEvidence({ key, unit, scope, page, entries });
  };
}

export const resolveRailRideCount = rideKindSum(
  "railRideCount",
  () => true,
  (s) => s.railRidesCount
);

/**
 * Kilometres, every source together. A ride with no distance is left out of
 * the list rather than shown contributing 0 — it measured nothing.
 */
export async function resolveRailDistanceKmTotal(
  userId: string,
  scope: EvidenceScope,
  page: PagingParams
): Promise<EvidenceResponse> {
  const key = "railDistanceKmTotal";
  const { rows, total, facts } = await loadScoped(userId, scope, key);
  const entries = rows
    .filter((r) => facts.get(r.id)!.km !== null)
    .map((r) => entryOf(r, { contribution: facts.get(r.id)!.km as number }));
  return domainSumEvidence({ key, unit: "km", scope, page, entries, value: total.railKm });
}

export const resolveRailCountriesCount = rideDistinct(
  "railCountriesCount",
  "countries",
  (f) => f.countries
);

/** Credited by the folded key ("db fernverkehr"), labelled with the name as the ride spells it. */
export const resolveRailOperatorsCount = rideDistinct(
  "railOperatorsCount",
  "operators",
  (f) => (f.operator ? [f.operator] : []),
  (row, f) => (f.operator && row.operator ? { [f.operator]: row.operator.trim() } : {})
);

export const resolveRailNightTrainCount = rideKindSum(
  "railNightTrainCount",
  (f) => f.isNightTrain,
  (s) => s.railNightTrains
);

export const resolveRailHighSpeedRideCount = rideKindSum(
  "railHighSpeedRideCount",
  (f) => f.isHighSpeed,
  (s) => s.railHighSpeedRides
);

export const resolveRailCrossBorderRideCount = rideKindSum(
  "railCrossBorderRideCount",
  (f) => f.isCrossBorder,
  (s) => s.railCrossBorderRides
);
