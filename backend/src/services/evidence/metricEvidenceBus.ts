import type { EvidenceScope } from "../../shared/evidence";
import type { EvidenceResponse } from "../../schemas/evidence";
import { busCountries } from "../../shared/busCounting";
import { isNightBusRide, terminalsOf } from "../../shared/busRideKinds";
import { busLongestReturn, computeBusStats, loadBusRows, type BusStatsRow } from "../bus/busStats";
import { journeyTransferWaits, railJourneysOf } from "../rail/railJourneyStats";
import { longestRide } from "../rail/railStats";
import { rideHoursOnBoard } from "../../shared/railClock";
import type { PagingParams } from "./paging";
import { busEvidenceEntry } from "./entryMappersRentalBus";
import {
  domainDistinctEvidence,
  domainSumEvidence,
  readDayScope,
  requireLifetime,
} from "./domainMeasureResponse";
import { localDay } from "../../shared/time/instant";

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
  // The day a ride left on its departure terminal's calendar (`busYear`'s day).
  const inPeriod = readDayScope(scope, key);
  const all = await loadBusRows(userId);
  return {
    all,
    rows:
      inPeriod === undefined
        ? all
        : all.filter((r) => inPeriod(localDay(r.departureTime, r.depTimezone ?? "UTC"))),
  };
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

const round1 = (n: number): number => Math.round(n * 10) / 10;

/** Hours on board: each ride with both clocks contributes its own (`rideHoursOnBoard`). */
export async function resolveBusHoursOnBoard(
  userId: string,
  scope: EvidenceScope,
  page: PagingParams
): Promise<EvidenceResponse> {
  const key = "busHoursOnBoard";
  const { all, rows } = await loadScoped(userId, scope, key);
  const entries = rows
    .map((row) => ({ row, hours: rideHoursOnBoard(row) }))
    .filter(({ hours }) => hours !== null)
    .map(({ row, hours }) => busEvidenceEntry(row, { contribution: hours as number }));
  const value = computeBusStats(rows, all).hoursOnBoard.hours;
  return domainSumEvidence({ key, unit: "hours", scope, page, entries, value, round: round1 });
}

/**
 * The changes the average change time is taken over, journey by journey —
 * rail's grouping rule, listed under each journey's first ride.
 */
export async function resolveBusTransferCount(
  userId: string,
  scope: EvidenceScope,
  page: PagingParams
): Promise<EvidenceResponse> {
  const key = "busTransferCount";
  const { all, rows } = await loadScoped(userId, scope, key);
  const entries = railJourneysOf(rows)
    .map((journey) => ({ journey, waits: journeyTransferWaits(journey).length }))
    .filter(({ waits }) => waits > 0)
    .map(({ journey, waits }) => {
      const first = journey[0];
      const last = journey[journey.length - 1];
      return busEvidenceEntry(
        { ...first, arrStationName: last.arrStationName },
        { contribution: waits }
      );
    });
  const value = computeBusStats(rows, all).transfers.count;
  return domainSumEvidence({ key, unit: "transfers", scope, page, entries, value });
}

/** The longest ride (a record) as its one witness — a one-row sum, as rail's. */
export async function resolveBusLongestRide(
  userId: string,
  scope: EvidenceScope,
  page: PagingParams
): Promise<EvidenceResponse> {
  const key = "busLongestRide";
  const { rows } = await loadScoped(userId, scope, key);
  const best = longestRide(rows);
  const km = best ? (best.distanceKm as number) : null;
  const entries = best ? [busEvidenceEntry(best, { contribution: km as number })] : [];
  return domainSumEvidence({
    key,
    unit: "km",
    scope,
    page,
    entries,
    value: km,
    abstained: rows.length,
  });
}

/**
 * The longest pause before coming back to a terminal — a LIFETIME figure on
 * the tab whatever year is picked, so it is served for `allTime` only. Its
 * witness is the ride that came back, contributing the days of the pause.
 */
export async function resolveBusLongestReturn(
  userId: string,
  scope: EvidenceScope,
  page: PagingParams
): Promise<EvidenceResponse> {
  const key = "busLongestReturn";
  requireLifetime(scope, key);
  const all = await loadBusRows(userId);
  const best = busLongestReturn(all);
  const ride = best ? all.find((r) => r.id === best.rideId) : undefined;
  const entries = best && ride ? [busEvidenceEntry(ride, { contribution: best.days })] : [];
  return domainSumEvidence({
    key,
    unit: "days",
    scope,
    page,
    entries,
    value: best?.days ?? null,
    abstained: all.length,
  });
}
