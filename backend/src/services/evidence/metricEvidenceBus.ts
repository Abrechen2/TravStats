import type { EvidenceScope } from "../../shared/evidence";
import type { EvidenceResponse } from "../../schemas/evidence";
import { busCountries, busYear } from "../../shared/busCounting";
import { isNightBusRide, terminalsOf } from "../../shared/busRideKinds";
import { computeBusStats, loadBusRows, type BusStatsRow } from "../bus/busStats";
import type { PagingParams } from "./paging";
import { busEvidenceEntry } from "./entryMappersRentalBus";
import { domainDistinctEvidence, domainSumEvidence, readYearScope } from "./domainMeasureResponse";

/**
 * The served bus measures (forgejo#263): the bus tab's figures and the bus
 * badges' progress, ride by ride. The population is the tab's
 * (`loadBusRows`: completed rides), cut to the year a ride left on its
 * departure terminal's calendar, and each figure is the tab's own number
 * (`computeBusStats`) — so the panel cannot name a ride the tile did not count.
 */
async function loadScoped(
  userId: string,
  scope: EvidenceScope,
  key: string
): Promise<{ all: BusStatsRow[]; rows: BusStatsRow[] }> {
  const year = readYearScope(scope, key);
  const all = await loadBusRows(userId);
  return { all, rows: year === undefined ? all : all.filter((r) => busYear(r) === year) };
}

function busSum(
  key: string,
  unit: string,
  contribution: (row: BusStatsRow) => number | null,
  value: (rows: BusStatsRow[], all: BusStatsRow[]) => number
) {
  return async (
    userId: string,
    scope: EvidenceScope,
    page: PagingParams
  ): Promise<EvidenceResponse> => {
    const { all, rows } = await loadScoped(userId, scope, key);
    const entries = rows
      .map((row) => ({ row, share: contribution(row) }))
      .filter(({ share }) => share !== null)
      .map(({ row, share }) => busEvidenceEntry(row, { contribution: share as number }));
    return domainSumEvidence({ key, unit, scope, page, entries, value: value(rows, all) });
  };
}

export const resolveBusRideCount = busSum(
  "busRideCount",
  "rides",
  () => 1,
  (rows, all) => computeBusStats(rows, all).rides
);

/** Every distance source together; a ride with no distance measured nothing and is not listed. */
export const resolveBusDistanceKmTotal = busSum(
  "busDistanceKmTotal",
  "km",
  (row) => row.distanceKm,
  (rows, all) => computeBusStats(rows, all).distance.totalKm
);

export const resolveBusNightRideCount = busSum(
  "busNightRideCount",
  "rides",
  (row) => (isNightBusRide(row) ? 1 : null),
  (rows, all) => computeBusStats(rows, all).night.rides
);

export async function resolveBusCountriesCount(
  userId: string,
  scope: EvidenceScope,
  page: PagingParams
): Promise<EvidenceResponse> {
  const key = "busCountriesCount";
  const { rows } = await loadScoped(userId, scope, key);
  const entries = rows
    .map((row) => ({ row, credits: busCountries(row) }))
    .filter(({ credits }) => credits.length > 0)
    .map(({ row, credits }) => busEvidenceEntry(row, { credits }));
  return domainDistinctEvidence({ key, unit: "countries", scope, page, entries });
}

/**
 * Terminals: each ride witnesses its two terminals, identified over EVERY
 * ride (`terminalsOf`) so a year's list names a terminal as the lifetime does.
 */
export async function resolveBusTerminalsCount(
  userId: string,
  scope: EvidenceScope,
  page: PagingParams
): Promise<EvidenceResponse> {
  const key = "busTerminalsCount";
  const { all, rows } = await loadScoped(userId, scope, key);
  const { registry, ends } = terminalsOf(all);
  const entries = rows.map((row) => {
    const e = ends.get(row.id)!;
    const credits = [...new Set([`t${e.dep}`, `t${e.arr}`])];
    return busEvidenceEntry(row, {
      credits,
      creditLabels: Object.fromEntries([e.dep, e.arr].map((id) => [`t${id}`, registry.nameOf(id)])),
    });
  });
  return domainDistinctEvidence({ key, unit: "terminals", scope, page, entries });
}
