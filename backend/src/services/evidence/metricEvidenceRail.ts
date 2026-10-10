import type { EvidenceScope } from "../../shared/evidence";
import type { EvidenceEntry, EvidenceResponse } from "../../schemas/evidence";
import { railYear, stationDayKey } from "../../shared/railCounting";
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
import {
  domainDistinctEvidence,
  domainSumEvidence,
  readDayScope,
  readYearScope,
} from "./domainMeasureResponse";
import {
  isDocumentedTransferJourney,
  journeyTransferWaits,
  railJourneysOf,
} from "../rail/railJourneyStats";
import { longestRide, railRideHours } from "../rail/railStats";
import { nightTrainNights } from "../../shared/railRideKinds";
import { firstRidesPerConnection } from "../../shared/railConnections";

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
  // The day a ride left on its departure station's calendar — the day
  // `railYear` files it under, and the day a same-span comparison cuts at.
  const inPeriod = readDayScope(scope, key);
  const all = await loadRailBadgeRows(userId);
  const rows =
    inPeriod === undefined
      ? all
      : all.filter((r) => inPeriod(stationDayKey(r.departureTime, r.depTimezone)));
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
    {
      id: row.id,
      label: label(row),
      departureTime: row.departureTime,
      depTimezone: row.depTimezone,
    },
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

/**
 * forgejo#261 — the journey figures of the rail tab, over the same rides and
 * by the same rules (`services/rail/railJourneyStats.ts`). A journey is
 * listed under its FIRST train and named from its first departure to its
 * last arrival; the station names are data, not copy.
 */
function journeyEntry(journey: readonly RailBadgeRow[]): EvidenceEntry {
  const first = journey[0];
  const last = journey[journey.length - 1];
  return railEvidenceEntry(
    {
      id: first.id,
      label: `${first.depStationName} → ${last.arrStationName}`,
      departureTime: first.departureTime,
      depTimezone: first.depTimezone,
    },
    { contribution: 1, subtitle: null }
  );
}

/** Journeys: legs of one booking that meet at a station are one (`railJourneysOf`). */
export async function resolveRailJourneyCount(
  userId: string,
  scope: EvidenceScope,
  page: PagingParams
): Promise<EvidenceResponse> {
  const key = "railJourneyCount";
  const { rows } = await loadScoped(userId, scope, key);
  const journeys = railJourneysOf(rows);
  return domainSumEvidence({
    key,
    unit: "journeys",
    scope,
    page,
    entries: journeys.map(journeyEntry),
    value: journeys.length,
  });
}

/** The badge "Gut umgestiegen": journeys with a change, every train with both clocks. */
export async function resolveRailDocumentedTransferJourneyCount(
  userId: string,
  scope: EvidenceScope,
  page: PagingParams
): Promise<EvidenceResponse> {
  const key = "railDocumentedTransferJourneyCount";
  const { rows, total } = await loadScoped(userId, scope, key);
  const entries = railJourneysOf(rows).filter(isDocumentedTransferJourney).map(journeyEntry);
  return domainSumEvidence({
    key,
    unit: "journeys",
    scope,
    page,
    entries,
    value: total.railDocumentedTransferJourneys,
  });
}

/** Nights on board: each night train contributes the nights it ran through. */
export async function resolveRailNightTrainNights(
  userId: string,
  scope: EvidenceScope,
  page: PagingParams
): Promise<EvidenceResponse> {
  const key = "railNightTrainNights";
  const { rows } = await loadScoped(userId, scope, key);
  const entries = rows
    .map((row) => ({ row, nights: nightTrainNights(row) }))
    .filter(({ nights }) => nights !== null && nights.length > 0)
    .map(({ row, nights }) => entryOf(row, { contribution: (nights as string[]).length }));
  const value = entries.reduce((sum, e) => sum + (e.contribution ?? 0), 0);
  return domainSumEvidence({ key, unit: "nights", scope, page, entries, value });
}

/**
 * New connections: the first counted ride on each connection, over EVERY
 * ride — then kept when that first ride is in the period on screen.
 */
export async function resolveRailNewConnectionsCount(
  userId: string,
  scope: EvidenceScope,
  page: PagingParams
): Promise<EvidenceResponse> {
  const key = "railNewConnectionsCount";
  const year = readYearScope(scope, key);
  const firsts = [...firstRidesPerConnection(await loadRailBadgeRows(userId)).values()].filter(
    (r) => year === undefined || railYear(r) === year
  );
  return domainSumEvidence({
    key,
    unit: "connections",
    scope,
    page,
    entries: firsts.map((r) => entryOf(r, { contribution: 1 })),
    value: firsts.length,
  });
}

const round1 = (n: number): number => Math.round(n * 10) / 10;

/**
 * Hours on board (forgejo#261): each ride with both clocks contributes its
 * own hours (`railRideHours`, the tab's rule); a date-only ride or one with
 * no arrival measured nothing and is not listed.
 */
export async function resolveRailHoursOnBoard(
  userId: string,
  scope: EvidenceScope,
  page: PagingParams
): Promise<EvidenceResponse> {
  const key = "railHoursOnBoard";
  const { rows } = await loadScoped(userId, scope, key);
  const entries = rows
    .map((row) => ({ row, hours: railRideHours(row) }))
    .filter(({ hours }) => hours !== null)
    .map(({ row, hours }) => entryOf(row, { contribution: hours as number }));
  const value = entries.reduce((sum, e) => sum + (e.contribution ?? 0), 0);
  return domainSumEvidence({ key, unit: "hours", scope, page, entries, value, round: round1 });
}

/**
 * The changes the average change time is taken over: each journey lists the
 * changes whose two clocks are known (`journeyTransferWaits`), so the panel's
 * total is the sample the tile's average names.
 */
export async function resolveRailTransferCount(
  userId: string,
  scope: EvidenceScope,
  page: PagingParams
): Promise<EvidenceResponse> {
  const key = "railTransferCount";
  const { rows } = await loadScoped(userId, scope, key);
  const entries = railJourneysOf(rows)
    .map((journey) => ({ journey, waits: journeyTransferWaits(journey).length }))
    .filter(({ waits }) => waits > 0)
    .map(({ journey, waits }) => ({ ...journeyEntry(journey), contribution: waits }));
  const value = entries.reduce((sum, e) => sum + (e.contribution ?? 0), 0);
  return domainSumEvidence({ key, unit: "transfers", scope, page, entries, value });
}

/**
 * The longest ride (a record) as its one witness: the ride and its distance.
 * Release 1 serves `sum` and `distinct` only, and a one-row sum is exactly
 * the record's evidence — the ride that holds it, contributing its km.
 */
export async function resolveRailLongestRide(
  userId: string,
  scope: EvidenceScope,
  page: PagingParams
): Promise<EvidenceResponse> {
  const key = "railLongestRide";
  const { rows } = await loadScoped(userId, scope, key);
  const best = longestRide(rows);
  const entries = best ? [entryOf(best, { contribution: best.distanceKm as number })] : [];
  return domainSumEvidence({
    key,
    unit: "km",
    scope,
    page,
    entries,
    value: best ? (best.distanceKm as number) : null,
    abstained: rows.length,
  });
}
